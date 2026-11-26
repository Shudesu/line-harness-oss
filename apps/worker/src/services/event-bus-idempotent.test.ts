import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { fireEvent } from './event-bus.js';
import { conversions } from '../routes/conversions.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('fireEvent with an operationId (idempotent dispatch)', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let webhookStatus: number;
  let deliveries: Array<string | null>;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('account-a','channel-a','A','synthetic-token-a','synthetic-secret')");
    fixture.sqlite.exec("INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('friend-a','line-friend-a','account-a','Synthetic friend')");
    fixture.sqlite.exec("INSERT INTO conversion_points(id,name,event_type) VALUES('point-a','Purchase','purchase')");
    fixture.sqlite.exec("INSERT INTO scoring_rules(id,name,event_type,score_value) VALUES('rule-1','Purchase points','cv_fire',10)");
    fixture.sqlite.exec(`INSERT INTO outgoing_webhooks(id,name,url,event_types) VALUES('hook-1','Synthetic','https://hook.example/in','["cv_fire"]')`);
    fixture.sqlite.exec(`INSERT INTO automations(id,name,event_type,conditions,actions,line_account_id) VALUES('auto-1','Synthetic','cv_fire','{}','[{"type":"set_metadata","params":{"data":"{\\"buyer\\":\\"yes\\"}"}}]','account-a')`);
    webhookStatus = 200;
    deliveries = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      deliveries.push(new Headers(init?.headers).get('X-Webhook-Event-Id'));
      return new Response(null, { status: webhookStatus });
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    fixture.sqlite.close();
    vi.restoreAllMocks();
  });

  const fire = (operationId?: string) =>
    fireEvent(fixture.db, 'cv_fire', { friendId: 'friend-a', eventData: {} }, 'synthetic-token-a', 'account-a', undefined, operationId ? { operationId } : undefined);
  const state = () => ({
    score: (fixture.sqlite.prepare("SELECT score FROM friends WHERE id='friend-a'").get() as { score: number }).score,
    ledger: (fixture.sqlite.prepare('SELECT count(*) n FROM friend_scores').get() as { n: number }).n,
    automations: (fixture.sqlite.prepare('SELECT count(*) n FROM automation_logs').get() as { n: number }).n,
    webhooks: deliveries.length,
  });

  it('runs every effect on every call without an operationId (unchanged)', async () => {
    await fire();
    await fire();
    expect(state()).toEqual({ score: 20, ledger: 2, automations: 2, webhooks: 2 });
    expect(deliveries).toEqual([null, null]);
    expect((fixture.sqlite.prepare("SELECT count(*) n FROM api_idempotency_keys").get() as { n: number }).n).toBe(0);
  });

  it('runs each effect once per operation, and separately for another operation', async () => {
    await fire('op-1');
    await fire('op-1');
    expect(state()).toEqual({ score: 10, ledger: 1, automations: 1, webhooks: 1 });
    await fire('op-2');
    expect(state()).toEqual({ score: 20, ledger: 2, automations: 2, webhooks: 2 });
    expect(deliveries[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(deliveries[1]).not.toBe(deliveries[0]);
  });

  it('sends a webhook again until it is delivered, keeps no "sending" state, and never repeats a delivered one', async () => {
    const records = () => fixture.sqlite.prepare("SELECT status FROM api_idempotency_keys WHERE scope LIKE 'event-webhook:%'").all();
    webhookStatus = 500;
    await fire('op-1');
    expect(records()).toEqual([]);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Synthetic network failure'));
    await fire('op-1');
    expect(records()).toEqual([]);
    webhookStatus = 200;
    await fire('op-1');
    await fire('op-1');
    expect(records()).toEqual([{ status: 'completed' }]);
    expect(state()).toEqual({ score: 10, ledger: 1, automations: 1, webhooks: 2 });
    expect(deliveries[1]).toBe(deliveries[0]);
  });

  // where the first attempt fails → the retry runs the handler again and must not repeat finished effects
  it.each([
    ['the score read after webhook + scoring', /SELECT score FROM friends/],
    ['storing the completed response, after every effect ran', /SET status = 'completed'/],
  ])('does not repeat finished effects when %s fails and the request is retried', async (_label, failing) => {
    const app = new Hono();
    app.route('/', conversions);
    const track = () => app.request('/api/conversions/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'payment-1' },
      body: JSON.stringify({ conversionPointId: 'point-a', friendId: 'friend-a', fireEvent: true }),
    }, { DB: fixture.db });

    const prepare = fixture.db.prepare.bind(fixture.db);
    let failed = false;
    vi.spyOn(fixture.db, 'prepare').mockImplementation((sql: string) => {
      if (!failed && failing.test(sql)) { failed = true; throw new Error('Synthetic failure in the middle of the request'); }
      return prepare(sql);
    });

    expect((await track()).status).toBe(500);
    expect(failed).toBe(true);
    // A failed store leaves the lease running; end it as time would.
    fixture.sqlite.exec("UPDATE api_idempotency_keys SET locked_until = 0 WHERE scope = 'conversion'");
    expect((await track()).status).toBe(201);
    expect((await track()).status).toBe(201);
    expect(state()).toEqual({ score: 10, ledger: 1, automations: 1, webhooks: 1 });
    expect((fixture.sqlite.prepare('SELECT count(*) n FROM conversion_events').get() as { n: number }).n).toBe(1);
  });
});
