import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(join(PKG_ROOT, 'migrations', '071_incoming_media.sql'), 'utf8');

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    INSERT INTO line_accounts (id) VALUES ('acc-1'), ('acc-2');
  `);
  db.exec(MIGRATION);
  return db;
}

function insert(db: Database.Database, accountId: string, messageId: string, id: string): void {
  db.prepare(
    `INSERT INTO incoming_media (
       id, line_account_id, line_message_id, source_type, source_id,
       sender_user_id, r2_key, mime_type, byte_size, sha256, status,
       stored_at, created_at, updated_at
     ) VALUES (?, ?, ?, 'group', 'C123', 'U456', ?, 'image/png', 4, ?,
               'stored', '2026-08-31T12:00:01+09:00',
               '2026-08-31T12:00:00+09:00', '2026-08-31T12:00:01+09:00')`,
  ).run(id, accountId, messageId, `incoming-${id}`, 'a'.repeat(64));
}

describe('071_incoming_media migration', () => {
  test('persists source, object, integrity, status, and timestamp metadata', () => {
    const db = setupDb();
    insert(db, 'acc-1', 'msg-1', 'media-1');
    const row = db.prepare('SELECT * FROM incoming_media').get() as Record<string, unknown>;
    expect(row).toMatchObject({
      line_account_id: 'acc-1',
      line_message_id: 'msg-1',
      source_type: 'group',
      source_id: 'C123',
      sender_user_id: 'U456',
      r2_key: 'incoming-media-1',
      mime_type: 'image/png',
      byte_size: 4,
      sha256: 'a'.repeat(64),
      status: 'stored',
      stored_at: '2026-08-31T12:00:01+09:00',
      created_at: '2026-08-31T12:00:00+09:00',
      updated_at: '2026-08-31T12:00:01+09:00',
    });
  });

  test('deduplicates only within the same account + LINE message identity', () => {
    const db = setupDb();
    insert(db, 'acc-1', 'msg-1', 'media-1');
    expect(() => insert(db, 'acc-1', 'msg-1', 'media-duplicate')).toThrow(/UNIQUE constraint failed/);
    expect(() => insert(db, 'acc-2', 'msg-1', 'media-other-account')).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS count FROM incoming_media').get()).toEqual({ count: 2 });
  });
});
