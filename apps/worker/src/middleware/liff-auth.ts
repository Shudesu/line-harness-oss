/**
 * LIFF認証ミドルウェア — IDトークンでユーザーを検証し、friendIdを注入
 *
 * LIFF公開エンドポイント（プロフィール・お気に入り・勤怠・信用スコア等）で
 * 他人のfriendIdへの不正アクセスを防止する。
 *
 * フロントエンドは X-LIFF-Token ヘッダーでIDトークンを送信する。
 */

import { getFriendByLineUserId, getLineAccounts } from '@line-crm/db';
import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

// キャッシュ: IDトークン → { lineUserId, friendId, expiresAt }
// Workers は isolate 単位でメモリを共有するため、短期キャッシュとして有効
const tokenCache = new Map<string, { lineUserId: string; friendId: string; expiresAt: number }>();
const CACHE_TTL_MS = 3 * 60 * 1000; // 3分

/**
 * LINE IDトークンを検証し、lineUserIdとfriendIdを返す
 */
export async function verifyLiffToken(
  db: D1Database,
  token: string,
  loginChannelId: string,
  additionalChannelIds?: string[],
): Promise<{ lineUserId: string; friendId: string } | null> {
  // キャッシュチェック
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return { lineUserId: cached.lineUserId, friendId: cached.friendId };
  }

  // LINE Verify API で検証
  const channelIds = [loginChannelId, ...(additionalChannelIds || [])];
  let verifyRes: Response | null = null;

  for (const channelId of channelIds) {
    if (!channelId) continue;
    verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: token, client_id: channelId }),
    });
    if (verifyRes.ok) break;
  }

  if (!verifyRes?.ok) return null;

  const verified = await verifyRes.json<{ sub: string }>();
  const lineUserId = verified.sub;

  // friendsテーブルからfriendIdを解決
  const friend = await getFriendByLineUserId(db, lineUserId);
  if (!friend) return null;

  // キャッシュ保存
  tokenCache.set(token, {
    lineUserId,
    friendId: friend.id,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  // キャッシュサイズ制限（古いエントリを削除）
  if (tokenCache.size > 500) {
    const now = Date.now();
    for (const [key, val] of tokenCache) {
      if (val.expiresAt < now) tokenCache.delete(key);
    }
  }

  return { lineUserId, friendId: friend.id };
}

/**
 * LIFF認証ミドルウェア
 *
 * X-LIFF-Token ヘッダーからIDトークンを取得・検証し、
 * c.set('liffFriendId', friendId) でコンテキストに注入する。
 *
 * トークンがない/無効な場合は 401 を返す。
 */
export async function liffAuthMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // API_KEY認証済みリクエスト（管理画面）はスキップ
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ') && authHeader.slice(7) === c.env.API_KEY) {
    return next();
  }

  const token = c.req.header('X-LIFF-Token');
  if (!token) {
    return c.json({ success: false, error: 'LIFF authentication required' }, 401);
  }

  // DB登録のLogin Channel IDsも取得
  const dbAccounts = await getLineAccounts(c.env.DB);
  const additionalIds = dbAccounts
    .filter((a) => a.login_channel_id)
    .map((a) => a.login_channel_id as string);

  const result = await verifyLiffToken(
    c.env.DB,
    token,
    c.env.LINE_LOGIN_CHANNEL_ID,
    additionalIds,
  );

  if (!result) {
    return c.json({ success: false, error: 'Invalid or expired LIFF token' }, 401);
  }

  c.set('liffFriendId', result.friendId);
  c.set('liffLineUserId', result.lineUserId);
  return next();
}

/**
 * friendIdの所有権チェックヘルパー
 * リクエスト内のfriendIdが認証済みユーザーのものかを検証する
 */
export function assertOwnFriendId(c: Context<Env>, requestedFriendId: string): boolean {
  const liffFriendId = c.get('liffFriendId');
  return liffFriendId === requestedFriendId;
}
