import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFileSync, writeFileSync, existsSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { checkDeps } from "../steps/check-deps.js";
import { ensureAuth, getAccountId } from "../steps/auth.js";
import { promptLineCredentials } from "../steps/prompt.js";
import { createDatabase } from "../steps/database.js";
import { deployWorker, syncInstalledWorkerConfig } from "../steps/deploy-worker.js";
import { deployAdmin } from "../steps/deploy-admin.js";
import { setSecrets } from "../steps/secrets.js";
import { configureAdminAuth } from "../steps/admin-auth.js";
import { generateMcpConfig } from "../steps/mcp-config.js";
import { generateApiKey } from "../lib/crypto.js";
import {
  getAccountIds,
  setAccountId,
  wrangler,
  WranglerError,
  type CloudflareAccount,
} from "../lib/wrangler.js";

interface SetupState {
  projectName?: string;
  lineChannelId?: string;
  lineChannelAccessToken?: string;
  lineChannelSecret?: string;
  lineLoginChannelId?: string;
  liffId?: string;
  apiKey?: string;
  d1DatabaseId?: string;
  d1DatabaseName?: string;
  r2BucketName?: string;
  workerName?: string;
  accountId?: string;
  botBasicId?: string;
  workerUrl?: string;
  adminUrl?: string;
  /**
   * Pristine apps/worker/wrangler.toml content captured before we started
   * substituting account/database IDs. Restored on exit so the cloned repo
   * stays git-clean. Persisted in state.json so SIGINT mid-run + later
   * `npx create-line-harness` resume still has the right baseline.
   */
  originalWranglerToml?: string;
  completedSteps: string[];
}

// Steps whose result lives in the previous CF account and must be redone if the user switches.
const ACCOUNT_DEPENDENT_STEPS = [
  "r2billing",
  "database",
  "r2",
  "worker",
  "secrets",
  "lineAccount",
  "admin",
  "workerConfig",
  "adminAuth",
];

function getStatePath(repoDir: string): string {
  return join(repoDir, ".line-harness-setup.json");
}

function loadState(repoDir: string): SetupState {
  const path = getStatePath(repoDir);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      // corrupt file, start fresh
    }
  }
  return { completedSteps: [] };
}

function saveState(repoDir: string, state: SetupState): void {
  writeFileSync(getStatePath(repoDir), JSON.stringify(state, null, 2) + "\n");
}

function removeStateFile(repoDir: string): void {
  const path = getStatePath(repoDir);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // Best effort — a stale state file only affects resume behavior.
  }
}

function isDone(state: SetupState, step: string): boolean {
  return state.completedSteps.includes(step);
}

/**
 * The OSS-synced wrangler.toml ships with placeholders like
 * `YOUR_DEV_ACCOUNT_ID` / `YOUR_DEV_D1_DATABASE_ID` so it never leaks the
 * upstream maintainer's IDs. Wrangler reads those placeholders verbatim and
 * fails routing (`Could not route to /accounts/YOUR_DEV_ACCOUNT_ID/...`),
 * which used to surface as "no such table: line_accounts" two steps later.
 *
 * We patch the file in-place (so `wrangler` resolves `main = "src/index.ts"`
 * and `assets.directory` correctly relative to apps/worker/) and capture the
 * pristine content into the setup state so it can be restored on failure /
 * cancellation. Successful installs now replace the file with a generated
 * user-specific config so follow-up `wrangler tail` and manual debugging work.
 *
 * Replaces EVERY account_id / database_id literal — covers both placeholders
 * and real IDs left over from a prior install or a different Cloudflare
 * account. Idempotent: safe to call multiple times.
 */
