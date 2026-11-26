import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { authMiddleware } from '../middleware/auth.js';
import { friends } from './friends.js';
import type { Env } from '../index.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No external network permitted'));
  sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','synthetic-a','a','synthetic-token','synthetic-secret'),('b','synthetic-b','b','synthetic-token','synthetic-secret')");
  const insert = sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES(?,?,?,?)');
  insert.run('friend-a', 'U-synthetic-a', 'a', 'U-synthetic-b');
  insert.run('friend-a2', 'U-synthetic-a-suffix', 'a', 'Synthetic A2');
  insert.run('friend-b', 'U-synthetic-b', 'b', 'Synthetic B');
  insert.run('friend-none', 'U-synthetic-unassigned', null, 'Synthetic unassigned');
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', friends);
  async function list(query: string) {
    const response = await app.request(`/api/friends?${query}`, { headers: { Authorization: 'Bearer synthetic-owner-key' } }, { DB: db, API_KEY: 'synthetic-owner-key' } as Env['Bindings']);
    const body = await response.json() as { success: boolean; data?: { items: Array<{ id: string }>; total: number } };
    return { status: response.status, ids: body.data?.items.map((friend) => friend.id), total: body.data?.total };
  }
  return { sqlite, list };
}

describe('GET /api/friends?lineUserId (exact, account-scoped lookup)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(); });
  afterEach(() => { s.sqlite.close(); vi.restoreAllMocks(); });

  it('returns only the exact match inside the requested account', async () => {
    expect(await s.list('lineUserId=U-synthetic-a&lineAccountId=a')).toEqual({ status: 200, ids: ['friend-a'], total: 1 });
  });

  it.each([
    ['a friend of another account', 'lineUserId=U-synthetic-b&lineAccountId=a'],
    ['a friend without an account', 'lineUserId=U-synthetic-unassigned&lineAccountId=a'],
    ['a prefix of a LINE user ID', 'lineUserId=U-synthetic&lineAccountId=a'],
    ['an unknown LINE user ID', 'lineUserId=U-synthetic-missing&lineAccountId=a'],
  ])('returns an empty list without fallback for %s', async (_label, query) => {
    expect(await s.list(query)).toEqual({ status: 200, ids: [], total: 0 });
  });

  it.each(['lineUserId=U-synthetic-a', 'lineUserId=&lineAccountId=a', 'lineUserId=U-synthetic-a&lineAccountId='])(
    'rejects %s instead of widening the lookup',
    async (query) => {
      expect((await s.list(query)).status).toBe(400);
    },
  );

  it('leaves the existing list and display-name search untouched', async () => {
    expect((await s.list('lineAccountId=a')).total).toBe(2);
    expect((await s.list('search=U-synthetic-b')).ids).toEqual(['friend-a']);
  });
});
