import * as p from "@clack/prompts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { applyD1Migrations, type ApplyD1MigrationsOptions } from "@line-harness/update-engine";
import { wrangler, WranglerError } from "../lib/wrangler.js";

interface DatabaseResult {
  databaseId: string;
  databaseName: string;
}

interface BootstrapMeta {
  includedMigrations: string[];
  migrationCount: number;
}

interface DatabaseOptions {
  accountId?: string;
  /** Capability of the Worker that setup is actually about to deploy. */
  legacyMileageProjectionVersion?: 1;
}

/**
 * Source builds declare their capability in the first non-comment statement.
 * Do not import/evaluate the checkout, or mistake a comment/string elsewhere
 * in an old Worker for evidence that it can consume held historical activity.
 */
export function readSourceLegacyMileageProjectionVersion(repoDir: string): 1 | undefined {
  const file = join(repoDir, "packages/db/src/mileage.ts");
  if (!existsSync(file)) return undefined;
  const source = readFileSync(file, "utf8").replace(/^(?:\s|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/, "");
  return /^export\s+const\s+LEGACY_MILEAGE_PROJECTION_VERSION\s*=\s*1\s*;/.test(source)
    ? 1 : undefined;
}

/** Wrangler has no bind flag. Encode values, then replace only SQL tokens. */
function bindMigrationParameters(sql: string, params: unknown[]): string {
  let index = 0;
  const bound = sql.replace(
    /'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\/|\?\d*/g,
    (token) => {
      if (!token.startsWith("?")) return token;
      if (token !== "?" || index >= params.length) {
        throw new Error("Unsupported or missing D1 migration parameter");
      }
      const value = params[index++];
      if (value === null) return "NULL";
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      if (typeof value === "string") {
        // Hex also preserves embedded NULs without passing them in argv.
        return `CAST(X'${Buffer.from(value, "utf8").toString("hex")}' AS TEXT)`;
      }
      throw new Error("Unsupported D1 migration parameter type");
    },
  );
  if (index !== params.length) throw new Error("Unexpected D1 migration parameters");
  return bound;
}

/**
 * Reuse setup's authenticated, account-pinned Wrangler session. --command
 * sends the adapter's whole atomic unit to D1 /query in one request; do not
 * split it into individually committed commands or send it via --file.
 * wrangler() uses an execa argument array, never shell interpolation.
 */
export function createSetupD1Executor(databaseName: string): NonNullable<ApplyD1MigrationsOptions["execute"]> {
  return async ({ sql, params = [] }) => {
    const output = await runD1WithRetry(
      ["d1", "execute", databaseName, "--remote", "--json", "--command", bindMigrationParameters(sql, params)],
      "マイレージ migration 適用",
    );
    let result: unknown;
    try { result = JSON.parse(output); } catch {
      throw new Error("D1 migration query did not return valid JSON results");
    }
    if (!Array.isArray(result) || result.length === 0 || result.some(
      (item) => item?.success !== true || !Array.isArray(item.results),
    )) {
      throw new Error("D1 migration query returned an unsuccessful SQL result");
    }
    return { success: true, result };
  };
}

/**
 * A resumed setup may skip migrations after changing its source/release target.
 * Check the actual DB handoff before any Worker deployment or config sync;
 * migration checksums alone do not prove that the new target can finish it.
 */
export async function assertSetupMileageHandoffCompatible(
  options: DatabaseOptions & DatabaseResult,
): Promise<void> {
  if (options.legacyMileageProjectionVersion === 1) return;
  if (!options.databaseName || !options.databaseId) {
    throw new Error("Cannot verify historical mileage handoff: saved D1 database information is missing.");
  }
  const execute = createSetupD1Executor(options.databaseName);
  const base = {
    creds: { accountId: options.accountId ?? "", apiToken: "" },
    databaseId: options.databaseId,
  };
  const tables = await execute({ ...base, sql: `SELECT
    (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_line_harness_legacy_mileage_claims') AS claims_table,
    (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'mileage_event_queue') AS queue_table` });
  const schema = tables.result[0].results[0];
  if (![0, 1].includes(schema?.claims_table) || ![0, 1].includes(schema?.queue_table)) {
    throw new Error("Cannot verify historical mileage handoff state; Worker deployment was stopped.");
  }
  if (schema.claims_table === 0) return;
  const pending = await execute({ ...base, sql: schema.queue_table === 1
    ? `SELECT EXISTS(SELECT 1 FROM _line_harness_legacy_mileage_claims claim
        LEFT JOIN mileage_event_queue queue ON queue.engagement_event_id = claim.engagement_event_id
        WHERE queue.status IS NOT 'processed') AS unresolved`
    : "SELECT EXISTS(SELECT 1 FROM _line_harness_legacy_mileage_claims) AS unresolved" });
  const unresolved = pending.result[0].results[0]?.unresolved;
  if (unresolved !== 0 && unresolved !== 1) {
    throw new Error("Cannot verify whether historical mileage handoff is complete; Worker deployment was stopped.");
  }
  if (unresolved === 1) {
    throw new Error(
      "Historical mileage is still awaiting a compatible Worker (legacy_mileage_projection_version=1). " +
      "Resume setup with a compatible release or source checkout; Worker deployment was stopped and held claims were preserved.",
    );
  }
}

async function applySetupMigration(
  databaseName: string,
  databaseId: string,
  migrationsDir: string,
  file: string,
  options: DatabaseOptions,
): Promise<void> {
  const filePath = join(migrationsDir, file);
  if (/^(?:062|063)_/.test(file)) {
    // Never pass the immutable historical financial INSERTs to applySqlFile,
    // including its file-level first attempt or statement-level retry path.
    await applyD1Migrations({
      // The supplied executor owns authentication; no API token is required.
      creds: { accountId: options.accountId ?? "", apiToken: "" },
      databaseId,
      names: [file],
      migrations: new Map([[file, readFileSync(filePath)]]),
      legacyMileageProjectionVersion: options.legacyMileageProjectionVersion,
      execute: createSetupD1Executor(databaseName),
    });
    return;
  }
  await applySqlFile(databaseName, filePath, `migration 適用: ${file}`);
}

const TRANSIENT_D1_ERROR = /code[:\s]*10043|cloudflarestatus|temporarily unavailable|internal error|timed out|timeout|fetch failed|network|connection reset/i;
const D1_RETRY_ATTEMPTS = 3;

function isTransientD1Error(err: unknown): boolean {
  if (!(err instanceof WranglerError)) return false;
  const text = `${err.message}\n${err.stderr}`;
  return TRANSIENT_D1_ERROR.test(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runD1WithRetry(
  args: string[],
  contextLabel: string,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= D1_RETRY_ATTEMPTS; attempt++) {
    try {
      return await wrangler(args);
    } catch (err) {
      lastErr = err;
      if (!isTransientD1Error(err) || attempt === D1_RETRY_ATTEMPTS) {
        throw err;
      }
      p.log.warn(
        `${contextLabel}: Cloudflare D1 の一時エラーのため再試行します (${attempt}/${D1_RETRY_ATTEMPTS})...`,
      );
      await sleep(attempt * 2_000);
    }
  }
  throw lastErr;
}

const isBenignSchemaError = (err: unknown): boolean => {
  if (!(err instanceof WranglerError)) return false;
  const text = `${err.message}\n${err.stderr}`.toLowerCase();
  return (
    text.includes("duplicate column") ||
    text.includes("already exists") ||
    text.includes("table") && text.includes("already")
  );
};

/**
 * 行末セミコロン + 改行で SQL を文に割る。packages/db/scripts/generate-bootstrap.mjs
 * と同じ分割規則。文字列リテラル内に「セミコロン + 改行」を含む SQL は誤分割される
 * ため、seed を追加するときはリテラルを 1 行に収めること (現在の bootstrap.sql の
 * INSERT は 1 行で、この条件を満たす)。
 */
function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * 文の種類を判定するために先頭の行コメントを落とす。migration ファイルは各文の前に
 * 意図を `--` で書いているので、これを剥がさないと文の頭が SQL キーワードにならない。
 */
function stripLeadingComments(statement: string): string {
  return statement.replace(/^(?:\s*--[^\n]*\n)+/, "").trim();
}

/**
 * 文単位フォールバックで絶対に流してはいけない文。
 *
 * 027/029 はテーブルを作り直す migration で、CREATE TABLE ..._new → INSERT SELECT →
 * DROP TABLE → RENAME という形をとる。これを既存 DB で再実行すると、その migration
 * 時点の列しかコピーされないため、後続 migration が足した列 (broadcasts の
 * dedup_progress / batch_lock_at / track_links など) と実データが消し飛ぶ。
 * ファイル一括で流す通常経路では 1 文目の duplicate column で全体がロールバック
 * されるので害が出ないが、文単位に割るとそれが素通りしてしまう。
 */
const DESTRUCTIVE_STATEMENT =
  /\b(?:DROP\s+TABLE|DELETE\s+FROM|ALTER\s+TABLE\s+\S+\s+RENAME)\b|^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)/i;

/**
 * 何度流しても結果が変わらない「足すだけ」の文。フォールバックの主目的である
 * 欠けた列・テーブル・index の補完がこれに当たる。CTE 付きの `WITH ... INSERT OR
 * IGNORE` も 062 の backfill で使われているので含める。
 */
const IDEMPOTENT_STATEMENT =
  /^(?:ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\b|CREATE\s+(?:TABLE|VIEW|TRIGGER|(?:UNIQUE\s+)?INDEX)\s+IF\s+NOT\s+EXISTS\b|(?:WITH\b[\s\S]*?)?INSERT\s+OR\s+IGNORE\s+INTO\b)/i;

/** ADD COLUMN の直後に置かれる「新しい列を既存行に埋める」タイプの backfill。 */
const BACKFILL_UPDATE = /^UPDATE\s+\S+\s+SET\b/i;

/**
 * SQL ファイルを D1 に適用する。
 *
 * `wrangler d1 execute --file` はファイル内の全ステートメントを 1 バッチとして送る
 * ため、1 文でも失敗するとファイル全体がロールバックされる。既存 DB への再適用では
 * 「既にある列/テーブル」に当たるのが普通なので、それだけで同一ファイル内の他の DDL
 * まで巻き添えで失われる。実際 issue #294 はこれで、046 が duplicate column で落ちた
 * 結果 tracked_links.line_account_id が付かず、050 が "no such column" で停止していた。
 *
 * そこでファイル単位で失敗し、かつ内容が benign (既存重複) なら、文単位に割り直して
 * IDEMPOTENT_STATEMENT に当たるものだけを流す。欠けていた列・テーブル・index は
 * 埋まり、データ移行を伴う文は触らない。正常系は従来どおりファイル 1 回で終わるので、
 * 往復が増えるのは修復が要る DB のときだけ。
 */
async function applySqlFile(
  databaseName: string,
  filePath: string,
  contextLabel: string,
): Promise<void> {
  try {
    await runD1WithRetry(
      ["d1", "execute", databaseName, "--remote", "--file", filePath],
      contextLabel,
    );
    return;
  } catch (err) {
    if (!isBenignSchemaError(err)) throw err;
  }

  let skipped = 0;
  // このファイルで実際に列を足したか。足していれば、それを埋める backfill UPDATE も
  // 流す必要がある (050 の dedup_key など)。逆に列が既にあった = backfill も適用済み
  // なので、UPDATE を流し直すと 029 のように既存の値を上書きしてしまう。
  let addedColumn = false;
  for (const statement of splitSqlStatements(readFileSync(filePath, "utf8"))) {
    const head = stripLeadingComments(statement);
    // 末尾のコメントブロックだけが 1 文として切り出されることがある。実行対象でも
    // 取りこぼしでもないので、スキップ件数には数えない。
    if (!head) continue;
    const isAddColumn = /^ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\b/i.test(head);
    const runnable =
      !DESTRUCTIVE_STATEMENT.test(head) &&
      (IDEMPOTENT_STATEMENT.test(head) ||
        (addedColumn && BACKFILL_UPDATE.test(head)));

    if (!runnable) {
      skipped++;
      continue;
    }
    try {
      await runD1WithRetry(
        ["d1", "execute", databaseName, "--remote", "--command", statement],
        contextLabel,
      );
      if (isAddColumn) addedColumn = true;
    } catch (err) {
      if (!isBenignSchemaError(err)) throw err;
    }
  }
  if (skipped > 0) {
    p.log.warn(
      `${contextLabel}: 既に適用済みの内容が含まれるため、データを書き換える ${skipped} 文はスキップしました（テーブル定義の追加のみ再適用）。`,
    );
  }
}

async function verifyLatestSchema(databaseName: string): Promise<void> {
  const verify = await runD1WithRetry(
    [
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--command",
      "SELECT name FROM sqlite_master WHERE type='table' AND name='line_accounts'",
    ],
    "テーブル検証",
  );

  if (!verify.includes("line_accounts")) {
    throw new Error(
      "schema/bootstrap を適用したのに line_accounts テーブルが見当たりません。`packages/db/bootstrap.sql` または migration 適用に問題があります。",
    );
  }
}

function loadBootstrapMeta(repoDir: string): BootstrapMeta | null {
  const metaPath = join(repoDir, "packages/db/bootstrap-meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as BootstrapMeta;
    if (
      typeof parsed.migrationCount !== "number" ||
      !Array.isArray(parsed.includedMigrations) ||
      !parsed.includedMigrations.every((value) => typeof value === "string")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function createDatabase(
  repoDir: string,
  databaseName: string,
  options: DatabaseOptions = {},
): Promise<DatabaseResult> {
  const s = p.spinner();

  // Create D1 database — keep this in pipe mode so we can parse the ID and
  // detect the "already exists" case via captured stderr.
  s.start("D1 データベース作成中...");
  let databaseId: string;
  let createdNow = false;
  try {
    const output = await runD1WithRetry(
      ["d1", "create", databaseName],
      "D1 データベース作成",
    );
    // Parse database_id from TOML or JSON format
    const tomlMatch = output.match(/database_id\s*=\s*"([^"]+)"/);
    const jsonMatch = output.match(/"database_id"\s*:\s*"([^"]+)"/);
    const uuidMatch = output.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    const match = tomlMatch || jsonMatch || uuidMatch;
    if (!match) {
      throw new Error(`D1 ID をパースできません: ${output}`);
    }
    databaseId = match[1];
    createdNow = true;
    s.stop("D1 データベース作成完了");
  } catch (error) {
    if (
      error instanceof WranglerError &&
      error.stderr.includes("already exists")
    ) {
      s.stop("D1 データベースは既に存在します");
      const listOutput = await runD1WithRetry(
        ["d1", "list", "--json"],
        "D1 一覧取得",
      );
      const databases = JSON.parse(listOutput);
      const db = databases.find(
        (d: { name: string }) => d.name === databaseName,
      );
      if (!db) {
        throw new Error("既存の D1 データベースが見つかりません");
      }
      databaseId = db.uuid;
    } else {
      s.stop("D1 データベース作成失敗");
      throw error;
    }
  }

  const bootstrapFile = join(repoDir, "packages/db/bootstrap.sql");
  const schemaFile = join(repoDir, "packages/db/schema.sql");
  const migrationsDir = join(repoDir, "packages/db/migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const bootstrapMeta = loadBootstrapMeta(repoDir);
  const includedMigrations = new Set(bootstrapMeta?.includedMigrations ?? []);
  // bootstrap.sql は「空の D1 を一発で完成形にする」ためのもので、既存 DB には使えない。
  // CREATE TABLE IF NOT EXISTS は既存テーブルを素通りするので欠けた列を補えず、その列を
  // 使う index 作成で落ちるだけになる。既存 DB の修復は下の schema.sql + 全 migration 経路
  // (applySqlFile が文単位に割って ALTER TABLE を通す) が担当する。
  const canUseBootstrap =
    createdNow &&
    existsSync(bootstrapFile) &&
    bootstrapMeta !== null &&
    bootstrapMeta.includedMigrations.every((file) => migrationFiles.includes(file));

  if (canUseBootstrap) {
    const pendingMigrations = migrationFiles.filter(
      (file) => !includedMigrations.has(file),
    );
    const label =
      pendingMigrations.length === 0
        ? "テーブル作成中（bootstrap）..."
        : `テーブル作成中（bootstrap + ${pendingMigrations.length} migrations）...`;
    s.start(label);
    try {
      await applySqlFile(databaseName, bootstrapFile, "bootstrap 適用");
    } catch (err) {
      s.stop("bootstrap 適用に失敗");
      throw err;
    }

    for (const file of pendingMigrations) {
      try {
        await applySetupMigration(
          databaseName,
          databaseId,
          migrationsDir,
          file,
          options,
        );
      } catch (err) {
        s.stop(`migration 失敗: ${file}`);
        throw err;
      }
    }
  } else {
    // 既存 D1 (createdNow=false) はここに来る。前回のセットアップが途中で落ちた DB でも、
    // applySqlFile が失敗ファイルを文単位に割り直して ALTER TABLE を通すので、欠けた列が
    // 埋まって最新スキーマまで回復する。
    const totalFiles = 1 + migrationFiles.length;
    const verb = createdNow ? "テーブル作成中" : "テーブル修復中";
    s.start(`${verb}（${totalFiles} files）...`);

    try {
      await applySqlFile(databaseName, schemaFile, "ベーススキーマ適用");
    } catch (err) {
      s.stop("ベーススキーマ適用に失敗");
      throw err;
    }

    for (const file of migrationFiles) {
      try {
        await applySetupMigration(
          databaseName,
          databaseId,
          migrationsDir,
          file,
          options,
        );
      } catch (err) {
        s.stop(`migration 失敗: ${file}`);
        throw err;
      }
    }
  }

  try {
    await verifyLatestSchema(databaseName);
  } catch (err) {
      s.stop("テーブル検証失敗");
    throw err;
  }

  s.stop("テーブル作成完了");

  return { databaseId, databaseName };
}
