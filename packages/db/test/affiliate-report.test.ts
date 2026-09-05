import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getAffiliateReportV2,
  getFriendJourney,
  getAffiliateJourneys,
  getAffiliateLinkStats,
} from '../src/affiliate-report.js';
import { getAffiliateReport } from '../src/affiliates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');

const BENIGN = /duplicate column name|already exists/i;

// The canonical IDENTITY_KEY_SQL fragment (kept in sync with
// apps/worker/src/lib/identity-key.ts). Passed into the report function so the
// db layer stays decoupled from apps/worker while using the same expression.
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

// ── Fixture helpers ──────────────────────────────────────────────────────────

function insertFriend(
  sqlite: Database.Database,
  id: string,
  opts: { createdAt: string; userId?: string | null; pictureUrl?: string | null; displayName?: string } = { createdAt: '2026-01-01T00:00:00.000+09:00' },
): void {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, picture_url, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      `U${id.replace(/[^0-9a-f]/gi, '').padEnd(32, '0').slice(0, 32)}`,
      opts.displayName ?? 'Test User',
      opts.pictureUrl ?? null,
      opts.userId ?? null,
      opts.createdAt,
      opts.createdAt,
    );
}

let affiliateSeq = 0;
function insertAffiliate(
  sqlite: Database.Database,
  id: string,
  opts: { friendId?: string | null; commissionRate?: number } = {},
): void {
  affiliateSeq++;
  sqlite
    .prepare(
      `INSERT INTO affiliates (id, name, code, commission_rate, is_active, created_at, friend_id)
       VALUES (?, ?, ?, ?, 1, '2024-01-01T00:00:00.000+09:00', ?)`,
    )
    .run(id, `Aff ${id}`, `code-${id}-${affiliateSeq}`, opts.commissionRate ?? 0, opts.friendId ?? null);
}

function insertLink(
  sqlite: Database.Database,
  opts: { id: string; affiliateId: string; refCode: string; clickCount?: number; offerId?: string | null },
): void {
  sqlite
    .prepare(
      `INSERT INTO affiliate_links (id, affiliate_id, ref_code, label, line_account_id, is_active, created_at, click_count, offer_id)
       VALUES (?, ?, ?, NULL, NULL, 1, '2024-01-01T00:00:00.000+09:00', ?, ?)`,
    )
    .run(opts.id, opts.affiliateId, opts.refCode, opts.clickCount ?? 0, opts.offerId ?? null);
}

function insertOffer(
  sqlite: Database.Database,
  opts: { id: string; name: string; rewardAmount: number },
): void {
  sqlite
    .prepare(
      `INSERT INTO affiliate_offers (id, name, reward_amount, is_active, created_at)
       VALUES (?, ?, ?, 1, '2024-01-01T00:00:00.000+09:00')`,
    )
    .run(opts.id, opts.name, opts.rewardAmount);
}

