import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { LineClient, type Message } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import {
  ScheduledMessageValidationError,
  createScheduledMessage,
  processDueFriendScheduledMessages,
  validateScheduledMessageInput,
} from './friend-scheduled-messages.js';
import { friendScheduledMessages } from '../routes/friend-scheduled-messages.js';
import { friends } from '../routes/friends.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const WORKER = 'https://worker.example';
const NOW = new Date('2026-11-20T09:00:00.000Z'); // 18:00 JST

describe('friend scheduled messages (1:1)', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let requests: Array<{ token: string; to: string; messages: Message[] }>;
  let failDelivery: boolean;

  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    fixture.sqlite.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)')
      .run('account-a', 'channel-a', 'Synthetic account', 'synthetic-token-a', 'synthetic-secret');
    fixture.sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name,is_following) VALUES(?,?,?,?,?)')
      .run('friend-a', 'line-friend-a', 'account-a', 'Synthetic friend', 1);
    fixture.sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name,is_following) VALUES(?,?,?,?,?)')
      .run('friend-blocked', 'line-friend-blocked', 'account-a', 'Blocked friend', 0);
    requests = [];
    failDelivery = false;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network is forbidden in this test'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(LineClient.prototype, 'request').mockImplementation(async function (this: LineClient, method, path, body) {
      expect(method).toBe('POST');
      expect(path).toBe('/v2/bot/message/push');
      requests.push({ token: Reflect.get(this, 'channelAccessToken'), ...(body as { to: string; messages: Message[] }) });
      if (failDelivery) throw new Error('Synthetic delivery failure');
      return { data: {}, headers: new Headers() };
    });
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    fixture.sqlite.close();
    vi.restoreAllMocks();
  });

  async function friend(id = 'friend-a') {
    const { getFriendById } = await import('@line-crm/db');
    return (await getFriendById(fixture.db, id))!;
  }
  function rows() {
    return fixture.sqlite.prepare('SELECT * FROM friend_scheduled_messages ORDER BY send_at').all() as Array<Record<string, unknown>>;
  }
  const opts = (now: Date) => ({ now, defaultAccessToken: 'synthetic-default', workerUrl: WORKER });

  describe('validation', () => {
    it('requires a timezone on sendAt and a future time', () => {
      expect(() => validateScheduledMessageInput({ content: 'x', sendAt: '2026-11-20T19:00:00' }, NOW))
        .toThrow(ScheduledMessageValidationError);
      expect(() => validateScheduledMessageInput({ content: 'x', sendAt: '2026-11-20T18:00:30+09:00' }, NOW))
        .toThrow(/at least 1 minute/);
      expect(() => validateScheduledMessageInput({ content: '  ', sendAt: '2026-11-20T19:00:00+09:00' }, NOW))
        .toThrow(/content is required/);
      expect(() => validateScheduledMessageInput({ content: 'x', messageType: 'video', sendAt: '2026-11-20T19:00:00+09:00' }, NOW))
        .toThrow(/messageType/);
      expect(() => validateScheduledMessageInput({ content: 'x', sendAt: '2028-11-20T19:00:00+09:00' }, NOW))
        .toThrow(/366 days/);
      const ok = validateScheduledMessageInput({ content: 'hello', sendAt: '2026-11-20T19:00:00+09:00' }, NOW);
      expect(ok).toMatchObject({ messageType: 'text', trackLinks: true, sendAtMs: Date.parse('2026-11-20T10:00:00Z') });
    });
  });

  it('sends a due message once, logs it like a manual 1:1 send, and never double-sends on overlapping ticks', async () => {
    const row = await createScheduledMessage(fixture.db, await friend(), { content: 'リマインドです', sendAt: '2026-11-20T19:00:00+09:00' }, { now: NOW, createdBy: 'tester' });
    expect(row.status).toBe('pending');

    // まだ時刻前 → 送らない
    expect(await processDueFriendScheduledMessages(fixture.db, opts(new Date('2026-11-20T09:59:00Z'))))
      .toMatchObject({ sent: 0 });
    expect(requests).toHaveLength(0);

    // 2 つの tick が同時に走っても1回だけ
    const at = new Date('2026-11-20T10:00:30Z');
    const [r1, r2] = await Promise.all([
      processDueFriendScheduledMessages(fixture.db, opts(at)),
      processDueFriendScheduledMessages(fixture.db, opts(at)),
    ]);
    expect(r1.sent + r2.sent).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ token: 'synthetic-token-a', to: 'line-friend-a', messages: [{ type: 'text', text: 'リマインドです' }] });

    const [saved] = rows();
    expect(saved).toMatchObject({ status: 'sent', error: null });
    expect(saved.message_id).toBeTruthy();
    const log = fixture.sqlite.prepare('SELECT id,direction,message_type,content,source FROM messages_log WHERE friend_id=?').get('friend-a');
    expect(log).toEqual({ id: saved.message_id, direction: 'outgoing', message_type: 'text', content: 'リマインドです', source: 'manual' });

    // 後続の tick でも再送しない
    await processDueFriendScheduledMessages(fixture.db, opts(new Date('2026-11-20T10:05:00Z')));
    expect(requests).toHaveLength(1);
  });

  it('does not send cancelled, blocked-friend, stale, or stuck rows', async () => {
    const f = await friend();
    const cancelled = await createScheduledMessage(fixture.db, f, { content: 'c', sendAt: '2026-11-20T19:00:00+09:00' }, { now: NOW, createdBy: null });
    const { cancelScheduledMessage } = await import('./friend-scheduled-messages.js');
    expect(await cancelScheduledMessage(fixture.db, 'friend-a', cancelled.id, 'tester')).toBe('cancelled');
    expect(await cancelScheduledMessage(fixture.db, 'friend-a', cancelled.id, 'tester')).toBe('not_pending');
    expect(await cancelScheduledMessage(fixture.db, 'friend-blocked', cancelled.id, 'tester')).toBe('not_found');

    await createScheduledMessage(fixture.db, await friend('friend-blocked'), { content: 'b', sendAt: '2026-11-20T19:00:00+09:00' }, { now: NOW, createdBy: null });
    const stale = await createScheduledMessage(fixture.db, f, { content: 's', sendAt: '2026-11-20T18:10:00+09:00' }, { now: NOW, createdBy: null });
    // 送信途中で止まった行
    fixture.sqlite.prepare(`INSERT INTO friend_scheduled_messages(id,friend_id,content,send_at,status,claim_token,claimed_at) VALUES('stuck','friend-a','x',?, 'sending','tok',?)`)
      .run(Date.parse('2026-11-20T09:00:00Z'), Date.parse('2026-11-20T09:00:00Z'));

    const res = await processDueFriendScheduledMessages(fixture.db, opts(new Date('2026-11-20T13:00:00Z')));
    expect(requests).toHaveLength(0);
    expect(res).toMatchObject({ sent: 0, expired: 1, failed: 1, stuck: 1 }); // blocked friend → failed
    const byId = Object.fromEntries(rows().map((r) => [r.id, r]));
    expect(byId[cancelled.id].status).toBe('cancelled');
    expect(byId[stale.id]).toMatchObject({ status: 'failed' });
    expect(String(byId[stale.id].error)).toMatch(/expired/);
    expect(byId.stuck).toMatchObject({ status: 'failed' });

    // 時刻直後なら blocked は送らず failed
    fixture.sqlite.exec("UPDATE friend_scheduled_messages SET status='pending', error=NULL WHERE friend_id='friend-blocked'");
    const res2 = await processDueFriendScheduledMessages(fixture.db, opts(new Date('2026-11-20T10:01:00Z')));
    expect(res2.failed).toBe(1);
    expect(requests).toHaveLength(0);
  });

  it('marks a LINE push error as failed without retrying', async () => {
    await createScheduledMessage(fixture.db, await friend(), { content: 'x', sendAt: '2026-11-20T19:00:00+09:00' }, { now: NOW, createdBy: null });
    failDelivery = true;
    const res = await processDueFriendScheduledMessages(fixture.db, opts(new Date('2026-11-20T10:00:00Z')));
    expect(res.failed).toBe(1);
    expect(rows()[0]).toMatchObject({ status: 'failed' });
    failDelivery = false;
    await processDueFriendScheduledMessages(fixture.db, opts(new Date('2026-11-20T10:05:00Z')));
    expect(requests).toHaveLength(1); // 失敗した1回だけ
  });

  describe('API', () => {
    let app: Hono;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
      app = new Hono();
      app.route('/', friends);
      app.route('/', friendScheduledMessages);
    });
    afterEach(() => vi.useRealTimers());
    const env = () => ({ DB: fixture.db, LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-default' });
    const call = (method: string, path: string, body?: unknown) => app.request(`${WORKER}${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }, env());

    it('creates, lists, and cancels without sending', async () => {
      const created = await call('POST', '/api/friends/friend-a/scheduled-messages', { content: 'hello', sendAt: '2026-11-20T19:00:00+09:00' });
      expect(created.status).toBe(201);
      const { data } = await created.json() as { data: { id: string; sendAt: string; sendAtJst: string; status: string } };
      expect(data).toMatchObject({ sendAt: '2026-11-20T10:00:00.000Z', status: 'pending' });
      expect(data.sendAtJst).toMatch(/^2026-11-20T19:00:00/);

      const list = await (await call('GET', '/api/friends/friend-a/scheduled-messages?status=pending')).json() as { data: unknown[] };
      expect(list.data).toHaveLength(1);
      const all = await (await call('GET', '/api/scheduled-messages?status=pending')).json() as { data: Array<{ friendDisplayName: string }> };
      expect(all.data[0].friendDisplayName).toBe('Synthetic friend');

      expect((await call('DELETE', `/api/friends/friend-a/scheduled-messages/${data.id}`)).status).toBe(200);
      expect((await call('POST', `/api/friends/friend-a/scheduled-messages/${data.id}/cancel`)).status).toBe(409);
      expect((await call('POST', `/api/friends/friend-a/scheduled-messages/nope/cancel`)).status).toBe(404);
      expect(requests).toHaveLength(0);
    });

    it('rejects bad input and unknown friends', async () => {
      expect((await call('POST', '/api/friends/friend-a/scheduled-messages', { content: 'x', sendAt: '2026-11-20T19:00:00' })).status).toBe(400);
      expect((await call('POST', '/api/friends/nobody/scheduled-messages', { content: 'x', sendAt: '2026-11-20T19:00:00+09:00' })).status).toBe(404);
      expect((await call('GET', '/api/friends/friend-a/scheduled-messages?status=weird')).status).toBe(400);
    });

    it('keeps the immediate 1:1 send path working alongside scheduled messages', async () => {
      const res = await call('POST', '/api/friends/friend-a/messages', { content: 'now', trackLinks: false });
      expect(res.status).toBe(200);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ token: 'synthetic-token-a', to: 'line-friend-a', messages: [{ type: 'text', text: 'now' }] });
    });
  });
});
