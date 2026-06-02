import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getOperators: vi.fn(),
  getOperatorById: vi.fn(),
  createOperator: vi.fn(),
  updateOperator: vi.fn(),
  deleteOperator: vi.fn(),
  getChats: vi.fn(),
  getChatById: vi.fn(),
  createChat: vi.fn(),
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
  updateChat: vi.fn(),
  jstNow: vi.fn(() => '2026-06-03T12:00:00.000'),
};
vi.mock('@line-crm/db', () => dbMocks);

const lineClientMocks = {
  pushTextMessage: vi.fn(),
  pushFlexMessage: vi.fn(),
  pushImageMessage: vi.fn(),
};
const lineClientCtor = vi.fn(() => lineClientMocks);
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: lineClientCtor,
}));

const { chats } = await import('./chats.js');

type CapturedStatement = {
  sql: string;
  binds: unknown[];
};

function makeDbStub(captured: CapturedStatement[]): D1Database {
  return {
    prepare: vi.fn((sql: string) => {
      const stmt = {
        bind: vi.fn((...binds: unknown[]) => {
          captured.push({ sql, binds });
          return {
            run: vi.fn().mockResolvedValue({ success: true }),
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [] }),
          };
        }),
      };
      return stmt;
    }),
  } as unknown as D1Database;
}

function setupApp(db: D1Database) {
  const app = new Hono<{
    Bindings: { DB: D1Database; LINE_CHANNEL_ACCESS_TOKEN: string };
  }>();
  app.route('/', chats);
  return {
    app,
    env: { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'default-token' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(dbMocks)) fn.mockReset?.();
  dbMocks.jstNow.mockReturnValue('2026-06-03T12:00:00.000');
});

describe('POST /api/chats/:id/send', () => {
  test('logs admin text pushes with delivery_type=push, source=manual, and line_account_id', async () => {
    const captured: CapturedStatement[] = [];
    const db = makeDbStub(captured);
    dbMocks.getChatById.mockResolvedValue({
      id: 'chat-1',
      friend_id: 'friend-1',
      operator_id: null,
      status: 'open',
      notes: null,
      last_message_at: null,
      created_at: '2026-06-03T11:00:00.000',
      updated_at: '2026-06-03T11:00:00.000',
    });
    dbMocks.getFriendById.mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U123',
      line_account_id: 'acc-1',
    });
    dbMocks.getLineAccountById.mockResolvedValue({
      id: 'acc-1',
      channel_access_token: 'account-token',
    });
    lineClientMocks.pushTextMessage.mockResolvedValue(undefined);
    dbMocks.updateChat.mockResolvedValue(undefined);

    const { app, env } = setupApp(db);
    const res = await app.request(
      '/api/chats/chat-1/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageType: 'text', content: 'テスト送信です' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(lineClientCtor).toHaveBeenCalledWith('account-token');
    expect(lineClientMocks.pushTextMessage).toHaveBeenCalledWith('U123', 'テスト送信です');

    const insert = captured.find((c) => c.sql.includes('INSERT INTO messages_log'));
    expect(insert).toBeDefined();
    expect(insert?.sql).toContain('delivery_type');
    expect(insert?.sql).toContain('line_account_id');
    expect(insert?.binds.slice(1)).toEqual([
      'friend-1',
      'text',
      'テスト送信です',
      'acc-1',
      '2026-06-03T12:00:00.000',
    ]);
    expect(dbMocks.updateChat).toHaveBeenCalledWith(db, 'chat-1', {
      status: 'in_progress',
      lastMessageAt: '2026-06-03T12:00:00.000',
    });
  });

  test('rejects unsupported message types before writing a log', async () => {
    const captured: CapturedStatement[] = [];
    const db = makeDbStub(captured);
    dbMocks.getChatById.mockResolvedValue({
      id: 'chat-1',
      friend_id: 'friend-1',
      operator_id: null,
      status: 'open',
      notes: null,
      last_message_at: null,
      created_at: '2026-06-03T11:00:00.000',
      updated_at: '2026-06-03T11:00:00.000',
    });
    dbMocks.getFriendById.mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U123',
      line_account_id: null,
    });

    const { app, env } = setupApp(db);
    const res = await app.request(
      '/api/chats/chat-1/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageType: 'video', content: 'x' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(lineClientMocks.pushTextMessage).not.toHaveBeenCalled();
    expect(captured.some((c) => c.sql.includes('INSERT INTO messages_log'))).toBe(false);
  });
});
