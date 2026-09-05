import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordRefTracking } from '../src/entry-routes.js';

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
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of migrationFiles) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async run() {
              stmt.run(...params);
              return { results: [], success: true, meta: {} };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...params) as T[], success: true, meta: {} };
            },
          };
        },
        async run() {
          sqlite.prepare(query).run();
          return { results: [], success: true, meta: {} };
        },
        async first<T>() {
          return (sqlite.prepare(query).get() as T) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all() as T[], success: true, meta: {} };
        },
      };
    },
  } as unknown as D1Database;
}

function insertFriend(sqlite: Database.Database, id: string, lineUserId: string) {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES (?, ?, 'Test User', '2024-01-01T00:00:00.000', '2024-01-01T00:00:00.000')`,
    )
    .run(id, lineUserId);
}

describe('recordRefTracking: last-touch update', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
  });

  test('last_ref_code and last_ref_at are updated on each call with friendId', async () => {
    insertFriend(sqlite, 'friend-lt-001', 'U0000000000000000000000000000001');

    // First call with ref code 'aaa111'
    await recordRefTracking(db, {
      refCode: 'aaa111',
      friendId: 'friend-lt-001',
    });

    const after1 = sqlite
      .prepare(`SELECT last_ref_code, last_ref_at FROM friends WHERE id = 'friend-lt-001'`)
      .get() as { last_ref_code: string | null; last_ref_at: string | null };

    expect(after1.last_ref_code).toBe('aaa111');
    expect(after1.last_ref_at).not.toBeNull();
    const at1 = after1.last_ref_at!;

    // Second call with ref code 'bbb222'
    await recordRefTracking(db, {
      refCode: 'bbb222',
      friendId: 'friend-lt-001',
    });

    const after2 = sqlite
      .prepare(`SELECT last_ref_code, last_ref_at FROM friends WHERE id = 'friend-lt-001'`)
      .get() as { last_ref_code: string | null; last_ref_at: string | null };

    // last-touch should be overwritten with the second ref code
    expect(after2.last_ref_code).toBe('bbb222');
    expect(after2.last_ref_at).not.toBeNull();
    // last_ref_at should be >= the first timestamp (last-touch semantics)
    expect(after2.last_ref_at! >= at1).toBe(true);
  });

  test('friends row is NOT changed when friendId is absent', async () => {
    insertFriend(sqlite, 'friend-lt-002', 'U0000000000000000000000000000002');

    const before = sqlite
      .prepare(`SELECT last_ref_code, last_ref_at FROM friends WHERE id = 'friend-lt-002'`)
      .get() as { last_ref_code: string | null; last_ref_at: string | null };

    // Call without friendId
    await recordRefTracking(db, {
      refCode: 'ccc333',
    });

    const after = sqlite
      .prepare(`SELECT last_ref_code, last_ref_at FROM friends WHERE id = 'friend-lt-002'`)
      .get() as { last_ref_code: string | null; last_ref_at: string | null };

    expect(after.last_ref_code).toBe(before.last_ref_code);
    expect(after.last_ref_at).toBe(before.last_ref_at);
  });
});
