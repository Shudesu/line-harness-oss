/**
 * Lark (飞书) API クライアント (Cloudflare Worker 用)。
 *
 * 必要な Worker secrets:
 *   - LARK_APP_ID        (例: cli_xxxxxxxxxxxxxxxx)
 *   - LARK_APP_SECRET    (例: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)
 *
 * tenant_access_token は短命 (約 2h) なので、Worker module の in-memory 変数で TTL 付きキャッシュする。
 * 同一 isolate 内で再利用される。複数 isolate にまたがる強整合キャッシュは不要 (毎回再取得しても
 * Lark 側は 1分間 100リクエストまで許可されているので、1日数百件規模なら十分)。
 *
 * 安全性メモ:
 *   - 本ファイルは "投稿実行" の API を提供するだけ。実際にどこへ送るかは呼び出し側 (lark-notifier.ts) が
 *     DB の lark_notifications テーブルに登録された設定に従って決める。
 *   - 設定が無い line_account は黙って no-op になる (テスト投稿が漏れない設計)。
 */

const LARK_BASE_URL = 'https://open.larksuite.com/open-apis';
// 日本リージョン (lark.com / open.larksuite.com) と中国本土 (feishu.cn / open.feishu.cn) は別ドメイン。
// hyhome は Lark (海外版) を使っているため larksuite.com を使う。万一 feishu.cn 側のテナントを使う
// 必要が出たら LARK_BASE_URL を env で差し替えられるよう拡張する。

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;

export async function getLarkTenantAccessToken(
  appId: string,
  appSecret: string,
): Promise<string> {
  // ScheduleWakeup の制約と同様、Math.random/Date.now は Workflow では使えないが
  // Cloudflare Worker ランタイムでは普通に使える。ここは Worker 実行コンテキスト。
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const res = await fetch(`${LARK_BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Lark tenant_access_token HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    code: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if (json.code !== 0 || !json.tenant_access_token) {
    throw new Error(`Lark tenant_access_token error code=${json.code} msg=${json.msg ?? ''}`);
  }

  const expireSec = json.expire ?? 7200;
  tokenCache = {
    token: json.tenant_access_token,
    expiresAt: now + expireSec * 1000,
  };
  return json.tenant_access_token;
}

export type LarkReceiveIdType = 'open_id' | 'chat_id' | 'email' | 'user_id' | 'union_id';

// Lark `/im/v1/messages` のレスポンス形 (成功時 code=0)。
// 旧実装は `let parsed: T | null = null; parsed = JSON.parse(...) as typeof parsed`
// と書いていたが、`typeof parsed` がリテラル `null` に narrow され、
// 後続の `parsed.code` 等が TS2339 (never) で読めなくなる罠だった。
// 名前付き型に切り出して `as LarkSendResponse` で明示する。
interface LarkSendResponse {
  code: number;
  msg?: string;
  data?: { message_id?: string };
}

export interface SendLarkTextResult {
  ok: boolean;
  httpStatus: number;
  code?: number;
  messageId?: string;
  errorMessage?: string;
}

/**
 * Lark にテキストメッセージを送る。
 *
 * receive_id_type と receive_id の対応:
 *   - 'chat_id'  → グループチャット (open_chat_id, oc_xxx で始まる)
 *   - 'open_id'  → 個人IM (open_id, ou_xxx で始まる)
 *   - 'email'    → メアド (要 contact:user.email:readonly スコープ + 同テナント内ユーザー)
 */
export async function sendLarkTextMessage(args: {
  appId: string;
  appSecret: string;
  receiveIdType: LarkReceiveIdType;
  receiveId: string;
  text: string;
  signal?: AbortSignal;
}): Promise<SendLarkTextResult> {
  const token = await getLarkTenantAccessToken(args.appId, args.appSecret);
  const url = `${LARK_BASE_URL}/im/v1/messages?receive_id_type=${encodeURIComponent(args.receiveIdType)}`;
  const body = JSON.stringify({
    receive_id: args.receiveId,
    msg_type: 'text',
    content: JSON.stringify({ text: args.text }),
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body,
      signal: args.signal,
    });
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      errorMessage: (err as Error).message ?? 'fetch failed',
    };
  }

  let parsed: LarkSendResponse | null = null;
  const responseText = await res.text().catch(() => '');
  try {
    parsed = JSON.parse(responseText) as LarkSendResponse;
  } catch {
    // not json
  }
  if (!res.ok || (parsed && parsed.code !== 0)) {
    return {
      ok: false,
      httpStatus: res.status,
      code: parsed?.code,
      errorMessage:
        parsed?.msg ??
        (responseText.length > 0 ? responseText.slice(0, 200) : `HTTP ${res.status}`),
    };
  }
  return {
    ok: true,
    httpStatus: res.status,
    code: parsed?.code ?? 0,
    messageId: parsed?.data?.message_id,
  };
}

/**
 * テスト用: 設定 (LarkConfig) が有効かどうか軽く確認するための関数。
 * 実際にメッセージは送らず、tenant_access_token が取れるかだけ確認する。
 */
export async function verifyLarkCredentials(
  appId: string,
  appSecret: string,
): Promise<{ ok: boolean; errorMessage?: string }> {
  try {
    await getLarkTenantAccessToken(appId, appSecret);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorMessage: (err as Error).message };
  }
}
