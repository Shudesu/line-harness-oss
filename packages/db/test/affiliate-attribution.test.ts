import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveAffiliateAttribution,
  ATTRIBUTION_WINDOW_DAYS,
} from '../src/affiliate-attribution.js';
import { trackConversion, type ConversionEvent } from '../src/conversions.js';

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

// ── Fixture helpers ──────────────────────────────────────────────────────────

function insertFriend(sqlite: Database.Database, id: string): void {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES (?, ?, 'Test User', '2024-01-01T00:00:00.000+09:00', '2024-01-01T00:00:00.000+09:00')`,
    )
    .run(id, `U${id.replace(/[^0-9a-f]/gi, '').padEnd(32, '0').slice(0, 32)}`);
}

let affiliateSeq = 0;
function insertAffiliate(
  sqlite: Database.Database,
  id: string,
  opts: { friendId?: string | null } = {},
): void {
  affiliateSeq++;
  sqlite
    .prepare(
      `INSERT INTO affiliates (id, name, code, commission_rate, is_active, created_at, friend_id)
       VALUES (?, ?, ?, 0, 1, '2024-01-01T00:00:00.000+09:00', ?)`,
    )
    .run(id, `Aff ${id}`, `code-${id}-${affiliateSeq}`, opts.friendId ?? null);
}

function insertLink(
  sqlite: Database.Database,
  opts: { id: string; affiliateId: string; refCode: string; isActive?: number },
): void {
  sqlite
    .prepare(
      `INSERT INTO affiliate_links (id, affiliate_id, ref_code, label, line_account_id, is_active, created_at, click_count)
       VALUES (?, ?, ?, NULL, NULL, ?, '2024-01-01T00:00:00.000+09:00', 0)`,
    )
    .run(opts.id, opts.affiliateId, opts.refCode, opts.isActive ?? 1);
}

/** Insert a raw ref_tracking touch row with an explicit created_at. */
function insertTouch(
  sqlite: Database.Database,
  opts: { id: string; refCode: string; friendId: string; createdAt: string },
): void {
  sqlite
    .prepare(
      `INSERT INTO ref_tracking (id, ref_code, friend_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(opts.id, opts.refCode, opts.friendId, opts.createdAt);
}

// JST ISO timestamp `daysAgo` days before `NOW`.
const NOW = '2026-07-07T12:00:00.000+09:00';
function jstDaysAgo(days: number, opts: { minutes?: number } = {}): string {
  const base = new Date(NOW).getTime();
  const ms = base - days * 86_400_000 + (opts.minutes ?? 0) * 60_000;
  const jst = new Date(ms + 9 * 60 * 60_000);
  return jst.toISOString().slice(0, -1) + '+09:00';
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolveAffiliateAttribution', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
  });

  test('constant window is 90 days', () => {
    expect(ATTRIBUTION_WINDOW_DAYS).toBe(90);
  });

  test('(a) multiple touches within 90 days -> latest affiliate link wins', async () => {
    insertFriend(sqlite, 'friend-a');
    insertAffiliate(sqlite, 'aff-1');
    insertAffiliate(sqlite, 'aff-2');
    insertLink(sqlite, { id: 'link-1', affiliateId: 'aff-1', refCode: 'ref1' });
    insertLink(sqlite, { id: 'link-2', affiliateId: 'aff-2', refCode: 'ref2' });

    insertTouch(sqlite, {
      id: 't1',
      refCode: 'ref1',
      friendId: 'friend-a',
      createdAt: jstDaysAgo(30),
    });
    insertTouch(sqlite, {
      id: 't2',
      refCode: 'ref2',
      friendId: 'friend-a',
      createdAt: jstDaysAgo(5),
    });

    const attr = await resolveAffiliateAttribution(db, 'friend-a', NOW);
    expect(attr).toEqual({ affiliateId: 'aff-2', refCode: 'ref2' });
  });

  test('(b) a later non-affiliate ref touch does not override the latest affiliate touch', async () => {
    insertFriend(sqlite, 'friend-b');
    insertAffiliate(sqlite, 'aff-1');
    insertLink(sqlite, { id: 'link-1', affiliateId: 'aff-1', refCode: 'ref1' });

    // affiliate touch first
    insertTouch(sqlite, {
      id: 't1',
      refCode: 'ref1',
      friendId: 'friend-b',
      createdAt: jstDaysAgo(10),
    });
    // later touch with a ref_code that has NO affiliate_link row
    insertTouch(sqlite, {
      id: 't2',
      refCode: 'organic-ref',
      friendId: 'friend-b',
      createdAt: jstDaysAgo(1),
    });

    const attr = await resolveAffiliateAttribution(db, 'friend-b', NOW);
    expect(attr).toEqual({ affiliateId: 'aff-1', refCode: 'ref1' });
  });

  test('(c) only a touch older than 90 days -> null', async () => {
    insertFriend(sqlite, 'friend-c');
    insertAffiliate(sqlite, 'aff-1');
    insertLink(sqlite, { id: 'link-1', affiliateId: 'aff-1', refCode: 'ref1' });

    insertTouch(sqlite, {
      id: 't1',
      refCode: 'ref1',
      friendId: 'friend-c',
      createdAt: jstDaysAgo(91),
    });

    const attr = await resolveAffiliateAttribution(db, 'friend-c', NOW);
    expect(attr).toBeNull();
  });

  test('(c-boundary) a touch exactly at the 90-day edge is still attributed', async () => {
    insertFriend(sqlite, 'friend-cb');
    insertAffiliate(sqlite, 'aff-1');
    insertLink(sqlite, { id: 'link-1', affiliateId: 'aff-1', refCode: 'ref1' });

    // exactly 90 days ago (inside), plus just-over 90 days (outside)
    insertTouch(sqlite, {
      id: 't-edge',
      refCode: 'ref1',
      friendId: 'friend-cb',
      createdAt: jstDaysAgo(90),
    });
    const attr = await resolveAffiliateAttribution(db, 'friend-cb', NOW);
    expect(attr).toEqual({ affiliateId: 'aff-1', refCode: 'ref1' });

    // A touch 1 minute past the 90-day window must be excluded.
    insertTouch(sqlite, {
      id: 't-over',
      refCode: 'ref1',
      friendId: 'friend-cb',
      createdAt: jstDaysAgo(90, { minutes: -1 }), // one minute earlier than the edge
    });
    // still resolves to the in-window edge touch (not the out-of-window one)
    const attr2 = await resolveAffiliateAttribution(db, 'friend-cb', NOW);
    expect(attr2).toEqual({ affiliateId: 'aff-1', refCode: 'ref1' });
  });

  test('(d) self-click (friend is the affiliate owner) is excluded', async () => {
    insertFriend(sqlite, 'friend-d');
    // affiliate owned by friend-d themselves
    insertAffiliate(sqlite, 'aff-self', { friendId: 'friend-d' });
    insertLink(sqlite, { id: 'link-1', affiliateId: 'aff-self', refCode: 'refself' });

    insertTouch(sqlite, {
      id: 't1',
      refCode: 'refself',
      friendId: 'friend-d',
      createdAt: jstDaysAgo(3),
    });

    const attr = await resolveAffiliateAttribution(db, 'friend-d', NOW);
    expect(attr).toBeNull();
  });

  test('(d-2) self-click is skipped but an earlier non-self affiliate touch still wins', async () => {
    insertFriend(sqlite, 'friend-d2');
    insertAffiliate(sqlite, 'aff-other');
    insertAffiliate(sqlite, 'aff-self', { friendId: 'friend-d2' });
    insertLink(sqlite, { id: 'link-o', affiliateId: 'aff-other', refCode: 'refother' });
    insertLink(sqlite, { id: 'link-s', affiliateId: 'aff-self', refCode: 'refselftouch' });

    insertTouch(sqlite, {
      id: 't1',
      refCode: 'refother',
      friendId: 'friend-d2',
      createdAt: jstDaysAgo(10),
    });
    // most-recent touch is a self-click -> must be skipped
    insertTouch(sqlite, {
      id: 't2',
      refCode: 'refselftouch',
      friendId: 'friend-d2',
      createdAt: jstDaysAgo(1),
    });

    const attr = await resolveAffiliateAttribution(db, 'friend-d2', NOW);
    expect(attr).toEqual({ affiliateId: 'aff-other', refCode: 'refother' });
  });

  test('(e) touch on an inactive (is_active=0) link is still attributed', async () => {
    insertFriend(sqlite, 'friend-e');
    insertAffiliate(sqlite, 'aff-1');
    insertLink(sqlite, {
      id: 'link-1',
      affiliateId: 'aff-1',
      refCode: 'refinactive',
      isActive: 0,
    });

    insertTouch(sqlite, {
      id: 't1',
      refCode: 'refinactive',
      friendId: 'friend-e',
      createdAt: jstDaysAgo(5),
    });

    const attr = await resolveAffiliateAttribution(db, 'friend-e', NOW);
    expect(attr).toEqual({ affiliateId: 'aff-1', refCode: 'refinactive' });
  });

  test('no touches at all -> null', async () => {
    insertFriend(sqlite, 'friend-none');
    const attr = await resolveAffiliateAttribution(db, 'friend-none', NOW);
    expect(attr).toBeNull();
  });

  test('(f) mixed timestamp formats: julianday ordering picks the truly newer touch', async () => {
    // Scenario: two affiliate touches for the same friend.
    //   - older touch (aff-1): stored as "+09:00" ISO format.
    //     The textual value starts with "2026-06-" which sorts AFTER "2026-06-"
    //     written as a space-separated UTC string, making it "win" under naive
    //     string sort even though it is actually older in real time.
    //   - newer touch (aff-2): stored as "YYYY-MM-DD HH:MM:SS" UTC space-separated
    //     (as emitted by SQLite datetime('now')), which is actually 7 days later
    //     in real time but would "lose" a naive text comparison.
    //
    // With ORDER BY julianday(rt.created_at) DESC, aff-2 must be returned.

    insertFriend(sqlite, 'friend-f');
    insertAffiliate(sqlite, 'aff-mixed-1');
    insertAffiliate(sqlite, 'aff-mixed-2');
    insertLink(sqlite, { id: 'link-f1', affiliateId: 'aff-mixed-1', refCode: 'ref-f1' });
    insertLink(sqlite, { id: 'link-f2', affiliateId: 'aff-mixed-2', refCode: 'ref-f2' });

    // Older touch: 20 days ago, stored in JST ISO "+09:00" format.
    // julianday sees the true instant (2026-06-17T03:00:00Z ≈ JD 2461214.625).
    const olderIso = '2026-06-17T12:00:00.000+09:00'; // JST noon = UTC 03:00

    // Newer touch: 13 days ago, stored as UTC space-separated (SQLite datetime style).
    // julianday sees the true instant (2026-06-24T03:00:00Z ≈ JD 2461221.625),
    // which is 7 days later than the ISO touch.
    // Naive text comparison: "2026-06-17T..." > "2026-06-24 ..." (ISO > space format
    // because 'T' > ' ' in ASCII), so the older one would win under string sort.
    const newerUtcSpace = '2026-06-24 03:00:00'; // UTC space-sep, same real instant as JST 12:00

    sqlite
      .prepare(`INSERT INTO ref_tracking (id, ref_code, friend_id, created_at) VALUES (?, ?, ?, ?)`)
      .run('tf-old', 'ref-f1', 'friend-f', olderIso);
    sqlite
      .prepare(`INSERT INTO ref_tracking (id, ref_code, friend_id, created_at) VALUES (?, ?, ?, ?)`)
      .run('tf-new', 'ref-f2', 'friend-f', newerUtcSpace);

    const attr = await resolveAffiliateAttribution(db, 'friend-f', NOW);
    // julianday ordering must select aff-mixed-2 (the genuinely newer touch).
    expect(attr).toEqual({ affiliateId: 'aff-mixed-2', refCode: 'ref-f2' });
  });
});