function insertTouch(
  sqlite: Database.Database,
  opts: { id: string; refCode: string; friendId: string; createdAt: string; sourceUrl?: string | null },
): void {
  sqlite
    .prepare(
      `INSERT INTO ref_tracking (id, ref_code, friend_id, source_url, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(opts.id, opts.refCode, opts.friendId, opts.sourceUrl ?? null, opts.createdAt);
}

function insertConversionPoint(
  sqlite: Database.Database,
  opts: { id: string; name: string; value: number },
): void {
  sqlite
    .prepare(
      `INSERT INTO conversion_points (id, name, event_type, value, created_at)
       VALUES (?, ?, 'purchase', ?, '2024-01-01T00:00:00.000+09:00')`,
    )
    .run(opts.id, opts.name, opts.value);
}

function insertConversion(
  sqlite: Database.Database,
  opts: {
    id: string; pointId: string; friendId: string; affiliateId: string | null;
    refCode: string | null; createdAt: string;
    approvalStatus?: 'pending' | 'approved' | 'rejected' | null;
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO conversion_events (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code, created_at, approval_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.id, opts.pointId, opts.friendId, opts.affiliateId, opts.refCode, opts.createdAt,
      opts.approvalStatus ?? null,
    );
}

function insertForm(sqlite: Database.Database, opts: { id: string; name: string }): void {
  sqlite
    .prepare(`INSERT INTO forms (id, name, created_at, updated_at) VALUES (?, ?, '2024-01-01T00:00:00.000+09:00', '2024-01-01T00:00:00.000+09:00')`)
    .run(opts.id, opts.name);
}

function insertSubmission(
  sqlite: Database.Database,
  opts: { id: string; formId: string; friendId: string; createdAt: string },
): void {
  sqlite
    .prepare(`INSERT INTO form_submissions (id, form_id, friend_id, data, created_at) VALUES (?, ?, ?, '{}', ?)`)
    .run(opts.id, opts.formId, opts.friendId, opts.createdAt);
}

const NOW = '2026-07-07T12:00:00.000+09:00';
function jstDaysAgo(days: number, opts: { minutes?: number } = {}): string {
  const base = new Date(NOW).getTime();
  const ms = base - days * 86_400_000 + (opts.minutes ?? 0) * 60_000;
  const jst = new Date(ms + 9 * 60 * 60_000);
  return jst.toISOString().slice(0, -1) + '+09:00';
}

// ── Journey + report scenario (brief) ────────────────────────────────────────
// touch(A) -> friend_add -> touch(B, other affiliate) -> conversion.
// The friend adds AFTER touch(A) but BEFORE touch(B), so add-time last-touch is
// A. The conversion happens after touch(B), so its snapshot attribution is B.

describe('journey + affiliate report v2 — canonical scenario', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);

    insertAffiliate(sqlite, 'aff-A', { commissionRate: 0.2 });
    insertAffiliate(sqlite, 'aff-B', { commissionRate: 0.5 });
    insertLink(sqlite, { id: 'link-A', affiliateId: 'aff-A', refCode: 'refA', clickCount: 7 });
    insertLink(sqlite, { id: 'link-B', affiliateId: 'aff-B', refCode: 'refB', clickCount: 3 });
    insertConversionPoint(sqlite, { id: 'cp-1', name: 'Purchase', value: 1000 });

    // friend added between touch A and touch B
    insertFriend(sqlite, 'friend-1', { createdAt: jstDaysAgo(20) });
    insertTouch(sqlite, { id: 't-a', refCode: 'refA', friendId: 'friend-1', createdAt: jstDaysAgo(25), sourceUrl: 'https://example.test/lp' });
    insertTouch(sqlite, { id: 't-b', refCode: 'refB', friendId: 'friend-1', createdAt: jstDaysAgo(10) });
    insertConversion(sqlite, {
      id: 'cv-1', pointId: 'cp-1', friendId: 'friend-1',
      affiliateId: 'aff-B', refCode: 'refB', createdAt: jstDaysAgo(5),
    });
  });

  test('journey returns 4 events in ascending time order', async () => {
    const journey = await getFriendJourney(db, 'friend-1');
    expect(journey.map((e) => e.type)).toEqual([
      'touch',      // touch A @ -25d
      'friend_add', // add @ -20d
      'touch',      // touch B @ -10d
      'conversion', // cv @ -5d
    ]);
    expect(journey[0].refCode).toBe('refA');
    expect(journey[0].affiliateId).toBe('aff-A');
    expect(journey[2].refCode).toBe('refB');
    expect(journey[2].affiliateId).toBe('aff-B');
    expect(journey[3].refCode).toBe('refB');
  });

  test('affiliate A: friendAdds=1, conversions=0', async () => {
    const report = await getAffiliateReportV2(db, 'aff-A', { identityKeySql: IDENTITY_KEY_SQL });
    expect(report).not.toBeNull();
    expect(report!.friendAdds).toBe(1);
    expect(report!.conversions).toBe(0);
    // A got 1 ref_tracking touch on its link
    expect(report!.clicks).toBe(1);
    expect(report!.linkClicks).toBe(7);
    expect(report!.revenue).toBe(0);
    expect(report!.estimatedCommission).toBe(0);
  });

  test('affiliate B: friendAdds=0, conversions=1', async () => {
    const report = await getAffiliateReportV2(db, 'aff-B', { identityKeySql: IDENTITY_KEY_SQL });
    expect(report!.friendAdds).toBe(0);
    expect(report!.conversions).toBe(1);
    expect(report!.clicks).toBe(1);
    expect(report!.linkClicks).toBe(3);
    expect(report!.conversionsByPoint).toEqual([
      { conversionPointId: 'cp-1', name: 'Purchase', count: 1, value: 1000 },
    ]);
    expect(report!.revenue).toBe(1000);
    expect(report!.estimatedCommission).toBe(500); // 1000 * 0.5
  });

  test('non-existent affiliate returns null', async () => {
    expect(await getAffiliateReportV2(db, 'nope', { identityKeySql: IDENTITY_KEY_SQL })).toBeNull();
  });
});

// ── friendAdds: self-click exclusion + window edge ───────────────────────────

describe('getAffiliateReportV2 — friendAdds attribution rules', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
  });

  test('self-click add is NOT counted as a friendAdd', async () => {
    insertFriend(sqlite, 'friend-self', { createdAt: jstDaysAgo(1) });
    insertAffiliate(sqlite, 'aff-self', { friendId: 'friend-self' });
    insertLink(sqlite, { id: 'link-s', affiliateId: 'aff-self', refCode: 'refself' });
    insertTouch(sqlite, { id: 't-s', refCode: 'refself', friendId: 'friend-self', createdAt: jstDaysAgo(3) });

    const report = await getAffiliateReportV2(db, 'aff-self', { identityKeySql: IDENTITY_KEY_SQL });
    expect(report!.friendAdds).toBe(0);
  });

  test('a touch strictly older than 90 days before add is not attributed', async () => {
    insertFriend(sqlite, 'friend-old', { createdAt: NOW });
    insertAffiliate(sqlite, 'aff-old');
    insertLink(sqlite, { id: 'link-o', affiliateId: 'aff-old', refCode: 'refold' });
    // touch 91 days before add
    insertTouch(sqlite, { id: 't-o', refCode: 'refold', friendId: 'friend-old', createdAt: jstDaysAgo(91) });

    const report = await getAffiliateReportV2(db, 'aff-old', { identityKeySql: IDENTITY_KEY_SQL });
    expect(report!.friendAdds).toBe(0);
  });

  test('add-time last-touch: newest eligible touch before add wins', async () => {
    insertAffiliate(sqlite, 'aff-x');
    insertAffiliate(sqlite, 'aff-y');
    insertLink(sqlite, { id: 'lx', affiliateId: 'aff-x', refCode: 'refx' });
    insertLink(sqlite, { id: 'ly', affiliateId: 'aff-y', refCode: 'refy' });
    // friend added at -10d: only touches before -10d count. refy(-12d) is newer than refx(-30d).
    insertFriend(sqlite, 'friend-w', { createdAt: jstDaysAgo(10) });
    insertTouch(sqlite, { id: 'tx', refCode: 'refx', friendId: 'friend-w', createdAt: jstDaysAgo(30) });
    insertTouch(sqlite, { id: 'ty', refCode: 'refy', friendId: 'friend-w', createdAt: jstDaysAgo(12) });
    // a later touch refx(-2d) is AFTER the add -> must not change add-time attribution
    insertTouch(sqlite, { id: 'tx2', refCode: 'refx', friendId: 'friend-w', createdAt: jstDaysAgo(2) });

    const rx = await getAffiliateReportV2(db, 'aff-x', { identityKeySql: IDENTITY_KEY_SQL });
    const ry = await getAffiliateReportV2(db, 'aff-y', { identityKeySql: IDENTITY_KEY_SQL });
    expect(rx!.friendAdds).toBe(0);
    expect(ry!.friendAdds).toBe(1);
  });
});

// ── duplicateFlags ───────────────────────────────────────────────────────────

describe('getAffiliateReportV2 — duplicateFlags', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
    insertAffiliate(sqlite, 'aff-d');
    insertLink(sqlite, { id: 'ld', affiliateId: 'aff-d', refCode: 'refd' });
  });

  test('two attributed friends sharing a user_id identity are flagged', async () => {
    // Both friends attributed to aff-d, both share user_id 'same-uid' → dup.
    insertFriend(sqlite, 'friend-d1', { createdAt: jstDaysAgo(10), userId: 'same-uid' });
    insertFriend(sqlite, 'friend-d2', { createdAt: jstDaysAgo(9), userId: 'same-uid' });
    // A third attributed friend with a unique identity → NOT flagged.
    insertFriend(sqlite, 'friend-d3', { createdAt: jstDaysAgo(8), userId: 'other-uid' });
    for (const fid of ['friend-d1', 'friend-d2', 'friend-d3']) {
      insertTouch(sqlite, { id: `t-${fid}`, refCode: 'refd', friendId: fid, createdAt: jstDaysAgo(11) });
    }

    const report = await getAffiliateReportV2(db, 'aff-d', { identityKeySql: IDENTITY_KEY_SQL });
    expect(report!.friendAdds).toBe(3);
    const flagged = report!.duplicateFlags.map((f) => f.friendId).sort();
    expect(flagged).toEqual(['friend-d1', 'friend-d2']);
    expect(report!.duplicateFlags.every((f) => f.identityKey === 'uid:same-uid')).toBe(true);
  });

  test('no duplicates → empty array', async () => {
    insertFriend(sqlite, 'friend-u1', { createdAt: jstDaysAgo(10), userId: 'u1' });
    insertFriend(sqlite, 'friend-u2', { createdAt: jstDaysAgo(9), userId: 'u2' });
    for (const fid of ['friend-u1', 'friend-u2']) {
      insertTouch(sqlite, { id: `t-${fid}`, refCode: 'refd', friendId: fid, createdAt: jstDaysAgo(11) });
    }
    const report = await getAffiliateReportV2(db, 'aff-d', { identityKeySql: IDENTITY_KEY_SQL });
    expect(report!.duplicateFlags).toEqual([]);
  });
});

// ── journeys pagination ──────────────────────────────────────────────────────

describe('getAffiliateJourneys — cursor pagination', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
    insertAffiliate(sqlite, 'aff-p');
    insertLink(sqlite, { id: 'lp', affiliateId: 'aff-p', refCode: 'refp' });
    insertForm(sqlite, { id: 'form-1', name: 'Signup' });
    insertConversionPoint(sqlite, { id: 'cp-p', name: 'Buy', value: 500 });
    // 3 attributed friends, added at -3d, -2d, -1d.
    for (let i = 1; i <= 3; i++) {
      const fid = `friend-p${i}`;
      insertFriend(sqlite, fid, { createdAt: jstDaysAgo(4 - i), displayName: `P${i}` });
      insertTouch(sqlite, { id: `tp${i}`, refCode: 'refp', friendId: fid, createdAt: jstDaysAgo(5) });
    }
    // friend-p1 also has a form submission and a conversion (later events)
    insertSubmission(sqlite, { id: 'sub-1', formId: 'form-1', friendId: 'friend-p1', createdAt: jstDaysAgo(2) });
    insertConversion(sqlite, { id: 'cv-p1', pointId: 'cp-p', friendId: 'friend-p1', affiliateId: 'aff-p', refCode: 'refp', createdAt: jstDaysAgo(1) });
  });

  test('newest-add first with per-friend counts', async () => {
    const page = await getAffiliateJourneys(db, 'aff-p', {});
    expect(page.items.map((i) => i.friendId)).toEqual(['friend-p3', 'friend-p2', 'friend-p1']);
    const p1 = page.items.find((i) => i.friendId === 'friend-p1')!;
    expect(p1.touchCount).toBe(1);
    expect(p1.formCount).toBe(1);
    expect(p1.conversionCount).toBe(1);
    expect(p1.refCode).toBe('refp');
    // last event for p1 is the conversion @ -1d, which is newer than its add @ -3d
    expect(p1.lastEventAt).toBe(jstDaysAgo(1));
    expect(page.nextCursor).toBeNull();
  });

  test('limit + cursor walks the whole set without gaps or repeats', async () => {
    const first = await getAffiliateJourneys(db, 'aff-p', { limit: 2 });
    expect(first.items.map((i) => i.friendId)).toEqual(['friend-p3', 'friend-p2']);
    expect(first.nextCursor).not.toBeNull();

    const second = await getAffiliateJourneys(db, 'aff-p', {
      limit: 2,
      beforeAt: first.nextCursor!.beforeAt,
      beforeId: first.nextCursor!.beforeId,
    });
    expect(second.items.map((i) => i.friendId)).toEqual(['friend-p1']);
    expect(second.nextCursor).toBeNull();
  });
});

// ── all-affiliates aggregate: linkCount + friendAdds (single pass) ────────────
// getAffiliateReport backs the list view (GET /api/affiliates-report). Its
// friend_adds column must match getAffiliateReportV2's friendAdds exactly, since
// both resolve add-time last-touch via FRIEND_ADD_WINNER_SUBQUERY.

describe('getAffiliateReport — linkCount + friendAdds aggregate', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);

    // aff-A: 2 links, wins one attributed friend.
    // aff-B: 1 link, wins zero attributed friends.
    insertAffiliate(sqlite, 'aff-A', { commissionRate: 0.2 });
    insertAffiliate(sqlite, 'aff-B', { commissionRate: 0.5 });
    insertLink(sqlite, { id: 'link-A1', affiliateId: 'aff-A', refCode: 'refA1', clickCount: 4 });
    insertLink(sqlite, { id: 'link-A2', affiliateId: 'aff-A', refCode: 'refA2', clickCount: 2 });
    insertLink(sqlite, { id: 'link-B1', affiliateId: 'aff-B', refCode: 'refB1', clickCount: 3 });

    // attributed friend: touch(refA1) before add → winner is aff-A.
    insertFriend(sqlite, 'friend-1', { createdAt: jstDaysAgo(20) });
    insertTouch(sqlite, { id: 't-a', refCode: 'refA1', friendId: 'friend-1', createdAt: jstDaysAgo(25) });

    // non-attributed friend: its only touch is 91d before add → outside window.
    insertFriend(sqlite, 'friend-2', { createdAt: NOW });
    insertTouch(sqlite, { id: 't-b', refCode: 'refB1', friendId: 'friend-2', createdAt: jstDaysAgo(91) });
  });

  test('per-affiliate link_count and friend_adds are correct', async () => {
    const rows = await getAffiliateReport(db);
    const byId = new Map(rows.map((r) => [r.affiliateId, r]));

    const a = byId.get('aff-A')!;
    const b = byId.get('aff-B')!;
    expect(a.linkCount).toBe(2);
    expect(a.friendAdds).toBe(1);
    expect(b.linkCount).toBe(1);
    // friend-2's only touch is outside the 90d window → not attributed to anyone.
    expect(b.friendAdds).toBe(0);
  });

  test('friend_adds matches per-affiliate getAffiliateReportV2 for the same input', async () => {
    const all = await getAffiliateReport(db);
    const allById = new Map(all.map((r) => [r.affiliateId, r.friendAdds]));

    for (const affId of ['aff-A', 'aff-B']) {
      const v2 = await getAffiliateReportV2(db, affId, { identityKeySql: IDENTITY_KEY_SQL });
      expect(allById.get(affId)).toBe(v2!.friendAdds);
    }
  });
});

// ── per-link stats (self API) ────────────────────────────────────────────────
// getAffiliateLinkStats backs the LIFF self endpoints. Per-link friendAdds must
// sum to the per-affiliate friendAdds (same winner logic); per-link conversions
// split by attributed_ref_code.

describe('getAffiliateLinkStats — per-link friendAdds + conversions', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);

    // One affiliate with two links (refA1, refA2). Each link wins its own
    // friend at add-time, and each has its own conversion.
    insertAffiliate(sqlite, 'aff-A', { commissionRate: 0.3 });
    insertLink(sqlite, { id: 'link-A1', affiliateId: 'aff-A', refCode: 'refA1' });
    insertLink(sqlite, { id: 'link-A2', affiliateId: 'aff-A', refCode: 'refA2' });
    insertConversionPoint(sqlite, { id: 'cp-1', name: 'Purchase', value: 1000 });

    // friend-1 won by refA1 (touch before add), + 1 conversion on refA1.
    insertFriend(sqlite, 'friend-1', { createdAt: jstDaysAgo(20) });
    insertTouch(sqlite, { id: 't-1', refCode: 'refA1', friendId: 'friend-1', createdAt: jstDaysAgo(25) });
    insertConversion(sqlite, { id: 'cv-1', pointId: 'cp-1', friendId: 'friend-1', affiliateId: 'aff-A', refCode: 'refA1', createdAt: jstDaysAgo(5) });

    // friend-2 won by refA2, + 2 conversions on refA2.
    insertFriend(sqlite, 'friend-2', { createdAt: jstDaysAgo(15) });
    insertTouch(sqlite, { id: 't-2', refCode: 'refA2', friendId: 'friend-2', createdAt: jstDaysAgo(18) });
    insertConversion(sqlite, { id: 'cv-2', pointId: 'cp-1', friendId: 'friend-2', affiliateId: 'aff-A', refCode: 'refA2', createdAt: jstDaysAgo(4) });
    insertConversion(sqlite, { id: 'cv-3', pointId: 'cp-1', friendId: 'friend-2', affiliateId: 'aff-A', refCode: 'refA2', createdAt: jstDaysAgo(3) });
  });

  test('friendAdds + conversions split correctly across two links', async () => {
    const stats = await getAffiliateLinkStats(db, 'aff-A');
    // No approval_status set → NULL treated as pending; conversions = approved+pending.
    expect(stats.get('refA1')).toEqual({ friendAdds: 1, conversions: 1, conversionsPending: 1, conversionsApproved: 0 });
    expect(stats.get('refA2')).toEqual({ friendAdds: 1, conversions: 2, conversionsPending: 2, conversionsApproved: 0 });
  });

  test('per-link friendAdds sum equals the per-affiliate friendAdds', async () => {
    const stats = await getAffiliateLinkStats(db, 'aff-A');
    const perLinkSum = [...stats.values()].reduce((s, v) => s + v.friendAdds, 0);
    const v2 = await getAffiliateReportV2(db, 'aff-A', { identityKeySql: IDENTITY_KEY_SQL });
    expect(perLinkSum).toBe(v2!.friendAdds);
    expect(perLinkSum).toBe(2);
  });

  test('per-link conversions sum equals the per-affiliate conversions', async () => {
    const stats = await getAffiliateLinkStats(db, 'aff-A');
    const perLinkSum = [...stats.values()].reduce((s, v) => s + v.conversions, 0);
    const v2 = await getAffiliateReportV2(db, 'aff-A', { identityKeySql: IDENTITY_KEY_SQL });
    expect(perLinkSum).toBe(v2!.conversions);
    expect(perLinkSum).toBe(3);
  });

  test('a link with no activity is absent from the map (caller defaults to 0)', async () => {
    insertLink(sqlite, { id: 'link-A3', affiliateId: 'aff-A', refCode: 'refA3' });
    const stats = await getAffiliateLinkStats(db, 'aff-A');
    expect(stats.has('refA3')).toBe(false);
  });
});

// ── approval-aware reporting: rejected exclusion + confirmedReward + byOffer ──
// ASP Phase 2 C1: reward numbers must reflect the approval decision. Rejected CVs
// leave the headline; confirmedReward = SUM(approved CV × offer reward_amount).

describe('getAffiliateReportV2 — approval breakdown + confirmedReward + byOffer', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);

    insertAffiliate(sqlite, 'aff-A');
    insertOffer(sqlite, { id: 'off-1', name: 'Freelance導入', rewardAmount: 30000 });
    insertOffer(sqlite, { id: 'off-2', name: 'Small案件', rewardAmount: 5000 });
    // offer-scoped links + one generic (offer-less) link.
    insertLink(sqlite, { id: 'l1', affiliateId: 'aff-A', refCode: 'ref1', offerId: 'off-1' });
    insertLink(sqlite, { id: 'l2', affiliateId: 'aff-A', refCode: 'ref2', offerId: 'off-2' });
    insertLink(sqlite, { id: 'lg', affiliateId: 'aff-A', refCode: 'refg', offerId: null });
    insertConversionPoint(sqlite, { id: 'cp-1', name: 'Purchase', value: 1000 });

    // off-1: 2 approved, 1 pending, 1 rejected.
    insertFriend(sqlite, 'f1', { createdAt: jstDaysAgo(10) });
    insertConversion(sqlite, { id: 'c1', pointId: 'cp-1', friendId: 'f1', affiliateId: 'aff-A', refCode: 'ref1', createdAt: jstDaysAgo(5), approvalStatus: 'approved' });
    insertConversion(sqlite, { id: 'c2', pointId: 'cp-1', friendId: 'f1', affiliateId: 'aff-A', refCode: 'ref1', createdAt: jstDaysAgo(5), approvalStatus: 'approved' });
    insertConversion(sqlite, { id: 'c3', pointId: 'cp-1', friendId: 'f1', affiliateId: 'aff-A', refCode: 'ref1', createdAt: jstDaysAgo(5), approvalStatus: 'pending' });
    insertConversion(sqlite, { id: 'c4', pointId: 'cp-1', friendId: 'f1', affiliateId: 'aff-A', refCode: 'ref1', createdAt: jstDaysAgo(5), approvalStatus: 'rejected' });
    // off-2: 1 approved.
    insertConversion(sqlite, { id: 'c5', pointId: 'cp-1', friendId: 'f1', affiliateId: 'aff-A', refCode: 'ref2', createdAt: jstDaysAgo(5), approvalStatus: 'approved' });
    // generic link (no offer): 1 approved → contributes 0 reward, no byOffer row.
    insertConversion(sqlite, { id: 'c6', pointId: 'cp-1', friendId: 'f1', affiliateId: 'aff-A', refCode: 'refg', createdAt: jstDaysAgo(5), approvalStatus: 'approved' });
    // legacy NULL-status attributed CV → treated as pending.
    insertConversion(sqlite, { id: 'c7', pointId: 'cp-1', friendId: 'f1', affiliateId: 'aff-A', refCode: 'ref2', createdAt: jstDaysAgo(5), approvalStatus: null });
  });

  test('headline conversions/revenue exclude rejected; breakdown counts are correct', async () => {
    const r = (await getAffiliateReportV2(db, 'aff-A', { identityKeySql: IDENTITY_KEY_SQL }))!;
    // approved: c1,c2,c5,c6 = 4. pending: c3, c7(NULL) = 2. rejected: c4 = 1.
    expect(r.conversionsApproved).toBe(4);
    expect(r.conversionsPending).toBe(2);
    expect(r.conversionsRejected).toBe(1);
    // headline conversions = approved + pending = 6 (rejected excluded).
    expect(r.conversions).toBe(6);
    // revenue: 6 non-rejected CVs × 1000 = 6000 (rejected c4 excluded).
    expect(r.revenue).toBe(6000);
  });

  test('confirmedReward = SUM(approved CV × offer reward_amount); offer-less approved adds 0', async () => {
    const r = (await getAffiliateReportV2(db, 'aff-A', { identityKeySql: IDENTITY_KEY_SQL }))!;
    // off-1: 2 approved × 30000 = 60000. off-2: 1 approved × 5000 = 5000.
    // generic approved (c6) → 0. Total = 65000.
    expect(r.confirmedReward).toBe(65000);
  });

  test('byOffer breaks down approved/pending + confirmedReward per offer (offer-less excluded)', async () => {
    const r = (await getAffiliateReportV2(db, 'aff-A', { identityKeySql: IDENTITY_KEY_SQL }))!;
    const byId = new Map(r.byOffer.map((o) => [o.offerId, o]));
    // generic link CV must NOT create a byOffer bucket.
    expect(r.byOffer.length).toBe(2);
    expect(byId.get('off-1')).toEqual({
      offerId: 'off-1', offerName: 'Freelance導入', rewardAmount: 30000,
      conversionsApproved: 2, conversionsPending: 1, confirmedReward: 60000,
    });
    expect(byId.get('off-2')).toEqual({
      offerId: 'off-2', offerName: 'Small案件', rewardAmount: 5000,
      conversionsApproved: 1, conversionsPending: 1, confirmedReward: 5000,
    });
  });

  test('getAffiliateLinkStats splits pending/approved and excludes rejected', async () => {
    const stats = await getAffiliateLinkStats(db, 'aff-A');
    // ref1: 2 approved + 1 pending (rejected c4 excluded) → conversions=3.
    expect(stats.get('ref1')).toEqual({ friendAdds: 0, conversions: 3, conversionsPending: 1, conversionsApproved: 2 });
    // ref2: 1 approved + 1 pending(NULL) → conversions=2.
    expect(stats.get('ref2')).toEqual({ friendAdds: 0, conversions: 2, conversionsPending: 1, conversionsApproved: 1 });
    // refg: 1 approved.
    expect(stats.get('refg')).toEqual({ friendAdds: 0, conversions: 1, conversionsPending: 0, conversionsApproved: 1 });
  });
});

// ── list aggregate: ASP affiliate_id + legacy affiliate_code CV ───────────────
// getAffiliateReport (list view) must surface conversions attributed by EITHER
// the affiliate_id snapshot (ASP ref-code path) OR the legacy affiliate_code
// match, without double-counting a row that satisfies both.

describe('getAffiliateReport — CV via affiliate_id OR affiliate_code', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
    insertAffiliate(sqlite, 'aff-A', { commissionRate: 0.2 });
    insertLink(sqlite, { id: 'link-A1', affiliateId: 'aff-A', refCode: 'refA1' });
    insertConversionPoint(sqlite, { id: 'cp-1', name: 'Purchase', value: 1000 });
  });

  test('affiliate_id-only snapshot CV appears in the list aggregate', async () => {
    insertFriend(sqlite, 'friend-1', { createdAt: jstDaysAgo(10) });
    // affiliate_id set, affiliate_code NULL (ASP ref-code path).
    insertConversion(sqlite, { id: 'cv-1', pointId: 'cp-1', friendId: 'friend-1', affiliateId: 'aff-A', refCode: 'refA1', createdAt: jstDaysAgo(2) });

    const rows = await getAffiliateReport(db, 'aff-A');
    expect(rows[0].totalConversions).toBe(1);
    expect(rows[0].totalRevenue).toBe(1000);
  });

  test('legacy affiliate_code CV still appears', async () => {
    const code = sqlite.prepare(`SELECT code FROM affiliates WHERE id = 'aff-A'`).get() as { code: string };
    insertFriend(sqlite, 'friend-2', { createdAt: jstDaysAgo(10) });
    // affiliate_code set (legacy), affiliate_id NULL.
    sqlite
      .prepare(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, affiliate_id, affiliate_code, attributed_ref_code, created_at)
         VALUES ('cv-legacy', 'cp-1', 'friend-2', NULL, ?, NULL, ?)`,
      )
      .run(code.code, jstDaysAgo(2));

    const rows = await getAffiliateReport(db, 'aff-A');
    expect(rows[0].totalConversions).toBe(1);
    expect(rows[0].totalRevenue).toBe(1000);
  });

  test('a row matching BOTH affiliate_id and affiliate_code is counted once', async () => {
    const code = sqlite.prepare(`SELECT code FROM affiliates WHERE id = 'aff-A'`).get() as { code: string };
    insertFriend(sqlite, 'friend-3', { createdAt: jstDaysAgo(10) });
    // BOTH affiliate_id AND affiliate_code point at aff-A → must NOT double-count.
    sqlite
      .prepare(
        `INSERT INTO conversion_events (id, conversion_point_id, friend_id, affiliate_id, affiliate_code, attributed_ref_code, created_at)
         VALUES ('cv-both', 'cp-1', 'friend-3', 'aff-A', ?, 'refA1', ?)`,
      )
      .run(code.code, jstDaysAgo(2));

    const rows = await getAffiliateReport(db, 'aff-A');
    expect(rows[0].totalConversions).toBe(1);
    expect(rows[0].totalRevenue).toBe(1000);
  });
});
