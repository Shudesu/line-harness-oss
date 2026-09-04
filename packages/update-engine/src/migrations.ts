import { createHash } from 'node:crypto';
import type { CfApiCreds } from './types.js';
import { executeD1Query } from './cf-api/d1.js';
import { isBenignSchemaErrorText } from './materialize.js';

const MIGRATION_STATE_TABLE = '_line_harness_migrations';

type D1Executor = typeof executeD1Query;

/**
 * Additive-only ポリシーのカットオフ。scripts/check-migrations.ts は
 * この定数を import して単一ソースにしている (リポ専用スクリプト → published
 * パッケージ方向の依存なので成立する。逆方向は不可)。
 *
 * これ未満の migration のうち**破壊的なもの (027/029 — DROP TABLE /
 * ALTER TABLE ... RENAME TO を含むテーブル再構築)** は、安全スプリッタが
 * 拒否するし、仮に通しても live DB での再実行は安全ではない。adoption
 * (adoptGrandfathered) では、実 DB がその再構築後の形を持つことをセンチネルで
 * 確認した上で、実行せず台帳へ「適用済み」と記録するだけにする (adopt-stamp)。
 * 破壊的でない pre-041 (030-040 等の additive DDL) は従来どおり実行する —
 * migration 027 より前から存在する旧 CLI インストールには 030-040 が本当に
 * 未適用の DB があり得るため、一律 stamp すると静かなスキーマ欠落を作る。
 *
 * これが無いと、未スタンプ (0.0.0-dev) 環境の adoption が bundle 内の
 * 027/029 の検証で必ず throw し、v0.23.x へ一切更新できない
 * (2026-09-02 に OSS 利用者報告で発覚)。
 */
export const GRANDFATHERED_CUTOFF_PREFIX = '041';

/** 数字3桁プレフィックスがカットオフ未満の grandfathered migration か。 */
export function isGrandfatheredMigration(name: string): boolean {
  const prefix = name.slice(0, 3);
  return /^\d{3}$/.test(prefix) && prefix < GRANDFATHERED_CUTOFF_PREFIX;
}

/**
 * 破壊的スキーマ変更 (DROP TABLE/COLUMN, RENAME TO/COLUMN) を含むか。
 * splitSqlStatements の拒否条件と同一定義 — adopt-stamp の対象判定と
 * スプリッタのガードがずれないよう、双方がこの関数を使う。
 */
export function containsDestructiveSchemaChanges(sql: string): boolean {
  const uncommented = stripSqlComments(sql);
  return (
    /\bDROP\s+(?:TABLE|COLUMN)\b/i.test(uncommented) ||
    /\bRENAME\s+(?:TO|COLUMN)\b/i.test(uncommented)
  );
}

export interface MigrationApplyResult {
  name: string;
  alreadyApplied: boolean;
  executedStatements: number;
  skippedStatements: number;
  /**
   * true = 破壊的な grandfathered migration のため SQL は実行せず台帳に
   * 記録だけした (センチネル probe で適用済み構造を確認済み。
   * GRANDFATHERED_CUTOFF_PREFIX 参照)。
   */
  adopted?: boolean;
}

export interface ApplyD1MigrationsOptions {
  creds: CfApiCreds;
  databaseId: string;
  names: string[];
  migrations: Map<string, Buffer>;
  onMigrationStart?: (name: string) => void | Promise<void>;
  onMigrationDone?: (result: MigrationApplyResult) => void | Promise<void>;
  /**
   * adoption (未スタンプ環境の全 replay) 専用オプトイン。true のとき、
   * 「grandfathered (GRANDFATHERED_CUTOFF_PREFIX 未満) かつ破壊的」な
   * migration (027/029) だけを実行せず台帳へ記録のみ行う (adopt-stamp)。
   * 破壊的でない pre-041 は従来どおり実行する (旧インストールへの additive
   * ブリッジを保つ)。記録の前に実 DB が再構築後のスキーマを本当に持っているか
   * センチネル probe で確認し、持っていなければ台帳に一切書かず明示エラーで
   * 停止する — 旧 CLI 期 (migration 027 以前) の取り残しインストールに
   * 存在しないスキーマを「適用済み」と偽記録しないため。
   * false (既定) では従来どおり: 破壊的 migration が混ざっていれば検証段階で
   * 停止する (通常の差分更新に現れるのは異常なので loud に落とす)。
   */
  adoptGrandfathered?: boolean;
  /** Test seam. Production callers use the Cloudflare D1 HTTP API. */
  execute?: D1Executor;
}

/**
 * Split a SQLite migration into individual statements.
 *
 * D1 executes a multi-statement SQL string atomically. That is unsafe for
 * legacy L Harness installs: one duplicate ALTER TABLE rolls back later
 * statements in the same file. This scanner splits only on semicolons that
 * are outside strings, quoted identifiers, and comments.
 *
 * Current L Harness migrations intentionally do not use CREATE TRIGGER
 * bodies (whose internal BEGIN/END semicolons need a full SQLite parser).
 * Fail loudly if one appears so a future release cannot silently split it
 * incorrectly.
 */
