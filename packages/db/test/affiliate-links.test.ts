import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAffiliateLink,
  getAffiliateLinkByRefCode,
  listAffiliateLinks,
  countAffiliateLinks,
  incrementAffiliateLinkClick,
  getAffiliateByFriendId,
  generateRefSlug,
} from '../src/affiliate-links.js';

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

/**
 * Wraps a better-sqlite3 Database to look like a D1Database (async API).
 * Only implements prepare/bind/run/first/all needed by affiliate-links.ts.
 */
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

// ── fixtures ───────────────────────────────────────────────────────────────

function insertAffiliate(sqlite: Database.Database, id: string) {
  sqlite
    .prepare(
      `INSERT INTO affiliates (id, name, code, is_active, created_at)
       VALUES (?, ?, ?, 1, '2024-01-01T00:00:00.000')`,
    )
    .run(id, `Affiliate ${id}`, `CODE-${id}`);
}

function insertFriend(sqlite: Database.Database, id: string, lineUserId: string) {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES (?, ?, 'Test User', '2024-01-01T00:00:00.000', '2024-01-01T00:00:00.000')`,
    )
    .run(id, lineUserId);
}

function insertLineAccount(sqlite: Database.Database, id: string) {
  sqlite
    .prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_secret, channel_access_token, created_at, updated_at)
       VALUES (?, ?, ?, 'secret', 'token', '2024-01-01T00:00:00.000', '2024-01-01T00:00:00.000')`,
    )
    .run(id, `ch-${id}`, `Account ${id}`);
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('affiliate-links CRUD', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  const AFF_ID = 'aff-test-001';

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
    insertAffiliate(sqlite, AFF_ID);
  });

  // ── generateRefSlug ───────────────────────────────────────────────────────

  test('generateRefSlug produces 6-char base62 string', () => {
    const slug = generateRefSlug(6);
    expect(slug).toMatch(/^[0-9A-Za-z]{6}$/);
  });

  test('generateRefSlug produces 8-char base62 string when length=8', () => {
    const slug = generateRefSlug(8);
    expect(slug).toMatch(/^[0-9A-Za-z]{8}$/);
  });

  test('generateRefSlug returns unique values', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateRefSlug(6)));
    // At least 90 unique out of 100 — collision probability at 6 chars is negligible
    expect(set.size).toBeGreaterThan(90);
  });

  // ── createAffiliateLink ──────────────────────────────────────────────────

  test('createAffiliateLink generates unique 6-char base62 slug', async () => {
    const link = await createAffiliateLink(db, { affiliateId: AFF_ID, label: 'X profile' });
    expect(link.ref_code).toMatch(/^[0-9A-Za-z]{6}$/);
    const again = await createAffiliateLink(db, { affiliateId: AFF_ID });
    expect(again.ref_code).not.toBe(link.ref_code);
  });

  test('createAffiliateLink returns correct fields', async () => {
    insertLineAccount(sqlite, 'la-001');
    const link = await createAffiliateLink(db, {
      affiliateId: AFF_ID,
      label: 'Test Label',
      lineAccountId: 'la-001',
    });
    expect(link.affiliate_id).toBe(AFF_ID);
    expect(link.label).toBe('Test Label');
    expect(link.line_account_id).toBe('la-001');
    expect(link.is_active).toBe(1);
    expect(link.click_count).toBe(0);
    expect(link.id).toBeTruthy();
    expect(link.created_at).toBeTruthy();
  });

  test('createAffiliateLink retries on collision using injected generator', async () => {
    // Pre-insert a row with slug 'AAAAAA' to force collision on first attempt
    const conflictSlug = 'AAAAAA';
    sqlite
      .prepare(
        `INSERT INTO affiliate_links (id, affiliate_id, ref_code, is_active, created_at)
         VALUES ('pre-001', ?, ?, 1, '2024-01-01T00:00:00.000')`,
      )
      .run(AFF_ID, conflictSlug);

    // Generator that returns the conflicting slug first, then a valid one
    let callCount = 0;
    const deterministicGen = (len: number) => {
      callCount += 1;
      return callCount === 1 ? conflictSlug : `BBBBBB`.slice(0, len);
    };

    const link = await createAffiliateLink(
      db,
      { affiliateId: AFF_ID },
      deterministicGen,
    );
    expect(callCount).toBe(2);
    expect(link.ref_code).toBe('BBBBBB');
  });

  test('createAffiliateLink uses 8-char slug after 3 failed retries', async () => {
    // Pre-insert 3 slugs to exhaust 6-char retries
    const slugs = ['CCCCCC', 'DDDDDD', 'EEEEEE'];
    for (const [i, s] of slugs.entries()) {
      sqlite
        .prepare(
          `INSERT INTO affiliate_links (id, affiliate_id, ref_code, is_active, created_at)
           VALUES (?, ?, ?, 1, '2024-01-01T00:00:00.000')`,
        )
        .run(`pre-${i}`, AFF_ID, s);
    }

    let callCount = 0;
    const deterministicGen = (len: number) => {
      callCount += 1;
      if (len === 6) {
        // Return the 3 conflicting slugs in order, then a new one (not reached)
        return slugs[callCount - 1] ?? 'FFFFFF';
      }
      // len === 8 — should be reached on 4th attempt
      return 'XXXXXXXX';
    };

    const link = await createAffiliateLink(
      db,
      { affiliateId: AFF_ID },
      deterministicGen,
    );
    // callCount should be 4 (3 × 6-char failures + 1 × 8-char success)
    expect(callCount).toBe(4);
    expect(link.ref_code).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(link.ref_code).toBe('XXXXXXXX');
  });

  // ── getAffiliateLinkByRefCode ────────────────────────────────────────────

  test('getAffiliateLinkByRefCode resolves existing link', async () => {
    const link = await createAffiliateLink(db, { affiliateId: AFF_ID });
    const found = await getAffiliateLinkByRefCode(db, link.ref_code);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(link.id);
  });

  test('getAffiliateLinkByRefCode returns null for unknown ref_code', async () => {
    const result = await getAffiliateLinkByRefCode(db, 'zzzzzz');
    expect(result).toBeNull();
  });

  // ── listAffiliateLinks ───────────────────────────────────────────────────

  test('listAffiliateLinks returns links for the affiliate', async () => {
    await createAffiliateLink(db, { affiliateId: AFF_ID, label: 'Link A' });
    await createAffiliateLink(db, { affiliateId: AFF_ID, label: 'Link B' });

    const AFF_ID_2 = 'aff-test-002';
    insertAffiliate(sqlite, AFF_ID_2);
    await createAffiliateLink(db, { affiliateId: AFF_ID_2, label: 'Other' });

    const links = await listAffiliateLinks(db, AFF_ID);
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.affiliate_id === AFF_ID)).toBe(true);
  });

  test('listAffiliateLinks returns empty array for unknown affiliate', async () => {
    const links = await listAffiliateLinks(db, 'nonexistent');
    expect(links).toEqual([]);
  });

  // ── countAffiliateLinks ──────────────────────────────────────────────────

  test('countAffiliateLinks returns correct count', async () => {
    expect(await countAffiliateLinks(db, AFF_ID)).toBe(0);
    await createAffiliateLink(db, { affiliateId: AFF_ID });
    await createAffiliateLink(db, { affiliateId: AFF_ID });
    expect(await countAffiliateLinks(db, AFF_ID)).toBe(2);
  });

  // ── incrementAffiliateLinkClick ──────────────────────────────────────────

  test('incrementAffiliateLinkClick increments click_count', async () => {
    const link = await createAffiliateLink(db, { affiliateId: AFF_ID });
    expect(link.click_count).toBe(0);

    await incrementAffiliateLinkClick(db, link.ref_code);
    await incrementAffiliateLinkClick(db, link.ref_code);

    const updated = await getAffiliateLinkByRefCode(db, link.ref_code);
    expect(updated!.click_count).toBe(2);
  });

  test('incrementAffiliateLinkClick on unknown ref_code is a no-op', async () => {
    // Should not throw
    await expect(incrementAffiliateLinkClick(db, 'zzzzzz')).resolves.toBeUndefined();
  });

  // ── getAffiliateByFriendId ───────────────────────────────────────────────

  test('getAffiliateByFriendId returns null when no affiliate linked', async () => {
    insertFriend(sqlite, 'friend-001', 'U0000000000000000000000000000099');
    const result = await getAffiliateByFriendId(db, 'friend-001');
    expect(result).toBeNull();
  });

  test('getAffiliateByFriendId returns affiliate when friend_id is set', async () => {
    insertFriend(sqlite, 'friend-002', 'U0000000000000000000000000000098');
    // Set friend_id on the affiliate
    sqlite
      .prepare(`UPDATE affiliates SET friend_id = ? WHERE id = ?`)
      .run('friend-002', AFF_ID);

    const aff = await getAffiliateByFriendId(db, 'friend-002');
    expect(aff).not.toBeNull();
    expect(aff!.id).toBe(AFF_ID);
  });
});
