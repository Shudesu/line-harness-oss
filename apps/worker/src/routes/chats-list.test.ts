import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@line-crm/db', () => ({
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
  jstNow: vi.fn(() => '2026-08-12T21:00:00.000+09:00'),
}));

import { chats } from './chats.js';

type Query = { sql: string; params: unknown[] };

function fakeDb(row: Record<string, unknown>) {
  const queries: Query[] = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          statement.params = params;
          return statement;
        },
        async all() {
          queries.push({ sql, params: statement.params });
          return { results: [row] };
        },
      };
      return statement;
    },
  };
  return { db: db as unknown as D1Database, queries };
}

describe('GET /api/chats list preview', () => {
  test('uses the actual latest message, including proxy outgoing text', async () => {
    const latest = '2026-08-12T20:23:07.867+09:00';
    const { db, queries } = fakeDb({
      id: 'friend-1',
      friend_id: 'friend-1',
      display_name: 'kt',
      picture_url: null,
      line_user_id: `U${'1'.repeat(32)}`,
      line_account_id: 'account-1',
      operator_id: null,
      status: 'in_progress',
      notes: null,
      last_message_at: latest,
      last_message_content: 'proxy manual reply',
      last_message_direction: 'outgoing',
      last_message_type: 'text',
      created_at: latest,
      updated_at: latest,
    });
    const app = new Hono();
    app.route('/', chats);

    const response = await app.request(
      new Request('http://worker.test/api/chats'),
      {},
      { DB: db } as never,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: Array<{
        lastMessageAt: string;
        lastMessageContent: string;
        lastMessageDirection: string;
      }>;
    };
    expect(body.data[0]).toMatchObject({
      lastMessageAt: latest,
      lastMessageContent: 'proxy manual reply',
      lastMessageDirection: 'outgoing',
    });

    const listSql = queries[0].sql;
    expect(listSql).toContain('FROM any_agg');
    expect(listSql).not.toContain('in_agg AS');
    expect(listSql).not.toContain("WHERE direction = 'incoming'");
  });
});
