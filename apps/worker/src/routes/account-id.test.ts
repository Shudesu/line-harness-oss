import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

type SavedChat = { id: string; friend_id: string; line_account_id: string | null; status: string };
type SavedMessage = { friend_id: string; line_account_id: string | null };

let activeDb: MemoryD1;

vi.mock('@line-crm/db', () => ({
  getOperators: vi.fn(),
  getOperatorById: vi.fn(),
  createOperator: vi.fn(),
  updateOperator: vi.fn(),
  deleteOperator: vi.fn(),
  getChats: vi.fn(),
  getChatById: vi.fn(async (_db: D1Database, id: string) => activeDb.chats.find((row) => row.id === id) ?? null),
  createChat: vi.fn(),
  getFriendById: vi.fn(async (_db: D1Database, id: string) => activeDb.friends.get(id) ?? null),
  getLineAccountById: vi.fn(),
  updateChat: vi.fn(),
  upsertFriend: vi.fn(),
  updateFriendFollowStatus: vi.fn(),
  getFriendByLineUserId: vi.fn(async (_db: D1Database, userId: string) => activeDb.friendsByUser.get(userId) ?? null),
  getScenarios: vi.fn().mockResolvedValue([]),
  enrollFriendInScenario: vi.fn(),
  getScenarioSteps: vi.fn(),
  advanceFriendScenario: vi.fn(),
  completeFriendScenario: vi.fn(),
  upsertChatOnMessage: vi.fn(),
  getLineAccounts: vi.fn(async () => activeDb.accounts),
  jstNow: vi.fn(() => '2026-10-20T20:00:00.000+09:00'),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
  addTagToFriend: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  getMessageTemplateById: vi.fn(),
}));

vi.mock('@line-crm/line-sdk', () => ({
  verifySignature: vi.fn(async (secret: string) => secret === activeDb.acceptedSecret),
  LineClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn() }));
vi.mock('../services/step-delivery.js', () => ({ buildMessage: vi.fn(), expandVariables: vi.fn() }));

import { chats } from './chats.js';
import { webhook } from './webhook.js';

class MemoryD1 {
  chats: SavedChat[] = [];
  messages: SavedMessage[] = [];
  friends = new Map<string, { id: string; line_account_id: string | null }>();
  friendsByUser = new Map<string, { id: string; line_account_id: string | null }>();
  accounts = [
    { id: 'account-a', channel_secret: 'secret-a', channel_access_token: 'token-a', is_active: 1 },
    { id: 'account-b', channel_secret: 'secret-b', channel_access_token: 'token-b', is_active: 1 },
  ];
  acceptedSecret = '';

  prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...bound: unknown[]) => {
        values = bound;
        return statement;
      },
      first: async () => {
        if (sql.includes('SELECT * FROM chats WHERE friend_id')) {
          return this.chats.find((row) => row.friend_id === values[0]) ?? null;
        }
        if (sql.includes('SELECT MAX(created_at)')) return { last: null };
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => {
        if (sql.includes('INSERT INTO chats')) {
          this.chats.push({
            id: String(values[0]),
            friend_id: String(values[1]),
            line_account_id: sql.includes('line_account_id') ? values[2] as string | null : null,
            status: 'resolved',
          });
        }
        if (sql.includes('INSERT INTO messages_log')) {
          this.messages.push({
            friend_id: String(values[1]),
            line_account_id: sql.includes('line_account_id') ? values[values.length - 2] as string | null : null,
          });
        }
        return { success: true };
      },
    };
    return statement;
  }
}

const executionCtx = {
  waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;
let pending: Promise<unknown>[];

function messageEvent(userId: string, type: 'text' | 'sticker', sequence: number) {
  return {
    type: 'message',
    replyToken: `reply-${sequence}`,
    source: { type: 'user', userId },
    timestamp: sequence,
    mode: 'active',
    webhookEventId: `event-${sequence}`,
    deliveryContext: { isRedelivery: false },
    message: type === 'text'
      ? { id: `message-${sequence}`, type, text: `plain-${sequence}`, quoteToken: `quote-${sequence}` }
      : { id: `message-${sequence}`, type, packageId: '1', stickerId: '1', quoteToken: `quote-${sequence}` },
  };
}

async function postWebhook(app: Hono, secret: string, event: ReturnType<typeof messageEvent>) {
  activeDb.acceptedSecret = secret;
  await app.request('/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'A'.repeat(43) + '=' },
    body: JSON.stringify({ destination: 'destination', events: [event] }),
  }, {
    DB: activeDb as unknown as D1Database,
    LINE_CHANNEL_SECRET: secret,
    LINE_CHANNEL_ACCESS_TOKEN: 'fallback-token',
  }, executionCtx);
  await Promise.all(pending.splice(0));
}

beforeEach(() => {
  activeDb = new MemoryD1();
  pending = [];
  activeDb.friends.set('friend-a', { id: 'friend-a', line_account_id: 'account-a' });
  activeDb.friends.set('friend-b', { id: 'friend-b', line_account_id: 'account-b' });
  activeDb.friends.set('friend-none', { id: 'friend-none', line_account_id: null });
  activeDb.friendsByUser.set('user-a', { id: 'friend-a', line_account_id: 'account-a' });
  activeDb.friendsByUser.set('user-b', { id: 'friend-b', line_account_id: 'account-b' });
  activeDb.friendsByUser.set('user-none', { id: 'friend-none', line_account_id: null });
});

describe('line-account ownership in worker routes', () => {
  it('lazy-created chats inherit A, B, and NULL ownership and remain scoped', async () => {
    const app = new Hono();
    app.route('/', chats);
    for (const friendId of ['friend-a', 'friend-b', 'friend-none']) {
      const response = await app.request(`/api/chats/${friendId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      }, { DB: activeDb as unknown as D1Database });
      expect(response.status).toBe(200);
    }

    expect(activeDb.chats.map(({ friend_id, line_account_id }) => ({ friend_id, line_account_id }))).toEqual([
      { friend_id: 'friend-a', line_account_id: 'account-a' },
      { friend_id: 'friend-b', line_account_id: 'account-b' },
      { friend_id: 'friend-none', line_account_id: null },
    ]);
    expect(activeDb.chats.filter((row) => row.line_account_id === 'account-a').map((row) => row.friend_id)).toEqual(['friend-a']);
    expect(activeDb.chats.filter((row) => row.line_account_id === 'account-b').map((row) => row.friend_id)).toEqual(['friend-b']);
  });

  it('stores alternating incoming messages under the webhook account, including NULL', async () => {
    const app = new Hono();
    app.route('/', webhook);
    await postWebhook(app, 'secret-a', messageEvent('user-a', 'text', 1));
    await postWebhook(app, 'secret-b', messageEvent('user-b', 'sticker', 2));
    await postWebhook(app, 'secret-a', messageEvent('user-a', 'sticker', 3));
    activeDb.accounts = [];
    await postWebhook(app, 'unregistered-secret', messageEvent('user-none', 'text', 4));

    expect(activeDb.messages).toEqual([
      { friend_id: 'friend-a', line_account_id: 'account-a' },
      { friend_id: 'friend-b', line_account_id: 'account-b' },
      { friend_id: 'friend-a', line_account_id: 'account-a' },
      { friend_id: 'friend-none', line_account_id: null },
    ]);
  });
});
