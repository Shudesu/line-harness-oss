import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@line-crm/db', () => ({
  getOperators: vi.fn(),
  getOperatorById: vi.fn(),
  createOperator: vi.fn(),
  updateOperator: vi.fn(),
  deleteOperator: vi.fn(),
  getChats: vi.fn(),
  createChat: vi.fn(),
  getChatById: vi.fn(async () => ({ id: 'chat-1', friend_id: 'friend-1' })),
  getFriendById: vi.fn(async () => ({
    id: 'friend-1',
    line_user_id: `U${'1'.repeat(32)}`,
    line_account_id: 'account-1',
  })),
  getLineAccountById: vi.fn(async () => ({ channel_access_token: 'account-token' })),
  updateChat: vi.fn(async () => ({})),
  jstNow: vi.fn(() => '2026-08-24T12:00:00.000+09:00'),
}));

const pushTextMessage = vi.fn(async () => ({}));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class {
    pushTextMessage = pushTextMessage;
  },
}));

const autoTrackContent = vi.fn(async (_db: unknown, messageType: string) => ({
  messageType,
  content: 'see https://worker.test/t/Ab3xY9k',
}));
const appendFriendToTrackedLinks = vi.fn(async (_db: unknown, content: string) => content);
vi.mock('../services/auto-track.js', () => ({
  autoTrackContent: (...args: unknown[]) => autoTrackContent(...(args as [unknown, string])),
  appendFriendToTrackedLinks: (...args: unknown[]) =>
    appendFriendToTrackedLinks(...(args as [unknown, string])),
}));

import { chats } from './chats.js';

function fakeDb() {
  const db = {
    prepare(sql: string) {
      const statement = {
        bind(..._params: unknown[]) {
          return statement;
        },
        async run() {
          return { success: true };
        },
        async all() {
          return { results: [] };
        },
        async first() {
          return null;
        },
      };
      void sql;
      return statement;
    },
  };
  return db as unknown as D1Database;
}

function app() {
  const a = new Hono();
  a.route('/', chats);
  return a;
}

function send(body: Record<string, unknown>) {
  return app().request(
    new Request('http://worker.test/api/chats/chat-1/send', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    {},
    { DB: fakeDb(), LINE_CHANNEL_ACCESS_TOKEN: 'default-token', WORKER_URL: 'https://worker.test' } as never,
  );
}

describe('POST /api/chats/:id/send link tracking', () => {
  beforeEach(() => {
    pushTextMessage.mockClear();
    autoTrackContent.mockClear();
    appendFriendToTrackedLinks.mockClear();
  });

  test('wraps URLs before pushing, same as the friends message route', async () => {
    const response = await send({ content: 'see https://example.com/join' });

    expect(response.status).toBe(200);
    expect(autoTrackContent).toHaveBeenCalledWith(
      expect.anything(),
      'text',
      'see https://example.com/join',
      'https://worker.test',
      { lineAccountId: 'account-1' },
    );
    // The tracked content (not the raw body) is what reaches LINE.
    expect(pushTextMessage).toHaveBeenCalledWith(
      `U${'1'.repeat(32)}`,
      'see https://worker.test/t/Ab3xY9k',
    );
  });

  test('trackLinks=false sends the content as-is', async () => {
    const response = await send({ content: 'see https://example.com/join', trackLinks: false });

    expect(response.status).toBe(200);
    expect(autoTrackContent).not.toHaveBeenCalled();
    // Friend attribution on pre-existing /t links still runs.
    expect(appendFriendToTrackedLinks).toHaveBeenCalled();
    expect(pushTextMessage).toHaveBeenCalledWith(`U${'1'.repeat(32)}`, 'see https://example.com/join');
  });
});
