import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAffiliateOffer,
  updateAffiliateOffer,
  listAffiliateOffers,
  getAffiliateOfferById,
  enrollAffiliateInOffer,
  setConversionApproval,
  getConversionApprovalNotifyInfo,
} from '../src/affiliate-offers.js';
import { trackConversion } from '../src/conversions.js';
import {
  getMileageHistoryForFriend,
  getMileageSummaryForFriend,
  postMileageEntry,
  recordEngagementEvent,
  syncAffiliateConversionMileage,
} from '../src/mileage.js';

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

/** Wraps better-sqlite3 to look like a D1Database (async API). */
function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async run() {
              const info = stmt.run(...params);
              return {
                results: [],
                success: true,
                meta: { changes: info.changes },
              };
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

// ── fixtures ───────────────────────────────────────────────────────────────

function insertAffiliate(sqlite: Database.Database, id: string, friendId?: string) {
  sqlite
    .prepare(
      `INSERT INTO affiliates (id, name, code, is_active, created_at, friend_id)
       VALUES (?, ?, ?, 1, '2024-01-01T00:00:00.000', ?)`,
    )
    .run(id, `Affiliate ${id}`, `CODE-${id}`, friendId ?? null);
}

function insertFriend(sqlite: Database.Database, id: string, lineUserId: string) {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES (?, ?, 'Test User', '2024-01-01T00:00:00.000', '2024-01-01T00:00:00.000')`,
    )
    .run(id, lineUserId);
}

function insertConversionPoint(sqlite: Database.Database, id: string) {
  sqlite
    .prepare(
      `INSERT INTO conversion_points (id, name, event_type, value, created_at)
       VALUES (?, 'CP', 'custom', 1000, '2024-01-01T00:00:00.000')`,
    )
    .run(id);
}

// ── CRUD ─────────────────────────────────────────────────────────────────

describe('affiliate-offers CRUD', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
  });

  test('createAffiliateOffer inserts with defaults and returns the row', async () => {
    const offer = await createAffiliateOffer(db, { name: 'Intro Bonus' });
    expect(offer.id).toBeTruthy();
    expect(offer.name).toBe('Intro Bonus');
    expect(offer.reward_amount).toBe(0);
    expect(offer.is_active).toBe(1);
    expect(offer.created_at).toBeTruthy();
  });

  test('createAffiliateOffer honours reward_amount and optional refs', async () => {
    const offer = await createAffiliateOffer(db, {
      name: 'Paid Offer',
      description: 'desc',
      rewardAmount: 5000,
    });
    expect(offer.reward_amount).toBe(5000);
    expect(offer.description).toBe('desc');
  });

  test('getAffiliateOfferById returns null for missing', async () => {
    expect(await getAffiliateOfferById(db, 'nope')).toBeNull();
  });

  test('updateAffiliateOffer patches fields', async () => {
    const offer = await createAffiliateOffer(db, { name: 'X', rewardAmount: 1000 });
    const updated = await updateAffiliateOffer(db, offer.id, {
      name: 'Y',
      reward_amount: 2000,
      is_active: 0,
    });
    expect(updated!.name).toBe('Y');
    expect(updated!.reward_amount).toBe(2000);
    expect(updated!.is_active).toBe(0);
  });

  test('updateAffiliateOffer with no fields is a no-op returning the row', async () => {
    const offer = await createAffiliateOffer(db, { name: 'X' });
    const updated = await updateAffiliateOffer(db, offer.id, {});
    expect(updated!.name).toBe('X');
  });

  test('listAffiliateOffers returns all, and activeOnly filters inactive', async () => {
    const a = await createAffiliateOffer(db, { name: 'active' });
    const b = await createAffiliateOffer(db, { name: 'inactive' });
    await updateAffiliateOffer(db, b.id, { is_active: 0 });

    const all = await listAffiliateOffers(db);
    expect(all.map((o) => o.id).sort()).toEqual([a.id, b.id].sort());

    const activeOnly = await listAffiliateOffers(db, { activeOnly: true });
    expect(activeOnly.map((o) => o.id)).toEqual([a.id]);
  });
});

// ── enroll (idempotent) ────────────────────────────────────────────────────

describe('enrollAffiliateInOffer', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
    insertAffiliate(sqlite, 'aff-1');
  });

  test('first enroll creates a new link tagged with offer_id and label=offer.name', async () => {
    const offer = await createAffiliateOffer(db, { name: 'Campaign A' });
    const { link, existing } = await enrollAffiliateInOffer(db, {
      affiliateId: 'aff-1',
      offerId: offer.id,
    });
    expect(existing).toBe(false);
    expect(link.affiliate_id).toBe('aff-1');
    expect(link.offer_id).toBe(offer.id);
    expect(link.label).toBe('Campaign A');
    expect(link.ref_code).toBeTruthy();
  });

  test('second enroll for the same affiliate+offer returns the existing link', async () => {
    const offer = await createAffiliateOffer(db, { name: 'Campaign B' });
    const first = await enrollAffiliateInOffer(db, {
      affiliateId: 'aff-1',
      offerId: offer.id,
    });
    const second = await enrollAffiliateInOffer(db, {
      affiliateId: 'aff-1',
      offerId: offer.id,
    });
    expect(second.existing).toBe(true);
    expect(second.link.id).toBe(first.link.id);
    expect(second.link.ref_code).toBe(first.link.ref_code);

    const count = sqlite
      .prepare(
        `SELECT COUNT(*) AS c FROM affiliate_links WHERE affiliate_id = 'aff-1' AND offer_id = ?`,
      )
      .get(offer.id) as { c: number };
    expect(count.c).toBe(1);
  });

  test('enrollAffiliateInOffer throws when offer does not exist', async () => {
    await expect(
      enrollAffiliateInOffer(db, { affiliateId: 'aff-1', offerId: 'no-such-offer' }),
    ).rejects.toThrow('offer not found');
  });

  test('different affiliates enrolling in the same offer get separate links', async () => {
    insertAffiliate(sqlite, 'aff-2');
    const offer = await createAffiliateOffer(db, { name: 'Shared' });
    const a = await enrollAffiliateInOffer(db, { affiliateId: 'aff-1', offerId: offer.id });
    const b = await enrollAffiliateInOffer(db, { affiliateId: 'aff-2', offerId: offer.id });
    expect(a.link.id).not.toBe(b.link.id);
    expect(a.link.ref_code).not.toBe(b.link.ref_code);
  });
});

// ── approval ───────────────────────────────────────────────────────────────

describe('setConversionApproval', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
    insertFriend(sqlite, 'f-1', 'U0000000000000000000000000000001');
    insertConversionPoint(sqlite, 'cp-1');
  });

  test('approves an affiliate-attributed pending event and stamps approved_at', async () => {
    sqlite
      .prepare(
        `INSERT INTO affiliates (id, name, code, is_active, created_at)
         VALUES ('aff-1', 'A', 'C1', 1, '2024-01-01T00:00:00.000')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at, affiliate_id, approval_status)
         VALUES ('ce-1', 'cp-1', 'f-1', '2024-01-01T00:00:00.000', 'aff-1', 'pending')`,
      )
      .run();

    const ok = await setConversionApproval(db, 'ce-1', 'approved');
    expect(ok).toBe(true);

    const row = sqlite
      .prepare(`SELECT approval_status, approved_at FROM conversion_events WHERE id = 'ce-1'`)
      .get() as { approval_status: string; approved_at: string | null };
    expect(row.approval_status).toBe('approved');
    expect(row.approved_at).toBeTruthy();
  });

  test('rejects an event', async () => {
    sqlite
      .prepare(
        `INSERT INTO affiliates (id, name, code, is_active, created_at)
         VALUES ('aff-1', 'A', 'C1', 1, '2024-01-01T00:00:00.000')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at, affiliate_id, approval_status)
         VALUES ('ce-2', 'cp-1', 'f-1', '2024-01-01T00:00:00.000', 'aff-1', 'pending')`,
      )
      .run();
    const ok = await setConversionApproval(db, 'ce-2', 'rejected');
    expect(ok).toBe(true);
    const row = sqlite
      .prepare(`SELECT approval_status, approved_at FROM conversion_events WHERE id = 'ce-2'`)
      .get() as { approval_status: string; approved_at: string | null };
    expect(row.approval_status).toBe('rejected');
    expect(row.approved_at).toBeTruthy();
  });

  test('returns already_set when setting the same status again (approved → approved)', async () => {
    sqlite
      .prepare(
        `INSERT INTO affiliates (id, name, code, is_active, created_at)
         VALUES ('aff-idem', 'A', 'CIDEM', 1, '2024-01-01T00:00:00.000')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at, affiliate_id, approval_status)
         VALUES ('ce-idem', 'cp-1', 'f-1', '2024-01-01T00:00:00.000', 'aff-idem', 'pending')`,
      )
      .run();
    // First approval — changes row
    const first = await setConversionApproval(db, 'ce-idem', 'approved');
    expect(first).toBe(true);
    // Second approval with same status — no-op
    const second = await setConversionApproval(db, 'ce-idem', 'approved');
    expect(second).toBe('already_set');
    // Verify DB row is unchanged (still approved, approved_at set by first call)
    const row = sqlite
      .prepare(`SELECT approval_status FROM conversion_events WHERE id = 'ce-idem'`)
      .get() as { approval_status: string };
    expect(row.approval_status).toBe('approved');
  });

  test('approved → rejected returns true (status change still works)', async () => {
    sqlite
      .prepare(
        `INSERT INTO affiliates (id, name, code, is_active, created_at)
         VALUES ('aff-chg', 'A', 'CCHG', 1, '2024-01-01T00:00:00.000')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at, affiliate_id, approval_status)
         VALUES ('ce-chg', 'cp-1', 'f-1', '2024-01-01T00:00:00.000', 'aff-chg', 'pending')`,
      )
      .run();
    const first = await setConversionApproval(db, 'ce-chg', 'approved');
    expect(first).toBe(true);
    const second = await setConversionApproval(db, 'ce-chg', 'rejected');
    expect(second).toBe(true);
    const row = sqlite
      .prepare(`SELECT approval_status FROM conversion_events WHERE id = 'ce-chg'`)
      .get() as { approval_status: string };
    expect(row.approval_status).toBe('rejected');
  });

  test('returns false for a non-attributed (affiliate_id NULL) event', async () => {
    sqlite
      .prepare(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at)
         VALUES ('ce-null', 'cp-1', 'f-1', '2024-01-01T00:00:00.000')`,
      )
      .run();
    const ok = await setConversionApproval(db, 'ce-null', 'approved');
    expect(ok).toBe(false);
    const row = sqlite
      .prepare(`SELECT approval_status FROM conversion_events WHERE id = 'ce-null'`)
      .get() as { approval_status: string | null };
    expect(row.approval_status).toBeNull();
  });

  test('returns false for a missing event', async () => {
    expect(await setConversionApproval(db, 'nope', 'approved')).toBe(false);
  });
});

