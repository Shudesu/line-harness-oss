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
interface CacheEntry {
  token: string | null;
  until: number;
  pending?: Promise<void>;
}

// A binding/default-account change must not reuse another environment's token.
let caches = new WeakMap<D1Database, Map<string, CacheEntry>>();

function entriesFor(env: DefaultTokenEnv): Map<string, CacheEntry> {
  let entries = caches.get(env.DB);
  if (!entries) {
    entries = new Map();
    caches.set(env.DB, entries);
  }
  return entries;
}

export function resetDefaultLineTokenCache(): void {
  caches = new WeakMap();
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

/**
 * Publish an authoritative post-refresh snapshot already read by scheduled().
 * Replacing the entry also prevents an older in-flight read from restoring it.
 * No additional D1 query is needed for the scheduler's default token.
 */
export function withDefaultLineTokenFromAccounts<E extends DefaultTokenEnv>(
  env: E,
  accounts: LineAccount[],
  now: number = Date.now(),
): E & { LINE_CHANNEL_ACCESS_TOKEN?: string } {
  if (env.LINE_CHANNEL_ACCESS_TOKEN) return env;
  const account = pickDefaultAccount(accounts, env.LINE_CHANNEL_SECRET);
  const token = account?.channel_access_token ?? null;
  entriesFor(env).set(env.LINE_CHANNEL_SECRET ?? '', { token, until: now + CACHE_MS });
  return token ? { ...env, LINE_CHANNEL_ACCESS_TOKEN: token } : env;
}

export async function withDefaultLineToken<E extends DefaultTokenEnv>(
  env: E,
  now: number = Date.now(),
): Promise<E & { LINE_CHANNEL_ACCESS_TOKEN?: string }> {
  if (env.LINE_CHANNEL_ACCESS_TOKEN) return env;
  const entries = entriesFor(env);
  const key = env.LINE_CHANNEL_SECRET ?? '';
  let entry = entries.get(key);
  if (!entry || (!entry.pending && entry.until <= now)) {
    const loading: CacheEntry = { token: null, until: now + CACHE_MS };
    entries.set(key, loading);
    loading.pending = (async () => {
      try {
        const account = pickDefaultAccount(await getLineAccounts(env.DB), env.LINE_CHANNEL_SECRET);
        loading.token = account?.channel_access_token ?? null;
      } catch (err) {
        // Share and cache failed reads too, so an outage does not amplify D1 load.
        console.error('[default-line-token] resolve failed:', err);
      }
    })();
    entry = loading;
  }
  await entry.pending;
  entry.pending = undefined;
  // scheduled() may have published refreshed tokens while this read was pending.
  const current = entries.get(key) ?? entry;
  return current.token ? { ...env, LINE_CHANNEL_ACCESS_TOKEN: current.token } : env;
}
