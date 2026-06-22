const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')
const { Pool, types } = require('pg')

// PostgreSQL returns COUNT(*) as int8 strings by default. D1 returns JS
// numbers, and the existing dashboard/worker code treats count/cnt as numbers.
types.setTypeParser(20, (value) => Number(value))

const SCHEMA_NAME = 'line_harness'
const OBJECTS_TABLE = '_line_harness_objects'
const BOOTSTRAP_SQL_PATH = path.join(process.cwd(), 'packages', 'db', 'bootstrap.sql')
const JST_NOW_SQL =
  "to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS')"
const UTC_NOW_SQL =
  "to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"

let pool
let ensureSchemaPromise

function withSearchPath(connectionString) {
  const url = new URL(connectionString)
  // Keep the LINE Harness tables isolated from any existing public-schema
  // Supabase tables, while still allowing extension/functions in public.
  url.searchParams.set('options', `-c search_path=${SCHEMA_NAME},public`)
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    url.searchParams.set('sslmode', 'verify-full')
  }
  return url.toString()
}

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured')
  }
  if (!pool) {
    pool = new Pool({
      connectionString: withSearchPath(process.env.DATABASE_URL),
      max: Number(process.env.POSTGRES_POOL_MAX || 3),
    })
  }
  return pool
}

async function ensureSchema() {
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = (async () => {
      const db = getPool()
      await db.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA_NAME}`)
      await db.query(
        `CREATE TABLE IF NOT EXISTS ${SCHEMA_NAME}._line_harness_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (${JST_NOW_SQL})
        )`,
      )
      await db.query(
        `CREATE TABLE IF NOT EXISTS ${SCHEMA_NAME}.${OBJECTS_TABLE} (
          key TEXT PRIMARY KEY,
          body BYTEA NOT NULL,
          size INTEGER NOT NULL,
          etag TEXT NOT NULL,
          content_type TEXT,
          custom_metadata TEXT,
          uploaded_at TEXT NOT NULL DEFAULT (${JST_NOW_SQL})
        )`,
      )
      const marker = await db.query(
        `SELECT value FROM ${SCHEMA_NAME}._line_harness_meta WHERE key = 'bootstrap_applied'`,
      )
      if (marker.rowCount > 0) return

      const bootstrapSql = fs.readFileSync(BOOTSTRAP_SQL_PATH, 'utf8')
      const statements = splitSqlStatements(bootstrapSql)
        .map(toPostgresSchemaStatement)
        .filter(Boolean)

      const client = await db.connect()
      try {
        await client.query('BEGIN')
        await client.query(`SET search_path TO ${SCHEMA_NAME},public`)
        for (const statement of statements) {
          await client.query(statement)
        }
        await client.query(
          `INSERT INTO _line_harness_meta (key, value, updated_at)
           VALUES ('bootstrap_applied', '1', ${JST_NOW_SQL})
           ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        )
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined)
        ensureSchemaPromise = undefined
        throw err
      } finally {
        client.release()
      }
    })()
  }
  return ensureSchemaPromise
}

