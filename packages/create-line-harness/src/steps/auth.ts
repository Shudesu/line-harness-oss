import * as p from "@clack/prompts";
import {
  getAccountIds,
  isWranglerAuthenticated,
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
 * Pick an account from the currently authenticated CF user.
 * - 0 accounts: throws
 * - 1 account: returns it directly
 * - 2+ accounts: prompts the user to select one
 */
export async function getAccountId(): Promise<string> {
  const accounts = await getAccountIds();
  if (accounts.length === 0) {
    throw new Error(
      "Cloudflare アカウント ID を取得できません。`npx wrangler whoami` の出力を確認してください。",
    );
  }

  if (accounts.length === 1) {
    return accounts[0].id;
  }

  const selected = await p.select({
    message: "使用する Cloudflare アカウントを選択してください",
    options: accounts.map((a) => ({
      value: a.id,
      label: `${a.name} (${a.id})`,
    })),
  });
  if (p.isCancel(selected)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }
  return selected as string;
}