// ── getConversionApprovalNotifyInfo ─────────────────────────────────────────

describe('getConversionApprovalNotifyInfo', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
    insertFriend(sqlite, 'f-1', 'U0000000000000000000000000000001');
    insertConversionPoint(sqlite, 'cp-1');
    insertAffiliate(sqlite, 'aff-1');
  });

  test('resolves affiliate + offer name + reward via attributed_ref_code', async () => {
    sqlite
      .prepare(
        `INSERT INTO affiliate_offers (id, name, reward_amount, is_active, created_at)
         VALUES ('off-1', '案件A', 5000, 1, '2024-01-01T00:00:00.000')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO affiliate_links (id, affiliate_id, ref_code, offer_id, is_active, created_at)
         VALUES ('al-1', 'aff-1', 'ref-1', 'off-1', 1, '2024-01-01T00:00:00.000')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at, affiliate_id, attributed_ref_code, approval_status)
         VALUES ('ce-1', 'cp-1', 'f-1', '2024-01-01T00:00:00.000', 'aff-1', 'ref-1', 'approved')`,
      )
      .run();

    const info = await getConversionApprovalNotifyInfo(db, 'ce-1');
    expect(info).toEqual({ affiliateId: 'aff-1', offerName: '案件A', rewardAmount: 5000 });
  });

  test('offer-less (generic link) attribution → null offer name, 0 reward', async () => {
    sqlite
      .prepare(
        `INSERT INTO affiliate_links (id, affiliate_id, ref_code, offer_id, is_active, created_at)
         VALUES ('al-2', 'aff-1', 'ref-2', NULL, 1, '2024-01-01T00:00:00.000')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at, affiliate_id, attributed_ref_code, approval_status)
         VALUES ('ce-2', 'cp-1', 'f-1', '2024-01-01T00:00:00.000', 'aff-1', 'ref-2', 'approved')`,
      )
      .run();

    const info = await getConversionApprovalNotifyInfo(db, 'ce-2');
    expect(info).toEqual({ affiliateId: 'aff-1', offerName: null, rewardAmount: 0 });
  });

  test('returns null for a non-attributed (affiliate_id NULL) event', async () => {
    sqlite
      .prepare(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at)
         VALUES ('ce-null', 'cp-1', 'f-1', '2024-01-01T00:00:00.000')`,
      )
      .run();
    expect(await getConversionApprovalNotifyInfo(db, 'ce-null')).toBeNull();
  });

  test('returns null for a missing event', async () => {
    expect(await getConversionApprovalNotifyInfo(db, 'nope')).toBeNull();
  });
});

// ── generic mileage foundation + ASP projection ────────────────────────────

describe('mileage foundation', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
    sqlite
      .prepare(
        `INSERT INTO users (id, display_name, created_at, updated_at)
         VALUES ('user-aff', 'Affiliate User', '2026-01-01', '2026-01-01')`,
      )
      .run();
    insertFriend(sqlite, 'friend-aff', 'U-AFF');
    insertFriend(sqlite, 'friend-customer', 'U-CUSTOMER');
    sqlite.prepare(`UPDATE friends SET user_id = 'user-aff' WHERE id = 'friend-aff'`).run();
    insertAffiliate(sqlite, 'aff-mile', 'friend-aff');
    insertConversionPoint(sqlite, 'cp-mile');
  });

  test('an approved referral grants once and rejection appends one reversal', async () => {
    const offer = await createAffiliateOffer(db, {
      name: '紹介キャンペーン',
      rewardAmount: 5000,
      rewardMiles: 750,
    });
    const { link } = await enrollAffiliateInOffer(db, {
      affiliateId: 'aff-mile',
      offerId: offer.id,
    });
    sqlite
      .prepare(
        `INSERT INTO conversion_events
           (id, conversion_point_id, friend_id, affiliate_id,
            attributed_ref_code, approval_status, created_at)
         VALUES ('ce-mile', 'cp-mile', 'friend-customer', 'aff-mile', ?, 'pending', '2026-01-01')`,
      )
      .run(link.ref_code);

    expect(await setConversionApproval(db, 'ce-mile', 'approved')).toBe(true);
    sqlite.prepare(`UPDATE conversion_events SET approved_at = '2026-01-02' WHERE id = 'ce-mile'`).run();
    await syncAffiliateConversionMileage(db, 'ce-mile', 'approved');
    await syncAffiliateConversionMileage(db, 'ce-mile', 'approved');

    expect(await getMileageSummaryForFriend(db, 'friend-aff')).toMatchObject({
      available: 750,
      lifetimeEarned: 750,
    });
    expect(await getMileageHistoryForFriend(db, 'friend-aff')).toHaveLength(1);
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS count FROM engagement_events`).get() as { count: number }).count,
    ).toBe(1);

    expect(await setConversionApproval(db, 'ce-mile', 'rejected')).toBe(true);
    sqlite.prepare(`UPDATE conversion_events SET approved_at = '2026-01-03' WHERE id = 'ce-mile'`).run();
    await syncAffiliateConversionMileage(db, 'ce-mile', 'rejected');
    await syncAffiliateConversionMileage(db, 'ce-mile', 'rejected');

    expect(await getMileageSummaryForFriend(db, 'friend-aff')).toMatchObject({
      available: 0,
      lifetimeEarned: 750,
    });
    const history = await getMileageHistoryForFriend(db, 'friend-aff');
    expect(history.map((item) => item.amount).sort((a, b) => a - b)).toEqual([-750, 750]);
  });

  test('generic events and ledger entries are idempotent', async () => {
    const eventA = await recordEngagementEvent(db, {
      idempotencyKey: 'webinar:view:abc:50-percent',
      eventType: 'webinar_progress',
      source: 'webinar',
      sourceEventId: 'abc',
      actorFriendId: 'friend-aff',
    });
    const eventB = await recordEngagementEvent(db, {
      idempotencyKey: 'webinar:view:abc:50-percent',
      eventType: 'webinar_progress',
      source: 'webinar',
      sourceEventId: 'abc',
      actorFriendId: 'friend-aff',
    });
    expect(eventB.id).toBe(eventA.id);

    const grantA = await postMileageEntry(db, {
      beneficiaryFriendId: 'friend-aff',
      engagementEventId: eventA.id,
      entryType: 'grant',
      amount: 100,
      reason: 'ウェビナー50%視聴',
      source: 'webinar',
      sourceEventId: 'abc',
      idempotencyKey: 'webinar:grant:abc:50-percent',
    });
    const grantB = await postMileageEntry(db, {
      beneficiaryFriendId: 'friend-aff',
      engagementEventId: eventA.id,
      entryType: 'grant',
      amount: 100,
      reason: 'ウェビナー50%視聴',
      source: 'webinar',
      sourceEventId: 'abc',
      idempotencyKey: 'webinar:grant:abc:50-percent',
    });
    expect(grantB.id).toBe(grantA.id);
    expect((await getMileageSummaryForFriend(db, 'friend-aff')).available).toBe(100);
  });

  test('a linked user sees mileage earned from another LINE-account friend row', async () => {
    insertFriend(sqlite, 'friend-aff-2', 'U-AFF-SECOND');
    sqlite.prepare(`UPDATE friends SET user_id = 'user-aff' WHERE id = 'friend-aff-2'`).run();
    await postMileageEntry(db, {
      beneficiaryUserId: 'user-aff',
      beneficiaryFriendId: 'friend-aff',
      entryType: 'grant',
      amount: 300,
      reason: '共通ユーザー付与',
      source: 'manual_test',
      idempotencyKey: 'cross-account-grant-1',
    });
    expect((await getMileageSummaryForFriend(db, 'friend-aff-2')).available).toBe(300);
  });
});

