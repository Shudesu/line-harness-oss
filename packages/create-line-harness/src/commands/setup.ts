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
import { wrangler } from "../lib/wrangler.js";

interface SetupState {
  lineChannelId?: string;
  lineChannelAccessToken?: string;
  lineChannelSecret?: string;
  lineLoginChannelId?: string;
  liffId?: string;
  apiKey?: string;
  d1DatabaseId?: string;
  d1DatabaseName?: string;
  workerName?: string;
  accountId?: string;
  botBasicId?: string;
  workerUrl?: string;
  adminUrl?: string;
  completedSteps: string[];
}

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

export async function runSetup(repoDir: string): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" LINE Harness セットアップ ")));

  const state = loadState(repoDir);

  if (state.completedSteps.length > 0) {
    p.log.info(
      `前回の途中から再開します（完了済み: ${state.completedSteps.join(", ")}）`,
    );
  }

  // Step 1: Check dependencies
  await checkDeps();

  // Step 2: Authenticate with Cloudflare
  await ensureAuth();

  // Step 2.5: Get account ID
  if (!state.accountId) {
    const accountId = await getAccountId();
    state.accountId = accountId;
    saveState(repoDir, state);
    p.log.success(`Cloudflare アカウント: ${accountId}`);
  }

  // Step 3: Get LINE credentials (skip if already saved)
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

  // Step 4: Ask for LIFF ID (skip if already saved)
  if (!isDone(state, "liffId")) {
    p.log.message(
      [
        "── LIFF アプリ（LINE Login チャネル内） ──",
        "",
        "LINE Login チャネルの設定:",
        "  リンクされたボット: Messaging API のボットを選択",
        "  Scope: openid, profile, chat_message.write を有効化",
        "  友だち追加オプション: On (aggressive)",
        "",
        "LIFF アプリの作成:",
        "  1. LINE Login チャネル → LIFF タブ → 追加",
        "  2. サイズ: Full",
        "  3. エンドポイント URL: https://example.com（後で変更します）",
        "  4. 作成後に表示される LIFF ID をコピー",
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

  // Step 5: Generate API key (skip if already generated)
  if (!state.apiKey) {
    state.apiKey = generateApiKey();
    saveState(repoDir, state);
  }

  // Step 6: Create D1 database + run migrations
  if (!isDone(state, "database")) {
    const { databaseId, databaseName } = await createDatabase(repoDir);
    state.d1DatabaseId = databaseId;
    state.d1DatabaseName = databaseName;
    markDone(state, "database");
    saveState(repoDir, state);
  } else {
    p.log.success(`D1 データベース: 作成済み（${state.d1DatabaseId}）`);
  }

  // Step 7: Fetch bot basic ID (before worker deploy — LINE API doesn't need worker)
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

  // Step 8: Deploy Worker (includes LIFF build via @cloudflare/vite-plugin)
  const workerName = "line-harness";
  state.workerName = workerName;
  if (!isDone(state, "worker")) {
    const { workerUrl } = await deployWorker({
      repoDir,
      d1DatabaseId: state.d1DatabaseId!,
      d1DatabaseName: state.d1DatabaseName!,
      workerName,
      accountId: state.accountId!,
      liffId: state.liffId!,
      botBasicId: state.botBasicId || "",
    });
    state.workerUrl = workerUrl;
    markDone(state, "worker");
    saveState(repoDir, state);
  } else {
    p.log.success(`Worker: デプロイ済み（${state.workerUrl}）`);
  }

  // Step 9: Set secrets
  if (!isDone(state, "secrets")) {
    await setSecrets({
      workerName,
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

  // Step 10: Register LINE account in DB
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
            "line-harness",
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

  // Step 11: Deploy Admin UI
  // Use unique project names to avoid subdomain collision
  const suffix = state.apiKey!.slice(0, 8);
  const adminProjectName = `lh-admin-${suffix}`;
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

  // Step 12: Generate MCP config
  const addMcp = await p.confirm({
    message: "MCP 設定を .mcp.json に追加しますか？（Claude Code / Cursor 用）",
  });
  if (addMcp && !p.isCancel(addMcp)) {
    generateMcpConfig({ workerUrl: state.workerUrl!, apiKey: state.apiKey! });
  }

  // Step 13: Show completion screen
  p.note(
    [
      `${pc.bold("① Webhook URL を設定してください:")}`,
      `   ${pc.cyan(`${state.workerUrl}/webhook`)}`,
      `   → LINE Official Account Manager → 設定 → Messaging API`,
      `   → Webhook URL に貼り付け → 「Webhookの利用」を ${pc.bold("ON")} にする`,
      "",
      `${pc.bold("② LIFF エンドポイント URL を更新してください:")}`,
      `   ${pc.cyan(state.workerUrl!)}`,
      `   → LINE Developers Console → LINE Login チャネル → LIFF`,
      `   → エンドポイント URL をこの URL に変更`,
      "",
      `${pc.bold("③ 友だち追加 URL（この URL を共有してください）:")}`,
      `   ${pc.cyan(`${state.workerUrl}/auth/line?ref=setup`)}`,
      `   → QR で直追加ではなくこの URL 経由で追加してもらう`,
      "",
      `${pc.bold("④ 管理画面:")}`,
      `   ${pc.cyan(state.adminUrl!)}`,
      "",
      `${pc.bold("API Key:")}`,
      `   ${pc.dim(state.apiKey!)}`,
      `   → この値は再表示できません。安全な場所に保存してください`,
    ].join("\n"),
    "セットアップ完了！",
  );

  // Clean up state file on success
  const statePath = getStatePath(repoDir);
  if (existsSync(statePath)) {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(statePath);
  }

  p.outro(pc.green("LINE Harness を使い始めましょう 🎉"));
}
