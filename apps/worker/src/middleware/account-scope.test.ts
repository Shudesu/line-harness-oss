import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { accountScopeMiddleware, RULES } from './account-scope.js';
import type { Env } from '../index.js';

// Minimal in-memory D1: account_settings + a few account-owning tables.
type Row = Record<string, string | null>;
function fakeDb(tables: Record<string, Row[]>): D1Database {
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => {
        args = a;
        return stmt;
      },
      all: async () => {
        if (sql.includes('FROM account_settings WHERE key = ?')) {
          return { results: (tables.account_settings ?? []).filter((r) => r.key === args[0]) };
        }
        throw new Error(`unexpected all(): ${sql}`);
      },
      first: async () => {
        const m = sql.match(/SELECT (.+) FROM (\w+) WHERE (\w+) = \?/);
        if (!m) throw new Error(`unexpected first(): ${sql}`);
        const [, cols, table, idCol] = m;
        const found = (tables[table] ?? []).find((r) => r[idCol] === args[0]);
        if (!found) return null;
        const alias = cols.match(/^(\w+) AS account$/);
        if (alias) return { account: found[alias[1]] ?? null };
        return found;
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

const DB = fakeDb({
  account_settings: [
    { line_account_id: 'intern', key: 'staff_access:s-intern', value: '1' },
  ],
  friends: [
    { id: 'f-intern', line_account_id: 'intern' },
    { id: 'f-kidou', line_account_id: 'kidou' },
  ],
  chats: [],
  scenarios: [
    { id: 'sc-intern', line_account_id: 'intern' },
    { id: 'sc-kidou', line_account_id: 'kidou' },
    { id: 'sc-shared', line_account_id: null },
  ],
  broadcasts: [
    { id: 'b-multi', line_account_id: null, account_ids: '["intern","kidou"]' },
    { id: 'b-intern', line_account_id: 'intern', account_ids: null },
  ],
});

function app(role: 'owner' | 'admin' | 'staff', id = 's-intern') {
  const a = new Hono<Env>();
  a.use('*', async (c, next) => {
    c.set('staff', { id, name: 'x', role });
    return next();
  });
  a.use('*', accountScopeMiddleware);
  a.all('*', (c) => c.json({ ok: true, scope: c.get('accountScope') ?? null }));
  return a;
}

async function call(a: Hono<Env>, method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return a.request(path, init, { DB } as unknown as Env['Bindings']);
}

describe('accountScopeMiddleware', () => {
  test('owner is unrestricted, even for endpoints outside the allowlist', async () => {
    const res = await call(app('owner'), 'GET', '/api/forms');
    expect(res.status).toBe(200);
  });

  test('restricted staff: list requires an allowed account', async () => {
    const a = app('staff');
    expect((await call(a, 'GET', '/api/friends?lineAccountId=intern')).status).toBe(200);
    expect((await call(a, 'GET', '/api/friends?lineAccountId=kidou')).status).toBe(403);
    expect((await call(a, 'GET', '/api/friends')).status).toBe(403);
  });

  test('restricted staff: resources are checked through their row', async () => {
    const a = app('admin');
    expect((await call(a, 'GET', '/api/friends/f-intern')).status).toBe(200);
    expect((await call(a, 'GET', '/api/friends/f-kidou')).status).toBe(403);
    expect((await call(a, 'POST', '/api/friends/f-kidou/messages', { text: 'hi' })).status).toBe(403);
    expect((await call(a, 'POST', '/api/chats/f-kidou/send', { text: 'hi' })).status).toBe(403);
    expect((await call(a, 'POST', '/api/chats/f-intern/send', { text: 'hi' })).status).toBe(200);
  });

  test('percent-encoded ids are checked against the real row', async () => {
    const a = app('admin');
    expect((await call(a, 'GET', '/api/friends/%66-kidou')).status).toBe(403);
    expect((await call(a, 'POST', '/api/chats/f-%6Bidou/send', { text: 'hi' })).status).toBe(403);
    expect((await call(a, 'GET', '/api/friends/%66-intern')).status).toBe(200);
  });

  test('shared (NULL account) rows are readable but not changeable', async () => {
    const a = app('staff');
    expect((await call(a, 'GET', '/api/scenarios/sc-shared')).status).toBe(200);
    expect((await call(a, 'PUT', '/api/scenarios/sc-shared', { name: 'x' })).status).toBe(403);
    expect((await call(a, 'PUT', '/api/scenarios/sc-intern', { name: 'x' })).status).toBe(200);
    expect((await call(a, 'POST', '/api/scenarios/sc-kidou/steps', {})).status).toBe(403);
  });

  test('create requires an allowed account in the body', async () => {
    const a = app('staff');
    expect((await call(a, 'POST', '/api/scenarios', { name: 'x', lineAccountId: 'intern' })).status).toBe(200);
    expect((await call(a, 'POST', '/api/scenarios', { name: 'x', lineAccountId: 'kidou' })).status).toBe(403);
    expect((await call(a, 'POST', '/api/scenarios', { name: 'x' })).status).toBe(403);
  });

  test('multi-account broadcasts need every account', async () => {
    const a = app('staff');
    expect((await call(a, 'GET', '/api/broadcasts/b-multi')).status).toBe(403);
    expect((await call(a, 'GET', '/api/broadcasts/b-intern')).status).toBe(200);
    expect(
      (await call(a, 'POST', '/api/broadcasts', { accountIds: ['intern', 'kidou'] })).status,
    ).toBe(403);
  });

  test('endpoints outside the allowlist are refused (forms, users, staff admin, tag delete)', async () => {
    const a = app('admin');
    for (const [m, p] of [
      ['GET', '/api/forms'],
      ['GET', '/api/users'],
      ['GET', '/api/staff'],
      ['DELETE', '/api/tags/t1'],
      ['POST', '/api/line-accounts'],
      ['GET', '/api/admin/recent-messages'],
    ] as const) {
      expect((await call(a, m, p)).status, `${m} ${p}`).toBe(403);
    }
  });

  test('staff without any assignment can use nothing account-bound', async () => {
    const a = app('staff', 's-nobody');
    expect((await call(a, 'GET', '/api/friends?lineAccountId=intern')).status).toBe(403);
    const me = await call(a, 'GET', '/api/staff/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ scope: [] });
  });

  test('the scope is exposed to handlers for list filtering', async () => {
    const res = await call(app('staff'), 'GET', '/api/line-accounts');
    expect(await res.json()).toMatchObject({ scope: ['intern'] });
  });

  test('legacy rich menu endpoints require an explicit account', async () => {
    const a = app('staff');
    expect((await call(a, 'GET', '/api/rich-menus')).status).toBe(403);
    expect((await call(a, 'GET', '/api/rich-menus?accountId=intern')).status).toBe(200);
  });

  test('every rule path is anchored', () => {
    for (const rule of RULES) {
      expect(rule.path.source.startsWith('^')).toBe(true);
      expect(rule.path.source.endsWith('$')).toBe(true);
    }
  });
});
