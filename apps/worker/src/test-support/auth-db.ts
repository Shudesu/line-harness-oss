import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

/** Real local SQLite for session/auth regressions; no production credentials. */
export function createAuthTestDb(): { sql: Database.Database; db: D1Database; reset: () => void; close: () => void } {
  const sql = new Database(':memory:');
  sql.exec(readFileSync(new NodeURL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
  const db = { prepare(query: string) {
    let values: unknown[] = [];
    return {
      bind(...args: unknown[]) { values=args;return this; },
      async first() { return sql.prepare(query).get(...values) ?? null; },
      async all() { return { results: sql.prepare(query).all(...values) }; },
      async run() { return { meta: { changes: sql.prepare(query).run(...values).changes } }; },
    };
  } } as unknown as D1Database;
  function reset() {
    sql.exec('DELETE FROM admin_sessions; DELETE FROM staff_members;');
    sql.prepare('INSERT INTO staff_members(id,name,role,api_key,is_active) VALUES(?,?,?,?,1)')
      .run('staff-1','Staff One','admin','staff-key');
  }
  reset();
  return { sql, db, reset, close: () => sql.close() };
}