function splitSqlStatements(sql) {
  const withoutComments = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  const statements = []
  let current = ''
  let quote = null
  for (let i = 0; i < withoutComments.length; i += 1) {
    const ch = withoutComments[i]
    current += ch
    if (quote) {
      if (ch === quote) {
        if (withoutComments[i + 1] === quote) {
          current += withoutComments[i + 1]
          i += 1
        } else {
          quote = null
        }
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === ';') {
      const stmt = current.slice(0, -1).trim()
      if (stmt) statements.push(stmt)
      current = ''
    }
  }
  const tail = current.trim()
  if (tail) statements.push(tail)
  return statements
}

function splitTopLevelComma(value) {
  const parts = []
  let current = ''
  let depth = 0
  let quote = null
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (quote) {
      current += ch
      if (ch === quote) {
        if (value[i + 1] === quote) {
          current += value[i + 1]
          i += 1
        } else {
          quote = null
        }
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function stripInlineReferences(columnDefinition) {
  return columnDefinition
    .replace(/\s+REFERENCES\s+["\w]+\s*\([^)]+\)(?:\s+ON\s+DELETE\s+(?:CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/gi, '')
    .replace(/\s+CHECK\s*\([^)]*json_valid\([^)]*\)[^)]*\)/gi, '')
}

function normalizeCreateTable(statement) {
  const match = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w]+"?)\s*\(([\s\S]*)\)$/i.exec(statement.trim())
  if (!match) return statement
  const [, tableName, body] = match
  const parts = splitTopLevelComma(body)
    .filter((part) => !/^FOREIGN\s+KEY\b/i.test(part))
    .filter((part) => !/^CHECK\b/i.test(part) || !/json_valid/i.test(part))
    .map(stripInlineReferences)
    .filter(Boolean)
  return `CREATE TABLE IF NOT EXISTS ${tableName} (\n${parts.join(',\n')}\n)`
}

function toPostgresSchemaStatement(statement) {
  let sql = statement.trim()
  if (!sql) return ''
  sql = sql
    .replace(/\bCREATE\s+UNIQUE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
    .replace(/\bCREATE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE INDEX IF NOT EXISTS ')
    .replace(/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/DEFAULT\s*\(\s*strftime\('%Y-%m-%dT%H:%M:%f',\s*'now',\s*'\+9 hours'\)\s*\)/gi, `DEFAULT (${JST_NOW_SQL})`)
    .replace(/DEFAULT\s*\(\s*strftime\('%Y-%m-%dT%H:%M:%fZ',\s*'now'\)\s*\)/gi, `DEFAULT (${UTC_NOW_SQL})`)
    .replace(/DEFAULT\s*\(\s*datetime\('now'\)\s*\)/gi, `DEFAULT (${JST_NOW_SQL})`)
  if (/^CREATE\s+TABLE/i.test(sql)) sql = normalizeCreateTable(sql)
  return sql
}

function convertPlaceholders(sql) {
  let out = ''
  let next = 1
  let quote = null
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]
    if (quote) {
      out += ch
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          out += sql[i + 1]
          i += 1
        } else {
          quote = null
        }
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      out += ch
      continue
    }
    if (ch === '?') {
      let digits = ''
      let j = i + 1
      while (/\d/.test(sql[j] || '')) {
        digits += sql[j]
        j += 1
      }
      if (digits) {
        out += `$${Number(digits)}`
        i = j - 1
      } else {
        out += `$${next}`
        next += 1
      }
      continue
    }
    out += ch
  }
  return out
}

function translateRuntimeSql(input) {
  let sql = convertPlaceholders(input)
  sql = sql
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\s+([\s\S]+?)\s+VALUES\s*(\([^;]+?\))(?!\s+ON\s+CONFLICT)/gi, 'INSERT INTO $1 VALUES $2 ON CONFLICT DO NOTHING')
    .replace(/strftime\('%Y-%m-%dT%H:%M:%f',\s*'now',\s*'\+9 hours'\)/gi, JST_NOW_SQL)
    .replace(/strftime\('%Y-%m-%dT%H:%M:%f'\s*,\s*'now'\s*,\s*'\+9 hours'\)/gi, JST_NOW_SQL)
    .replace(/strftime\('%Y-%m-%dT%H:%M:%fZ'\s*,\s*'now'\)/gi, UTC_NOW_SQL)
    .replace(/datetime\('now'\)/gi, JST_NOW_SQL)
    .replace(/date\('now',\s*'start of month'\)/gi, `to_char(date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo'), 'YYYY-MM-DD"T"HH24:MI:SS.MS')`)
    .replace(/strftime\('%s',\s*'now'\)/gi, 'EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)')
    .replace(/strftime\('%s',\s*([A-Za-z_][\w.]*?)\)/gi, 'EXTRACT(EPOCH FROM ($1)::timestamptz)')
    .replace(/julianday\('now',\s*'\+9 hours'\)\s*-\s*julianday\(([^)]+)\)/gi, "(EXTRACT(EPOCH FROM ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo') - ($1)::timestamp)) / 86400.0)")
    .replace(/julianday\(([^)]+)\)\s*<\s*julianday\(([^)]+)\)/gi, '(($1)::timestamptz < ($2)::timestamptz)')
    .replace(/json_extract\(([^,]+),\s*'\$\.'\s*\|\|\s*(\$\d+)\)/gi, "(COALESCE(NULLIF($1, '')::jsonb, '{}'::jsonb) ->> $2)")
    .replace(/json_extract\(([^,]+),\s*(\$\d+)\)/gi, "(COALESCE(NULLIF($1, '')::jsonb, '{}'::jsonb) #>> string_to_array(regexp_replace($2, '^\\$\\.?', ''), '.'))")
    .replace(/EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+json_each\(([^)]+)\)\s+WHERE\s+value\s*=\s*(\$\d+)\s*\)/gi, "EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(NULLIF($1, '')::jsonb, '[]'::jsonb)) AS j(value) WHERE j.value = $2)")
    .replace(/json_group_array\s*\(\s*json_object\s*\(/gi, 'json_agg(json_build_object(')
  return sql
}

function normalizeParams(params) {
  return params.map((value) => {
    if (value === undefined) return null
    if (typeof value === 'boolean') return value ? 1 : 0
    return value
  })
}

function normalizeRows(rows) {
  return rows.map((row) => {
    const normalized = {}
    for (const [key, value] of Object.entries(row)) {
      if (Array.isArray(value) || (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value))) {
        normalized[key] = JSON.stringify(value)
      } else {
        normalized[key] = value
      }
    }
    return normalized
  })
}

