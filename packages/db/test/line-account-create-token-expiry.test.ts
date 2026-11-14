import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLineAccount } from '../src/line-accounts.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BENIGN = /duplicate column name|already exists/i;

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  const files = [join(PKG_ROOT, 'schema.sql')].concat(
    readdirSync(join(PKG_ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
      .map((f) => join(PKG_ROOT, 'migrations', f)),
  );
  for (const file of files) {
    for (const stmt of readFileSync(file, 'utf8').split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) {
      try { db.exec(stmt); } catch (err) { if (!BENIGN.test(String(err))) throw err; }
    }
  }
  return db;
}

function asD1(sqlite: Database.Database): D1Database {
  function prepare(sql: string, values: unknown[] = []): D1PreparedStatement {
    return {
      bind: (...args: unknown[]) => prepare(sql, args),
      first: async () => (sqlite.prepare(sql).get(...(values as never[])) ?? null) as never,
      run: async () => ({ success: true, meta: { changes: sqlite.prepare(sql).run(...(values as never[])).changes } }) as never,
    } as unknown as D1PreparedStatement;
  }
  return { prepare } as unknown as D1Database;
}

describe('createLineAccount token expiry', () => {
  it('stores tokenExpiresAt so token-refresh knows when to renew', async () => {
    const db = asD1(setupDb());
    const row = await createLineAccount(db, {
      channelId: '1001', name: 'main', channelAccessToken: 'issued', channelSecret: 'secret',
      tokenExpiresAt: '2026-12-09T12:00:00.000+09:00',
    });
    expect(row.token_expires_at).toBe('2026-12-09T12:00:00.000+09:00');
  });

  it('leaves the expiry NULL when it is not known (a token typed in by hand)', async () => {
    const db = asD1(setupDb());
    const row = await createLineAccount(db, {
      channelId: '1002', name: 'sub', channelAccessToken: 'typed', channelSecret: 'secret',
    });
    expect(row.token_expires_at).toBeNull();
  });
});