export function splitSqlStatements(sql: string): string[] {
  const uncommented = stripSqlComments(sql);
  if (/\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i.test(uncommented)) {
    throw new Error('CREATE TRIGGER migrations are not supported by the safe D1 splitter');
  }
  if (containsDestructiveSchemaChanges(sql)) {
    throw new Error('destructive schema changes are not supported by safe D1 updates');
  }

  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | '`' | ']' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      if (ch === '\n' || ch === '\r') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      const closing = quote;
      if (ch === closing) {
        // SQLite escapes quote characters by doubling them.
        if (next === closing && closing !== ']') {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (ch === '-' && next === '-') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '[') {
      quote = ']';
      continue;
    }
    if (ch === ';') {
      pushSqlStatement(statements, sql.slice(start, i));
      start = i + 1;
    }
  }

  if (quote || blockComment) {
    throw new Error('migration contains an unterminated SQL quote or block comment');
  }
  pushSqlStatement(statements, sql.slice(start));
  return statements;
}

/**
 * Apply cumulative release migrations safely across fresh, fully-applied,
 * and partially-applied databases.
 *
 * Each statement is its own D1 request. Duplicate schema-object errors are
 * skipped at statement granularity, so a duplicate first ALTER no longer
 * prevents later ALTERs in the same file from running. A checksum ledger is
 * written only after every statement succeeds or is confirmed benign; later
 * releases can then skip the immutable migration without replaying its DML.
 *
 * 例外: adoptGrandfathered 時の「grandfathered かつ破壊的」な migration
 * (027/029) は文単位の修復対象ではなく、センチネル probe で適用済みを確認の上
 * 記録のみ行う (adopt-stamp — options の doc 参照)。
 */
export async function applyD1Migrations(
  opts: ApplyD1MigrationsOptions,
): Promise<MigrationApplyResult[]> {
  const execute = opts.execute ?? executeD1Query;
  const base = { creds: opts.creds, databaseId: opts.databaseId };

  const adoptGrandfathered = opts.adoptGrandfathered === true;

  // Validate the whole manifest before touching D1. A malformed release must
  // fail without leaving even the migration ledger behind.
  // adoption 時のみ、「grandfathered かつ破壊的」な migration (027/029) は
  // 実行しない (adopt-stamp) ので splitSqlStatements の破壊的変更ガードには
  // かけない — かけると DROP/RENAME でここが throw し、全 migration を replay
  // する adoption 経路が常に失敗する。破壊的でない pre-041 は通常どおり検証・
  // 実行する (旧インストールへの additive ブリッジ)。フラグなしの通常更新は
  // 従来どおり検証で loud に落とす。
  const parsedStatements = new Map<string, string[]>();
  const adoptable = new Set<string>();
  for (const name of opts.names) {
    if (!opts.migrations.has(name)) {
      throw new Error(`migration ${name} missing in bundle`);
    }
    const sql = (opts.migrations.get(name) as Buffer).toString('utf8');
    if (
      adoptGrandfathered &&
      isGrandfatheredMigration(name) &&
      containsDestructiveSchemaChanges(sql)
    ) {
      adoptable.add(name);
      continue;
    }
    parsedStatements.set(name, splitSqlStatements(sql));
  }
  if (opts.names.length === 0) return [];

  // Associate ledger initialization failures with the first migration in
  // progress output. Older callers/tests expect a migration:running event
  // before any D1-side failure is surfaced.
  await opts.onMigrationStart?.(opts.names[0]);
  await execute({
    ...base,
    sql:
      `CREATE TABLE IF NOT EXISTS ${MIGRATION_STATE_TABLE} (` +
      'name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)',
  });

  const results: MigrationApplyResult[] = [];
  let schemaProbeDone = false;
  for (let migrationIndex = 0; migrationIndex < opts.names.length; migrationIndex += 1) {
    const name = opts.names[migrationIndex];
    const source = opts.migrations.get(name) as Buffer;

    if (migrationIndex > 0) await opts.onMigrationStart?.(name);
    const checksum = `sha256:${createHash('sha256').update(source).digest('hex')}`;
    const recorded = await execute({
      ...base,
      sql: `SELECT checksum FROM ${MIGRATION_STATE_TABLE} WHERE name = ?`,
      params: [name],
    });
    const priorChecksum = firstResultValue(recorded, 'checksum');
    if (typeof priorChecksum === 'string') {
      // adopt-stamp 対象は checksum 不一致でもブロックしない: このエンジンは
      // 中身を一度も実行しない (記録のみ) ので、ファイル差分は挙動に影響しない。
      // ただし fork 検知の材料にはなるので黙殺せず warn は残す。それ以外は
      // 従来どおり「適用後に書き換わった migration」は事故なので停止する。
      if (priorChecksum !== checksum) {
        if (!adoptable.has(name)) {
          throw new Error(
            `migration ${name} changed after it was applied (${priorChecksum} != ${checksum})`,
          );
        }
        console.warn(
          `migration ${name}: recorded checksum differs from bundle (never executed by this engine — continuing)`,
        );
      }
      const result: MigrationApplyResult = {
        name,
        alreadyApplied: true,
        executedStatements: 0,
        skippedStatements: 0,
      };
      results.push(result);
      await opts.onMigrationDone?.(result);
      continue;
    }

    if (adoptable.has(name)) {
      // 初回の stamp 前に、実 DB が破壊的 migration (027/029) 適用後の形を
      // 本当に持っているか確認する。持っていない DB (migration 027 以前の
      // 取り残しインストール) に「適用済み」と偽記録すると、以後のリトライが
      // alreadyApplied で素通りして自己修復不能になるため、台帳に書く前に
      // 明示エラーで止める。
      if (!schemaProbeDone) {
        await assertAdoptableSchemaPresent(execute, base);
        schemaProbeDone = true;
      }
      // 実行せず台帳に記録だけ (adopt-stamp)。GRANDFATHERED_CUTOFF_PREFIX 参照。
      await execute({
        ...base,
        sql:
          `INSERT INTO ${MIGRATION_STATE_TABLE} (name, checksum, applied_at) ` +
          "VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        params: [name, checksum],
      });
      const result: MigrationApplyResult = {
        name,
        alreadyApplied: false,
        executedStatements: 0,
        skippedStatements: 0,
        adopted: true,
      };
      results.push(result);
      await opts.onMigrationDone?.(result);
      continue;
    }

    const statements = parsedStatements.get(name) as string[];
    let executedStatements = 0;
    let skippedStatements = 0;
    for (let index = 0; index < statements.length; index += 1) {
      try {
        await execute({ ...base, sql: statements[index] });
        executedStatements += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isBenignSchemaErrorText(message)) {
          skippedStatements += 1;
          continue;
        }
        throw new Error(
          `migration ${name} statement ${index + 1}/${statements.length} failed: ${message}`,
          { cause: error },
        );
      }
    }

    await execute({
      ...base,
      sql:
        `INSERT INTO ${MIGRATION_STATE_TABLE} (name, checksum, applied_at) ` +
        "VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
      params: [name, checksum],
    });
    const result: MigrationApplyResult = {
      name,
      alreadyApplied: false,
      executedStatements,
      skippedStatements,
    };
    results.push(result);
    await opts.onMigrationDone?.(result);
  }
  return results;
}

