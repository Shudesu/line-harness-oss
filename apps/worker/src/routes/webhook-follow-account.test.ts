import { describe, expect, test, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import type Database from 'better-sqlite3';
import type { LineClient, WebhookEvent } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { handleWebhookEventForTest as handleEvent } from './webhook.js';

// Regression: during a follow burst the follow handler can be cut off (the
// isolate stops mid-waitUntil) after it has written the friend row but before a
// separate `UPDATE ... line_account_id`, leaving friends that belong to no
// account. The account must be attributed by the handler's very first write.

const ACCOUNT = 'acc-1b';

class Interrupted extends Error {}

/** Lets the first write to `friends` through, then fails every later D1 call. */
function interruptAfterFirstFriendWrite(db: D1Database): D1Database {
  let tripped = false;
  const guard = () => { if (tripped) throw new Interrupted('isolate interrupted'); };
  return {
    ...db,
    prepare(sql: string) {
      const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => ({
        ...stmt,
        bind: (...values: unknown[]) => wrap(stmt.bind(...values)),
        async run<T>() {
          guard();
          const result = await stmt.run<T>();
          if (/^\s*(INSERT|UPDATE)\b[\s\S]*\bfriends\b/i.test(sql)) tripped = true;
          return result;
        },
        async first<T>(column?: string) { guard(); return column === undefined ? stmt.first<T>() : stmt.first<T>(column); },
        async all<T>() { guard(); return stmt.all<T>(); },
      } as D1PreparedStatement);
      return wrap(db.prepare(sql));
    },
    async batch() { guard(); throw new Error('unexpected batch'); },
  } as unknown as D1Database;
}

const lineClient = {
  getProfile: async () => ({ userId: 'U-new', displayName: 'Burst Follower' }),
  replyMessage: async () => ({}),
  pushMessage: async () => ({}),
} as unknown as LineClient;

function followEvent(userId: string): WebhookEvent {
  return {
    type: 'follow',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'user', userId },
    replyToken: 'reply-token',
    webhookEventId: `evt-${userId}`,
    deliveryContext: { isRedelivery: false },
  } as unknown as WebhookEvent;
}

function stored(sqlite: Database.Database, lineUserId: string) {
  return sqlite
    .prepare('SELECT line_account_id, ref_code, user_id, is_following FROM friends WHERE line_user_id = ?')
    .get(lineUserId) as { line_account_id: string | null; ref_code: string | null; user_id: string | null; is_following: number } | undefined;
}

describe('follow webhook attributes line_account_id in its first write', () => {
  let db: D1Database;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ db, sqlite } = sqliteD1());
    sqlite.exec(readFileSync(new NodeURL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
    sqlite
      .prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)')
      .run(ACCOUNT, 'ch-1b', 'Account 1b', 'token', 'secret');
  });

  test('new follower interrupted right after the first write still has its account', async () => {
    await expect(
      handleEvent(interruptAfterFirstFriendWrite(db), lineClient, followEvent('U-new'), 'token', ACCOUNT),
    ).rejects.toBeInstanceOf(Interrupted);

    expect(stored(sqlite, 'U-new')?.line_account_id).toBe(ACCOUNT);
  });

  test('row created first by /auth/callback (no account) is attributed even if the follow is interrupted', async () => {
    // What /auth/callback leaves behind for an entry-route QR follow.
    sqlite
      .prepare("INSERT INTO friends(id,line_user_id,display_name,ref_code,user_id) VALUES('f-callback','U-qr','QR','qr-route','uuid-1')")
      .run();

    await expect(
      handleEvent(interruptAfterFirstFriendWrite(db), lineClient, followEvent('U-qr'), 'token', ACCOUNT),
    ).rejects.toBeInstanceOf(Interrupted);

    expect(stored(sqlite, 'U-qr')).toMatchObject({
      line_account_id: ACCOUNT,
      ref_code: 'qr-route',
      user_id: 'uuid-1',
      is_following: 1,
    });
  });

  test('uninterrupted follow stores account and profile', async () => {
    await handleEvent(db, lineClient, followEvent('U-ok'), 'token', ACCOUNT);

    const row = sqlite
      .prepare('SELECT line_account_id, display_name FROM friends WHERE line_user_id = ?')
      .get('U-ok');
    expect(row).toEqual({ line_account_id: ACCOUNT, display_name: 'Burst Follower' });
  });
});
