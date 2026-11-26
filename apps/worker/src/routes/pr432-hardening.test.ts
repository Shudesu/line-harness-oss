// Regression cases from the PR review. Synthetic data; all traffic is mocked.
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { conversions } from './conversions.js';
import { friends } from './friends.js';

let fixture: ReturnType<typeof sqliteD1>;
let app: Hono;
const initialTime = 1_800_000_000_000;
beforeEach(() => {
  fixture = sqliteD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
  fixture.sqlite.exec(`
    INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
      VALUES('review-account','review-channel','Synthetic','synthetic-token','synthetic-secret');
    INSERT INTO friends(id,line_user_id,line_account_id,display_name)
      VALUES('review-friend','synthetic-line-user','review-account','Synthetic');
    INSERT INTO conversion_points(id,name,event_type) VALUES('review-point','Synthetic','purchase');
  `);
  app = new Hono();
  app.route('/', conversions);
  app.route('/', friends);
  vi.spyOn(Date, 'now').mockReturnValue(initialTime);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden in review'));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  fixture.sqlite.close();
});
const track = () => app.request('/api/conversions/track', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-event' },
  body: JSON.stringify({ conversionPointId: 'review-point', friendId: 'review-friend', fireEvent: true }),
}, { DB: fixture.db });
const send = () => app.request('https://worker.example/api/friends/review-friend/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-send' },
  body: JSON.stringify({ content: 'Synthetic', trackLinks: false }),
}, { DB: fixture.db });

it('sends once when a live automation outlasts the API lease, then replays after completion', async () => {
  fixture.sqlite.prepare(`INSERT INTO automations(id,name,event_type,conditions,actions,line_account_id)
    VALUES('review-auto','Synthetic','cv_fire','{}',?,'review-account')`)
    .run(JSON.stringify([{ type: 'send_message', params: { content: 'Synthetic' } }]));
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const retryKeys: Array<string | undefined> = [];
  vi.spyOn(LineClient.prototype, 'request').mockImplementation(async (_method, path, _body, headers) => {
    expect(path).toBe('/v2/bot/message/push');
    retryKeys.push(headers?.['X-Line-Retry-Key']);
    if (retryKeys.length === 1) await blocked;
    return { data: {}, headers: new Headers() };
  });
  const first = track();
  await vi.waitFor(() => expect(retryKeys).toHaveLength(1));
  vi.mocked(Date.now).mockReturnValue(initialTime + 300_001);
  const second = await track();
  release();
  expect([(await first).status, second.status]).toEqual([201, 409]);
  expect(await second.json()).toMatchObject({ code: 'line_send_in_progress', requiresReview: false });
  expect((await track()).status).toBe(201);
  expect(retryKeys).toHaveLength(1);
  expect(retryKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(fixture.sqlite.prepare('SELECT status FROM api_line_sends').get()).toEqual({ status: 'completed' });
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM automation_logs').get()).toEqual({ n: 1 });
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM messages_log').get()).toEqual({ n: 1 });
});

it('requires manual review after a log failure and 25 hours, without a second delivery', async () => {
  // Model LINE's documented 24-hour retry-key validity, without a network call.
  const accepted = new Map<string, number>();
  let deliveries = 0;
  vi.spyOn(LineClient.prototype, 'request').mockImplementation(async (_method, _path, _body, headers) => {
    const key = headers!['X-Line-Retry-Key'];
    const previous = accepted.get(key);
    if (previous === undefined || Date.now() - previous >= 86_400_000) {
      deliveries++;
      accepted.set(key, Date.now());
    }
    return { data: {}, headers: new Headers() };
  });
  const prepare = fixture.db.prepare.bind(fixture.db);
  let failLog = true;
  vi.spyOn(fixture.db, 'prepare').mockImplementation(sql => {
    if (failLog && /INTO messages_log/.test(sql)) {
      failLog = false;
      throw new Error('Synthetic log write failure after accepted push');
    }
    return prepare(sql);
  });
  expect((await send()).status).toBe(500);
  expect(deliveries).toBe(1);
  vi.mocked(Date.now).mockReturnValue(initialTime + 25 * 3_600_000);
  const retry = await send();
  expect(retry.status).toBe(409);
  expect(await retry.json()).toMatchObject({ code: 'line_delivery_requires_review', requiresReview: true });
  expect(deliveries).toBe(1);
  expect(fixture.sqlite.prepare('SELECT first_started_at,status FROM api_line_sends').get())
    .toEqual({ first_started_at: initialTime, status: 'retryable' });
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM messages_log').get()).toEqual({ n: 0 });
});

it('rolls back a failed score UPDATE and retries to one consistent ledger/cache value', async () => {
  fixture.sqlite.exec("INSERT INTO scoring_rules(id,name,event_type,score_value) VALUES('review-rule','Synthetic','cv_fire',10)");
  // Fail at execution, after the INSERT actually ran inside the batch.
  fixture.sqlite.exec(`CREATE TRIGGER fail_score BEFORE UPDATE OF score ON friends
    BEGIN SELECT RAISE(ABORT, 'Synthetic score UPDATE failure'); END`);
  expect((await track()).status).toBe(500);
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM friend_scores').get()).toEqual({ n: 0 });
  expect(fixture.sqlite.prepare("SELECT score FROM friends WHERE id='review-friend'").get()).toEqual({ score: 0 });
  expect(fixture.sqlite.prepare("SELECT status FROM api_idempotency_keys WHERE scope='conversion'").get()).toEqual({ status: 'processing' });
  fixture.sqlite.exec('DROP TRIGGER fail_score');
  expect((await track()).status).toBe(201);
  expect((await track()).status).toBe(201);
  expect(fixture.sqlite.prepare("SELECT score FROM friends WHERE id='review-friend'").get()).toEqual({ score: 10 });
  expect(fixture.sqlite.prepare('SELECT sum(score_change) total FROM friend_scores').get()).toEqual({ total: 10 });
});

it('confirms a direct send failure is not completed and the same key remains retryable', async () => {
  vi.spyOn(LineClient.prototype, 'request')
    .mockRejectedValueOnce(new Error('Synthetic upstream send failure'))
    .mockResolvedValue({ data: {}, headers: new Headers() });
  expect((await send()).status).toBe(500);
  expect(fixture.sqlite.prepare("SELECT status,locked_until FROM api_idempotency_keys WHERE scope LIKE 'friend-message:%'").get())
    .toEqual({ status: 'processing', locked_until: 0 });
  expect((await send()).status).toBe(200);
});

it('confirms ordinary concurrent direct sends execute once while the lease is live', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const request = vi.spyOn(LineClient.prototype, 'request').mockImplementation(async () => {
    await blocked;
    return { data: {}, headers: new Headers() };
  });
  const first = send();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect((await send()).status).toBe(409);
  release();
  expect((await first).status).toBe(200);
  expect((await send()).headers.get('Idempotency-Replayed')).toBe('true');
  expect(request).toHaveBeenCalledTimes(1);
});

