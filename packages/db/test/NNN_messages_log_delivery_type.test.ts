import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATION_051 = readFileSync(
  join(PKG_ROOT, 'migrations', 'NNN_messages_log_delivery_type_test.sql'),
  'utf8',
);
const BOOTSTRAP_SQL = readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8');

/**
 * 本番レガシー DB の再現: bootstrap 以前の環境は 009 時代の ALTER で
 * delivery_type を得ており、CHECK が ('push', 'reply') のまま
 * (migration 026 が「D1 は CHECK を強制しない」という誤前提で no-op だったため)。
 */
function setupLegacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE friends (id TEXT PRIMARY KEY);
    CREATE TABLE broadcasts (id TEXT PRIMARY KEY);
    CREATE TABLE scenario_steps (id TEXT PRIMARY KEY);
    CREATE TABLE messages_log (
      id               TEXT PRIMARY KEY,
      friend_id        TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
      direction        TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
      message_type     TEXT NOT NULL,
      content          TEXT NOT NULL,
      broadcast_id     TEXT REFERENCES broadcasts (id) ON DELETE SET NULL,
      scenario_step_id TEXT REFERENCES scenario_steps (id) ON DELETE SET NULL,
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
      delivery_type TEXT CHECK (delivery_type IN ('push', 'reply')),
      source TEXT, line_account_id TEXT, template_id_at_send TEXT
    );
    CREATE INDEX idx_messages_log_created_at ON messages_log (created_at);
    CREATE INDEX idx_messages_log_friend_id ON messages_log (friend_id);
  `);
  db.exec(`
    INSERT INTO friends (id) VALUES ('f1');
    INSERT INTO messages_log (id, friend_id, direction, message_type, content, delivery_type, created_at)
      VALUES ('m1', 'f1', 'outgoing', 'text', 'hello', 'push', '2026-07-01T10:00:00.000+09:00');
    INSERT INTO messages_log (id, friend_id, direction, message_type, content, delivery_type)
      VALUES ('m2', 'f1', 'incoming', 'text', 'hi', NULL);
  `);
  return db;
}

function insertTestRow(db: Database.Database): void {
  db.prepare(
    `INSERT INTO messages_log (id, friend_id, direction, message_type, content, delivery_type)
     VALUES ('m-test', 'f1', 'outgoing', 'text', 'test send', 'test')`,
  ).run();
}

describe('NNN_messages_log_delivery_type_test', () => {
  it("旧CHECKのレガシーDBでは'test'の書き込みが失敗するべき(バグ再現)", () => {
    const db = setupLegacyDb();
    expect(() => insertTestRow(db)).toThrow(/CHECK constraint failed/);
  });

  it("適用後は'test'を受理し既存行をすべて保持するべき", () => {
    const db = setupLegacyDb();
    db.exec(MIGRATION_051);

    insertTestRow(db);

    const rows = db
      .prepare('SELECT id, delivery_type, content, created_at FROM messages_log ORDER BY id')
      .all() as Array<{ id: string; delivery_type: string | null; content: string; created_at: string }>;
    expect(rows.map((r) => r.id)).toEqual(['m-test', 'm1', 'm2']);
    expect(rows.find((r) => r.id === 'm1')).toMatchObject({
      delivery_type: 'push',
      content: 'hello',
      created_at: '2026-07-01T10:00:00.000+09:00',
    });
    expect(rows.find((r) => r.id === 'm2')?.delivery_type).toBeNull();
  });

  it('適用後のカラム定義とインデックスがbootstrap正典と一致するべき', () => {
    const db = setupLegacyDb();
    db.exec(MIGRATION_051);

    const canon = new Database(':memory:');
    canon.exec(BOOTSTRAP_SQL);

    const columns = (target: Database.Database) =>
      target.prepare('PRAGMA table_info(messages_log)').all().map((r: unknown) => {
        const row = r as { name: string; type: string; notnull: number; dflt_value: string | null };
        return [row.name, row.type, row.notnull, row.dflt_value];
      });
    expect(columns(db)).toEqual(columns(canon));

    const indexNames = (target: Database.Database) =>
      target
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND tbl_name = 'messages_log' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all()
        .map((r) => (r as { name: string }).name);
    expect(indexNames(db)).toEqual(indexNames(canon));
  });

  it('bootstrap由来のDB(修正済みCHECK)に適用しても無害であるべき', () => {
    const db = new Database(':memory:');
    db.exec(BOOTSTRAP_SQL);
    db.exec(`INSERT INTO friends (id, line_user_id, metadata) VALUES ('f1', 'U1', '{}')`);

    db.exec(MIGRATION_051);

    insertTestRow(db);
    const row = db
      .prepare(`SELECT delivery_type FROM messages_log WHERE id = 'm-test'`)
      .get() as { delivery_type: string };
    expect(row.delivery_type).toBe('test');
  });
});