function applyPatchedConfig(
  state: SetupState,
  repoDir: string,
  accountId: string,
  databaseId?: string,
): void {
  const tomlPath = join(repoDir, "apps/worker/wrangler.toml");
  if (!existsSync(tomlPath)) return;
  // Capture the pristine file the FIRST time we patch (before our
  // substitution touches it), so we can restore it on exit and not pollute
  // future `git pull --ff-only` runs.
  if (state.originalWranglerToml === undefined) {
    state.originalWranglerToml = readFileSync(tomlPath, "utf-8");
  }
  let content = state.originalWranglerToml;
  content = content.replace(/account_id\s*=\s*"[^"]*"/g, `account_id = "${accountId}"`);
  if (databaseId) {
    content = content.replace(/database_id\s*=\s*"[^"]*"/g, `database_id = "${databaseId}"`);
  }
  writeFileSync(tomlPath, content);
}

/**
 * Restore the original wrangler.toml so the cloned repo is git-clean again.
 * Called from the top-level try/finally so it runs on success, error, and
 * SIGINT alike.
 */
function restoreWranglerToml(state: SetupState, repoDir: string): void {
  if (state.originalWranglerToml === undefined) return;
  const tomlPath = join(repoDir, "apps/worker/wrangler.toml");
  try {
    writeFileSync(tomlPath, state.originalWranglerToml);
  } catch {
    // Best effort — user can `git -C ~/.line-harness checkout apps/worker/wrangler.toml`.
  }
}

function markDone(state: SetupState, step: string): void {
  if (!state.completedSteps.includes(step)) {
    state.completedSteps.push(step);
  }
}

/**
 * When the user switches CF accounts mid-setup, all account-bound state is stale
 * (R2 billing was enabled on a different account, the D1 lives elsewhere, etc.).
 * Strip those steps + their cached resource IDs so the resumed run rebuilds them.
 */
function resetAccountBoundState(state: SetupState): void {
  state.completedSteps = state.completedSteps.filter(
    (s) => !ACCOUNT_DEPENDENT_STEPS.includes(s),
  );
  state.d1DatabaseId = undefined;
  state.d1DatabaseName = undefined;
  state.r2BucketName = undefined;
  state.workerUrl = undefined;
  state.adminUrl = undefined;
}

function describeAccount(
  id: string | undefined,
  accounts: CloudflareAccount[],
): string {
  if (!id) return "(未設定)";
  const match = accounts.find((a) => a.id === id);
  return match ? `${match.name} (${id})` : id;
}

/**
 * Verify that the previously-saved accountId still belongs to the currently
 * authenticated wrangler session. If not, prompt the user to either switch
 * back, pick a new account (and rebuild account-bound state), or abort.
 */
