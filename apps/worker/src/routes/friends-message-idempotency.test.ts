import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { friends } from './friends.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('POST /api/friends/:id/messages with Idempotency-Key', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono;
  let pushes: Array<{ to: string; retryKey: string | undefined }>;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('account-a','channel-a','Synthetic account','synthetic-token','synthetic-secret')");
    for (const id of ['a', 'b']) {
      fixture.sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES(?,?,?,?)')
        .run(`friend-${id}`, `line-friend-${id}`, 'account-a', 'Synthetic friend');
    }
    pushes = [];
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network is forbidden in this test'));
    vi.spyOn(LineClient.prototype, 'request').mockImplementation(async (_method, path, body, headers) => {
      expect(path).toBe('/v2/bot/message/push');
      pushes.push({ to: (body as { to: string }).to, retryKey: headers?.['X-Line-Retry-Key'] });
      return { data: {}, headers: new Headers() };
    });
    app = new Hono();
    app.route('/', friends);
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    fixture.sqlite.close();
    vi.restoreAllMocks();
  });

  async function send(content: string, key?: string, friend = 'friend-a', extra: Record<string, unknown> = {}) {
    const response = await app.request(`https://worker.example/api/friends/${friend}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key === undefined ? {} : { 'Idempotency-Key': key }) },
      body: JSON.stringify({ content, ...extra }),
    }, { DB: fixture.db, LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-default' });
    const body = await response.json() as { data?: { messageId: string } };
    return { status: response.status, messageId: body.data?.messageId };
  }
  const logs = () => fixture.sqlite.prepare('SELECT id, friend_id, content FROM messages_log ORDER BY friend_id').all() as Array<{ id: string; friend_id: string; content: string }>;

  it('keeps sending and logging every request when no key is given', async () => {
    const first = await send('hello');
    const second = await send('hello');
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.messageId).not.toBe(second.messageId);
    expect(pushes).toEqual([{ to: 'line-friend-a', retryKey: undefined }, { to: 'line-friend-a', retryKey: undefined }]);
    // Unkeyed sends call the LINE client with exactly the original arguments.
    const push = vi.spyOn(LineClient.prototype, 'pushMessage');
    await send('hello');
    expect(push.mock.calls.map((args) => args.length)).toEqual([2]);
    expect(logs()).toHaveLength(3);
  });

  it('delivers and logs once, and replays the original messageId on retry', async () => {
    const first = await send('hello', 'order-1');
    const retry = await send('hello', 'order-1');
    expect(first.status).toBe(200);
    expect(retry).toEqual(first);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].retryKey).toMatch(UUID);
    expect(logs()).toEqual([{ id: first.messageId, friend_id: 'friend-a', content: 'hello' }]);
  });

  it('binds the key to the first message even when that attempt failed after delivery', async () => {
    const insert = fixture.sqlite.prepare.bind(fixture.sqlite);
    let failLog = true;
    vi.spyOn(fixture.sqlite, 'prepare').mockImplementation((sql: string) => {
      if (failLog && /INTO messages_log/.test(sql)) { failLog = false; throw new Error('Synthetic log failure after LINE accepted the push'); }
      return insert(sql);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await send('hello', 'order-1')).status).toBe(500);
    expect((await send('changed', 'order-1')).status).toBe(422);
    const retry = await send('hello', 'order-1');
    expect(retry.status).toBe(200);
    expect(pushes.map((push) => push.retryKey)).toEqual([pushes[0].retryKey, pushes[0].retryKey]);
    expect(logs()).toEqual([{ id: retry.messageId, friend_id: 'friend-a', content: 'hello' }]);
  });

  it('scopes the key to the friend and rejects reuse for a different request', async () => {
    const first = await send('hello', 'order-1');
    const other = await send('hello', 'order-1', 'friend-b');
    expect(other.status).toBe(200);
    expect(other.messageId).not.toBe(first.messageId);
    expect(pushes[1].retryKey).not.toBe(pushes[0].retryKey);
    expect((await send('changed', 'order-1')).status).toBe(422);
    expect((await send('hello', 'order-1', 'friend-a', { altText: 'changed' })).status).toBe(422);
    expect((await send('hello', 'order-1', 'friend-a', { trackLinks: false })).status).toBe(422);
    expect((await send('hello', 'order-2', 'friend-missing')).status).toBe(404);
    expect(pushes).toHaveLength(2);
    expect(logs()).toHaveLength(2);
  });
});
