import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { checkDeps } from "../steps/check-deps.js";
import { ensureAuth, getAccountId } from "../steps/auth.js";
import { promptLineCredentials } from "../steps/prompt.js";
import { createDatabase } from "../steps/database.js";
import { deployWorker } from "../steps/deploy-worker.js";
import { deployAdmin } from "../steps/deploy-admin.js";
import { setSecrets } from "../steps/secrets.js";
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

function isDone(state: SetupState, step: string): boolean {
  return state.completedSteps.includes(step);
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

  try {
    await runSetupInner(state, repoDir);
  } catch (error) {
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
    markDone(state, "database");
    saveState(repoDir, state);
  } else {
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

  // Step 12: Register LINE account in DB
  if (!isDone(state, "lineAccount")) {
    const s = p.spinner();
    s.start("LINE アカウント登録中...");
    try {
      const res = await fetch(`${state.workerUrl}/api/line-accounts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${state.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "LINE Harness",
          channelId: state.lineChannelId,
          channelAccessToken: state.lineChannelAccessToken,
          channelSecret: state.lineChannelSecret,
        }),
      });
      if (res.ok) {
        // Set login_channel_id (not supported by API, update DB directly)
        try {
          await wrangler([
            "d1",
            "execute",
            state.d1DatabaseName!,
            "--remote",
            "--command",
            `UPDATE line_accounts SET login_channel_id = '${state.lineLoginChannelId}' WHERE channel_id = '${state.lineChannelId}'`,
          ]);
        } catch {
          // Non-critical
        }
        s.stop("LINE アカウント登録完了");
      } else {
        const data = (await res.json()) as Record<string, unknown>;
        s.stop(`LINE アカウント登録: ${data.error || "エラー"}`);
      }
    } catch {
      s.stop("LINE アカウント登録スキップ（Worker 起動待ち）");
    }
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

  // Save config for future updates (separate from setup state)
  const configPath = join(repoDir, ".line-harness-config.json");
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        projectName: state.projectName,
        workerName: state.workerName,
        workerUrl: state.workerUrl,
        adminUrl: state.adminUrl,
        d1DatabaseName: state.d1DatabaseName,
        d1DatabaseId: state.d1DatabaseId,
        r2BucketName: state.r2BucketName,
        accountId: state.accountId,
      },
      null,
      2,
    ) + "\n",
  );

  // Clean up state file on success
  const statePath = getStatePath(repoDir);
  if (existsSync(statePath)) {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(statePath);
  }

  p.outro(pc.green("LINE Harness を使い始めましょう 🎉"));
}
