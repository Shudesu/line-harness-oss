import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(
  join(PKG_ROOT, 'migrations', '073_group_tags_tasks.sql'),
  'utf8',
);
const SCHEMA = readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8');

/**
 * Stand up the tables migration 073 depends on, with rows in them, so the
 * migration can be shown to add without disturbing anything already stored.
 *
 * `messages_log` stands in for the live receive log this feature promised not
 * to touch.
 */
function legacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE line_accounts (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE tags (
      id         TEXT PRIMARY KEY,
      name       TEXT UNIQUE NOT NULL,
      color      TEXT NOT NULL DEFAULT '#3B82F6',
      created_at TEXT NOT NULL
    );
    CREATE TABLE friends (
      id         TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE friend_tags (
      friend_id   TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
      tag_id      TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (friend_id, tag_id)
    );
    CREATE TABLE messages_log (
      id         TEXT PRIMARY KEY,
      friend_id  TEXT,
      body       TEXT,
      created_at TEXT NOT NULL
    );
  `);

  db.exec(`
    INSERT INTO line_accounts (id, name, created_at)
      VALUES ('acc-1', '本体アカウント', '2026-01-01T00:00:00.000');
    INSERT INTO tags (id, name, color, created_at) VALUES
      ('tag-1', '進行中', '#10B981', '2026-01-01T00:00:00.000'),
      ('tag-2', '要確認', '#F59E0B', '2026-01-01T00:00:00.000');
    INSERT INTO friends (id, created_at) VALUES
      ('friend-1', '2026-01-01T00:00:00.000'),
      ('friend-2', '2026-01-01T00:00:00.000');
    INSERT INTO friend_tags (friend_id, tag_id, assigned_at) VALUES
      ('friend-1', 'tag-1', '2026-02-01T00:00:00.000'),
      ('friend-2', 'tag-2', '2026-02-01T00:00:00.000');
  `);

  const insertLog = db.prepare(
    `INSERT INTO messages_log (id, friend_id, body, created_at) VALUES (?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (let index = 0; index < 392; index += 1) {
      insertLog.run(`log-${index}`, 'friend-1', `message ${index}`, '2026-03-01T00:00:00.000');
    }
  })();

  return db;
}

/** Statements that would rewrite or remove data that already exists. */
const DESTRUCTIVE =
  /\b(UPDATE|DELETE\s+FROM|DROP\s+TABLE|DROP\s+INDEX|ALTER\s+TABLE|TRUNCATE)\b/gi;

const PRE_EXISTING_TABLES = [
  'line_accounts',
  'tags',
  'friends',
  'friend_tags',
  'messages_log',
] as const;

