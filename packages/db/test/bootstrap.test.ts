import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const GENERATOR = join(PKG_ROOT, 'scripts', 'generate-bootstrap.mjs');
const BOOTSTRAP_PATH = join(PKG_ROOT, 'bootstrap.sql');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');

const BENIGN_SQLITE_ERROR = /duplicate column name|already exists/i;

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function applyMigrationReplay(db: Database.Database): void {
  db.exec(readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of splitSqlStatements(sql)) {
      try {
        db.exec(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!BENIGN_SQLITE_ERROR.test(message)) {
          throw new Error(`${file}: ${message}`);
        }
      }
    }
  }
}

function readSchemaObjects(db: Database.Database) {
  return db
    .prepare(
      `
        SELECT type, name, sql
        FROM sqlite_master
        WHERE sql IS NOT NULL
          AND name NOT LIKE 'sqlite_%'
        ORDER BY
          CASE type
            WHEN 'table' THEN 0
            WHEN 'index' THEN 1
            WHEN 'trigger' THEN 2
            WHEN 'view' THEN 3
            ELSE 4
          END,
          name
      `,
    )
    .all() as Array<{ type: string; name: string; sql: string }>;
}

describe('bootstrap.sql', () => {
  it('stays in sync with schema.sql + migrations', () => {
    expect(() =>
      execFileSync('node', [GENERATOR, '--check'], {
        cwd: PKG_ROOT,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('matches the schema produced by replaying all migrations', () => {
    const bootstrapDb = new Database(':memory:');
    const replayDb = new Database(':memory:');

    bootstrapDb.exec(readFileSync(BOOTSTRAP_PATH, 'utf8'));
    applyMigrationReplay(replayDb);

    expect(readSchemaObjects(bootstrapDb)).toEqual(readSchemaObjects(replayDb));
  });

  it('includes built-in auto-reply seed data for clean installs', () => {
    const db = new Database(':memory:');
    db.exec(readFileSync(BOOTSTRAP_PATH, 'utf8'));

    const rule = db
      .prepare(
        `SELECT keyword, match_type, response_type, line_account_id, is_active, response_content
           FROM auto_replies
          WHERE id = 'builtin-mileage-wallet-keyword'`,
      )
      .get() as {
        keyword: string;
        match_type: string;
        response_type: string;
        line_account_id: string | null;
        is_active: number;
        response_content: string;
      } | undefined;

    expect(rule).toMatchObject({
      keyword: 'マイル',
      match_type: 'exact',
      response_type: 'flex',
      line_account_id: null,
      is_active: 1,
    });
    expect(rule?.response_content).toContain('?page=affiliate&liffId={{liff_id}}');
  });
});
