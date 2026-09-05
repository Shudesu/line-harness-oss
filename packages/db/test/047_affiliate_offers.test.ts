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
 * Build an in-memory DB by applying schema.sql + all migrations through 047.
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

/**
 * Build a DB with schema + every migration STRICTLY BEFORE 047, so a test can
 * seed pre-047 rows and then apply 047 itself to exercise its backfill.
 */
function setupDbBefore047(): Database.Database {
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f < '047')
    .sort();
  for (const file of migrationFiles) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function apply047(db: Database.Database): void {
  execSafe(db, readFileSync(join(MIGRATIONS_DIR, '047_affiliate_offers.sql'), 'utf8'));
}

describe('047_affiliate_offers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDbWithMigrations();
  });

  test('affiliate_offers table and new columns exist', () => {
    const cols = (t: string) =>
      (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map(
        (r) => r.name,
      );

    expect(cols('affiliate_offers')).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'description',
        'reward_amount',
        'line_account_id',
        'tag_id',
        'scenario_id',
        'is_active',
        'created_at',
      ]),
    );
    expect(cols('affiliate_links')).toContain('offer_id');
    expect(cols('conversion_events')).toEqual(
      expect.arrayContaining(['approval_status', 'approved_at']),
    );
  });

  test('offer index exists', () => {
    const getIndex = (name: string) =>
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
        )
        .get(name) as { name: string } | undefined;
    expect(getIndex('idx_affiliate_links_offer')).toBeDefined();
  });

  test('affiliate_offers default values are correct', () => {
    db.exec(
      `INSERT INTO affiliate_offers (id, name, created_at)
       VALUES ('off-1', 'Test Offer', '2024-01-01T00:00:00.000')`,
    );
    const row = db
      .prepare(`SELECT reward_amount, is_active FROM affiliate_offers WHERE id = 'off-1'`)
      .get() as { reward_amount: number; is_active: number };
    expect(row.reward_amount).toBe(0);
    expect(row.is_active).toBe(1);
  });

  test('conversion_events.approval_status enforces its CHECK constraint', () => {
    db.exec(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES ('f-1', 'U0000000000000000000000000000001', 'Test User',
               '2024-01-01T00:00:00.000', '2024-01-01T00:00:00.000')`,
    );
    db.exec(
      `INSERT INTO conversion_points (id, name, event_type, created_at)
       VALUES ('cp-1', 'CP', 'custom', '2024-01-01T00:00:00.000')`,
    );
    // Valid statuses (incl. NULL for non-attributed CVs) are accepted.
    expect(() =>
      db.exec(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at, approval_status)
         VALUES ('ce-1', 'cp-1', 'f-1', '2024-01-01T00:00:00.000', 'pending')`,
      ),
    ).not.toThrow();
    expect(() =>
      db.exec(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at)
         VALUES ('ce-null', 'cp-1', 'f-1', '2024-01-01T00:00:00.000')`,
      ),
    ).not.toThrow();
    // An out-of-set value is rejected.
    expect(() =>
      db.exec(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at, approval_status)
         VALUES ('ce-bad', 'cp-1', 'f-1', '2024-01-01T00:00:00.000', 'maybe')`,
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  test('affiliate_links.offer_id links to an offer', () => {
    db.exec(
      `INSERT INTO affiliates (id, name, code, is_active, created_at)
       VALUES ('aff-1', 'A', 'CODE001', 1, '2024-01-01T00:00:00.000')`,
    );
    db.exec(
      `INSERT INTO affiliate_offers (id, name, reward_amount, created_at)
       VALUES ('off-2', 'Offer', 5000, '2024-01-01T00:00:00.000')`,
    );
    db.exec(
      `INSERT INTO affiliate_links (id, affiliate_id, ref_code, offer_id, created_at)
       VALUES ('al-1', 'aff-1', 'REF001', 'off-2', '2024-01-01T00:00:00.000')`,
    );
    const row = db
      .prepare(`SELECT offer_id FROM affiliate_links WHERE id = 'al-1'`)
      .get() as { offer_id: string };
    expect(row.offer_id).toBe('off-2');
  });

  test('backfill: existing attributed CVs with NULL approval_status become pending', () => {
    // Seed an attributed CV that predates 047 (no approval_status column yet), plus
    // a non-attributed CV. Then apply 047 and assert only the attributed one is
    // backfilled to 'pending'; the organic CV stays NULL.
    const db = setupDbBefore047();
    db.exec(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES ('f-b', 'U0000000000000000000000000000009', 'B', '2024-01-01T00:00:00.000', '2024-01-01T00:00:00.000')`,
    );
    db.exec(
      `INSERT INTO affiliates (id, name, code, is_active, created_at)
       VALUES ('aff-b', 'B', 'CODEB', 1, '2024-01-01T00:00:00.000')`,
    );
    db.exec(
      `INSERT INTO conversion_points (id, name, event_type, created_at)
       VALUES ('cp-b', 'CP', 'custom', '2024-01-01T00:00:00.000')`,
    );
    // attributed CV (affiliate_id set) — should be backfilled.
    db.exec(
      `INSERT INTO conversion_events (id, conversion_point_id, friend_id, affiliate_id, created_at)
       VALUES ('ce-attr', 'cp-b', 'f-b', 'aff-b', '2024-01-02T00:00:00.000')`,
    );
    // organic CV (affiliate_id NULL) — should stay NULL.
    db.exec(
      `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at)
       VALUES ('ce-org', 'cp-b', 'f-b', '2024-01-02T00:00:00.000')`,
    );

    apply047(db);

    const attr = db
      .prepare(`SELECT approval_status FROM conversion_events WHERE id = 'ce-attr'`)
      .get() as { approval_status: string | null };
    const org = db
      .prepare(`SELECT approval_status FROM conversion_events WHERE id = 'ce-org'`)
      .get() as { approval_status: string | null };
    expect(attr.approval_status).toBe('pending');
    expect(org.approval_status).toBeNull();

    // Idempotent: applying 047 again changes nothing.
    apply047(db);
    const again = db
      .prepare(`SELECT approval_status FROM conversion_events WHERE id = 'ce-attr'`)
      .get() as { approval_status: string | null };
    expect(again.approval_status).toBe('pending');
  });
});
