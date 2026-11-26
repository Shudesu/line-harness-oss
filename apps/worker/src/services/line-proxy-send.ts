import type { Message } from '@line-crm/line-sdk';

export type HarnessProxyDispatch = (request: Request) => Promise<Response>;

/**
 * LINE の push は必ず Harness の互換プロキシを通す。
 * プロキシ側が送信履歴の記録も担当するため、呼び出し元で messages_log を
 * 二重に書かないこと。
 */
export async function pushViaHarnessProxy(
  proxyBaseUrl: string,
  accessToken: string,
  to: string,
  messages: Message[],
  retryKey?: string,
  dispatch?: HarnessProxyDispatch,
): Promise<void> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  if (retryKey) headers['X-Line-Retry-Key'] = retryKey;

  const url = `${proxyBaseUrl.replace(/\/$/, '')}/line-api/v2/bot/message/push`;
  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify({ to, messages }),
  };
  // Worker 自身の公開 URL へ fetch すると自己接続が失敗する環境がある。
  // 内部呼び出しは同じ Hono proxy handler へ直接 dispatch し、外部利用時だけ fetch。
  const response = dispatch ? await dispatch(new Request(url, init)) : await fetch(url, init);

  // 同じ retry key がすでに LINE に受理済みなら、再送の 409 も成功扱い。
  const alreadyAccepted =
    response.status === 409 && Boolean(response.headers.get('x-line-accepted-request-id'));
  if (response.ok || alreadyAccepted) return;

  const body = await response.text().catch(() => '');
  throw new Error(
    `L Harness proxy error: ${response.status} ${response.statusText} — ${body.slice(0, 500)}`,
  );
}

/**
 * LINE の reply も Harness の互換プロキシを通す。
 * replyToken から受信者を逆引きできないため、messages_log は呼び出し元が記録する。
 */
export async function replyViaHarnessProxy(
  proxyBaseUrl: string,
  accessToken: string,
  replyToken: string,
  messages: Message[],
  dispatch?: HarnessProxyDispatch,
): Promise<void> {
  const url = `${proxyBaseUrl.replace(/\/$/, '')}/line-api/v2/bot/message/reply`;
  const init: RequestInit = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages }),
  };
  const response = dispatch ? await dispatch(new Request(url, init)) : await fetch(url, init);
  if (response.ok) return;

  const body = await response.text().catch(() => '');
  throw new Error(
    `L Harness proxy error: ${response.status} ${response.statusText} — ${body.slice(0, 500)}`,
  );
}
