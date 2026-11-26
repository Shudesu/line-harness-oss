import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION_PATH = join(PKG_ROOT, 'migrations', '072_health_logs_composite_index.sql');
const LATEST_HEALTH_QUERY = `
  SELECT *
    FROM account_health_logs
   WHERE line_account_id = ?
   ORDER BY created_at DESC
   LIMIT ?
`;

function legacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE account_health_logs (
      id              TEXT PRIMARY KEY,
      line_account_id TEXT NOT NULL,
      error_code      INTEGER,
      error_count     INTEGER NOT NULL DEFAULT 0,
      check_period    TEXT NOT NULL,
      risk_level      TEXT NOT NULL DEFAULT 'normal',
      created_at      TEXT NOT NULL
    );
    CREATE INDEX idx_health_logs_account
      ON account_health_logs (line_account_id);
  `);

  const insert = db.prepare(`
    INSERT INTO account_health_logs
      (id, line_account_id, error_count, check_period, risk_level, created_at)
    VALUES (?, ?, 0, ?, 'normal', ?)
  `);
  const insertMany = db.transaction(() => {
    for (let index = 0; index < 1_000; index += 1) {
      const timestamp = `2026-08-${String((index % 28) + 1).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00.000+09:00`;
      insert.run(`log-${index}`, 'account-1', timestamp, timestamp);
    }
  });
  insertMany();
  return db;
}

describe('migration 072_health_logs_composite_index', () => {
  it('uses the composite index for the v0.23.1 latest-state query', () => {
    const db = legacyDb();
    db.exec(readFileSync(MIGRATION_PATH, 'utf8'));

    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${LATEST_HEALTH_QUERY}`)
      .all('account-1', 1) as Array<{ detail: string }>;

    expect(plan.map(({ detail }) => detail).join('\n')).toContain(
      'USING INDEX idx_health_logs_account_created_at (line_account_id=?)',
    );
    expect(plan.map(({ detail }) => detail).join('\n')).not.toContain('USE TEMP B-TREE');
    db.close();
  });

  it('removes the redundant line_account_id-only index', () => {
    const db = legacyDb();
    db.exec(readFileSync(MIGRATION_PATH, 'utf8'));

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`)
      .all() as Array<{ name: string }>;

    expect(indexes.map(({ name }) => name)).toContain('idx_health_logs_account_created_at');
    expect(indexes.map(({ name }) => name)).not.toContain('idx_health_logs_account');
    db.close();
  });

  it('is idempotent and safe to re-apply', () => {
    const db = legacyDb();
    const migration = readFileSync(MIGRATION_PATH, 'utf8');

    expect(() => db.exec(migration)).not.toThrow();
    expect(() => db.exec(migration)).not.toThrow();
    db.close();
  });
});