/**
 * adopt-stamp の前提検証。破壊的 migration 027/029 が適用済みであることを
 * 実 DB のセンチネルで確認する:
 *   - line_accounts テーブル …… bootstrap 済みか (無ければそもそも空 DB)
 *   - friend_scenarios の CHECK に 'delivering' …… 027 の再構築後の形
 *   - line_accounts.display_order 列 …… 029 が追加した列
 * 1つでも欠けていれば、その DB は破壊的 migration より古い時代の取り残しで、
 * stamp すると存在しないスキーマを「適用済み」と偽記録することになるため、
 * 台帳に書く前に明示エラーで停止する (手動移行が必要)。
 */
async function assertAdoptableSchemaPresent(
  execute: D1Executor,
  base: { creds: CfApiCreds; databaseId: string },
): Promise<void> {
  const res = await execute({
    ...base,
    sql:
      'SELECT ' +
      "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='line_accounts') AS bootstrapped, " +
      "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='friend_scenarios' AND sql LIKE '%delivering%') AS m027, " +
      "(SELECT COUNT(*) FROM pragma_table_info('line_accounts') WHERE name='display_order') AS m029",
  });
  const first = res.result?.[0];
  const rows = first && typeof first === 'object' ? (first as { results?: unknown[] }).results : undefined;
  const row = (Array.isArray(rows) ? rows[0] : undefined) as
    | { bootstrapped?: number; m027?: number; m029?: number }
    | undefined;

  const missing: string[] = [];
  if (!row || !Number(row.bootstrapped)) {
    missing.push('line_accounts (DB が bootstrap されていません)');
  } else {
    if (!Number(row.m027)) missing.push("friend_scenarios の 'delivering' status (migration 027)");
    if (!Number(row.m029)) missing.push('line_accounts.display_order (migration 029)');
  }
  if (missing.length > 0) {
    throw new Error(
      'adoption を中止しました: データベースのスキーマが旧世代 migration の適用前の形です ' +
        `(不足: ${missing.join(' / ')})。この世代のテーブル再構築は自動では再実行できないため、` +
        '手動での更新が必要です: https://github.com/Shudesu/line-harness-oss/blob/main/docs/wiki/26-Manual-Update.md',
    );
  }
}

function pushSqlStatement(statements: string[], candidate: string): void {
  const trimmed = candidate.trim();
  if (trimmed && stripSqlComments(trimmed).trim()) statements.push(trimmed);
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function firstResultValue(
  response: { result: any[] },
  key: string,
): unknown {
  const first = response.result?.[0];
  const rows = first && typeof first === 'object' ? first.results : undefined;
  return Array.isArray(rows) && rows.length > 0 ? rows[0]?.[key] : undefined;
}