// ── trackConversion approval wiring ─────────────────────────────────────────

describe('trackConversion sets approval_status', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
    insertConversionPoint(sqlite, 'cp-1');
  });

  test("attributed CV is inserted with approval_status='pending'", async () => {
    // Affiliate (not the converting friend, so self-click exclusion does not apply).
    insertAffiliate(sqlite, 'aff-1');
    insertFriend(sqlite, 'f-buyer', 'U0000000000000000000000000000010');
    // A ref link + a ref_tracking touch → last-touch attribution resolves.
    sqlite
      .prepare(
        `INSERT INTO affiliate_links (id, affiliate_id, ref_code, is_active, created_at)
         VALUES ('al-1', 'aff-1', 'REF010', 1, '2024-01-01T00:00:00.000')`,
      )
      .run();
    // Touch must fall within the 90-day attribution window (relative to now),
    // so use a recent timestamp rather than a fixed historical date.
    const recentTouch = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO ref_tracking (id, ref_code, friend_id, created_at)
         VALUES ('rt-1', 'REF010', 'f-buyer', ?)`,
      )
      .run(recentTouch);

    const ev = await trackConversion(db, {
      conversionPointId: 'cp-1',
      friendId: 'f-buyer',
    });
    expect(ev.affiliate_id).toBe('aff-1');

    const row = sqlite
      .prepare(`SELECT approval_status FROM conversion_events WHERE id = ?`)
      .get(ev.id) as { approval_status: string | null };
    expect(row.approval_status).toBe('pending');
  });

  test('non-attributed CV keeps approval_status NULL', async () => {
    insertFriend(sqlite, 'f-lone', 'U0000000000000000000000000000011');
    const ev = await trackConversion(db, {
      conversionPointId: 'cp-1',
      friendId: 'f-lone',
    });
    expect(ev.affiliate_id).toBeNull();
    const row = sqlite
      .prepare(`SELECT approval_status FROM conversion_events WHERE id = ?`)
      .get(ev.id) as { approval_status: string | null };
    expect(row.approval_status).toBeNull();
  });
});