async function verifyAccount(
  state: SetupState,
  repoDir: string,
): Promise<void> {
  const accounts = await getAccountIds();
  if (accounts.length === 0) {
    // wrangler whoami unparsable — let downstream steps surface the error.
    return;
  }

  const hasAccountBoundProgress = state.completedSteps.some((s) =>
    ACCOUNT_DEPENDENT_STEPS.includes(s),
  );

  if (!state.accountId) {
    if (!hasAccountBoundProgress) {
      // Brand-new run (or only credentials/liffId completed) — normal flow picks the account next.
      return;
    }

    // Legacy state file from < 0.1.14: account-bound steps are marked done but
    // we don't know which CF account they were performed on. Cannot trust them.
    p.log.warn(
      [
        "前回のセットアップで作成された Cloudflare リソース（D1/R2/Worker など）がありますが、",
        "どのアカウントに作られたか記録されていません（v0.1.14 未満で生成された state です）。",
        `現在ログイン中: ${accounts.map((a) => `${a.name} (${a.id})`).join(", ")}`,
      ].join("\n"),
    );

    const choice = await p.select({
      message: "どうしますか？",
      options: [
        {
          value: "reset",
          label: "アカウント依存ステップをリセットして、現在のアカウントで作り直す（推奨）",
        },
        {
          value: "continue",
          label: "リセットせず、現在のアカウントで続行する（前回のリソースが流用できれば再利用）",
        },
        {
          value: "abort",
          label: "中止する",
        },
      ],
    });
    if (p.isCancel(choice) || choice === "abort") {
      p.cancel("セットアップを中止しました。");
      process.exit(0);
    }
    if (choice === "reset") {
      resetAccountBoundState(state);
      saveState(repoDir, state);
      p.log.success("アカウント依存ステップをリセットしました。");
    }
    return;
  }

  const stillAvailable = accounts.some((a) => a.id === state.accountId);
  if (stillAvailable) {
    p.log.info(
      `前回のアカウント: ${pc.cyan(describeAccount(state.accountId, accounts))}`,
    );
    return;
  }

  p.log.warn(
    [
      "前回使用した Cloudflare アカウントが、現在ログイン中のアカウント一覧に見つかりません。",
      `  前回:           ${describeAccount(state.accountId, accounts)}`,
      `  現在ログイン中: ${accounts.map((a) => `${a.name} (${a.id})`).join(", ")}`,
    ].join("\n"),
  );

  const choice = await p.select({
    message: "どうしますか？",
    options: [
      {
        value: "switch",
        label: "現在ログイン中のアカウントで続行する（R2/D1/Worker などを作り直し）",
      },
      {
        value: "abort",
        label: "中止して `wrangler login` で前回のアカウントに戻る",
      },
    ],
  });
  if (p.isCancel(choice) || choice === "abort") {
    p.cancel(
      "セットアップを中止しました。`npx wrangler login` で前回のアカウントに戻ってから再実行してください。",
    );
    process.exit(0);
  }

  resetAccountBoundState(state);
  state.accountId = undefined;
  saveState(repoDir, state);
  p.log.success("アカウント依存ステップをリセットしました。新しいアカウントで再構築します。");
}

