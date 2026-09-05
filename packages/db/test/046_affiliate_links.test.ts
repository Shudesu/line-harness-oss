import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * Build an in-memory DB by applying schema.sql + all migrations through 046
 * (mirrors the bootstrap test's applyMigrationReplay approach).
 */
function setupDbWithMigrations(): Database.Database {
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

describe('046_affiliate_links', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDbWithMigrations();
  });

  test('affiliate_links table and new columns exist', () => {
    const cols = (t: string) =>
      (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map(
        (r) => r.name,
      );

    expect(cols('affiliate_links')).toEqual(
      expect.arrayContaining([
        'id',
        'affiliate_id',
        'ref_code',
        'label',
        'line_account_id',
        'is_active',
        'created_at',
        'click_count',
      ]),
    );
    expect(cols('affiliates')).toContain('friend_id');
    expect(cols('friends')).toEqual(
      expect.arrayContaining(['last_ref_code', 'last_ref_at']),
    );
    expect(cols('conversion_events')).toEqual(
      expect.arrayContaining(['affiliate_id', 'attributed_ref_code']),
    );
  });

  test('affiliate_links ref_code is UNIQUE', () => {
    db.exec(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES ('f-1', 'U0000000000000000000000000000001', 'Test User',
               '2024-01-01T00:00:00.000', '2024-01-01T00:00:00.000')`,
    );
    db.exec(
      `INSERT INTO line_accounts (id, channel_id, name, channel_secret, channel_access_token, created_at, updated_at)
       VALUES ('la-1', 'ch-001', 'Test Account', 'secret-001', 'token-001',
               '2024-01-01T00:00:00.000', '2024-01-01T00:00:00.000')`,
    );
    db.exec(
      `INSERT INTO affiliates (id, name, code, is_active, created_at)
       VALUES ('aff-1', 'Test Affiliate', 'CODE001', 1, '2024-01-01T00:00:00.000')`,
    );
    db.exec(
      `INSERT INTO affiliate_links (id, affiliate_id, ref_code, is_active, created_at)
       VALUES ('al-1', 'aff-1', 'REF001', 1, '2024-01-01T00:00:00.000')`,
    );
    expect(() =>
      db.exec(
        `INSERT INTO affiliate_links (id, affiliate_id, ref_code, is_active, created_at)
         VALUES ('al-2', 'aff-1', 'REF001', 1, '2024-01-01T00:00:00.000')`,
      ),
    ).toThrow(/UNIQUE constraint failed/);
  });

  test('all four new indexes exist', () => {
    const getIndex = (name: string) =>
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
        )
        .get(name) as { name: string } | undefined;

    expect(getIndex('idx_ref_tracking_friend_created')).toBeDefined();
    expect(getIndex('idx_ref_tracking_ref_created')).toBeDefined();
    expect(getIndex('idx_affiliate_links_affiliate')).toBeDefined();
    expect(getIndex('idx_affiliates_friend')).toBeDefined();
  });

  test('idx_affiliates_friend is a partial UNIQUE index on friend_id', () => {
    const idx = db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_affiliates_friend'`,
      )
      .get() as { sql: string } | undefined;
    expect(idx).toBeDefined();
    expect(idx!.sql).toMatch(/UNIQUE\s+INDEX/i);
    expect(idx!.sql).toMatch(/WHERE\s+friend_id\s+IS\s+NOT\s+NULL/i);
  });

  test('affiliates.friend_id is UNIQUE per friend, but NULL is unconstrained', () => {
    db.exec(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES ('f-uniq', 'U0000000000000000000000000000009', 'Uniq User',
               '2024-01-01T00:00:00.000', '2024-01-01T00:00:00.000')`,
    );
    db.exec(
      `INSERT INTO affiliates (id, name, code, is_active, created_at, friend_id)
       VALUES ('aff-u1', 'A1', 'UCODE1', 1, '2024-01-01T00:00:00.000', 'f-uniq')`,
    );
    // A second affiliate for the same friend must be rejected.
    expect(() =>
      db.exec(
        `INSERT INTO affiliates (id, name, code, is_active, created_at, friend_id)
         VALUES ('aff-u2', 'A2', 'UCODE2', 1, '2024-01-01T00:00:00.000', 'f-uniq')`,
      ),
    ).toThrow(/UNIQUE constraint failed/);
    // But multiple affiliates with NULL friend_id (admin-created) are allowed.
    expect(() => {
      db.exec(
        `INSERT INTO affiliates (id, name, code, is_active, created_at)
         VALUES ('aff-n1', 'N1', 'NCODE1', 1, '2024-01-01T00:00:00.000')`,
      );
      db.exec(
        `INSERT INTO affiliates (id, name, code, is_active, created_at)
         VALUES ('aff-n2', 'N2', 'NCODE2', 1, '2024-01-01T00:00:00.000')`,
      );
    }).not.toThrow();
  });

  test('affiliate_links default values are correct', () => {
    db.exec(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES ('f-2', 'U0000000000000000000000000000002', 'Test User 2',
               '2024-01-01T00:00:00.000', '2024-01-01T00:00:00.000')`,
    );
    db.exec(
      `INSERT INTO affiliates (id, name, code, is_active, created_at)
       VALUES ('aff-2', 'Affiliate 2', 'CODE002', 1, '2024-01-01T00:00:00.000')`,
    );
    db.exec(
      `INSERT INTO affiliate_links (id, affiliate_id, ref_code, created_at)
       VALUES ('al-3', 'aff-2', 'REF002', '2024-01-01T00:00:00.000')`,
    );
    const row = db
      .prepare(`SELECT is_active, click_count FROM affiliate_links WHERE id = 'al-3'`)
      .get() as { is_active: number; click_count: number };
    expect(row.is_active).toBe(1);
    expect(row.click_count).toBe(0);
  });
});
