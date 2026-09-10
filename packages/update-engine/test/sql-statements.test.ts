import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { applyD1Migrations } from '../src/migrations.js';
import {
  containsDestructiveSchemaChanges,
  splitSqlStatements,
  stripSqlComments,
} from '../src/sql-statements.js';

const malformedTriggers = [
  ['missing BEGIN', 'CREATE TRIGGER t AFTER INSERT ON a SELECT 1; END;'],
  ['missing END', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1;'],
  ['empty body', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN END;'],
  ['missing body semicolon', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1 END;'],
  ['unclosed CASE', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT CASE WHEN 1 THEN 2; END;'],
  ['unclosed nested CASE', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT CASE WHEN 1 THEN CASE WHEN 2 THEN 3 END; END;'],
  ['unclosed CASE with END identifier', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT CASE WHEN end > 0 THEN end; END;'],
  ['unclosed WHEN CASE with END identifier', 'CREATE TRIGGER t AFTER INSERT ON a WHEN CASE WHEN end > 0 THEN end BEGIN SELECT 1; END;'],
  ['unclosed parentheses', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT (1; END;'],
  ['unmatched closing parenthesis', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1); END;'],
  ['extra END', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1; END END;'],
  ['unterminated outer statement', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1; END CREATE TABLE b (id);'],
  ['nested BEGIN block', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN BEGIN SELECT 1; END; END;'],
  ['unfinished WHEN CASE', 'CREATE TRIGGER t AFTER INSERT ON a WHEN CASE WHEN 1 THEN 1 BEGIN SELECT 1; END;'],
  ['empty WHEN', 'CREATE TRIGGER t AFTER INSERT ON a WHEN BEGIN SELECT 1; END;'],
  ['unterminated string', "CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 'END;"],
  ['unterminated comment', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1; /* END;'],
] as const;

describe('safe SQLite statement scanning', () => {
  it('executes multiple commands, nested CASE, another trigger and following DDL separately', () => {
    const db = new Database(':memory:');
    try {
      const statements = splitSqlStatements(`
        CREATE TABLE events (id INTEGER PRIMARY KEY, value INTEGER);
        CREATE TABLE logs (event_id INTEGER, value TEXT);
        CREATE /* TRIGGER BEGIN END; */ TEMPORARY TRIGGER IF NOT EXISTS audit
        AFTER INSERT ON main.events FOR EACH ROW
        WHEN CASE WHEN NEW.value > 0 THEN CASE WHEN NEW.id > 0 THEN 1 ELSE 0 END ELSE 0 END
        BEGIN
          INSERT INTO logs VALUES (NEW.id, CASE WHEN NEW.value = 1 THEN
            CASE WHEN NEW.id = 1 THEN 'it''s CASE; END; -- /*' ELSE 'other' END
            ELSE 'BEGIN; END' END);
          -- CASE END; CREATE TRIGGER ignored
          UPDATE events SET value = value + 1 WHERE id = NEW.id;
        END;
        CREATE TRIGGER audit_delete AFTER DELETE ON events BEGIN
          INSERT INTO logs VALUES (OLD.id, 'deleted;');
        END;
        CREATE INDEX logs_event ON logs(event_id);
        INSERT INTO events VALUES (1, 1);
        DELETE FROM events WHERE id = 1;
      `);
      expect(statements).toHaveLength(7);
      // prepare().run() rejects accidentally joined statements and incomplete
      // trigger fragments, unlike exec(), which accepts multi-statement input.
      for (const statement of statements) db.prepare(statement).run();
      expect(db.prepare('SELECT value FROM logs ORDER BY rowid').all()).toEqual([
        { value: "it's CASE; END; -- /*" },
        { value: 'deleted;' },
      ]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()).toContainEqual({ name: 'logs_event' });
    } finally {
      db.close();
    }
  });

  it('keeps quoted identifiers and comment markers out of keyword handling', () => {
    const db = new Database(':memory:');
    try {
      const statements = splitSqlStatements(`
        CREATE TABLE a ("END;" INTEGER, [CASE] INTEGER, \`BEGIN\` INTEGER);
        CREATE TABLE b (value INTEGER);
        CREATE TRIGGER "audit;END" UPDATE OF "END;", [CASE] ON a BEGIN
          INSERT INTO b VALUES (NEW."END;" + NEW.[CASE] + NEW.\`BEGIN\`);
        END;
        INSERT INTO a VALUES (1, 2, 3);
        UPDATE a SET "END;" = 4;
      `);
      for (const statement of statements) db.prepare(statement).run();
      expect(db.prepare('SELECT value FROM b').get()).toEqual({ value: 9 });
    } finally {
      db.close();
    }
  });

  it('supports omitted timing, INSTEAD OF, TEMP and a complete final END without an outer semicolon', () => {
    const db = new Database(':memory:');
    try {
      for (const statement of splitSqlStatements(`
        CREATE TABLE items (value INTEGER);
        CREATE VIEW input AS SELECT value FROM items;
        CREATE TEMP TRIGGER insert_input INSTEAD OF INSERT ON input BEGIN
          INSERT INTO items VALUES (NEW.value);
        END;
        CREATE TRIGGER validate_input INSERT ON items BEGIN
          SELECT CASE WHEN NEW.value < 0 THEN RAISE(ABORT, 'negative') END;
        END
      `)) db.prepare(statement).run();
      db.prepare('INSERT INTO input VALUES (4)').run();
      expect(db.prepare('SELECT value FROM items').get()).toEqual({ value: 4 });
      expect(() => db.prepare('INSERT INTO input VALUES (-1)').run()).toThrow('negative');
    } finally {
      db.close();
    }
  });

  it('executes BEGIN and END fallback identifiers without consuming CASE or trigger delimiters', () => {
    const db = new Database(':memory:');
    try {
      db.function('begin', () => 1);
      const statements = splitSqlStatements(`
        CREATE TABLE events (begin INTEGER, end INTEGER);
        CREATE TABLE logs (begin INTEGER, end INTEGER);
        CREATE TRIGGER audit AFTER INSERT ON events
        WHEN (SELECT begin FROM events LIMIT 1) > 0 BEGIN
          INSERT INTO logs(end, begin) VALUES (NEW.end, NEW.begin);
          UPDATE logs SET end = CASE WHEN end > 0 THEN end ELSE 0 END,
            begin = CASE end WHEN 4 THEN CASE WHEN begin > 0 THEN end ELSE 0 END ELSE 0 END;
        END;
        CREATE TRIGGER audit_update AFTER UPDATE ON events
        WHEN begin() > 0 BEGIN
          UPDATE logs SET end = (SELECT CASE WHEN end > 0 THEN end ELSE 0 END FROM events LIMIT 1);
        END;
        INSERT INTO events VALUES (2, 4);
      `);
      expect(statements).toHaveLength(5);
      for (const statement of statements) db.prepare(statement).run();
      expect(db.prepare('SELECT * FROM logs').get()).toEqual({ begin: 4, end: 4 });
      db.prepare('UPDATE events SET end = 7').run();
      expect(db.prepare('SELECT * FROM logs').get()).toEqual({ begin: 4, end: 7 });
      // Name resolution in a WHEN expression belongs to SQLite. Its bare
      // BEGIN operand must still be preserved by the envelope scanner.
      const bareWhen = 'CREATE TRIGGER bare_when AFTER INSERT ON events WHEN begin > 0 BEGIN SELECT 1; END';
      expect(splitSqlStatements(`${bareWhen};`)).toEqual([bareWhen]);
      db.prepare(bareWhen).run();
    } finally {
      db.close();
    }
  });

  it.each(malformedTriggers)('rejects %s during scanning', (_name, sql) => {
    expect(() => splitSqlStatements(sql)).toThrow(/malformed CREATE TRIGGER|unterminated SQL/);
  });

  it.each(malformedTriggers)('does not contact D1 for a cumulative release with %s', async (_name, sql) => {
    const execute = vi.fn();
    const onMigrationStart = vi.fn();
    await expect(applyD1Migrations({
      creds: { accountId: 'account', apiToken: 'token' },
      databaseId: 'db',
      names: ['041_valid.sql', '076_malformed.sql'],
      migrations: new Map([
        ['041_valid.sql', Buffer.from('CREATE TABLE a (id INTEGER);')],
        ['076_malformed.sql', Buffer.from(sql)],
      ]),
      execute,
      onMigrationStart,
    })).rejects.toThrow(/malformed CREATE TRIGGER|unterminated SQL/);
    expect(execute).not.toHaveBeenCalled();
    expect(onMigrationStart).not.toHaveBeenCalled();
  });

  it.each([
    'DROP/**/TABLE a;',
    'ALTER TABLE a DROP -- name\nCOLUMN b;',
    'ALTER TABLE a RENAME TO b;',
    'ALTER TABLE a RENAME COLUMN b TO c;',
    "SELECT '--'; DROP TABLE a;",
  ])('keeps destructive schema guards for %s', (sql) => {
    expect(containsDestructiveSchemaChanges(sql)).toBe(true);
    expect(() => splitSqlStatements(sql)).toThrow(/destructive schema changes/);
  });

  it('does not treat quoted text or comments as destructive schema operations', () => {
    const sql = `/* DROP TABLE a; */ SELECT 'DROP TABLE a; CREATE TRIGGER t', "RENAME COLUMN", [DROP TABLE];`;
    expect(containsDestructiveSchemaChanges(sql)).toBe(false);
    expect(splitSqlStatements(sql)).toHaveLength(1);
    expect(stripSqlComments("SELECT '--literal', '/*literal*/'; -- comment").trim()).toBe("SELECT '--literal', '/*literal*/';");
  });
});
