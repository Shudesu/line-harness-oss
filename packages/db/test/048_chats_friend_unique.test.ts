import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createChat, upsertChatOnMessage, getChatByFriendId } from '../src/chats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');
const MIGRATION_048 = readFileSync(
  join(MIGRATIONS_DIR, '048_chats_friend_unique.sql'),
  'utf8',
);

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

function insertFriend(sqlite: Database.Database, id: string): void {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES (?, ?, 'Test User', '2024-01-01T00:00:00.000+09:00', '2024-01-01T00:00:00.000+09:00')`,
    )
    .run(id, `U${id.replace(/[^0-9a-f]/gi, '').padEnd(32, '0').slice(0, 32)}`);
}

function insertChatRow(
  sqlite: Database.Database,
  row: {
    id: string;
    friendId: string;
    status: string;
    createdAt: string;
    updatedAt?: string;
    operatorId?: string;
    notes?: string;
    lastMessageAt?: string;
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO chats (id, friend_id, status, operator_id, notes, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.friendId,
      row.status,
      row.operatorId ?? null,
      row.notes ?? null,
      row.lastMessageAt ?? null,
      row.createdAt,
      row.updatedAt ?? row.createdAt,
    );
}

// UNIQUE インデックス導入前の重複行がある DB を再現する
function dropUniqueIndex(db: Database.Database): void {
  db.exec('DROP INDEX IF EXISTS idx_chats_friend_unique');
}

describe('048_chats_friend_unique.sql migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
    dropUniqueIndex(db);
  });

  it('keeps only the newest chat row per friend when duplicates exist', () => {
    insertFriend(db, 'f-dup');
    insertChatRow(db, { id: 'c-old', friendId: 'f-dup', status: 'resolved', createdAt: '2024-01-01T00:00:00.000+09:00' });
    insertChatRow(db, { id: 'c-mid', friendId: 'f-dup', status: 'in_progress', createdAt: '2024-06-01T00:00:00.000+09:00' });
    insertChatRow(db, { id: 'c-new', friendId: 'f-dup', status: 'unread', createdAt: '2024-12-01T00:00:00.000+09:00' });

    execSafe(db, MIGRATION_048);

    const rows = db.prepare(`SELECT id FROM chats WHERE friend_id = 'f-dup'`).all() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('c-new');
  });

  it('converges to one row even when duplicate rows share the same created_at', () => {
    insertFriend(db, 'f-tie');
    insertChatRow(db, { id: 'c-a', friendId: 'f-tie', status: 'unread', createdAt: '2024-06-01T00:00:00.000+09:00' });
    insertChatRow(db, { id: 'c-b', friendId: 'f-tie', status: 'unread', createdAt: '2024-06-01T00:00:00.000+09:00' });

    execSafe(db, MIGRATION_048);

    const rows = db.prepare(`SELECT id FROM chats WHERE friend_id = 'f-tie'`).all();
    expect(rows).toHaveLength(1);
  });

  it('carries operator state from the most recently updated duplicate onto the kept row', () => {
    insertFriend(db, 'f-merge');
    // オペレーターが最古行を「解決済」にした (updated_at が最新) — バグ報告の実シナリオ。
    insertChatRow(db, {
      id: 'c-old',
      friendId: 'f-merge',
      status: 'resolved',
      operatorId: null,
      notes: 'operator memo',
      lastMessageAt: '2024-11-01T00:00:00.000+09:00',
      createdAt: '2024-01-01T00:00:00.000+09:00',
      updatedAt: '2024-12-15T00:00:00.000+09:00',
    });
    insertChatRow(db, {
      id: 'c-new',
      friendId: 'f-merge',
      status: 'unread',
      lastMessageAt: '2024-12-01T00:00:00.000+09:00',
      createdAt: '2024-12-01T00:00:00.000+09:00',
      updatedAt: '2024-12-01T00:00:00.000+09:00',
    });

    execSafe(db, MIGRATION_048);

    const rows = db
      .prepare(`SELECT id, status, notes, last_message_at FROM chats WHERE friend_id = 'f-merge'`)
      .all() as Array<{ id: string; status: string; notes: string | null; last_message_at: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('c-new');
    expect(rows[0].status).toBe('resolved');
    expect(rows[0].notes).toBe('operator memo');
    expect(rows[0].last_message_at).toBe('2024-12-01T00:00:00.000+09:00');
  });

  it('prefers the newer row state when it was updated after the operator action', () => {
    insertFriend(db, 'f-late-msg');
    // resolved 後に新着が来て webhook が最新行を unread に更新したケース — unread が勝つべき。
    insertChatRow(db, {
      id: 'c-old',
      friendId: 'f-late-msg',
      status: 'resolved',
      createdAt: '2024-01-01T00:00:00.000+09:00',
      updatedAt: '2024-12-01T00:00:00.000+09:00',
    });
    insertChatRow(db, {
      id: 'c-new',
      friendId: 'f-late-msg',
      status: 'unread',
      createdAt: '2024-06-01T00:00:00.000+09:00',
      updatedAt: '2024-12-20T00:00:00.000+09:00',
    });

    execSafe(db, MIGRATION_048);

    const rows = db
      .prepare(`SELECT id, status FROM chats WHERE friend_id = 'f-late-msg'`)
      .all() as Array<{ id: string; status: string }>;
    expect(rows).toEqual([{ id: 'c-new', status: 'unread' }]);
  });

  it('keeps operator assignment and notes even when a webhook later touched the newest row', () => {
    insertFriend(db, 'f-op');
    db.prepare(
      `INSERT INTO operators (id, name, email) VALUES ('op-1', 'Op', 'op@example.com')`,
    ).run();
    // 古い行にアサイン + メモ、その後 webhook が最新行の updated_at を進めたケース。
    // status は最後の更新 (unread) が勝つが、operator/notes は消えてはいけない。
    insertChatRow(db, {
      id: 'c-old',
      friendId: 'f-op',
      status: 'in_progress',
      operatorId: 'op-1',
      notes: 'assigned memo',
      createdAt: '2024-01-01T00:00:00.000+09:00',
      updatedAt: '2024-11-01T00:00:00.000+09:00',
    });
    insertChatRow(db, {
      id: 'c-new',
      friendId: 'f-op',
      status: 'unread',
      createdAt: '2024-06-01T00:00:00.000+09:00',
      updatedAt: '2024-12-20T00:00:00.000+09:00',
    });

    execSafe(db, MIGRATION_048);

    const rows = db
      .prepare(`SELECT id, status, operator_id, notes FROM chats WHERE friend_id = 'f-op'`)
      .all() as Array<{ id: string; status: string; operator_id: string | null; notes: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('c-new');
    expect(rows[0].status).toBe('unread');
    expect(rows[0].operator_id).toBe('op-1');
    expect(rows[0].notes).toBe('assigned memo');
  });

  it('does not touch friends that already have a single chat row', () => {
    insertFriend(db, 'f-single');
    insertChatRow(db, { id: 'c-solo', friendId: 'f-single', status: 'in_progress', createdAt: '2024-03-01T00:00:00.000+09:00' });

    execSafe(db, MIGRATION_048);

    const rows = db.prepare(`SELECT id, status FROM chats WHERE friend_id = 'f-single'`).all() as Array<{ id: string; status: string }>;
    expect(rows).toEqual([{ id: 'c-solo', status: 'in_progress' }]);
  });

  it('re-applying schema.sql to a DB with legacy duplicates repairs them instead of failing (db:migrate path)', () => {
    insertFriend(db, 'f-reapply');
    insertChatRow(db, { id: 'c-old', friendId: 'f-reapply', status: 'resolved', createdAt: '2024-01-01T00:00:00.000+09:00', updatedAt: '2024-12-15T00:00:00.000+09:00' });
    insertChatRow(db, { id: 'c-new', friendId: 'f-reapply', status: 'unread', createdAt: '2024-12-01T00:00:00.000+09:00' });

    // pnpm db:migrate は schema.sql を既存 DB へそのまま流す — UNIQUE 作成で落ちないこと
    execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));

    const rows = db.prepare(`SELECT id, status FROM chats WHERE friend_id = 'f-reapply'`).all() as Array<{ id: string; status: string }>;
    expect(rows).toEqual([{ id: 'c-new', status: 'resolved' }]);
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_chats_friend_unique'`).get();
    expect(idx).toBeTruthy();
  });

  it('rejects duplicate friend_id inserts after the migration', () => {
    insertFriend(db, 'f-uniq');
    execSafe(db, MIGRATION_048);

    insertChatRow(db, { id: 'c-1', friendId: 'f-uniq', status: 'unread', createdAt: '2024-01-01T00:00:00.000+09:00' });
    expect(() =>
      insertChatRow(db, { id: 'c-2', friendId: 'f-uniq', status: 'unread', createdAt: '2024-02-01T00:00:00.000+09:00' }),
    ).toThrow(/UNIQUE/i);
  });
});

