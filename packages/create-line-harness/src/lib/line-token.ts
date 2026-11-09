/**
 * Messaging API のチャネルアクセストークンを、チャネル ID + チャネルシークレットから
 * 発行する（`POST /v2/oauth/accessToken`・有効期限30日）。セットアップ中に
 * bot 情報を読むのと、line_accounts の初期値に使う。長期トークンは不要。
 *
 * 運用中のトークンの発行し直しは Worker（apps/worker/src/services/token-refresh.ts）が行う。
 */
export async function issueShortLivedChannelToken(
  channelId: string,
  channelSecret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl("https://api.line.me/v2/oauth/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });
  if (!res.ok) {
    // 本文に値は含まれないが、念のため status だけを出す。
    throw new Error(
      `チャネル ID とチャネルシークレットからトークンを発行できませんでした（HTTP ${res.status}）。` +
        "LINE Developers コンソールの値を確認してください",
    );
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("LINE のトークン発行 API が想定外の応答を返しました");
  }
  return data.access_token;
}