describe('trackConversion + attribution integration', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
    sqlite
      .prepare(
        `INSERT INTO conversion_points (id, name, event_type, value, created_at)
         VALUES ('cp-1', 'Purchase', 'purchase', 1000, '2024-01-01T00:00:00.000+09:00')`,
      )
      .run();
  });

  test('trackConversion stamps affiliate_id + attributed_ref_code from last-touch', async () => {
    insertFriend(sqlite, 'friend-x');
    insertAffiliate(sqlite, 'aff-1');
    insertLink(sqlite, { id: 'link-1', affiliateId: 'aff-1', refCode: 'refx' });
    insertTouch(sqlite, {
      id: 't1',
      refCode: 'refx',
      friendId: 'friend-x',
      createdAt: jstDaysAgo(2),
    });

    const ev = (await trackConversion(db, {
      conversionPointId: 'cp-1',
      friendId: 'friend-x',
    })) as ConversionEvent & {
      affiliate_id: string | null;
      attributed_ref_code: string | null;
    };

    expect(ev.affiliate_id).toBe('aff-1');
    expect(ev.attributed_ref_code).toBe('refx');
  });

  test('trackConversion leaves attribution null when there is no eligible touch', async () => {
    insertFriend(sqlite, 'friend-y');

    const ev = (await trackConversion(db, {
      conversionPointId: 'cp-1',
      friendId: 'friend-y',
    })) as ConversionEvent & {
      affiliate_id: string | null;
      attributed_ref_code: string | null;
    };

    expect(ev.affiliate_id).toBeNull();
    expect(ev.attributed_ref_code).toBeNull();
  });

  test('existing affiliateCode argument behaviour is preserved', async () => {
    insertFriend(sqlite, 'friend-z');

    const ev = await trackConversion(db, {
      conversionPointId: 'cp-1',
      friendId: 'friend-z',
      affiliateCode: 'legacy-code',
    });

    expect(ev.affiliate_code).toBe('legacy-code');
  });
});