class PostgresD1Statement {
  constructor(sql, params = []) {
    this.sql = sql
    this.params = params
  }

  bind(...params) {
    return new PostgresD1Statement(this.sql, params)
  }

  async all() {
    await ensureSchema()
    const result = await getPool().query(translateRuntimeSql(this.sql), normalizeParams(this.params))
    return { success: true, results: normalizeRows(result.rows), meta: { duration: 0 } }
  }

  async first() {
    const out = await this.all()
    return out.results[0] ?? null
  }

  async run() {
    await ensureSchema()
    const result = await getPool().query(translateRuntimeSql(this.sql), normalizeParams(this.params))
    return {
      success: true,
      meta: {
        duration: 0,
        changes: result.rowCount ?? 0,
        rows_read: 0,
        rows_written: result.rowCount ?? 0,
      },
    }
  }
}

class PostgresD1Database {
  prepare(sql) {
    return new PostgresD1Statement(sql)
  }

  async batch(statements) {
    await ensureSchema()
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      const results = []
      for (const stmt of statements) {
        const result = await client.query(translateRuntimeSql(stmt.sql), normalizeParams(stmt.params || []))
        results.push({
          success: true,
          results: normalizeRows(result.rows),
          meta: { changes: result.rowCount ?? 0, rows_written: result.rowCount ?? 0 },
        })
      }
      await client.query('COMMIT')
      return results
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  }

  async exec(sql) {
    await ensureSchema()
    const results = []
    for (const statement of splitSqlStatements(sql)) {
      results.push(await getPool().query(translateRuntimeSql(statement)))
    }
    return { count: results.length }
  }
}

function createPostgresD1() {
  return new PostgresD1Database()
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (typeof value === 'string') return Buffer.from(value)
  if (value && typeof value.arrayBuffer === 'function') {
    return value.arrayBuffer().then((arrayBuffer) => Buffer.from(arrayBuffer))
  }
  return Buffer.from(value ?? '')
}

class PostgresR2Object {
  constructor(row) {
    this.key = row.key
    this.size = row.size
    this.etag = row.etag
    this.httpMetadata = row.content_type ? { contentType: row.content_type } : {}
    this.customMetadata = row.custom_metadata ? JSON.parse(row.custom_metadata) : {}
    this.body = new Blob([row.body]).stream()
  }

  async arrayBuffer() {
    return this.body ? new Response(this.body).arrayBuffer() : new ArrayBuffer(0)
  }
}

class PostgresR2Bucket {
  async put(key, value, options = {}) {
    await ensureSchema()
    const body = await toBuffer(value)
    const etag = crypto.createHash('sha256').update(body).digest('hex')
    const contentType = options?.httpMetadata?.contentType ?? null
    const customMetadata = options?.customMetadata ? JSON.stringify(options.customMetadata) : null
    await getPool().query(
      `INSERT INTO ${OBJECTS_TABLE} (key, body, size, etag, content_type, custom_metadata, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${JST_NOW_SQL})
       ON CONFLICT (key) DO UPDATE
       SET body = EXCLUDED.body,
           size = EXCLUDED.size,
           etag = EXCLUDED.etag,
           content_type = EXCLUDED.content_type,
           custom_metadata = EXCLUDED.custom_metadata,
           uploaded_at = EXCLUDED.uploaded_at`,
      [key, body, body.byteLength, etag, contentType, customMetadata],
    )
    return { key, etag, size: body.byteLength }
  }

  async get(key) {
    await ensureSchema()
    const result = await getPool().query(
      `SELECT key, body, size, etag, content_type, custom_metadata
       FROM ${OBJECTS_TABLE}
       WHERE key = $1`,
      [key],
    )
    const row = result.rows[0]
    return row ? new PostgresR2Object(row) : null
  }

  async delete(key) {
    await ensureSchema()
    await getPool().query(`DELETE FROM ${OBJECTS_TABLE} WHERE key = $1`, [key])
  }
}

function createPostgresR2Bucket() {
  return new PostgresR2Bucket()
}

module.exports = {
  SCHEMA_NAME,
  OBJECTS_TABLE,
  createPostgresD1,
  createPostgresR2Bucket,
  ensureSchema,
  splitSqlStatements,
  toPostgresSchemaStatement,
  translateRuntimeSql,
}
