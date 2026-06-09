/**
 * LIFF ID token verification.
 *
 * The form-submit / form-partial endpoints are publicly reachable (LIFF
 * pages cannot send Authorization headers reliably across UA/SDK
 * versions), so we authenticate the caller by verifying the LIFF /
 * LINE Login ID token that the LIFF SDK exposes via `liff.getIDToken()`.
 *
 * Implementation: we delegate signature verification to LINE's
 * canonical `/oauth2/v2.1/verify` endpoint — same approach used in
 * `routes/liff.ts` (`/api/liff/link`, `/api/liff/send-form-link`,
 * `/auth/callback`). This avoids reimplementing JWKS handling inside
 * the Worker (no key cache to invalidate, no JOSE crypto on the
 * hot path) and keeps verification semantics identical across the
 * codebase. The endpoint enforces signature, audience (`client_id`),
 * issuer and `exp` server-side; on success it returns the decoded
 * payload including `sub` (= LINE user id).
 *
 * The function tries the env-configured default login channel first,
 * then walks every login_channel_id registered in `line_accounts` so
 * multi-account installations work without extra config. The first
 * channel that accepts the token wins.
 */

import { getLineAccounts } from '@line-crm/db';

export interface VerifiedLiffToken {
  sub: string;
  /** The login_channel_id (aud) that accepted the token. */
  channelId: string;
  email?: string;
  name?: string;
}

export interface VerifyLiffIdTokenEnv {
  DB: D1Database;
  LINE_LOGIN_CHANNEL_ID: string;
}

/**
 * Verify a LIFF/LINE Login ID token against every login channel that
 * this tenant knows about. Returns the decoded payload on success or
 * `null` on any failure (invalid signature, wrong audience, expired,
 * malformed JSON). Callers MUST treat `null` as auth failure.
 *
 * NOTE: this function performs a remote round-trip per candidate
 * channel. Most installs only have 1–2 login channels so the worst
 * case is bounded, and LINE's verify endpoint is colocated with the
 * Worker region. Do not cache results — id_tokens are short-lived
 * and the verify endpoint already enforces `exp` for us.
 */
export async function verifyLiffIdToken(
  env: VerifyLiffIdTokenEnv,
  idToken: string,
): Promise<VerifiedLiffToken | null> {
  if (!idToken || typeof idToken !== 'string') return null;

  // Build the candidate list. env default first so the common case
  // is one fetch. De-dupe to avoid hitting LINE twice if a DB account
  // also references the env default channel.
  const seen = new Set<string>();
  const channelIds: string[] = [];
  if (env.LINE_LOGIN_CHANNEL_ID) {
    channelIds.push(env.LINE_LOGIN_CHANNEL_ID);
    seen.add(env.LINE_LOGIN_CHANNEL_ID);
  }
  try {
    const dbAccounts = await getLineAccounts(env.DB);
    for (const acct of dbAccounts) {
      if (acct.login_channel_id && !seen.has(acct.login_channel_id)) {
        channelIds.push(acct.login_channel_id);
        seen.add(acct.login_channel_id);
      }
    }
  } catch (err) {
    // Non-fatal — fall through with just the env default.
    console.error('[liff-verify] getLineAccounts failed:', err);
  }

  for (const channelId of channelIds) {
    try {
      const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
      });
      if (!res.ok) continue;
      const payload = (await res.json()) as {
        sub?: string;
        email?: string;
        name?: string;
      };
      if (!payload.sub) continue;
      return {
        sub: payload.sub,
        channelId,
        email: payload.email,
        name: payload.name,
      };
    } catch (err) {
      console.error('[liff-verify] verify call failed:', err);
      continue;
    }
  }

  return null;
}
