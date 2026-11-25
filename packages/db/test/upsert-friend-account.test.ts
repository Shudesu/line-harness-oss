import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { upsertFriend } from '../src/friends.js';

const BOOTSTRAP = join(dirname(fileURLToPath(import.meta.url)), '..', 'bootstrap.sql');
const ACC_A = 'acc-a';
const ACC_B = 'acc-b';

type Hook = (sql: string) => void;

/** Minimal D1 adapter over better-sqlite3 that reports meta.changes like D1. */
function asD1(sqlite: Database.Database, beforeRun?: Hook): { db: D1Database; writes: string[] } {
  const writes: string[] = [];
  const db = {
    prepare(sql: string) {
      const bound = (params: unknown[]) => ({
        bind: (...next: unknown[]) => bound(next),
        async run() {
          beforeRun?.(sql);
          writes.push(sql);
          const info = sqlite.prepare(sql).run(...params);
          return { success: true, results: [], meta: { changes: Number(info.changes) } };
        },
        async first<T>() {
          return (sqlite.prepare(sql).get(...params) as T) ?? null;
        },
        async all<T>() {
          return { success: true, results: sqlite.prepare(sql).all(...params) as T[], meta: {} };
        },
      });
      return bound([]);
    },
  } as unknown as D1Database;
  return { db, writes };
}

function row(sqlite: Database.Database, lineUserId: string) {
  return sqlite
    .prepare('SELECT id, line_account_id, display_name, ref_code FROM friends WHERE line_user_id = ?')
    .get(lineUserId) as { id: string; line_account_id: string | null; display_name: string | null; ref_code: string | null };
}

describe('upsertFriend line_account_id attribution', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(BOOTSTRAP, 'utf8'));
    for (const id of [ACC_A, ACC_B]) {
      sqlite
        .prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)')
        .run(id, `ch-${id}`, id, 'token', 'secret');
    }
  });

  test('a new friend is inserted with its account in the same single write', async () => {
    const { db, writes } = asD1(sqlite);
    const friend = await upsertFriend(db, { lineUserId: 'U1', displayName: 'A', lineAccountId: ACC_A });
    expect(friend.line_account_id).toBe(ACC_A);
    expect(row(sqlite, 'U1').line_account_id).toBe(ACC_A);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/INSERT INTO friends/);
  });

  test('without lineAccountId the row stays unattributed (LIFF login / cross-link records)', async () => {
    const { db } = asD1(sqlite);
    await upsertFriend(db, { lineUserId: 'U1', displayName: 'A' });
    expect(row(sqlite, 'U1').line_account_id).toBeNull();

    sqlite.prepare('UPDATE friends SET line_account_id = ? WHERE line_user_id = ?').run(ACC_B, 'U1');
    await upsertFriend(db, { lineUserId: 'U1', displayName: 'A2' });
    expect(row(sqlite, 'U1').line_account_id).toBe(ACC_B);
  });

  test("'fill' (default) sets a missing account but never rebinds an existing one", async () => {
    const { db } = asD1(sqlite);
    await upsertFriend(db, { lineUserId: 'U1' });
    await upsertFriend(db, { lineUserId: 'U1', lineAccountId: ACC_A });
    expect(row(sqlite, 'U1').line_account_id).toBe(ACC_A);

    await upsertFriend(db, { lineUserId: 'U1', lineAccountId: ACC_B, accountMode: 'fill' });
    expect(row(sqlite, 'U1').line_account_id).toBe(ACC_A);
  });

  test("'rebind' overwrites the account, but a null account never erases one", async () => {
    const { db } = asD1(sqlite);
    await upsertFriend(db, { lineUserId: 'U1', lineAccountId: ACC_A });
    await upsertFriend(db, { lineUserId: 'U1', lineAccountId: ACC_B, accountMode: 'rebind' });
    expect(row(sqlite, 'U1').line_account_id).toBe(ACC_B);

    await upsertFriend(db, { lineUserId: 'U1', lineAccountId: null, accountMode: 'rebind' });
    expect(row(sqlite, 'U1').line_account_id).toBe(ACC_B);
  });

  test('a profile-less update keeps the stored profile', async () => {
    const { db } = asD1(sqlite);
    await upsertFriend(db, { lineUserId: 'U1', displayName: 'Keep me' });
    await upsertFriend(db, { lineUserId: 'U1', lineAccountId: ACC_A, accountMode: 'rebind' });
    expect(row(sqlite, 'U1').display_name).toBe('Keep me');
  });

  test('losing the insert race to a concurrent writer still attributes the account (no UNIQUE error)', async () => {
    // /auth/callback inserts the same LINE user between our existence check and
    // our INSERT — exactly what happens when the follow webhook and the OAuth
    // callback land together.
    let raced = false;
    const { db } = asD1(sqlite, (sql) => {
      if (!raced && /INSERT INTO friends/.test(sql)) {
        raced = true;
        sqlite
          .prepare("INSERT INTO friends(id,line_user_id,display_name,ref_code) VALUES('callback-row','U1','From callback','qr-route')")
          .run();
      }
    });

    const friend = await upsertFriend(db, { lineUserId: 'U1', lineAccountId: ACC_A, accountMode: 'rebind' });

    expect(friend.id).toBe('callback-row');
    const stored = row(sqlite, 'U1');
    expect(stored.line_account_id).toBe(ACC_A);
    expect(stored.ref_code).toBe('qr-route');
    expect(stored.display_name).toBe('From callback');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM friends').get()).toEqual({ n: 1 });
  });
});