it('confirms the exact lookup remains authenticated and uses an existing equality index', async () => {
  const { authMiddleware } = await import('../middleware/auth.js');
  const authenticated = new Hono();
  authenticated.use('*', authMiddleware);
  authenticated.route('/', friends);
  const response = await authenticated.request('/api/friends?lineUserId=synthetic-line-user&lineAccountId=review-account', {},
    { DB: fixture.db, API_KEY: 'synthetic-owner-key' });
  expect(response.status).toBe(401);
  const plans = fixture.sqlite.prepare(`EXPLAIN QUERY PLAN SELECT f.* FROM friends f
    WHERE f.line_account_id=? AND f.line_user_id=? ORDER BY f.created_at DESC LIMIT ? OFFSET ?`)
    .all('review-account', 'synthetic-line-user', 1, 0) as Array<{ detail: string }>;
  expect(plans.some(row => /SEARCH f USING INDEX .*\(line_user_id=\?\)/.test(row.detail))).toBe(true);
  expect(plans.some(row => /SCAN f/.test(row.detail))).toBe(false);
});


it('resumes the failed second action without resending the completed first action', async () => {
  fixture.sqlite.prepare(`INSERT INTO automations(id,name,event_type,conditions,actions,line_account_id)
    VALUES('review-auto','Synthetic','cv_fire','{}',?,'review-account')`)
    .run(JSON.stringify([
      { type: 'send_message', params: { content: 'First' } },
      { type: 'send_message', params: { content: 'Second' } },
    ]));
  const keys: string[] = [];
  const bodies: unknown[] = [];
  vi.spyOn(LineClient.prototype, 'request').mockImplementation(async (_method, _path, body, headers) => {
    keys.push(headers!['X-Line-Retry-Key']);
    bodies.push(body);
    if (keys.length === 2) throw new Error('Synthetic second action failure');
    return { data: {}, headers: new Headers() };
  });
  expect((await track()).status).toBe(500);
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM automation_logs').get()).toEqual({ n: 0 });
  expect((await track()).status).toBe(201);
  expect(keys).toHaveLength(3);
  expect(keys[0]).not.toBe(keys[1]);
  expect(keys[1]).toBe(keys[2]);
  expect(bodies[1]).toEqual(bodies[2]);
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM messages_log').get()).toEqual({ n: 2 });
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM automation_logs').get()).toEqual({ n: 1 });
});
