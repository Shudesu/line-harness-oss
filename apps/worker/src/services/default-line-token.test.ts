import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ getLineAccounts: vi.fn() }));
vi.mock('@line-crm/db', () => db);

import { resetDefaultLineTokenCache, withDefaultLineToken } from './default-line-token.js';

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