describe('createChat / upsertChatOnMessage single-row guarantee', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
  });

  it('createChat returns the existing row instead of inserting a duplicate', async () => {
    insertFriend(sqlite, 'f-1');
    const first = await createChat(db, { friendId: 'f-1' });
    const second = await createChat(db, { friendId: 'f-1' });

    expect(second.id).toBe(first.id);
    const count = sqlite.prepare(`SELECT COUNT(*) AS c FROM chats WHERE friend_id = 'f-1'`).get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('upsertChatOnMessage never creates a second row for the same friend', async () => {
    insertFriend(sqlite, 'f-2');
    const a = await upsertChatOnMessage(db, 'f-2');
    const b = await upsertChatOnMessage(db, 'f-2');

    expect(b.id).toBe(a.id);
    const count = sqlite.prepare(`SELECT COUNT(*) AS c FROM chats WHERE friend_id = 'f-2'`).get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('upsertChatOnMessage flips resolved back to unread and refreshes last_message_at (regression)', async () => {
    insertFriend(sqlite, 'f-3');
    const chat = await upsertChatOnMessage(db, 'f-3');
    sqlite
      .prepare(`UPDATE chats SET status = 'resolved', last_message_at = '2024-01-01T00:00:00.000+09:00' WHERE id = ?`)
      .run(chat.id);

    const after = await upsertChatOnMessage(db, 'f-3');
    expect(after.id).toBe(chat.id);
    expect(after.status).toBe('unread');
    // 受信メッセージの時刻で更新される (resolveOrCreateChat とのレースで
    // resolved 行を掴んだケースでも取りこぼさないための保証)
    expect(after.last_message_at).not.toBe('2024-01-01T00:00:00.000+09:00');
  });

  it('getChatByFriendId picks the newest row when legacy duplicates remain', async () => {
    insertFriend(sqlite, 'f-4');
    dropUniqueIndex(sqlite);
    insertChatRow(sqlite, { id: 'c-old', friendId: 'f-4', status: 'resolved', createdAt: '2024-01-01T00:00:00.000+09:00' });
    insertChatRow(sqlite, { id: 'c-new', friendId: 'f-4', status: 'unread', createdAt: '2024-12-01T00:00:00.000+09:00' });

    const row = await getChatByFriendId(db, 'f-4');
    expect(row?.id).toBe('c-new');
  });
});
