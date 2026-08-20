import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { consumeAdminSsoJti } from '../src/admin-sso.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');

const BENIGN = /duplicate column name|already exists/i;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!BENIGN.test(msg)) throw err;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

/**
 * Minimal D1 shim. Unlike the shims in the sibling migration tests this one
 * reports `meta.changes` and implements `batch()` — both are load-bearing for
 * the single-use semantics under test.
 */
function asD1(sqlite: Database.Database): D1Database {
  const bound = (query: string, params: unknown[]) => ({
    async run() {
      const info = sqlite.prepare(query).run(...(params as never[]));
      return { results: [], success: true, meta: { changes: info.changes } };
    },
    async first<T>() {
      return (sqlite.prepare(query).get(...(params as never[])) as T) ?? null;
    },
    async all<T>() {
      return {
        results: sqlite.prepare(query).all(...(params as never[])) as T[],
        success: true,
        meta: {},
      };
    },
  });

  return {
    prepare(query: string) {
      return {
        bind: (...params: unknown[]) => bound(query, params),
        ...bound(query, []),
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
}

const NOW = 1_735_689_600;

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = setupDb();
  db = asD1(sqlite);
});

describe('migration 070_admin_sso_jti', () => {
  it('creates the sso_jti table with jti as the primary key', () => {
    const table = sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sso_jti'`)
      .get() as { sql: string } | undefined;

    expect(table?.sql).toMatch(/jti\s+TEXT\s+PRIMARY KEY/i);
    expect(table?.sql).toMatch(/exp\s+INTEGER\s+NOT NULL/i);
  });

  it('indexes exp so the lazy sweep does not table-scan', () => {
    const index = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_sso_jti_exp'`)
      .get();
    expect(index).toBeTruthy();
  });

  it('is idempotent (IF NOT EXISTS) — safe to re-apply', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '070_admin_sso_jti.sql'), 'utf8');
    expect(() => execSafe(sqlite, sql)).not.toThrow();
  });
});

describe('consumeAdminSsoJti', () => {
  it('burns a fresh jti exactly once', async () => {
    const first = await consumeAdminSsoJti(db, 'jti-alpha', NOW + 120, NOW);
    expect(first.consumed).toBe(true);

    const replay = await consumeAdminSsoJti(db, 'jti-alpha', NOW + 120, NOW);
    expect(replay.consumed).toBe(false);
  });

  it('keeps distinct jtis independent', async () => {
    expect((await consumeAdminSsoJti(db, 'jti-one', NOW + 60, NOW)).consumed).toBe(true);
    expect((await consumeAdminSsoJti(db, 'jti-two', NOW + 60, NOW)).consumed).toBe(true);
  });

  it('a replay is still refused when the sweep runs in the same call', async () => {
    await consumeAdminSsoJti(db, 'jti-live', NOW + 300, NOW);

    // Later, but still before the token's exp — the sweep must not delete the
    // row that is protecting it.
    const replay = await consumeAdminSsoJti(db, 'jti-live', NOW + 300, NOW + 200);
    expect(replay.consumed).toBe(false);
  });

  it('sweeps rows whose exp has passed', async () => {
    await consumeAdminSsoJti(db, 'jti-old-a', NOW + 10, NOW);
    await consumeAdminSsoJti(db, 'jti-old-b', NOW + 10, NOW);
    expect(rowCount()).toBe(2);

    const result = await consumeAdminSsoJti(db, 'jti-new', NOW + 400, NOW + 300);

    expect(result.consumed).toBe(true);
    expect(result.purged).toBe(2);
    expect(rowCount()).toBe(1);
  });

  it('does not leave the ledger growing without bound', async () => {
    for (let i = 0; i < 20; i += 1) {
      await consumeAdminSsoJti(db, `jti-${i}`, NOW + 60, NOW);
    }
    expect(rowCount()).toBe(20);

    // One SSO after everything expired collapses the table back to a single row.
    await consumeAdminSsoJti(db, 'jti-later', NOW + 1000, NOW + 900);
    expect(rowCount()).toBe(1);
  });
});

function rowCount(): number {
  return (sqlite.prepare('SELECT COUNT(*) AS n FROM sso_jti').get() as { n: number }).n;
}
