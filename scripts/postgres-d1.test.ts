import { describe, expect, it } from 'vitest'

const {
  splitSqlStatements,
  toPostgresSchemaStatement,
  translateRuntimeSql,
} = require('../api/_lib/postgres-d1.js') as {
  splitSqlStatements(sql: string): string[]
  toPostgresSchemaStatement(sql: string): string
  translateRuntimeSql(sql: string): string
}

describe('postgres-d1 SQL translation', () => {
  it('converts D1 placeholders to pg placeholders', () => {
    expect(translateRuntimeSql('SELECT * FROM friends WHERE id = ? AND line_account_id = ?')).toContain(
      'id = $1 AND line_account_id = $2',
    )
    expect(translateRuntimeSql('SELECT * FROM friends WHERE id = ?2 AND line_account_id = ?1')).toContain(
      'id = $2 AND line_account_id = $1',
    )
  })

  it('converts INSERT OR IGNORE to PostgreSQL upsert syntax', () => {
    const sql = translateRuntimeSql(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
       VALUES (?, ?, ?)`,
    )
    expect(sql).toContain('INSERT INTO friend_tags')
    expect(sql).toContain('VALUES ($1, $2, $3) ON CONFLICT DO NOTHING')
  })

  it('converts SQLite JSON helpers used by the dashboard queries', () => {
    expect(
      translateRuntimeSql(
        `EXISTS (SELECT 1 FROM json_each(b.account_ids) WHERE value = ?)`,
      ),
    ).toContain('jsonb_array_elements_text')

    expect(translateRuntimeSql(`json_extract(f.metadata, '$.' || ?) = ?`)).toContain(
      "COALESCE(NULLIF(f.metadata, '')::jsonb",
    )

    expect(
      translateRuntimeSql(
        `SELECT json_group_array(json_object('id', la.id, 'count', sub.cnt)) FROM line_accounts la`,
      ),
    ).toContain('json_agg(json_build_object')
  })

  it('normalizes generated SQLite schema into idempotent PostgreSQL DDL', () => {
    const statement = toPostgresSchemaStatement(`CREATE TABLE broadcasts (
      id TEXT PRIMARY KEY,
      account_ids TEXT CHECK (account_ids IS NULL OR json_valid(account_ids)),
      line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
      FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
    )`)

    expect(statement).toMatch(/^CREATE TABLE IF NOT EXISTS broadcasts/)
    expect(statement).not.toContain('json_valid')
    expect(statement).not.toContain('FOREIGN KEY')
    expect(statement).not.toContain('REFERENCES')
    expect(statement).toContain('Asia/Tokyo')
  })

  it('splits SQL statements without splitting semicolons inside strings', () => {
    expect(splitSqlStatements("CREATE TABLE a (x TEXT DEFAULT ';'); CREATE TABLE b (id TEXT);")).toEqual([
      "CREATE TABLE a (x TEXT DEFAULT ';')",
      'CREATE TABLE b (id TEXT)',
    ])
  })
})
