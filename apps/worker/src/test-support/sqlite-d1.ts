// Local/test adapter only. Production routes use the Cloudflare D1 binding.
import Database from 'better-sqlite3';
type SQLInputValue = string | number | bigint | Buffer | null;
export function sqliteD1(path = ':memory:'): { db: D1Database; sqlite: Database.Database } {
  const sqlite = new Database(path);
  const syncRuns = new WeakMap<D1PreparedStatement, () => D1Result>();
  function prepare(sql: string, values: SQLInputValue[] = []): D1PreparedStatement {
    const run = (): D1Result => {
      const info = sqlite.prepare(sql).run(...values);
      return { success: true, results: [], meta: { changes: Number(info.changes), duration: 0, last_row_id: Number(info.lastInsertRowid), changed_db: !!info.changes, size_after: 0, rows_read: 0, rows_written: Number(info.changes) } };
    };
    const statement = {
      bind(...args: unknown[]) { return prepare(sql, args as SQLInputValue[]); },
      async first<T>(column?: string) {
        const row = sqlite.prepare(sql).get(...values) as Record<string, SQLInputValue> | undefined;
        return (column ? row?.[column] ?? null : row ?? null) as T | null;
      },
      async all<T>() {
        const results = sqlite.prepare(sql).all(...values) as T[];
        return { success: true, results, meta: { changes: 0, duration: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: results.length, rows_written: 0 } };
      },
      async run<T>() { return run() as D1Result<T>; },
      async raw<T>() { return sqlite.prepare(sql).all(...values).map(row => Object.values(row as Record<string, SQLInputValue>)) as T[]; },
    } as D1PreparedStatement;
    syncRuns.set(statement, run);
    return statement;
  }
  const db = {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      // Execute synchronously inside the transaction, like one D1 batch. No
      // await between statements: another synthetic request must not interleave.
      return sqlite.transaction(() => statements.map((statement) => {
        const run = syncRuns.get(statement);
        if (!run) throw new Error('Statement belongs to a different fixture');
        return run() as D1Result<T>;
      }))();
    },
  } as D1Database;
  return { db, sqlite };
}
