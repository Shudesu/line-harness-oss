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
 */
export async function getAccountId(): Promise<string> {
  const output = await wrangler(["whoami"]);
  // Parse account ID from table: │ Account Name │ xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx │
  const match = output.match(/│\s+\S.*?\s+│\s+([a-f0-9]{32})\s+│/);
  if (!match) {
    throw new Error(
      "Cloudflare アカウント ID を取得できません。wrangler whoami の出力を確認してください。",
    );
  }
  return match[1];
}
