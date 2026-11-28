import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LineClient } from '@line-crm/line-sdk';
import { notifications } from '../routes/notifications.js';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { recordStepDeliveryError } from './step-delivery-errors.js';
import { processStepDeliveries } from './step-delivery.js';

/**
 * PR #211 review round 2 [P2]: a step-delivery diagnostic must be filed under
 * the account the delivery resolved to. `GET /api/notifications?lineAccountId=`
 * filters by exact match, so a NULL line_account_id hides a monthly-limit pause
 * from the per-account screen and monitors.
 */
const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const monthlyLimit = () => new Error('LINE API error: 429 Too Many Requests — {"message":"You have reached your monthly limit."}');

let fixture: ReturnType<typeof sqliteD1>;
beforeEach(() => {
  fixture = sqliteD1();
  fixture.sqlite.exec(schema);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fixture.sqlite.close();
});

interface Listed { id: string; eventType: string; status: string; metadata: { reason?: string } | null }
async function listFor(lineAccountId: string, query = ''): Promise<Listed[]> {
  const app = new Hono();
  app.route('/', notifications);
  const res = await app.request(`/api/notifications?lineAccountId=${lineAccountId}${query}`, {}, { DB: fixture.db });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: Listed[] }).data;
}
const storedAccount = (id: string) =>
  (fixture.sqlite.prepare('SELECT line_account_id FROM notifications WHERE id = ?').get(id) as { line_account_id: string | null } | undefined)?.line_account_id;

it('lists the diagnostic under the delivery account only', async () => {
  await recordStepDeliveryError(fixture.db, 'fs-1', monthlyLimit(), 'account-a');

  expect(storedAccount('step-delivery-error:fs-1')).toBe('account-a');
  const listed = await listFor('account-a');
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ id: 'step-delivery-error:fs-1', eventType: 'step_delivery_error', status: 'failed' });
  expect(listed[0].metadata).toMatchObject({ reason: 'monthly_message_limit' });
  expect(await listFor('account-a', '&status=failed')).toHaveLength(1);
  expect(await listFor('account-b')).toHaveLength(0);
});

it('updates the account on a repeated failure of the same enrollment', async () => {
  // A row written before the account was stored (or before it was known).
  await recordStepDeliveryError(fixture.db, 'fs-1', new Error('fetch failed'));
  expect(storedAccount('step-delivery-error:fs-1')).toBeNull();
  expect(await listFor('account-a')).toHaveLength(0);

  await recordStepDeliveryError(fixture.db, 'fs-1', monthlyLimit(), 'account-a');

  expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM notifications').get()).toEqual({ n: 1 });
  expect(storedAccount('step-delivery-error:fs-1')).toBe('account-a');
  expect((await listFor('account-a'))[0].metadata).toMatchObject({ reason: 'monthly_message_limit' });
});

function seedDueEnrollment(opts: { scenarioAccountId: string | null; friendAccountId: string | null }) {
  const s = fixture.sqlite;
  for (const id of ['account-a', 'account-b']) {
    s.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, ?, ?, ?, 'synthetic-secret')`)
      .run(id, `channel-${id}`, id, `synthetic-token-${id}`);
  }
  s.prepare(`INSERT INTO friends (id, line_user_id, is_following, line_account_id) VALUES ('friend-1', 'synthetic-recipient', 1, ?)`).run(opts.friendAccountId);
  s.prepare(`INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id) VALUES ('scenario-1', 'synthetic', 'manual', 1, ?)`).run(opts.scenarioAccountId);
  s.prepare(`INSERT INTO scenario_steps (id, scenario_id, step_order, message_type, message_content) VALUES ('step-1', 'scenario-1', 1, 'text', 'hello')`).run();
  s.prepare(`INSERT INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at)
    VALUES ('enrollment-1', 'friend-1', 'scenario-1', 0, 'active', '2026-01-01T00:00:00.000+09:00', '2026-01-01T00:00:00.000+09:00')`).run();
}
function failPushWithMonthlyLimit() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ message: 'You have reached your monthly limit.' }), { status: 429, statusText: 'Too Many Requests' }));
}
const unusedDefaultClient = () => ({ pushMessage: vi.fn().mockRejectedValue(new Error('default client must not send')) }) as unknown as LineClient;

it('files a monthly-limit pause under the scenario account end to end', async () => {
  seedDueEnrollment({ scenarioAccountId: 'account-a', friendAccountId: 'account-a' });
  const fetchMock = failPushWithMonthlyLimit();
  const defaultClient = unusedDefaultClient();

  await processStepDeliveries(fixture.db, defaultClient);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((defaultClient.pushMessage as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  expect(fixture.sqlite.prepare(`SELECT status FROM friend_scenarios WHERE id = 'enrollment-1'`).get()).toEqual({ status: 'paused' });
  const listed = await listFor('account-a');
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ id: 'step-delivery-error:enrollment-1', eventType: 'step_delivery_error' });
  expect(listed[0].metadata).toMatchObject({ reason: 'monthly_message_limit', httpStatus: 429 });
  expect(await listFor('account-b')).toHaveLength(0);
});

it('falls back to the friend account when the scenario is not account-bound', async () => {
  seedDueEnrollment({ scenarioAccountId: null, friendAccountId: 'account-b' });
  failPushWithMonthlyLimit();

  await processStepDeliveries(fixture.db, unusedDefaultClient());

  expect(await listFor('account-b')).toHaveLength(1);
  expect(await listFor('account-a')).toHaveLength(0);
});
