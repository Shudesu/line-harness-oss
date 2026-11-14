import type { LineAccount } from '@line-crm/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ getLineAccounts: vi.fn() }));
vi.mock('@line-crm/db', () => db);

import { resetDefaultLineTokenCache, withDefaultLineToken, withDefaultLineTokenFromAccounts } from './default-line-token.js';

const DB = {} as D1Database;
const NOW = Date.UTC(2026, 10, 9, 3, 0, 0);

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    channel_id: '1001',
    name: 'main',
    channel_access_token: 'main-token',
    channel_secret: 'secret-1',
    is_active: 1,
    ...overrides,
  };
}

beforeEach(() => {
  resetDefaultLineTokenCache();
  db.getLineAccounts.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('withDefaultLineToken', () => {
  it('leaves env untouched when LINE_CHANNEL_ACCESS_TOKEN is set (existing installs)', async () => {
    const env = { DB, LINE_CHANNEL_ACCESS_TOKEN: 'long-lived', LINE_CHANNEL_SECRET: 'secret-1' };
    expect(await withDefaultLineToken(env, NOW)).toBe(env);
    expect(db.getLineAccounts).not.toHaveBeenCalled();
  });

  it('uses the account whose secret matches LINE_CHANNEL_SECRET, even with several accounts', async () => {
    db.getLineAccounts.mockResolvedValue([
      account({ id: 'other', channel_secret: 'secret-2', channel_access_token: 'other-token' }),
      account(),
    ]);
    const env = await withDefaultLineToken({ DB, LINE_CHANNEL_ACCESS_TOKEN: '', LINE_CHANNEL_SECRET: 'secret-1' }, NOW);
    expect(env.LINE_CHANNEL_ACCESS_TOKEN).toBe('main-token');
  });

  it('ignores an inactive account with the matching secret and falls back to the only active one', async () => {
    db.getLineAccounts.mockResolvedValue([
      account({ id: 'off', is_active: 0, channel_access_token: 'off-token' }),
      account({ id: 'only', channel_secret: 'secret-9', channel_access_token: 'only-token' }),
    ]);
    const env = await withDefaultLineToken({ DB, LINE_CHANNEL_SECRET: 'secret-1' }, NOW);
    expect(env.LINE_CHANNEL_ACCESS_TOKEN).toBe('only-token');
  });

  it('does not guess between several accounts without a secret match', async () => {
    db.getLineAccounts.mockResolvedValue([
      account({ id: 'a', channel_secret: 'secret-2' }),
      account({ id: 'b', channel_secret: 'secret-3' }),
    ]);
    const input = { DB, LINE_CHANNEL_SECRET: 'secret-1' };
    expect(await withDefaultLineToken(input, NOW)).toBe(input);
  });

  it('returns env unchanged when D1 cannot be read, without re-reading it on every request', async () => {
    db.getLineAccounts.mockRejectedValue(new Error('D1 down'));
    const input = { DB, LINE_CHANNEL_SECRET: 'secret-1' };
    expect(await withDefaultLineToken(input, NOW)).toBe(input);
    expect(await withDefaultLineToken(input, NOW + 10_000)).toBe(input);
    expect(db.getLineAccounts).toHaveBeenCalledTimes(1);
  });

  it('reads D1 at most once a minute per isolate', async () => {
    db.getLineAccounts.mockResolvedValue([account()]);
    const input = { DB, LINE_CHANNEL_SECRET: 'secret-1' };
    await withDefaultLineToken(input, NOW);
    await withDefaultLineToken(input, NOW + 30_000);
    expect(db.getLineAccounts).toHaveBeenCalledTimes(1);
    db.getLineAccounts.mockResolvedValue([account({ channel_access_token: 'refreshed-token' })]);
    const later = await withDefaultLineToken(input, NOW + 61_000);
    expect(db.getLineAccounts).toHaveBeenCalledTimes(2);
    expect(later.LINE_CHANNEL_ACCESS_TOKEN).toBe('refreshed-token');
  });
});

describe('concurrent default token resolution', () => {
  it.each([1, 100, 1000])('shares one cold-cache query across %i callers', async (count) => {
    let release!: (rows: ReturnType<typeof account>[]) => void;
    db.getLineAccounts.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const input = { DB, LINE_CHANNEL_SECRET: 'secret-1' };
    const requests = Array.from({ length: count }, () => withDefaultLineToken(input, NOW));
    release([account()]);
    const results = await Promise.all(requests);
    expect(results.every((r) => r.LINE_CHANNEL_ACCESS_TOKEN === 'main-token')).toBe(true);
    expect(db.getLineAccounts).toHaveBeenCalledTimes(1);
  });

  it('shares failed reads, caches failure, and retries once after the TTL', async () => {
    let reject!: (error: Error) => void;
    db.getLineAccounts.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    const input = { DB, LINE_CHANNEL_SECRET: 'secret-1' };
    const requests = Array.from({ length: 100 }, () => withDefaultLineToken(input, NOW));
    reject(new Error('synthetic outage'));
    expect((await Promise.all(requests)).every((result) => result === input)).toBe(true);
    await withDefaultLineToken(input, NOW + 10_000);
    expect(db.getLineAccounts).toHaveBeenCalledTimes(1);
    db.getLineAccounts.mockResolvedValue([account()]);
    const recovered = await Promise.all(Array.from({ length: 100 }, () => withDefaultLineToken(input, NOW + 61_000)));
    expect(recovered.every((result) => result.LINE_CHANNEL_ACCESS_TOKEN === 'main-token')).toBe(true);
    expect(db.getLineAccounts).toHaveBeenCalledTimes(2);
  });

  it('does not share a token across DB bindings or default account settings', async () => {
    const otherDb = {} as D1Database;
    db.getLineAccounts.mockImplementation(async (database) => database === DB
      ? [account(), account({ id: 'acc-2', channel_secret: 'secret-2', channel_access_token: 'second-token' })]
      : [account({ channel_access_token: 'other-db-token' })]);
    expect((await withDefaultLineToken({ DB, LINE_CHANNEL_SECRET: 'secret-1' }, NOW)).LINE_CHANNEL_ACCESS_TOKEN).toBe('main-token');
    expect((await withDefaultLineToken({ DB, LINE_CHANNEL_SECRET: 'secret-2' }, NOW)).LINE_CHANNEL_ACCESS_TOKEN).toBe('second-token');
    expect((await withDefaultLineToken({ DB: otherDb, LINE_CHANNEL_SECRET: 'secret-1' }, NOW)).LINE_CHANNEL_ACCESS_TOKEN).toBe('other-db-token');
  });
});

describe('authoritative post-refresh snapshots', () => {
  it.each([false, true])('does not let an older pending read overwrite refreshed tokens (reject=%s)', async (reject) => {
    let resolve!: (rows: ReturnType<typeof account>[]) => void;
    let fail!: (error: Error) => void;
    db.getLineAccounts.mockReturnValue(new Promise((ok, no) => { resolve = ok; fail = no; }));
    const input = { DB, LINE_CHANNEL_SECRET: 'secret-1' };
    const pending = withDefaultLineToken(input, NOW);
    const fresh = withDefaultLineTokenFromAccounts(input, [account({ channel_access_token: 'fresh' })] as LineAccount[], NOW + 1);
    expect(fresh.LINE_CHANNEL_ACCESS_TOKEN).toBe('fresh');
    if (reject) fail(new Error('old read failed'));
    else resolve([account({ channel_access_token: 'old' })]);
    expect((await pending).LINE_CHANNEL_ACCESS_TOKEN).toBe('fresh');
    expect((await withDefaultLineToken(input, NOW + 2)).LINE_CHANNEL_ACCESS_TOKEN).toBe('fresh');
    expect(db.getLineAccounts).toHaveBeenCalledTimes(1);
  });

  it('replaces a prior token with an empty result when no default account remains', async () => {
    const input = { DB, LINE_CHANNEL_SECRET: 'secret-1' };
    withDefaultLineTokenFromAccounts(input, [account()] as LineAccount[], NOW);
    expect(withDefaultLineTokenFromAccounts(input, [], NOW + 1)).toBe(input);
    expect(await withDefaultLineToken(input, NOW + 2)).toBe(input);
    expect(db.getLineAccounts).not.toHaveBeenCalled();
  });

  it('does not create a cache entry for an explicit legacy token', async () => {
    const explicit = { DB, LINE_CHANNEL_SECRET: 'secret-1', LINE_CHANNEL_ACCESS_TOKEN: 'explicit' };
    expect(withDefaultLineTokenFromAccounts(explicit, [account()] as LineAccount[], NOW)).toBe(explicit);
    db.getLineAccounts.mockResolvedValue([account({ channel_access_token: 'db-current' })]);
    expect((await withDefaultLineToken({ DB, LINE_CHANNEL_SECRET: 'secret-1' }, NOW)).LINE_CHANNEL_ACCESS_TOKEN).toBe('db-current');
    expect(db.getLineAccounts).toHaveBeenCalledTimes(1);
  });
});
