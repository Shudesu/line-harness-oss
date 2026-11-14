/**
 * Token auto-refresh — proactively renew LINE channel access tokens before expiry.
 *
 * LINE's short-lived token API (v2) uses client_credentials grant:
 * POST channel_id + channel_secret → new access_token (30 days).
 * No refresh_token needed.
 *
 * Runs every cron cycle (5 min). Only refreshes when:
 * - token_expires_at is within 7 days, OR
 * - token_expires_at is NULL (legacy, unknown expiry — refresh once to start tracking)
 */

import { getLineAccounts, toJstString, updateLineAccount } from '@line-crm/db';
import type { LineAccount } from '@line-crm/db';

const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60_000; // 7 days
const JST_OFFSET_MS = 9 * 60 * 60_000;

function jstNow(): string {
  const jst = new Date(Date.now() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, -1) + '+09:00';
}

function shouldRefresh(account: LineAccount): boolean {
  if (!account.token_expires_at) return true; // unknown expiry
  const expiresAt = new Date(account.token_expires_at).getTime();
  return expiresAt - Date.now() < REFRESH_THRESHOLD_MS;
}

interface TokenResponse {
  access_token: string;
  expires_in: number; // seconds
  token_type: string;
}

async function issueNewToken(
  channelId: string,
  channelSecret: string,
): Promise<TokenResponse> {
  const res = await fetch('https://api.line.me/v2/oauth/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE token API ${res.status}: ${body}`);
  }

  return res.json() as Promise<TokenResponse>;
}

/**
 * Issue a token from channel ID + secret and compute its expiry in the same JST
 * format as `line_accounts.token_expires_at`. Also used when an account is
 * registered without a token (routes/line-accounts.ts).
 */
export async function issueChannelToken(
  channelId: string,
  channelSecret: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const token = await issueNewToken(channelId, channelSecret);
  return {
    accessToken: token.access_token,
    expiresAt: toJstString(new Date(Date.now() + token.expires_in * 1000)),
  };
}

export async function refreshLineAccessTokens(db: D1Database): Promise<void> {
  const accounts = await getLineAccounts(db);

  for (const account of accounts) {
    if (!account.is_active) continue;
    if (!shouldRefresh(account)) continue;

    try {
      const token = await issueChannelToken(account.channel_id, account.channel_secret);

      await updateLineAccount(db, account.id, {
        channel_access_token: token.accessToken,
        token_expires_at: token.expiresAt,
      });

      console.log(`🔄 Token refreshed: ${account.name} (expires ${token.expiresAt})`);
    } catch (err) {
      console.error(`❌ Token refresh failed for ${account.name}:`, err);
    }
  }
}
