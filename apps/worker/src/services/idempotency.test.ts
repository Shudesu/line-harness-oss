import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { runIdempotent } from './idempotency.js';
import type { Env } from '../index.js';

const migration = readFileSync(new URL('../../../../packages/db/migrations/076_api_idempotency_keys.sql', import.meta.url), 'utf8');

describe('runIdempotent (Idempotency-Key state table)', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono<Env>;
  let runs: string[];
  let outcome: () => Promise<{ status: number } | 'throw'>;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(migration);
    runs = [];
    outcome = async () => ({ status: 201 });
    app = new Hono<Env>();
    app.onError((_err, c) => c.json({ success: false }, 500));
    app.post('/op/:scope', async (c) => {
      const body = await c.req.json<{ value: string }>();
      return runIdempotent(c, `test:${c.req.param('scope')}`, { value: body.value }, async (operation) => {
        runs.push(`${body.value}:${operation?.operationId ?? 'no-key'}`);
        const result = await outcome();
        if (result === 'throw') throw new Error('Synthetic handler crash');
        return c.json({ success: result.status < 400, data: { run: runs.length } }, result.status as 201);
      });
    });
  });
  afterEach(() => fixture.sqlite.close());

  /** A promise the test resolves by hand, to hold a handler mid-flight. */
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  };
  const started = (count: number) => vi.waitFor(() => expect(runs).toHaveLength(count));

  async function call(value: string, key?: string, scope = 'a') {
    const response = await app.request(`/op/${scope}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key === undefined ? {} : { 'Idempotency-Key': key }) },
      body: JSON.stringify({ value }),
    }, { DB: fixture.db } as Env['Bindings']);
    return { status: response.status, body: await response.text(), replayed: response.headers.get('Idempotency-Replayed') };
  }
  const row = () => fixture.sqlite.prepare('SELECT status, locked_until FROM api_idempotency_keys').get() as { status: string; locked_until: number } | undefined;
  const count = () => (fixture.sqlite.prepare('SELECT count(*) n FROM api_idempotency_keys').get() as { n: number }).n;

  it('runs the handler directly and stores nothing without the header', async () => {
    expect((await call('x')).status).toBe(201);
    expect((await call('x')).status).toBe(201);
    expect(runs).toEqual(['x:no-key', 'x:no-key']);
    expect(count()).toBe(0);
    expect((await call('x', 'k'.repeat(256))).status).toBe(400);
    expect(runs).toHaveLength(2);
  });

  // stored row × incoming request → [status, handler runs again?]
  it.each([
    ['none', 'same', 201, true],
    ['none', 'different', 201, true],
    ['processing-live', 'same', 409, false],
    ['processing-live', 'different', 422, false],
    ['processing-expired', 'same', 201, true],
    ['processing-expired', 'different', 422, false],
    ['completed', 'same', 201, false],
    ['completed', 'different', 422, false],
  ] as const)('row %s + %s request → %i', async (stored, incoming, status, runsAgain) => {
    if (stored !== 'none') {
      expect((await call('first', 'key-1')).status).toBe(201);
      if (stored !== 'completed') {
        fixture.sqlite.prepare("UPDATE api_idempotency_keys SET status='processing', response_status=NULL, response_body=NULL, locked_until=?")
          .run(stored === 'processing-live' ? Date.now() + 60_000 : 0);
      }
    }
    const before = runs.length;
    const result = await call(incoming === 'same' ? 'first' : 'other', 'key-1');
    expect(result.status).toBe(status);
    expect(runs.length - before).toBe(runsAgain ? 1 : 0);
    if (stored === 'completed' && incoming === 'same') {
      expect(result).toEqual({ status: 201, body: JSON.stringify({ success: true, data: { run: 1 } }), replayed: 'true' });
    }
  });

  // handler result → row afterwards
  it.each([
    [{ status: 200 }, 'completed'],
    [{ status: 404 }, undefined],
    [{ status: 500 }, 'processing'],
    ['throw', 'processing'],
  ] as const)('handler result %j leaves the row %s', async (result, status) => {
    outcome = async () => result;
    await call('first', 'key-1');
    expect(row()?.status).toBe(status);
    if (status === 'processing') {
      expect(row()?.locked_until).toBe(0);
      expect((await call('other', 'key-1')).status).toBe(422);
      outcome = async () => ({ status: 201 });
      expect((await call('first', 'key-1')).status).toBe(201);
      expect(runs).toEqual(['first:test:a:key-1', 'first:test:a:key-1']);
    }
  });

  it('keeps the key bound when a re-claimed attempt is rejected with 4xx', async () => {
    outcome = async () => ({ status: 500 });
    expect((await call('first', 'key-1')).status).toBe(500);
    outcome = async () => ({ status: 404 });
    expect((await call('first', 'key-1')).status).toBe(404);
    expect(row()?.status).toBe('processing');
    expect((await call('other', 'key-1')).status).toBe(422);
  });

  // An attempt that outlived its lease finishes after another attempt took over.
  it.each([
    [{ status: 201 }, 'a late success'],
    [{ status: 404 }, 'a late 4xx'],
    ['throw', 'a late crash'],
  ] as const)('does not let %j (%s) touch the claim that replaced it', async (late, _label) => {
    const gateA = deferred();
    const gateB = deferred();
    outcome = async () => { await gateA.promise; return late; };
    const a = call('first', 'key-1');
    await started(1);
    fixture.sqlite.exec('UPDATE api_idempotency_keys SET locked_until = 0');
    outcome = async () => { await gateB.promise; return { status: 201 }; };
    const b = call('first', 'key-1');
    await started(2);
    const owned = row();
    gateA.resolve();
    await a;
    expect(row()).toEqual(owned);
    expect((await call('first', 'key-1')).status).toBe(409);
    gateB.resolve();
    expect((await b).status).toBe(201);
    expect(row()?.status).toBe('completed');
    expect(runs).toHaveLength(2);
  });

  it('gives the handler a stable operation, and can refuse to run without a key', async () => {
    const seen: string[] = [];
    app.post('/strict', (c) => runIdempotent(c, 'test:strict', {}, async (operation) => {
      seen.push(`${operation?.operationId}|${await operation?.deriveId('row')}`);
      return c.json({ success: false }, 500);
    }, { keyRequired: 'this action requires an Idempotency-Key header' }));
    const post = (key?: string) => app.request('/strict', { method: 'POST', headers: key ? { 'Idempotency-Key': key } : {} }, { DB: fixture.db } as Env['Bindings']);
    expect((await post()).status).toBe(400);
    await post('key-1');
    await post('key-1');
    await post('key-2');
    expect(seen[0]).toMatch(/^test:strict:key-1\|[0-9a-f-]{36}$/);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).not.toBe(seen[0]);
  });

  it('lets only one of two concurrent requests run the handler', async () => {
    const gate = deferred();
    outcome = async () => { await gate.promise; return { status: 201 }; };
    const first = call('first', 'key-1');
    await started(1);
    expect((await call('first', 'key-1')).status).toBe(409);
    gate.resolve();
    expect((await first).status).toBe(201);
    expect(runs).toHaveLength(1);
    expect((await call('first', 'key-1')).replayed).toBe('true');
  });

  it('separates scopes, and the migration can be re-applied without losing keys', async () => {
    expect((await call('first', 'key-1', 'a')).status).toBe(201);
    expect((await call('other', 'key-1', 'b')).status).toBe(201);
    fixture.sqlite.exec(migration);
    expect(count()).toBe(2);
  });
});
