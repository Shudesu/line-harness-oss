/** Read-only credential check. Never include the credential or provider body in errors. */
export async function checkLineToken(token: string): Promise<{ basicId: string; displayName: string; userId: string }> {
  let response: Response;
  try {
    response = await fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("LINEに接続できません。通信状態を確認してセットアップを再開してください。");
  }
  if (response.status === 401 || response.status === 403) throw new InvalidLineTokenError();
  if (!response.ok) throw new Error(`LINEの確認に失敗しました（HTTP ${response.status}）。後ほど再開してください。`);
  const bot = await response.json().catch(() => null) as { basicId?: string; displayName?: string; userId?: string } | null;
  if (!bot || typeof bot.basicId !== 'string' || !bot.basicId || typeof bot.userId !== 'string' || !bot.userId) throw new Error("LINEの応答を確認できません。後ほど再開してください。");
  return { basicId: bot.basicId, displayName: typeof bot.displayName === "string" ? bot.displayName : "", userId: bot.userId };
}
export class InvalidLineTokenError extends Error {
  constructor() { super("チャネルアクセストークンが無効です。Messaging API設定の長期トークンを確認してください。"); }
}
