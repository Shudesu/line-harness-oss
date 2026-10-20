import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChat } from '../src/chats.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  return db;
}

function makeD1(db: Database.Database): D1Database {
  return {
    prepare: (sql: string) => {
      let values: unknown[] = [];
      const statement = {
        bind: (...bound: unknown[]) => {
          values = bound;
          return statement;
        },
        run: async () => db.prepare(sql).run(...values),
        first: async <T>() => (db.prepare(sql).get(...values) as T | undefined) ?? null,
      };
      return statement;
    },
  } as unknown as D1Database;
}

describe('createChat line-account ownership', () => {
  let raw: Database.Database;
  let d1: D1Database;

  beforeEach(() => {
    raw = loadDb();
    d1 = makeD1(raw);
    const account = raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES (?, ?, ?, 'token', 'secret')`,
    );
    account.run('account-a', 'channel-a', 'Store A');
    account.run('account-b', 'channel-b', 'Store B');

    const friend = raw.prepare(
      `INSERT INTO friends (id, line_user_id, display_name, line_account_id)
       VALUES (?, ?, ?, ?)`,
    );
    friend.run('friend-a', 'user-a', 'A friend', 'account-a');
    friend.run('friend-b', 'user-b', 'B friend', 'account-b');
    friend.run('friend-none', 'user-none', 'Unassigned friend', null);
  });

  it('stores A, B, and NULL ownership and keeps account scopes separate', async () => {
    await createChat(d1, { friendId: 'friend-a' });
    await createChat(d1, { friendId: 'friend-b' });
    await createChat(d1, { friendId: 'friend-none' });

    const rows = raw.prepare(
      `SELECT friend_id, line_account_id FROM chats ORDER BY friend_id`,
    ).all() as Array<{ friend_id: string; line_account_id: string | null }>;
    expect(rows).toEqual([
      { friend_id: 'friend-a', line_account_id: 'account-a' },
      { friend_id: 'friend-b', line_account_id: 'account-b' },
      { friend_id: 'friend-none', line_account_id: null },
    ]);

    const scoped = raw.prepare(
      `SELECT friend_id FROM chats WHERE line_account_id = ? ORDER BY friend_id`,
    );
    expect(scoped.all('account-a')).toEqual([{ friend_id: 'friend-a' }]);
    expect(scoped.all('account-b')).toEqual([{ friend_id: 'friend-b' }]);
  });
});
