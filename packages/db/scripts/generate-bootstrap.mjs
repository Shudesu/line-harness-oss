import Database from "better-sqlite3";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(SCRIPT_DIR, "..");
const SCHEMA_PATH = join(PKG_ROOT, "schema.sql");
const MIGRATIONS_DIR = join(PKG_ROOT, "migrations");
const BOOTSTRAP_PATH = join(PKG_ROOT, "bootstrap.sql");
const BOOTSTRAP_META_PATH = join(PKG_ROOT, "bootstrap-meta.json");

const BENIGN_SQLITE_ERROR = /duplicate column name|already exists/i;

function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function isBenignSqliteError(error) {
  return error instanceof Error && BENIGN_SQLITE_ERROR.test(error.message);
}

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function applyMigrationFile(db, fileName) {
  const sql = readFileSync(join(MIGRATIONS_DIR, fileName), "utf8");
  for (const statement of splitSqlStatements(sql)) {
    try {
      db.exec(statement);
    } catch (error) {
      if (!isBenignSqliteError(error)) {
        throw new Error(`${fileName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

/**
 * sqlite_master が返す DDL は素の `CREATE TABLE ...` / `CREATE INDEX ...` で、
 * 既存 DB に流すと 1 文目の "table already exists" でファイル全体が失敗する。
 * セットアップのリトライ時 (D1 が既に存在するケース) にも bootstrap.sql を
 * そのまま適用できるよう、書き出し時に IF NOT EXISTS を差し込む。
 */
function makeIdempotent(sql) {
  return sql.replace(
    /^CREATE\s+(TABLE|VIEW|TRIGGER|(?:UNIQUE\s+)?INDEX)\s+(?!IF\s+NOT\s+EXISTS\b)/i,
    (_match, kind) => `CREATE ${kind.replace(/\s+/g, " ")} IF NOT EXISTS `,
  );
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * bootstrap.sql は sqlite_master だけでは seed data を保持できない。
 * 新規インストールでも migration と同じ組み込み自動返信を利用できるよう、
 * builtin ID の auto_replies だけを決定的な順序で書き出す。
 */
function buildBuiltinAutoReplySeeds(db) {
  const rows = db
    .prepare(
      `SELECT id, keyword, match_type, response_type, response_content,
              template_id, line_account_id, is_active, created_at
         FROM auto_replies
        WHERE id LIKE 'builtin-%'
        ORDER BY id`,
    )
    .all();
  if (rows.length === 0) return "";

  const columns = [
    "id",
    "keyword",
    "match_type",
    "response_type",
    "response_content",
    "template_id",
    "line_account_id",
    "is_active",
    "created_at",
  ];
  return rows
    .map((row) => {
      const values = columns.map((column) => sqlLiteral(row[column])).join(", ");
      return `INSERT OR IGNORE INTO auto_replies (${columns.join(", ")})\nVALUES (${values});`;
    })
    .join("\n\n");
}

function buildBootstrapSql() {
  const sqlitePath = join(
    tmpdir(),
    `line-harness-bootstrap-${process.pid}-${Date.now()}.sqlite`,
  );
  const db = new Database(sqlitePath);
  const migrationFiles = listMigrationFiles();

  try {
    db.exec(readFileSync(SCHEMA_PATH, "utf8"));

    for (const file of migrationFiles) {
      applyMigrationFile(db, file);
    }

    const rows = db
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
      .all();

    const header = [
      "-- Generated from schema.sql + migrations by scripts/generate-bootstrap.mjs.",
      "-- Do not edit manually. Run `pnpm --dir packages/db generate:bootstrap`.",
      "",
    ].join("\n");

    const body = rows
      .map((row) => `${makeIdempotent(String(row.sql).trim())};`)
      .join("\n\n");
    const builtinSeeds = buildBuiltinAutoReplySeeds(db);

    return {
      sql: `${header}${body}${builtinSeeds ? `\n\n${builtinSeeds}` : ""}\n`,
      meta: {
        includedMigrations: migrationFiles,
        migrationCount: migrationFiles.length,
      },
    };
  } finally {
    db.close();
    if (existsSync(sqlitePath)) {
      rmSync(sqlitePath, { force: true });
    }
  }
}

const generated = buildBootstrapSql();
const wantsStdout = process.argv.includes("--stdout");
const wantsCheck = process.argv.includes("--check");

if (wantsStdout) {
  process.stdout.write(generated.sql);
  process.exit(0);
}

if (wantsCheck) {
  const current = existsSync(BOOTSTRAP_PATH)
    ? readFileSync(BOOTSTRAP_PATH, "utf8")
    : "";
  const currentMeta = existsSync(BOOTSTRAP_META_PATH)
    ? readFileSync(BOOTSTRAP_META_PATH, "utf8")
    : "";
  const nextMeta = `${JSON.stringify(generated.meta, null, 2)}\n`;
  if (current !== generated.sql || currentMeta !== nextMeta) {
    console.error(
      "bootstrap.sql or bootstrap-meta.json is out of date. Run `pnpm --dir packages/db generate:bootstrap`.",
    );
    process.exit(1);
  }
  process.exit(0);
}

writeFileSync(BOOTSTRAP_PATH, generated.sql);
writeFileSync(BOOTSTRAP_META_PATH, `${JSON.stringify(generated.meta, null, 2)}\n`);
