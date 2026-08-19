import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

// =============================================================================
// created_at / updated_at の DEFAULT 式ドリフト検知
// =============================================================================
//
// このリポジトリのタイムスタンプ列は JST ISO-8601（ミリ秒付き）で保存する規約。
// 一方 SQLite の datetime('now') は「UTC・スペース区切り・ミリ秒なし」を返すため、
// 両者が混ざると文字列比較の順序・境界判定が壊れる。
// （実際に一度踏んでいる: src/affiliate-report.ts の "Task 4 boundary-bug lesson"
//   コメント参照。あちらは julianday() で読み側を防御している。）
//
// ドリフトが起きる典型は「テーブル再構築マイグレーション」で、schema.sql 側の
// 宣言と食い違っても replay 後は後勝ちで気付けない。実例として
// 029_account_management_v2.sql が broadcasts を datetime('now') で作り直している。
//
// そこで replay 後の *実効 DDL* を PRAGMA table_info で読み、DEFAULT 式が
// 正準形か既知の例外かを検査する。PRAGMA を使うのは、空白や改行の差で
// 誤検知しない正規化済みの値が得られるため。

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');
const BOOTSTRAP_PATH = join(PKG_ROOT, 'bootstrap.sql');

const BENIGN_SQLITE_ERROR = /duplicate column name|already exists/i;

/** 全テーブル共通の正準 DEFAULT 式（JST ISO-8601, ミリ秒付き）。 */
const CANONICAL_JST_DEFAULT = "strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')";

/** UTC を返す非正準式。 */
const UTC_DEFAULT = "datetime('now')";

// 既知の UTC DEFAULT。SQLite は DEFAULT の変更にテーブル再構築を要するため、
// 「現時点で DEFAULT が発火していない（INSERT が created_at を明示している）」
// 列については、既存テーブルの作り直しを避けて現状を追認している。
//
// このリストは ratchet として機能する:
//   * 新しく UTC DEFAULT の列が増えたらテストが落ちる（＝ドリフトの新規流入を止める）
//   * 逆にここの列を正準形へ直したら、リストから消すまでテストが落ちる
//
// 追加する場合は「なぜ DEFAULT が発火しないか」を必ず確認すること。
// DEFAULT に依存する INSERT を書くなら、ここに足すのではなく jstNow() を明示バインドする。
const KNOWN_UTC_DEFAULTS = new Set([
  'broadcasts.created_at',
  'entry_routes.created_at',
  'entry_routes.updated_at',
  'form_submissions.created_at',
  'forms.created_at',
  'forms.updated_at',
  'media_inquiries.created_at',
  'media_inquiries.updated_at',
  'message_templates.created_at',
  'message_templates.updated_at',
  'pool_accounts.created_at',
  'ref_tracking.created_at',
  'tracked_links.created_at',
  'tracked_links.updated_at',
  'webinar_funnel_events.created_at',
]);

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

/** `table.column` -> DEFAULT 式（DEFAULT 無しの列は含めない）。 */
function collectTimestampDefaults(db: Database.Database): Map<string, string> {
  const found = new Map<string, string>();
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    )
    .all() as Array<{ name: string }>;

  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{
      name: string;
      dflt_value: string | null;
    }>;
    for (const column of columns) {
      if (column.name !== 'created_at' && column.name !== 'updated_at') continue;
      if (column.dflt_value === null) continue;
      found.set(`${name}.${column.name}`, column.dflt_value);
    }
  }
  return found;
}

function replayedDefaults(): Map<string, string> {
  const db = new Database(':memory:');
  try {
    applyMigrationReplay(db);
    return collectTimestampDefaults(db);
  } finally {
    db.close();
  }
}

describe('created_at / updated_at DEFAULT expressions', () => {
  it('uses the canonical JST expression except for known UTC columns', () => {
    const defaults = replayedDefaults();
    expect(defaults.size).toBeGreaterThan(0);

    const offenders = [...defaults]
      .filter(([key, expr]) => expr !== CANONICAL_JST_DEFAULT && !KNOWN_UTC_DEFAULTS.has(key))
      .map(([key, expr]) => `${key} => ${expr}`);

    expect(offenders).toEqual([]);
  });

  // KNOWN_UTC_DEFAULTS が現実とズレたら落とす。片方向の抑制リストにすると
  // 直したあともリストが残り、次のドリフトを隠してしまうため。
  it('keeps KNOWN_UTC_DEFAULTS exactly in sync with reality', () => {
    const defaults = replayedDefaults();
    const actualUtc = [...defaults]
      .filter(([, expr]) => expr === UTC_DEFAULT)
      .map(([key]) => key)
      .sort();

    expect(actualUtc).toEqual([...KNOWN_UTC_DEFAULTS].sort());
  });

  // 新規インストールは bootstrap.sql から作られるので、replay と一致していないと
  // 「移行済み DB と新規 DB でタイムスタンプ形式が違う」事故になる。
  it('bootstrap.sql agrees with the migration replay', () => {
    const bootstrapDb = new Database(':memory:');
    try {
      bootstrapDb.exec(readFileSync(BOOTSTRAP_PATH, 'utf8'));
      const fromBootstrap = collectTimestampDefaults(bootstrapDb);
      expect(Object.fromEntries([...fromBootstrap].sort())).toEqual(
        Object.fromEntries([...replayedDefaults()].sort()),
      );
    } finally {
      bootstrapDb.close();
    }
  });
});