export async function runSetup(repoDir: string): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" LINE Harness セットアップ ")));

  const state = loadState(repoDir);

  if (state.completedSteps.length > 0) {
    p.log.info(
      `前回の途中から再開します（完了済み: ${state.completedSteps.join(", ")}）`,
    );
  }

  // Resume hygiene: a previous (possibly aborted) run may have left
  // wrangler.toml patched and cached the now-stale baseline in state.json.
  // Roll the file back to that baseline first, then forget it — the next
  // applyPatchedConfig() will re-capture the current (possibly git-pulled)
  // version. Without this, resuming overwrites a freshly-pulled toml with
  // the stale snapshot.
  if (state.originalWranglerToml !== undefined) {
    restoreWranglerToml(state, repoDir);
    state.originalWranglerToml = undefined;
    saveState(repoDir, state);
  }

  // process.exit() skips the finally block in Node, and clack's p.cancel()
  // inside runSetupInner can call it too. Centralise restore + persist into
  // one helper so every exit path runs it before exiting.
  // Critically: also clear originalWranglerToml in state so a future rerun
  // (after `git pull` may have updated apps/worker/wrangler.toml) does NOT
  // restore yesterday's snapshot over today's freshly-pulled file.
  const cleanupFailure = (): void => {
    restoreWranglerToml(state, repoDir);
    state.originalWranglerToml = undefined;
    saveState(repoDir, state);
  };

  const cleanupSuccess = (): void => {
    state.originalWranglerToml = undefined;
    removeStateFile(repoDir);
  };

  // Best-effort restore on SIGINT (Ctrl-C). Without this the user's repo
  // is left dirty and `ensureRepo()` next time can't ff-only.
  const onSignal = (sig: NodeJS.Signals) => {
    cleanupFailure();
    process.exit(sig === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await runSetupInner(state, repoDir);
    cleanupSuccess();
  } catch (error) {
    cleanupFailure();
    if (error instanceof WranglerError) {
      const help = error.getHelp();
      if (help) {
        p.log.error(`${error.message}\n\n${pc.yellow("考えられる原因:")}\n${help}`);
      } else {
        p.log.error(error.message);
      }
      p.cancel(
        "セットアップが失敗しました。修正後に同じコマンドを再実行すれば、続きから再開できます。",
      );
      process.exit(1);
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

async function runSetupInner(
  state: SetupState,
  repoDir: string,
): Promise<void> {
  // Step 1: Check dependencies
  await checkDeps();

  // Step 2: Authenticate with Cloudflare
  await ensureAuth();

  // Step 2.4: If we have a saved accountId, make sure it still belongs to the current wrangler session
  await verifyAccount(state, repoDir);

  // Step 2.5: Get account ID (only if not set or just reset by verifyAccount)
  if (!state.accountId) {
    const accountId = await getAccountId();
    state.accountId = accountId;
    saveState(repoDir, state);
    p.log.success(`Cloudflare アカウント: ${accountId}`);
  }
  // Pin all wrangler commands to this account
  setAccountId(state.accountId);
  // Patch wrangler.toml's account_id placeholder immediately — d1/worker
  // commands consult the toml file directly, and an unsubstituted
  // `YOUR_DEV_ACCOUNT_ID` would 404 every API call.
  applyPatchedConfig(state, repoDir, state.accountId);
  saveState(repoDir, state);

  // Step 1: Cloudflare R2 billing setup
  if (!isDone(state, "r2billing")) {
    p.log.step("═══ Step 1. Cloudflare 設定 ═══");
    p.log.message(
      [
        "R2 Object Storage の有効化（10GB まで無料）",
        "",
        "https://www.cloudflare.com/ja-jp/ にアクセス",
        "→ ログイン",
        "→ サイドメニュー「Storage & Databases」",
        "→ R2 Object Storage",
        "→ Overview",
        "→ クレジット＆個人情報を登録",
        "",
        "完了したら Enter を押してください",
      ].join("\n"),
    );
    await p.text({
      message: "R2 の有効化が完了したら Enter を押してください",
      defaultValue: "done",
    });
    markDone(state, "r2billing");
    saveState(repoDir, state);
  }

  // Get project name (used for Worker + D1 naming)
  if (!state.projectName) {
    const projectName = await p.text({
      message: "プロジェクト名（Worker と D1 の名前に使われます）",
      placeholder: "line-harness",
      defaultValue: "line-harness",
      validate(value) {
        if (!value) return undefined; // use default
        if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
          return "英小文字・数字・ハイフンのみ使用できます（例: my-line-bot）";
        }
      },
    });
    if (p.isCancel(projectName)) {
      p.cancel("セットアップをキャンセルしました");
      process.exit(0);
    }
    state.projectName = (projectName as string).trim() || "line-harness";
    saveState(repoDir, state);
  } else {
    p.log.success(`プロジェクト名: ${state.projectName}`);
  }

  // Step 4: Get LINE credentials (skip if already saved)
  if (!isDone(state, "credentials")) {
    const credentials = await promptLineCredentials();
    state.lineChannelId = credentials.lineChannelId;
    state.lineChannelAccessToken = credentials.lineChannelAccessToken;
    state.lineChannelSecret = credentials.lineChannelSecret;
    state.lineLoginChannelId = credentials.lineLoginChannelId;
    markDone(state, "credentials");
    saveState(repoDir, state);
  } else {
    p.log.success("LINE チャネル情報: 入力済み（スキップ）");
  }

  // Step 5: Ask for LIFF ID (skip if already saved)
  if (!isDone(state, "liffId")) {
    p.log.message(
      [
        "■ Step 3-2. LIFF ID 取得",
        "",
        "https://developers.line.biz/console/ にアクセス",
        "→ Step 2 で設定したプロバイダーを選択",
        "→ LINE ログインチャネル",
        "→ 「LIFF」タブ",
        "→ 追加",
        "→ LIFF アプリ名: 任意記入",
        "→ サイズ: Full",
        "→ エンドポイント URL: https://example.com（後で変更します）",
        "→ Scope: openid, profile, chat_message.write",
        "→ 友だち追加オプション: On (Aggressive)",
        "→ LIFF ID をコピー",
        "",
        "注意: LIFF アプリを「公開済み」にしてください（開発中だと動きません）",
      ].join("\n"),
    );

    const liffId = await p.text({
      message: "LIFF ID",
      placeholder: "チャネルID-ランダム文字列（例: 2009554425-4IMBmLQ9）",
      validate(value) {
        if (!value || !value.includes("-")) {
          return "LIFF ID は「チャネルID-ランダム文字列」の形式です（例: 2009554425-4IMBmLQ9）";
        }
      },
    });
    if (p.isCancel(liffId)) {
      p.cancel("セットアップをキャンセルしました");
      process.exit(0);
    }
    state.liffId = (liffId as string).trim();
    markDone(state, "liffId");
    saveState(repoDir, state);
  } else {
    p.log.success(`LIFF ID: 入力済み（${state.liffId}）`);
  }

  // Step 6: Generate API key (skip if already generated)
  if (!state.apiKey) {
    state.apiKey = generateApiKey();
    saveState(repoDir, state);
  }

  // Step 7: Create D1 database + run migrations
  if (!isDone(state, "database")) {
    const { databaseId, databaseName } = await createDatabase(repoDir, state.projectName!);
    state.d1DatabaseId = databaseId;
    state.d1DatabaseName = databaseName;
    // Now that the real D1 ID is known, finish patching wrangler.toml so
    // that `wrangler deploy` / future `d1 execute --file` calls hit the
    // correct database instead of the placeholder.
    applyPatchedConfig(state, repoDir, state.accountId, databaseId);
    markDone(state, "database");
    saveState(repoDir, state);
  } else {
    // Resumed install — wrangler.toml may have been re-cloned with
    // placeholders, so patch it again with the cached IDs.
    if (state.d1DatabaseId) {
      applyPatchedConfig(state, repoDir, state.accountId, state.d1DatabaseId);
    }
    p.log.success(`D1 データベース: 作成済み（${state.d1DatabaseId}）`);
  }

  // Step 8: Create R2 bucket for image uploads
  const r2BucketName = `${state.projectName}-images`;
  if (!isDone(state, "r2")) {
    const s = p.spinner();
    s.start("R2 バケット作成中...");
    try {
      await wrangler(["r2", "bucket", "create", r2BucketName]);
      s.stop("R2 バケット作成完了");
    } catch (error: any) {
      if (error?.stderr?.includes("already exists")) {
        s.stop("R2 バケットは既に存在します");
      } else {
        s.stop("R2 バケット作成完了");
      }
    }
    state.r2BucketName = r2BucketName;
    markDone(state, "r2");
    saveState(repoDir, state);
  } else {
    p.log.success(`R2 バケット: 作成済み（${state.r2BucketName}）`);
  }

  // Step 9: Fetch bot basic ID (before worker deploy — LINE API doesn't need worker)
  if (!state.botBasicId) {
    try {
      const botRes = await fetch("https://api.line.me/v2/bot/info", {
        headers: { Authorization: `Bearer ${state.lineChannelAccessToken}` },
      });
      if (botRes.ok) {
        const bot = (await botRes.json()) as { basicId?: string };
        if (bot.basicId) {
          state.botBasicId = bot.basicId;
          saveState(repoDir, state);
          p.log.success(`Bot Basic ID: ${state.botBasicId}`);
        }
      }
    } catch {
      // Non-critical — LIFF friend-add button won't show
    }
  }

  // Step 10: Deploy Worker (includes LIFF build via @cloudflare/vite-plugin)
  state.workerName = state.projectName!;
  if (!isDone(state, "worker")) {
    const { workerUrl } = await deployWorker({
      repoDir,
      d1DatabaseId: state.d1DatabaseId!,
      d1DatabaseName: state.d1DatabaseName!,
      workerName: state.workerName,
      accountId: state.accountId!,
      liffId: state.liffId!,
      r2BucketName: state.r2BucketName!,
      botBasicId: state.botBasicId || "",
    });
    state.workerUrl = workerUrl;
    markDone(state, "worker");
    saveState(repoDir, state);
  } else {
    p.log.success(`Worker: デプロイ済み（${state.workerUrl}）`);
  }

  // Step 11: Set secrets
  if (!isDone(state, "secrets")) {
    await setSecrets({
      workerName: state.workerName,
      lineChannelAccessToken: state.lineChannelAccessToken!,
      lineChannelSecret: state.lineChannelSecret!,
      lineLoginChannelId: state.lineLoginChannelId!,
      liffId: state.liffId!,
      apiKey: state.apiKey!,
    });
    markDone(state, "secrets");
    saveState(repoDir, state);
  } else {
    p.log.success("シークレット: 設定済み");
  }

  // Step 12: Register LINE account in DB.
  // We INSERT directly via `wrangler d1 execute` instead of POSTing to
  // /api/line-accounts. The CLI is already authenticated against the user's
  // Cloudflare account and has wrangler, so going through the Worker would
  // only add a DNS-propagation race (new workers.dev subdomains take a few
  // minutes to resolve) for no real benefit. Direct SQL is also idempotent
  // via ON CONFLICT(channel_id), preserving any name the operator may have
  // set later in the dashboard.
  if (!isDone(state, "lineAccount")) {
    const s = p.spinner();
    s.start("LINE アカウント登録中...");
    // Two separate temp files so we can clean each one immediately and never
    // hold both plaintext credentials on disk simultaneously.
    const insertSqlFile = join(tmpdir(), `clh-line-account-${randomUUID()}.sql`);
    const loginSqlFile = join(tmpdir(), `clh-line-login-${randomUUID()}.sql`);
    const q = (val: string) => `'${val.replace(/'/g, "''")}'`;
    let insertErr: unknown = null;

    try {
      const id = randomUUID();
      // Use the same timestamp format the rest of the app writes via jstNow()
      // — ISO 8601 with an explicit '+09:00' suffix. Relying on table defaults
      // or raw strftime(...) drops the timezone marker, which makes the row
      // sort inconsistently with rows written by the worker.
      const jstNowStr =
        new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, -1) + "+09:00";
      // Step A (required): upsert the core row using only the columns that
      // exist in every shipped schema version. login_channel_id was added in
      // a later migration, so we update it separately as best-effort to keep
      // the CLI working against older databases that resumed an old install.
      const insertSql = `
INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, created_at, updated_at)
VALUES (${q(id)}, ${q(state.lineChannelId!)}, ${q("LINE Harness")}, ${q(state.lineChannelAccessToken!)}, ${q(state.lineChannelSecret!)}, 1, ${q(jstNowStr)}, ${q(jstNowStr)})
ON CONFLICT(channel_id) DO UPDATE SET
  channel_access_token = excluded.channel_access_token,
  channel_secret = excluded.channel_secret,
  updated_at = ${q(jstNowStr)};
`;
      // Restrict to the owner — os.tmpdir() can be a shared directory
      // (Linux /tmp), and the file holds plaintext channel secrets.
      writeFileSync(insertSqlFile, insertSql, { mode: 0o600 });
      try {
        await wrangler([
          "d1",
          "execute",
          state.d1DatabaseName!,
          "--remote",
          "--file",
          insertSqlFile,
        ]);
      } finally {
        // Remove the secrets-bearing file before any further work (including
        // a possible exit). Don't wait for an outer finally that exit() skips.
        try { rmSync(insertSqlFile, { force: true }); } catch { /* best-effort */ }
      }
    } catch (err) {
      insertErr = err;
    }

    if (insertErr) {
      s.stop(`LINE アカウント登録に失敗: ${insertErr instanceof Error ? insertErr.message : String(insertErr)}`);
      p.log.error(
        `D1 への直接書き込みに失敗しました。'npx create-line-harness@latest' を再実行してください。`,
      );
      saveState(repoDir, state);
      process.exit(1);
    }

    // Step B (best-effort): set login_channel_id. May fail on older
    // schemas that don't have the column — that's fine, the dashboard
    // can set it later.
    try {
      const loginSql = `UPDATE line_accounts SET login_channel_id = ${q(state.lineLoginChannelId!)} WHERE channel_id = ${q(state.lineChannelId!)};`;
      writeFileSync(loginSqlFile, loginSql, { mode: 0o600 });
      try {
        await wrangler([
          "d1",
          "execute",
          state.d1DatabaseName!,
          "--remote",
          "--file",
          loginSqlFile,
        ]);
      } finally {
        try { rmSync(loginSqlFile, { force: true }); } catch { /* best-effort */ }
      }
    } catch {
      // Non-critical — login_channel_id can be set from the dashboard.
    }

    s.stop("LINE アカウント登録完了");
    markDone(state, "lineAccount");
    saveState(repoDir, state);
  } else {
    p.log.success("LINE アカウント: 登録済み");
  }

  // Step 13: Deploy Admin UI
  // Use unique project names to avoid subdomain collision
  const suffix = state.apiKey!.slice(0, 8);
  const adminProjectName = `${state.projectName}-admin-${suffix}`;
  if (!isDone(state, "admin")) {
    const { adminUrl } = await deployAdmin({
      repoDir,
      workerUrl: state.workerUrl!,
      apiKey: state.apiKey!,
      projectName: adminProjectName,
    });
    state.adminUrl = adminUrl;
    markDone(state, "admin");
    saveState(repoDir, state);
  } else {
    p.log.success(`Admin UI: デプロイ済み（${state.adminUrl}）`);
  }

  // Step 13b: Configure cookie-based admin auth for the cross-site
  // Pages↔Workers topology (SameSite=None cookie + CORS allowlist).
  if (!isDone(state, "adminAuth")) {
    await configureAdminAuth({
      workerName: state.workerName,
      workerUrl: state.workerUrl!,
      adminUrl: state.adminUrl!,
    });
    markDone(state, "adminAuth");
    saveState(repoDir, state);
  } else {
    p.log.success("管理画面の認証設定: 設定済み");
  }

  if (!isDone(state, "workerConfig")) {
    await syncInstalledWorkerConfig({
      repoDir,
      workerName: state.workerName!,
      accountId: state.accountId!,
      d1DatabaseName: state.d1DatabaseName!,
      d1DatabaseId: state.d1DatabaseId!,
      r2BucketName: state.r2BucketName!,
      workerPublicUrl: state.workerUrl!,
      adminPagesProject: adminProjectName,
      adminPublicUrl: state.adminUrl!,
      liffPagesProject: `${state.workerName}-liff`,
      liffPublicUrl: state.workerUrl!,
      manifestUrl:
        "https://github.com/Shudesu/line-harness-oss/releases/latest/download/release-manifest.json",
    });
    markDone(state, "workerConfig");
    saveState(repoDir, state);
  } else {
    p.log.success("Worker 設定: 反映済み");
  }

  // Step 14: Generate MCP config
  const addMcp = await p.confirm({
    message: "MCP 設定を .mcp.json に追加しますか？（Claude Code / Cursor 用）",
  });
  if (addMcp && !p.isCancel(addMcp)) {
    generateMcpConfig({ workerUrl: state.workerUrl!, apiKey: state.apiKey! });
  }

  // Step 15: Show completion screen
  p.note(
    [
      `${pc.bold("① LINE 応答設定を変更してください:")}`,
      `   → LINE Official Account Manager → 設定 → 応答設定`,
      `   チャット:             ${pc.red("オフ")}`,
      `   あいさつメッセージ:   ${pc.red("オフ")}`,
      `   Webhook:              ${pc.green("オン")}`,
      `   応答メッセージ:       ${pc.red("オフ")}`,
      "",
      `${pc.bold("② Webhook URL を設定してください:")}`,
      `   ${pc.cyan(`${state.workerUrl}/webhook`)}`,
      `   → LINE Official Account Manager → 設定 → Messaging API`,
      `   → Webhook URL に貼り付け → 「Webhookの利用」を ${pc.bold("ON")} にする`,
      "",
      `${pc.bold("③ LINE Login チャネルの設定:")}`,
      `   → LINE Developers Console → LINE Login チャネル`,
      `   a. 「リンクされたLINE公式アカウント」で公式アカウントを選択`,
      `   b. 「友だち追加オプション」を ${pc.bold("On (aggressive)")} に設定`,
      `   c. ${pc.bold("Callback URL を登録")}（必須・PC 経由の友だち追加に必要）:`,
      `      → 「LINEログイン設定」タブを開く`,
      `      → 「ウェブアプリでLINEログインを利用する」を ${pc.bold("ON")}`,
      `      → 「Callback URL」に以下を貼り付け:`,
      `        ${pc.cyan(`${state.workerUrl}/auth/callback`)}`,
      `      ※ スマホからの友だち追加は LIFF 経由なのでこの設定が無くても動きます。`,
      `         PC から QR を踏むと "Invalid redirect_uri" で silent fail します。`,
      "",
      `${pc.bold("④ LIFF エンドポイント URL を更新してください:")}`,
      `   ${pc.cyan(`${state.workerUrl}?liffId=${state.liffId}`)}`,
      `   → LINE Developers Console → LINE Login チャネル → LIFF`,
      `   → エンドポイント URL を上記 URL に変更（?liffId= 必須）`,
      "",
      `${pc.bold("⑤ 友だち追加 URL（この URL を共有してください）:")}`,
      `   ${pc.cyan(`${state.workerUrl}/auth/line?ref=setup`)}`,
      `   → QR で直追加ではなくこの URL 経由で追加してもらう`,
      "",
      `${pc.bold("⑥ 管理画面:")}`,
      `   ${pc.cyan(state.adminUrl!)}`,
      "",
      `${pc.bold("API Key:")}`,
      `   ${pc.dim(state.apiKey!)}`,
      `   → この値は再表示できません。安全な場所に保存してください`,
    ].join("\n"),
    "セットアップ完了！",
  );

  // Save config for future updates (separate from setup state).
  // Writes BOTH legacy field names (for older update.ts versions) and the
  // new Task 22 names (so future `npx create-line-harness update` runs
  // don't have to prompt for missing fields). We intentionally omit
  // liffProject because current setup serves LIFF from the Worker via
  // [assets], not a separate Pages project.
  const configPath = join(repoDir, ".line-harness-config.json");
  const adminPublicUrl = state.adminUrl;
  const workerPublicUrl = state.workerUrl;
  const fullConfig: Record<string, unknown> = {
    // Legacy fields (kept for backwards compatibility with older update.ts)
    projectName: state.projectName,
    accountId: state.accountId,
    adminUrl: state.adminUrl,
    workerUrl: state.workerUrl,
    workerName: state.workerName,
    d1DatabaseName: state.d1DatabaseName,
    d1DatabaseId: state.d1DatabaseId,
    r2BucketName: state.r2BucketName,
    // New fields (required by Task 22 update.ts)
    cfAccountId: state.accountId,
    workerPublicUrl,
    adminProject: adminProjectName,
    adminPublicUrl,
    liffPublicUrl: state.workerUrl,
    // liffProject is intentionally omitted — current setup serves LIFF
    // from the Worker via [assets], not a separate Pages project.
    manifestUrl:
      "https://github.com/Shudesu/line-harness-oss/releases/latest/download/release-manifest.json",
  };
  writeFileSync(configPath, JSON.stringify(fullConfig, null, 2) + "\n");

  p.outro(pc.green("LINE Harness を使い始めましょう 🎉"));
}
