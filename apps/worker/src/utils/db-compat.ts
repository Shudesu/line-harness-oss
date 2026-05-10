const columnCache = new Map<string, boolean>();
const tableCache = new Map<string, boolean>();

export async function hasTable(db: D1Database, tableName: string): Promise<boolean> {
  const cached = tableCache.get(tableName);
  if (cached !== undefined) return cached;

  const row = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .bind(tableName)
    .first<{ name: string }>();
  const exists = Boolean(row);
  tableCache.set(tableName, exists);
  return exists;
}

export async function hasColumn(db: D1Database, tableName: string, columnName: string): Promise<boolean> {
  const key = `${tableName}.${columnName}`;
  const cached = columnCache.get(key);
  if (cached !== undefined) return cached;

  const result = await db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all<{ name: string }>();
  const exists = result.results.some((column) => column.name === columnName);
  columnCache.set(key, exists);
  return exists;
}
