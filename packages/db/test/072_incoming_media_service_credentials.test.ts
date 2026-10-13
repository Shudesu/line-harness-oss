import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(
  join(PKG_ROOT, 'migrations', '072_incoming_media_service_credentials.sql'),
  'utf8',
);

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    INSERT INTO line_accounts (id) VALUES ('acc-1'), ('acc-2');
  `);
  db.exec(MIGRATION);
  return db;
}

function insert(db: Database.Database, id: string, hash: string, account = 'acc-1') {
  db.prepare(
    `INSERT INTO incoming_media_service_credentials (
       id, line_account_id, token_sha256, label, not_before, expires_at, created_at
     ) VALUES (?, ?, ?, 'accounting recovery', ?, ?, ?)`,
  ).run(
    id,
    account,
    hash,
    '2026-08-31T00:00:00.000Z',
    '2026-11-29T00:00:00.000Z',
    '2026-08-31T00:00:00.000Z',
  );
}

describe('072 incoming-media service credentials', () => {
  test('stores only fixed-purpose account-bound token digests', () => {
    const db = setup();
    insert(db, 'a'.repeat(32), 'b'.repeat(64));
    const row = db.prepare(
      `SELECT id, line_account_id, scope, token_sha256, revoked_at
         FROM incoming_media_service_credentials`,
    ).get() as Record<string, unknown>;
    expect(row).toEqual({
      id: 'a'.repeat(32),
      line_account_id: 'acc-1',
      scope: 'incoming_media_read',
      token_sha256: 'b'.repeat(64),
      revoked_at: null,
    });
  });

  test('permits overlapping rows for safe rotation but rejects digest reuse', () => {
    const db = setup();
    insert(db, 'a'.repeat(32), 'b'.repeat(64));
    insert(db, 'c'.repeat(32), 'd'.repeat(64));
    expect(db.prepare('SELECT COUNT(*) AS count FROM incoming_media_service_credentials').get())
      .toEqual({ count: 2 });
    expect(() => insert(db, 'e'.repeat(32), 'b'.repeat(64))).toThrow(/UNIQUE/);
  });

  test('rejects malformed ids, hashes, times, and unknown accounts', () => {
    const db = setup();
    expect(() => insert(db, 'A'.repeat(32), 'b'.repeat(64))).toThrow(/CHECK/);
    expect(() => insert(db, 'a'.repeat(32), 'B'.repeat(64))).toThrow(/CHECK/);
    expect(() => insert(db, 'a'.repeat(32), 'b'.repeat(64), 'missing')).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare(
      `INSERT INTO incoming_media_service_credentials (
         id, line_account_id, token_sha256, label, not_before, expires_at, created_at
       ) VALUES (?, 'acc-1', ?, 'x', '2026-09-01T00:00:00Z',
                 '2026-08-31T00:00:00Z', '2026-08-31T00:00:00Z')`,
    ).run('a'.repeat(32), 'b'.repeat(64))).toThrow(/CHECK/);
  });
});
