import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { getFriendTagsByIds } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { authMiddleware } from '../middleware/auth.js';
import { friends } from './friends.js';
import type { Env } from '../index.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
afterEach(() => { vi.restoreAllMocks(); });
function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No external network permitted'));
  sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','synthetic-a','a','synthetic-token','synthetic-secret'),('b','synthetic-b','b','synthetic-token','synthetic-secret')");
  const insert = sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name,created_at) VALUES(?,?,?,?,?)');
  for (let i = 0; i < 205; i++) insert.run(`f-${String(i).padStart(3, '0')}`, `synthetic-user-${i}`, 'a', `Synthetic ${i}`, `2020-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`);
  insert.run('other-account', 'synthetic-other', 'b', 'Other synthetic friend', '2021-01-01');
  sqlite.exec("INSERT INTO tags(id,name,color) VALUES('z','Zebra','#112233'),('a','Alpha','#445566'),('private-tag','Other account tag','#778899')");
  const attach = sqlite.prepare('INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,?)');
  for (let i = 0; i < 204; i++) { attach.run(`f-${String(i).padStart(3, '0')}`, 'z'); attach.run(`f-${String(i).padStart(3, '0')}`, 'a'); }
  attach.run('other-account', 'private-tag');
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const prepare = db.prepare.bind(db);
  vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const entry = { sql, args: [] as unknown[] }; statements.push(entry);
    const statement = prepare(sql), bind = statement.bind.bind(statement);
    statement.bind = (...args: unknown[]) => {
      entry.args = args;
      if (args.length > 100) throw new Error('D1 bind limit exceeded');
      return bind(...args);
    };
    return statement;
  });
  const tagQueries = () => statements.filter(({ sql }) => /JOIN (?:friend_tags|tags) /i.test(sql) && /ft.friend_id/.test(sql));
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', friends);
  async function list(query: string, authorized = true) {
    const response = await app.request(`/api/friends?${query}`, { headers: authorized ? { Authorization: 'Bearer synthetic-owner-key' } : {} }, { DB: db, API_KEY: 'synthetic-owner-key' } as Env['Bindings']);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    return response;
  }
  return { db, sqlite, statements, tagQueries, list };
}

describe('friend list page-scoped tag enrichment (Issue #331)', () => {
  it('uses one tag query for a page and preserves account, pagination, item order and tag shape/name order', async () => {
    const s = setup();
    try {
      const response = await s.list('lineAccountId=a&sort=oldest&limit=2&offset=1');
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { items: Array<{ id: string; tags: Array<{ id: string; name: string; color: string; createdAt: string }> }>; total: number } };
      expect(body.data.total).toBe(205);
      expect(body.data.items.map((friend) => friend.id)).toEqual(['f-001', 'f-002']);
      expect(body.data.items[0].tags.map((tag) => [tag.id, tag.name, tag.color])).toEqual([['a', 'Alpha', '#445566'], ['z', 'Zebra', '#112233']]);
      expect(Object.keys(body.data.items[0].tags[0]).sort()).toEqual(['color', 'createdAt', 'id', 'name']);
      expect(s.tagQueries()).toHaveLength(1);
      expect(s.tagQueries()[0].args).toEqual(['f-001', 'f-002']);
    } finally { s.sqlite.close(); }
  });

  it.each([100, 101, 205])('limits every bind list to 100 for a %i-friend page', async (limit) => {
    const s = setup();
    try {
      const response = await s.list(`lineAccountId=a&sort=oldest&limit=${limit}`);
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { items: Array<{ id: string; tags: unknown[] }> } };
      expect(body.data.items).toHaveLength(limit);
      expect(s.tagQueries()).toHaveLength(Math.ceil(limit / 100));
      expect(s.tagQueries().every((query) => query.args.length <= 100)).toBe(true);
      expect(s.tagQueries().flatMap((query) => query.args)).not.toContain('other-account');
      if (limit === 205) expect(body.data.items[204].tags).toEqual([]);
    } finally { s.sqlite.close(); }
  });

  it('does no tag reads for includeTags=false or an empty selected page', async () => {
    const s = setup();
    try {
      const response = await s.list('lineAccountId=a&includeTags=false&limit=2');
      const body = await response.json() as { data: { items: Array<{ tags: unknown[] }> } };
      expect(body.data.items.every((friend) => friend.tags.length === 0)).toBe(true);
      await s.list('lineAccountId=a&offset=999&limit=2');
      expect(s.tagQueries()).toHaveLength(0);
    } finally { s.sqlite.close(); }
  });

  it('preserves tag filtering and rejects unauthenticated access before the list query', async () => {
    const s = setup();
    try {
      expect((await s.list('lineAccountId=a&tagId=a&limit=2', false)).status).toBe(401);
      expect(s.tagQueries()).toHaveLength(0);
      const response = await s.list('lineAccountId=b&tagId=private-tag&limit=2');
      const body = await response.json() as { data: { items: Array<{ id: string; tags: Array<{ id: string }> }> } };
      expect(body.data.items.map((friend) => friend.id)).toEqual(['other-account']);
      expect(body.data.items[0].tags.map((tag) => tag.id)).toEqual(['private-tag']);
    } finally { s.sqlite.close(); }
  });

  it('the bulk helper deduplicates requested IDs and includes empty results without reading unrelated tags', async () => {
    const s = setup();
    try {
      expect((await getFriendTagsByIds(s.db, [])).size).toBe(0);
      const result = await getFriendTagsByIds(s.db, ['f-204', 'f-000', 'f-000']);
      expect(result.get('f-204')).toEqual([]);
      expect(result.get('f-000')?.map((tag) => tag.name)).toEqual(['Alpha', 'Zebra']);
      expect(result.has('other-account')).toBe(false);
      expect(s.tagQueries()).toHaveLength(1);
      expect(s.tagQueries()[0].args).toEqual(['f-204', 'f-000']);
    } finally { s.sqlite.close(); }
  });
});
