import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';

const fireEvent = vi.fn();
vi.mock('../services/event-bus.js', () => ({ fireEvent }));
const { friends } = await import('./friends.js');

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('friend tag routes with Idempotency-Key', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec("INSERT INTO friends(id,line_user_id,display_name) VALUES('friend-a','line-friend-a','Synthetic A'),('friend-b','line-friend-b','Synthetic B')");
    fixture.sqlite.exec("INSERT INTO tags(id,name,color) VALUES('tag-1','Buyer','#112233'),('tag-2','Other','#445566')");
    fireEvent.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app = new Hono();
    app.route('/', friends);
  });
  afterEach(() => {
    fixture.sqlite.close();
    vi.restoreAllMocks();
  });

  async function call(method: 'POST' | 'DELETE', key?: string, tag = 'tag-1', friend = 'friend-a') {
    const headers = { 'Content-Type': 'application/json', ...(key === undefined ? {} : { 'Idempotency-Key': key }) };
    const response = method === 'POST'
      ? await app.request(`/api/friends/${friend}/tags`, { method, headers, body: JSON.stringify({ tagId: tag }) }, { DB: fixture.db })
      : await app.request(`/api/friends/${friend}/tags/${tag}`, { method, headers }, { DB: fixture.db });
    return response.status;
  }
  const count = (table: string) => (fixture.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;
  const fired = () => fireEvent.mock.calls.map((args) => (args[2] as { eventData: { action: string } }).eventData.action);

  it('keeps firing tag_change on every unkeyed call and stores no key', async () => {
    expect([await call('POST'), await call('POST'), await call('DELETE'), await call('DELETE')]).toEqual([201, 201, 200, 200]);
    expect(fired()).toEqual(['add', 'add', 'remove', 'remove']);
    expect(count('api_idempotency_keys')).toBe(0);
    // Unkeyed calls reach the event bus with exactly the original arguments.
    expect(fireEvent.mock.calls.map((args) => args.length)).toEqual([3, 3, 3, 3]);
  });

  it('fires once per key for add and remove, and replays retries without firing', async () => {
    expect([await call('POST', 'order-1'), await call('POST', 'order-1')]).toEqual([201, 201]);
    expect(count('friend_tags')).toBe(1);
    expect([await call('DELETE', 'refund-1'), await call('DELETE', 'refund-1')]).toEqual([200, 200]);
    expect(count('friend_tags')).toBe(0);
    expect(fired()).toEqual(['add', 'remove']);
    // Each keyed request is one operation for the event bus.
    expect(fireEvent.mock.calls.map((args) => args[6])).toEqual([
      { operationId: 'friend-tag:friend-a:order-1' },
      { operationId: 'friend-tag:friend-a:refund-1' },
    ]);
  });

  it('answers 409 while the same key is in progress, so tag_change is not fired twice', async () => {
    let release!: () => void;
    fireEvent.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = call('POST', 'order-1');
    await vi.waitFor(() => expect(fireEvent).toHaveBeenCalledTimes(1));
    expect(await call('POST', 'order-1')).toBe(409);
    expect(await call('POST', 'order-1', 'tag-2')).toBe(422);
    release();
    expect(await first).toBe(201);
    expect(fired()).toEqual(['add']);
    expect(count('friend_tags')).toBe(1);
  });

  it('keeps the key bound to the request after a failed attempt and runs it again on retry', async () => {
    fireEvent.mockRejectedValueOnce(new Error('Synthetic failure after the tag row was written'));
    expect(await call('POST', 'order-1')).toBe(500);
    expect(await call('POST', 'order-1', 'tag-2')).toBe(422);
    expect(await call('POST', 'order-1')).toBe(201);
    expect(await call('POST', 'order-1')).toBe(201);
    expect(fireEvent).toHaveBeenCalledTimes(2);
    expect(count('friend_tags')).toBe(1);
  });

  it('scopes keys to the friend and rejects reuse for a different tag change', async () => {
    expect(await call('POST', 'order-1')).toBe(201);
    expect(await call('POST', 'order-1', 'tag-1', 'friend-b')).toBe(201);
    expect(await call('POST', 'order-1', 'tag-2')).toBe(422);
    expect(await call('DELETE', 'order-1')).toBe(422);
    expect(fired()).toEqual(['add', 'add']);
    expect(count('friend_tags')).toBe(2);
  });

  it('behaves like the unkeyed route for an unknown friend: the real event bus rejects it every time', async () => {
    const actual = await vi.importActual<typeof import('../services/event-bus.js')>('../services/event-bus.js');
    fireEvent.mockImplementation(actual.fireEvent);
    fixture.sqlite.exec("INSERT INTO automations(id,name,event_type,conditions,actions,is_active) VALUES('auto-1','Synthetic','tag_change','{}','[]',1)");
    expect(await call('DELETE', undefined, 'tag-1', 'friend-missing')).toBe(500);
    expect(await call('DELETE', 'refund-1', 'tag-1', 'friend-missing')).toBe(500);
    expect(await call('DELETE', 'refund-1', 'tag-1', 'friend-missing')).toBe(500);
    expect(count('automation_logs')).toBe(0);
    expect(count('api_idempotency_keys')).toBe(1);
  });
});