/** Full contents of every table that existed before the migration. */
function snapshot(db: Database.Database) {
  return Object.fromEntries(
    PRE_EXISTING_TABLES.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('migration 073_group_tags_tasks', () => {
  it('creates line_groups, group_tags and tasks', () => {
    const db = legacyDb();
    db.exec(MIGRATION);

    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all() as Array<{ name: string }>
    ).map(({ name }) => name);

    expect(tables).toContain('line_groups');
    expect(tables).toContain('group_tags');
    expect(tables).toContain('tasks');
    db.close();
  });

  it('leaves every pre-existing row byte-for-byte unchanged', () => {
    const db = legacyDb();
    const before = snapshot(db);

    db.exec(MIGRATION);

    expect(snapshot(db)).toEqual(before);
    // The receive-log count is the number this feature promised not to change.
    expect(count(db, 'messages_log')).toBe(392);
    db.close();
  });

  it('reuses the existing tags table instead of defining a second one', () => {
    const db = legacyDb();
    db.exec(MIGRATION);

    // A group tag must resolve to a row in the same `tags` table friends use.
    db.exec(`
      INSERT INTO line_groups (id, account_id, name, created_at, updated_at)
        VALUES ('Cabc', 'acc-1', 'KOBOREL PJ', '2026-10-01T00:00:00.000', '2026-10-01T00:00:00.000');
      INSERT INTO group_tags (group_id, tag_id, assigned_at)
        VALUES ('Cabc', 'tag-1', '2026-10-01T00:00:00.000');
    `);

    const row = db
      .prepare(
        `SELECT t.name FROM group_tags gt
           JOIN tags t ON t.id = gt.tag_id
          WHERE gt.group_id = ?`,
      )
      .get('Cabc') as { name: string };
    expect(row.name).toBe('進行中');
    db.close();
  });

  it('drops a group’s tags and tasks when the group row goes, and nothing else', () => {
    const db = legacyDb();
    db.exec(MIGRATION);
    db.pragma('foreign_keys = ON');
    db.exec(`
      INSERT INTO line_groups (id, account_id, name, created_at, updated_at)
        VALUES ('Cabc', 'acc-1', 'KOBOREL PJ', '2026-10-01T00:00:00.000', '2026-10-01T00:00:00.000');
      INSERT INTO group_tags (group_id, tag_id, assigned_at)
        VALUES ('Cabc', 'tag-1', '2026-10-01T00:00:00.000');
      INSERT INTO tasks (id, group_id, title, status, created_at, updated_at)
        VALUES ('task-1', 'Cabc', '契約書を送る', 'todo', '2026-10-01T00:00:00.000', '2026-10-01T00:00:00.000');
    `);

    db.exec(`DELETE FROM line_groups WHERE id = 'Cabc'`);

    expect(count(db, 'group_tags')).toBe(0);
    expect(count(db, 'tasks')).toBe(0);
    // The shared tag survives — it is still attached to friends.
    expect(count(db, 'tags')).toBe(2);
    expect(count(db, 'friend_tags')).toBe(2);
    db.close();
  });

  it('keeps a group’s tags when the shared tag is deleted, without touching friend_tags', () => {
    const db = legacyDb();
    db.exec(MIGRATION);
    db.pragma('foreign_keys = ON');
    db.exec(`
      INSERT INTO line_groups (id, account_id, name, created_at, updated_at)
        VALUES ('Cabc', 'acc-1', 'KOBOREL PJ', '2026-10-01T00:00:00.000', '2026-10-01T00:00:00.000');
      INSERT INTO group_tags (group_id, tag_id, assigned_at)
        VALUES ('Cabc', 'tag-2', '2026-10-01T00:00:00.000');
    `);

    // Deleting tag-2 must clear only the rows that reference it.
    db.exec(`DELETE FROM tags WHERE id = 'tag-2'`);

    expect(count(db, 'group_tags')).toBe(0);
    expect(count(db, 'friend_tags')).toBe(1);
    expect(count(db, 'line_groups')).toBe(1);
    db.close();
  });

  it('rejects a task status outside todo / doing / done', () => {
    const db = legacyDb();
    db.exec(MIGRATION);
    expect(() =>
      db.exec(`
        INSERT INTO tasks (id, title, status, created_at, updated_at)
          VALUES ('task-x', 'x', 'blocked', '2026-10-01T00:00:00.000', '2026-10-01T00:00:00.000');
      `),
    ).toThrow();
    db.close();
  });

  it('orders a deadline list soonest-first with undated tasks last', () => {
    const db = legacyDb();
    db.exec(MIGRATION);
    db.exec(`
      INSERT INTO tasks (id, title, status, due_date, created_at, updated_at) VALUES
        ('t-none', '期限なし', 'todo', NULL,         '2026-10-01T00:00:00.000', '2026-10-01T00:00:00.000'),
        ('t-late', '来月',     'todo', '2026-11-30', '2026-10-01T00:00:00.000', '2026-10-01T00:00:00.000'),
        ('t-soon', '明日',     'todo', '2026-10-02', '2026-10-01T00:00:00.000', '2026-10-01T00:00:00.000');
    `);

    const ids = (
      db
        .prepare(
          `SELECT id FROM tasks ORDER BY due_date IS NULL, due_date ASC, created_at ASC`,
        )
        .all() as Array<{ id: string }>
    ).map(({ id }) => id);

    expect(ids).toEqual(['t-soon', 't-late', 't-none']);
    db.close();
  });

  it('contains no UPDATE, DELETE, DROP or ALTER statement', () => {
    // Scan the executable SQL only. The file's own comments name these
    // keywords to explain the rule, and matching those would make the guard
    // fire on prose instead of statements.
    const executable = MIGRATION.replace(/--[^\n]*/g, '');
    expect(executable.match(DESTRUCTIVE)).toBeNull();

    // Negative control: the same scan must catch a destructive statement, so a
    // pass above means "nothing found", not "the scan is broken".
    expect(`DELETE FROM messages_log;`.match(DESTRUCTIVE)).not.toBeNull();
    expect(`UPDATE tags SET name = 'x';`.match(DESTRUCTIVE)).not.toBeNull();
    expect(`DROP TABLE friend_tags;`.match(DESTRUCTIVE)).not.toBeNull();
  });

  it('is idempotent and safe to re-apply', () => {
    const db = legacyDb();
    expect(() => db.exec(MIGRATION)).not.toThrow();
    expect(() => db.exec(MIGRATION)).not.toThrow();
    db.close();
  });

  it('is mirrored in schema.sql, which is what db:migrate applies to live databases', () => {
    for (const table of ['line_groups', 'group_tags', 'tasks']) {
      expect(SCHEMA).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    }
  });
});
