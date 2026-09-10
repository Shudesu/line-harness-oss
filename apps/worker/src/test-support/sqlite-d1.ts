// Local/test adapter only. Production routes use the Cloudflare D1 binding.
import type { SQLInputValue } from 'node:sqlite';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
export function sqliteD1(path = ':memory:') {
  const sqlite = new DatabaseSync(path);
  function prepare(sql: string, values: SQLInputValue[] = []): D1PreparedStatement {
    return {
      bind(...args: unknown[]) { return prepare(sql, args as SQLInputValue[]); },
      async first<T>(column?: string) {
        const row = sqlite.prepare(sql).get(...values);
        return (column ? row?.[column] ?? null : row ?? null) as T | null;
      },
      async all<T>() {
        const results = sqlite.prepare(sql).all(...values) as T[];
        return { success: true, results, meta: { changes: 0, duration: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: results.length, rows_written: 0 } };
      },
      async run<T>() {
        const info = sqlite.prepare(sql).run(...values);
        return { success: true, results: [] as T[], meta: { changes: Number(info.changes), duration: 0, last_row_id: Number(info.lastInsertRowid), changed_db: !!info.changes, size_after: 0, rows_read: 0, rows_written: Number(info.changes) } };
      },
      async raw<T>() { return sqlite.prepare(sql).all(...values).map(row => Object.values(row)) as T[]; },
    } as D1PreparedStatement;
  }
  const db = { prepare } as D1Database;
  return { db, sqlite };
}
