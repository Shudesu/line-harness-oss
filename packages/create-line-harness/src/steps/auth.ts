import * as p from "@clack/prompts";
import {
  isWranglerAuthenticated,
  wrangler,
  wranglerInteractive,
} from "../lib/wrangler.js";

export async function ensureAuth(): Promise<void> {
  const s = p.spinner();
  s.start("Cloudflare 認証チェック中...");

  const authenticated = await isWranglerAuthenticated();
  if (authenticated) {
    s.stop("Cloudflare 認証済み");
    return;
  }

  s.stop("Cloudflare にログインが必要です");
  p.log.info("ブラウザが開きます。Cloudflare にログインしてください。");

  await wranglerInteractive(["login"]);

  const nowAuthenticated = await isWranglerAuthenticated();
  if (!nowAuthenticated) {
    p.cancel("Cloudflare ログインに失敗しました。もう一度試してください。");
    process.exit(1);
  }

  p.log.success("Cloudflare ログイン完了");
}

/**
 * Get the account ID of the currently authenticated CF account.
 * If multiple accounts are available, prompts the user to select one.
 */
export async function getAccountId(): Promise<string> {
  const output = await wrangler(["whoami"]);
  // Parse all account IDs from table: │ Account Name │ xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx │
  const matches = [...output.matchAll(/│\s+(.+?)\s+│\s+([a-f0-9]{32})\s+│/g)];
  if (matches.length === 0) {
    throw new Error(
      "Cloudflare アカウント ID を取得できません。wrangler whoami の出力を確認してください。",
    );
  }

  if (matches.length === 1) {
    return matches[0][2];
  }

  // Multiple accounts — let the user choose
  const selected = await p.select({
    message: "使用する Cloudflare アカウントを選択してください",
    options: matches.map((m) => ({
      value: m[2],
      label: `${m[1].trim()} (${m[2]})`,
    })),
  });
  if (p.isCancel(selected)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }
  return selected as string;
}
