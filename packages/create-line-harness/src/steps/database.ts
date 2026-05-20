import * as p from "@clack/prompts";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { wrangler, WranglerError } from "../lib/wrangler.js";

// Wrangler 4.x demotes piped invocations to "non-interactive" mode and demands
// CLOUDFLARE_API_TOKEN even when the user is logged in via OAuth (OSS issue
// #124). When we see one of these markers in stderr, the only recovery is to
// retry the same command with full stdio inheritance so wrangler can refresh
// its token and emit its "Ok to proceed?" prompt against a real TTY.
const TTY_REQUIRED =
  /non[- ]?interactive|cloudflare_api_token|consent denied|authentication error|expired/i;

interface DatabaseResult {
  databaseId: string;
  databaseName: string;
}

export async function createDatabase(
  repoDir: string,
  databaseName: string,
): Promise<DatabaseResult> {
  const s = p.spinner();

  // Create D1 database — keep this in pipe mode so we can parse the ID and
  // detect the "already exists" case via captured stderr.
  s.start("D1 データベース作成中...");
  let databaseId: string;
  try {
    const output = await wrangler(["d1", "create", databaseName]);
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
    s.stop("D1 データベース作成完了");
  } catch (error) {
    if (
      error instanceof WranglerError &&
      error.stderr.includes("already exists")
    ) {
      s.stop("D1 データベースは既に存在します");
      const listOutput = await wrangler(["d1", "list", "--json"]);
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

  // Run base schema first, then migrations
  const schemaFile = join(repoDir, "packages/db/schema.sql");
  const migrationsDir = join(repoDir, "packages/db/migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const totalFiles = 1 + migrationFiles.length;
  s.start(`テーブル作成中（${totalFiles} files）...`);

  // A wrangler error is benign only if it indicates the table/column already
  // exists (i.e. this migration has been applied before). Anything else —
  // including the API never being reached — is a real failure that must
  // surface so the user doesn't end up with an empty database thinking
  // setup succeeded (issue: 'no such table: line_accounts' on Step 12).
  const isBenignSchemaError = (err: unknown): boolean => {
    if (!(err instanceof WranglerError)) return false;
    const text = `${err.message}\n${err.stderr}`.toLowerCase();
    return (
      text.includes("duplicate column") ||
      text.includes("already exists") ||
      text.includes("table") && text.includes("already") // catch "table foo already exists"
    );
  };

  // Apply a single .sql file via `wrangler d1 execute --remote --file`.
  //
  // We prefer pipe mode (captures stderr so isBenignSchemaError can flag
  // already-applied schema as benign on resumed installs). But wrangler
  // 4.x detects non-TTY stdout and refuses authenticated/destructive ops
  // with "non-interactive" / "CLOUDFLARE_API_TOKEN" / "consent denied"
  // errors even when the user has a valid cached OAuth token (OSS issue
  // #124). Refreshing the token doesn't help — wrangler trips the same
  // check on every subsequent pipe call — so the only recovery is to
  // re-run the d1 execute itself with full stdio inheritance.
  //
  // Trade-off: TTY mode inherits stderr, so we can't classify its errors.
  // Two implications:
  //   1. Fresh install (file never applied): TTY retry succeeds first
  //      time — this is the OSS-#124 happy path.
  //   2. Resumed install with expired token (file partly/fully applied
  //      already): TTY retry surfaces "already exists" as a fatal error
  //      to the user instead of swallowing it. Recovery is manual:
  //      `npx wrangler login` to refresh the token, then re-run setup so
  //      pipe mode succeeds and isBenignSchemaError handles re-applies.
  //   3. TTY mid-apply failure (rare): user sees wrangler's actual stderr
  //      directly and can act on it. We deliberately do NOT retry in pipe
  //      mode here — that could read "already exists" on an early
  //      statement and mark the whole file as benignly applied while
  //      later statements never ran (partial-schema corruption).
  const applyD1File = async (
    file: string,
    failureLabel: string,
  ): Promise<void> => {
    const args = ["d1", "execute", databaseName, "--remote", "--file", file];
    try {
      await wrangler(args);
      return;
    } catch (err) {
      if (isBenignSchemaError(err)) return;
      const isTtyRequired =
        err instanceof WranglerError && TTY_REQUIRED.test(err.stderr);
      if (!isTtyRequired) {
        s.stop(failureLabel);
        throw err;
      }
      // Stop the spinner so wrangler's inherited output during the TTY
      // retry below doesn't scramble it.
      s.stop("wrangler 認証更新のため対話モードで再実行します（出力が表示されます）...");
    }

    try {
      await wrangler(args, { tty: true });
    } catch (ttyErr) {
      // TTY stderr was inherited — the user already saw wrangler's output.
      // Re-throwing surfaces a clean failure label for the spinner output
      // above; on resumed-install "already exists" edge case the user
      // can recover by running `npx wrangler login` and re-running setup.
      throw ttyErr;
    }
    // Resume the spinner for the next file in the loop.
    s.start(`テーブル作成中（${totalFiles} files）...`);
  };

  // Base schema — fatal if it fails for any non-benign reason.
  await applyD1File(schemaFile, "ベーススキーマ適用に失敗");

  // Migration files — duplicate-column / already-exists are expected on
  // re-runs and resumed installs, but any other error means the migration
  // never ran and we should bail rather than silently advance.
  for (const file of migrationFiles) {
    await applyD1File(join(migrationsDir, file), `migration 失敗: ${file}`);
  }

  // Final guard: confirm the core table exists. Catches the silent-failure
  // mode where every wrangler call was rejected (e.g. wrangler.toml had a
  // placeholder account_id and every API call 404'd) and the user would
  // otherwise hit `no such table: line_accounts` two steps later.
  try {
    const verify = await wrangler([
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--command",
      "SELECT name FROM sqlite_master WHERE type='table' AND name='line_accounts'",
    ]);
    if (!verify.includes("line_accounts")) {
      s.stop("テーブル検証失敗");
      throw new Error(
        "schema/migration を適用したのに line_accounts テーブルが見当たりません。手動で `npx wrangler d1 execute " +
          databaseName +
          " --remote --file packages/db/schema.sql` を実行してください。",
      );
    }
  } catch (err) {
    s.stop("テーブル検証失敗");
    throw err;
  }

  s.stop("テーブル作成完了");

  return { databaseId, databaseName };
}
