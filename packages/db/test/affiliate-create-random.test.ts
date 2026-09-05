import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAffiliateWithRandomCode,
  getAffiliateByCode,
} from '../src/affiliates.js';
import { getAffiliateByFriendId } from '../src/affiliate-links.js';

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

/** Minimal async D1 shim over better-sqlite3 (same as affiliate-links.test.ts). */
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

describe('createAffiliateWithRandomCode', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
  });

  test('generates a random base62 code and persists the row', async () => {
    const aff = await createAffiliateWithRandomCode(db, { name: 'Alice', commissionRate: 10 });
    expect(aff.code).toMatch(/^[0-9A-Za-z]{6}$/);
    expect(aff.name).toBe('Alice');
    expect(aff.commission_rate).toBe(10);
    expect(aff.friend_id).toBeNull();

    const fetched = await getAffiliateByCode(db, aff.code);
    expect(fetched?.id).toBe(aff.id);
  });

  test('retries on a code collision using the injected generator', async () => {
    // Force the first two slugs to collide with an existing code, then succeed.
    sqlite
      .prepare(
        `INSERT INTO affiliates (id, name, code, is_active, created_at)
         VALUES ('pre-1', 'Pre', 'TAKEN1', 1, '2024-01-01T00:00:00.000')`,
      )
      .run();
    const slugs = ['TAKEN1', 'FRESH2'];
    let i = 0;
    const gen = () => slugs[Math.min(i++, slugs.length - 1)];

    const aff = await createAffiliateWithRandomCode(db, { name: 'Bob' }, gen);
    expect(aff.code).toBe('FRESH2');
    expect(i).toBe(2); // first slug collided, second succeeded
  });

  test('binds a friend 1:1 and rejects a second affiliate for the same friend', async () => {
    insertFriend(sqlite, 'friend-1', 'U-friend-1');

    const first = await createAffiliateWithRandomCode(db, {
      name: 'Carol',
      friendId: 'friend-1',
    });
    expect(first.friend_id).toBe('friend-1');
    expect(await getAffiliateByFriendId(db, 'friend-1')).not.toBeNull();

    // The friend_id partial UNIQUE index (migration 046) must reject the second
    // affiliate — and it must NOT be swallowed by the code-collision retry loop.
    await expect(
      createAffiliateWithRandomCode(db, { name: 'Dave', friendId: 'friend-1' }),
    ).rejects.toThrow(/UNIQUE constraint failed/i);
  });
});
