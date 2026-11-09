/**
 * 送信の「既定トークン」（`env.LINE_CHANNEL_ACCESS_TOKEN`）を、長期トークンなしで決める。
 *
 * 送信経路の多くは「env のトークンを既定にして、友だちやリンクからアカウントが
 * 分かれば line_accounts のトークンで上書き」という形になっている。line_accounts の
 * トークンはチャネル ID + シークレットから Worker が発行し、期限前に発行し直している
 * （services/token-refresh.ts）。だから env が未設定でも、既定アカウントのトークンを
 * env に詰めれば、呼び出し側を変えずに長期トークンを外せる。
 *
 * 既定アカウントは webhook の高速経路と同じく `LINE_CHANNEL_SECRET` と同じシークレットを
 * 持つ有効なアカウント。無ければ、有効なアカウントが1本だけのときのその1本
 * （resolveDefaultLineAccount と同じ考え方）。どちらでもなければ何もしない。
 *
 * `LINE_CHANNEL_ACCESS_TOKEN` が設定されていれば何もしない（従来どおりの動き）。
 */

import { getLineAccounts } from '@line-crm/db';
import type { LineAccount } from '@line-crm/db';

interface DefaultTokenEnv {
  DB: D1Database;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
}

/** 同じ isolate の中で、リクエストのたびに D1 を読まないための短いキャッシュ。 */
const CACHE_MS = 60_000;
let cache: { token: string | null; until: number } | null = null;

export function resetDefaultLineTokenCache(): void {
  cache = null;
}

function pickDefaultAccount(accounts: LineAccount[], envSecret: string | undefined): LineAccount | null {
  const active = accounts.filter((a) => a.is_active && a.channel_access_token);
  if (envSecret) {
    // どちらもサーバー側の値なので、webhook の署名検証のような定数時間比較は要らない。
    const main = active.find((a) => a.channel_secret === envSecret);
    if (main) return main;
  }
  return active.length === 1 ? active[0] : null;
}

export async function withDefaultLineToken<E extends DefaultTokenEnv>(
  env: E,
  now: number = Date.now(),
): Promise<E & { LINE_CHANNEL_ACCESS_TOKEN?: string }> {
  if (env.LINE_CHANNEL_ACCESS_TOKEN) return env;
  if (!cache || cache.until <= now) {
    try {
      const account = pickDefaultAccount(await getLineAccounts(env.DB), env.LINE_CHANNEL_SECRET);
      cache = { token: account?.channel_access_token ?? null, until: now + CACHE_MS };
    } catch (err) {
      // D1 が読めないときは env をそのまま返す（従来と同じ。送信側が失敗を扱う）。
      // 障害中にリクエストのたびに D1 を読み直さないよう、失敗も同じ時間だけ覚える。
      console.error('[default-line-token] resolve failed:', err);
      cache = { token: null, until: now + CACHE_MS };
      return env;
    }
  }
  return cache.token ? { ...env, LINE_CHANNEL_ACCESS_TOKEN: cache.token } : env;
}
