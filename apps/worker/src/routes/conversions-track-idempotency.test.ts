import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';

const fireEvent = vi.fn();
vi.mock('../services/event-bus.js', () => ({ fireEvent }));
const { conversions } = await import('./conversions.js');

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('POST /api/conversions/track with Idempotency-Key', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('account-a','channel-a','A','synthetic-token-a','synthetic-secret'),('account-b','channel-b','B','synthetic-token-b','synthetic-secret')");
    fixture.sqlite.exec("INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('friend-a','line-friend-a','account-a','Synthetic friend')");
    fixture.sqlite.exec("INSERT INTO conversion_points(id,name,event_type) VALUES('point-a','Purchase','purchase'),('point-b','Other','purchase')");
    fireEvent.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app = new Hono();
    app.route('/', conversions);
  });
  afterEach(() => {
    fixture.sqlite.close();
    vi.restoreAllMocks();
  });

  async function track(body: Record<string, unknown>, key?: string) {
    const response = await app.request('/api/conversions/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key === undefined ? {} : { 'Idempotency-Key': key }) },
      body: JSON.stringify({ conversionPointId: 'point-a', friendId: 'friend-a', ...body }),
    }, { DB: fixture.db });
    const json = await response.json() as { data?: { id: string } };
    return { status: response.status, id: json.data?.id };
  }
  const count = () => (fixture.sqlite.prepare('SELECT count(*) n FROM conversion_events').get() as { n: number }).n;

  it('records a new event per request and never fires cv_fire when no key is given', async () => {
    const first = await track({});
    const second = await track({});
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.id).not.toBe(second.id);
    expect(count()).toBe(2);
    expect(fireEvent).not.toHaveBeenCalled();
    expect((await track({ fireEvent: true })).status).toBe(400);
  });

  it('records once per key, replays the first response, and rejects a different request', async () => {
    const first = await track({ metadata: { amount: 100 } }, 'payment-1');
    expect(first.status).toBe(201);
    expect(await track({ metadata: { amount: 100 } }, 'payment-1')).toEqual(first);
    expect((await track({ metadata: { amount: 999 } }, 'payment-1')).status).toBe(422);
    expect((await track({ conversionPointId: 'point-b', metadata: { amount: 100 } }, 'payment-1')).status).toBe(422);
    expect((await track({ metadata: { amount: 100 }, fireEvent: true }, 'payment-1')).status).toBe(422);
    expect((await track({}, 'payment-2')).status).toBe(201);
    expect(count()).toBe(2);
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('fires cv_fire for the friend\'s own account, once, and resumes after a failed attempt', async () => {
    fireEvent.mockRejectedValueOnce(new Error('Synthetic crash after the row was written'));
    expect((await track({ fireEvent: true, metadata: { amount: 100 } }, 'payment-1')).status).toBe(500);
    expect(count()).toBe(1);

    const retry = await track({ fireEvent: true, metadata: { amount: 100 } }, 'payment-1');
    expect(retry.status).toBe(201);
    expect(count()).toBe(1);
    expect(fireEvent).toHaveBeenCalledTimes(2);
    expect(fireEvent).toHaveBeenLastCalledWith(
      fixture.db,
      'cv_fire',
      { friendId: 'friend-a', eventData: { amount: 100, conversionPointId: 'point-a', conversionEventId: retry.id } },
      'synthetic-token-a',
      'account-a',
    );

    expect(await track({ fireEvent: true, metadata: { amount: 100 } }, 'payment-1')).toEqual(retry);
    expect(fireEvent).toHaveBeenCalledTimes(2);
  });

  it('answers 409 while the same key is in progress, so cv_fire is not fired twice', async () => {
    let release!: () => void;
    fireEvent.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = track({ fireEvent: true }, 'payment-1');
    await vi.waitFor(() => expect(fireEvent).toHaveBeenCalledTimes(1));
    expect((await track({ fireEvent: true }, 'payment-1')).status).toBe(409);
    release();
    expect((await first).status).toBe(201);
    expect(fireEvent).toHaveBeenCalledTimes(1);
    expect(count()).toBe(1);
  });

  it('refuses fireEvent when the friend\'s account cannot be determined, instead of reaching every account', async () => {
    fixture.sqlite.exec("INSERT INTO friends(id,line_user_id,display_name) VALUES('friend-unassigned','line-friend-u','Synthetic unassigned')");
    expect((await track({ fireEvent: true, friendId: 'friend-unassigned' }, 'payment-1')).status).toBe(422);
    expect(fireEvent).not.toHaveBeenCalled();
    expect(count()).toBe(0);
    expect((await track({ friendId: 'friend-unassigned' }, 'payment-1')).status).toBe(201);
  });

  it('does not fire for a conversion that cannot be recorded', async () => {
    expect((await track({ fireEvent: true, friendId: 'friend-missing' }, 'payment-1')).status).toBe(404);
    expect((await track({ fireEvent: true, conversionPointId: 'point-missing' }, 'payment-2')).status).toBe(500);
    expect((await track({ fireEvent: true, conversionPointId: 'point-missing' }, 'payment-2')).status).toBe(500);
    expect(fireEvent).not.toHaveBeenCalled();
    expect(count()).toBe(0);
  });
});
