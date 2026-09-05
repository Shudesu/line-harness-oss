import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getConversionApprovalQueue } from '../src/affiliate-report.js';
import { setConversionApproval } from '../src/affiliate-offers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');
const BENIGN = /duplicate column name|already exists/i;

// Canonical IDENTITY_KEY_SQL (kept in sync with apps/worker/src/lib/identity-key.ts).
const IDENTITY_KEY_SQL = `
  COALESCE(
    CASE
      WHEN friends.picture_url LIKE 'https://sprofile.line-scdn.net/%' THEN SUBSTR(friends.picture_url, 42, 80)
      WHEN friends.picture_url LIKE 'https://profile.line-scdn.net/%' THEN SUBSTR(friends.picture_url, 41, 80)
      ELSE NULL
    END,
    'uid:' || friends.user_id,
    'solo:' || friends.id
  )
`;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) {
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
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
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
              const info = stmt.run(...params);
              return { results: [], success: true, meta: { changes: info.changes } };
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
          const info = sqlite.prepare(query).run();
          return { results: [], success: true, meta: { changes: info.changes } };
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

function insertFriend(
  s: Database.Database,
  id: string,
  opts: { userId?: string | null; displayName?: string } = {},
): void {
  s.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, picture_url, user_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, '2026-01-01T00:00:00.000+09:00', '2026-01-01T00:00:00.000+09:00')`,
  ).run(id, `L-${id}`, opts.displayName ?? id, opts.userId ?? null);
}

function insertAffiliate(s: Database.Database, id: string): void {
  s.prepare(
    `INSERT INTO affiliates (id, name, code, commission_rate, is_active, created_at, friend_id)
     VALUES (?, ?, ?, 0, 1, '2026-01-01T00:00:00.000+09:00', NULL)`,
  ).run(id, `Aff ${id}`, `code-${id}`);
}

function insertPoint(s: Database.Database, id: string, value: number): void {
  s.prepare(
    `INSERT INTO conversion_points (id, name, event_type, value, created_at)
     VALUES (?, ?, 'purchase', ?, '2026-01-01T00:00:00.000+09:00')`,
  ).run(id, `Point ${id}`, value);
}

function insertOfferAndLink(
  s: Database.Database,
  opts: { offerId: string; offerName: string; affiliateId: string; refCode: string },
): void {
  s.prepare(
    `INSERT INTO affiliate_offers (id, name, description, reward_amount, line_account_id, tag_id, scenario_id, is_active, created_at)
     VALUES (?, ?, NULL, 500, NULL, NULL, NULL, 1, '2026-01-01T00:00:00.000+09:00')`,
  ).run(opts.offerId, opts.offerName);
  s.prepare(
    `INSERT INTO affiliate_links (id, affiliate_id, ref_code, label, line_account_id, offer_id, is_active, created_at, click_count)
     VALUES (?, ?, ?, NULL, NULL, ?, 1, '2026-01-01T00:00:00.000+09:00', 0)`,
  ).run(`link-${opts.refCode}`, opts.affiliateId, opts.refCode, opts.offerId);
}

function insertConversion(
  s: Database.Database,
  opts: {
    id: string;
    pointId: string;
    friendId: string;
    affiliateId: string | null;
    refCode: string | null;
    approvalStatus: string | null;
    createdAt: string;
  },
): void {
  s.prepare(
    `INSERT INTO conversion_events (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code, approval_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(opts.id, opts.pointId, opts.friendId, opts.affiliateId, opts.refCode, opts.approvalStatus, opts.createdAt);
}

let sqlite: Database.Database;
let db: D1Database;
beforeEach(() => {
  sqlite = setupDb();
  db = asD1(sqlite);
});

describe('getConversionApprovalQueue', () => {
  test('filters by status and resolves friend/affiliate/offer/point + value', async () => {
    insertFriend(sqlite, 'f1', { displayName: 'Alice', userId: 'uid-a' });
    insertAffiliate(sqlite, 'aff1');
    insertPoint(sqlite, 'p1', 800);
    insertOfferAndLink(sqlite, { offerId: 'off1', offerName: '案件A', affiliateId: 'aff1', refCode: 'rc1' });
    insertConversion(sqlite, {
      id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1',
      approvalStatus: 'pending', createdAt: '2026-02-01T00:00:00.000+09:00',
    });
    // An approved CV and a non-attributed CV that must NOT surface in pending.
    insertConversion(sqlite, {
      id: 'cv2', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1',
      approvalStatus: 'approved', createdAt: '2026-02-02T00:00:00.000+09:00',
    });
    insertConversion(sqlite, {
      id: 'cv3', pointId: 'p1', friendId: 'f1', affiliateId: null, refCode: null,
      approvalStatus: null, createdAt: '2026-02-03T00:00:00.000+09:00',
    });

    const pending = await getConversionApprovalQueue(db, { status: 'pending', identityKeySql: IDENTITY_KEY_SQL });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      eventId: 'cv1',
      friendName: 'Alice',
      affiliateName: 'Aff aff1',
      offerName: '案件A',
      conversionPointName: 'Point p1',
      value: 800,
      approvalStatus: 'pending',
      duplicateFlag: false,
    });

    const approved = await getConversionApprovalQueue(db, { status: 'approved', identityKeySql: IDENTITY_KEY_SQL });
    expect(approved.map((r) => r.eventId)).toEqual(['cv2']);
  });

  test('duplicateFlag is true when two friends share an identity_key within the same affiliate', async () => {
    // Two friends, SAME user_id → same identity_key. Both attributed to aff1.
    insertFriend(sqlite, 'f1', { userId: 'shared-uid' });
    insertFriend(sqlite, 'f2', { userId: 'shared-uid' });
    // A third friend on a different key, same affiliate → not flagged.
    insertFriend(sqlite, 'f3', { userId: 'lonely-uid' });
    insertAffiliate(sqlite, 'aff1');
    insertPoint(sqlite, 'p1', 100);
    insertOfferAndLink(sqlite, { offerId: 'off1', offerName: 'O', affiliateId: 'aff1', refCode: 'rc1' });

    insertConversion(sqlite, { id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'pending', createdAt: '2026-02-01T00:00:00.000+09:00' });
    insertConversion(sqlite, { id: 'cv2', pointId: 'p1', friendId: 'f2', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'pending', createdAt: '2026-02-02T00:00:00.000+09:00' });
    insertConversion(sqlite, { id: 'cv3', pointId: 'p1', friendId: 'f3', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'pending', createdAt: '2026-02-03T00:00:00.000+09:00' });

    const rows = await getConversionApprovalQueue(db, { status: 'pending', identityKeySql: IDENTITY_KEY_SQL });
    const flagByEvent = new Map(rows.map((r) => [r.eventId, r.duplicateFlag]));
    expect(flagByEvent.get('cv1')).toBe(true);
    expect(flagByEvent.get('cv2')).toBe(true);
    expect(flagByEvent.get('cv3')).toBe(false);
  });

  test('duplicate identity_key across DIFFERENT affiliates does not flag', async () => {
    insertFriend(sqlite, 'f1', { userId: 'shared-uid' });
    insertFriend(sqlite, 'f2', { userId: 'shared-uid' });
    insertAffiliate(sqlite, 'aff1');
    insertAffiliate(sqlite, 'aff2');
    insertPoint(sqlite, 'p1', 100);
    insertOfferAndLink(sqlite, { offerId: 'off1', offerName: 'O1', affiliateId: 'aff1', refCode: 'rc1' });
    insertOfferAndLink(sqlite, { offerId: 'off2', offerName: 'O2', affiliateId: 'aff2', refCode: 'rc2' });

    insertConversion(sqlite, { id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'pending', createdAt: '2026-02-01T00:00:00.000+09:00' });
    insertConversion(sqlite, { id: 'cv2', pointId: 'p1', friendId: 'f2', affiliateId: 'aff2', refCode: 'rc2', approvalStatus: 'pending', createdAt: '2026-02-02T00:00:00.000+09:00' });

    const rows = await getConversionApprovalQueue(db, { status: 'pending', identityKeySql: IDENTITY_KEY_SQL });
    expect(rows.every((r) => r.duplicateFlag === false)).toBe(true);
  });
});

describe('setConversionApproval', () => {
  test('updates an attributed row and returns true; missing/non-attributed returns false', async () => {
    insertFriend(sqlite, 'f1', { userId: 'u' });
    insertAffiliate(sqlite, 'aff1');
    insertPoint(sqlite, 'p1', 100);
    insertConversion(sqlite, { id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: null, approvalStatus: 'pending', createdAt: '2026-02-01T00:00:00.000+09:00' });
    insertConversion(sqlite, { id: 'cv2', pointId: 'p1', friendId: 'f1', affiliateId: null, refCode: null, approvalStatus: null, createdAt: '2026-02-02T00:00:00.000+09:00' });

    expect(await setConversionApproval(db, 'cv1', 'approved')).toBe(true);
    const row = sqlite.prepare(`SELECT approval_status FROM conversion_events WHERE id = 'cv1'`).get() as { approval_status: string };
    expect(row.approval_status).toBe('approved');

    // Non-attributed CV → no update.
    expect(await setConversionApproval(db, 'cv2', 'approved')).toBe(false);
    // Missing CV → no update.
    expect(await setConversionApproval(db, 'nope', 'rejected')).toBe(false);
  });
});
