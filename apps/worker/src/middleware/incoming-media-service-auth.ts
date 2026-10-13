import { getIncomingMediaServiceCredentialById } from '@line-crm/db';
import { timingSafeEqual } from 'node:crypto';

const TOKEN_RE = /^lhim_v1\.([0-9a-f]{32})\.([0-9a-f]{64})$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DUMMY_SHA256 = '0'.repeat(64);

export type IncomingMediaServicePrincipal = {
  credentialId: string;
  lineAccountId: string;
  scope: 'incoming_media_read';
};

function bytesFromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
}

/**
 * Authenticate the fixed-purpose credential without storing or logging its
 * bearer value. Invalid, expired, not-yet-valid, and revoked credentials all
 * return the same null result.
 */
export async function authenticateIncomingMediaServiceToken(
  db: D1Database,
  token: string | null,
  now: Date = new Date(),
): Promise<IncomingMediaServicePrincipal | null> {
  const supplied = token ?? '';
  const parsed = TOKEN_RE.exec(supplied);
  const credentialId = parsed?.[1] ?? '';
  const row = credentialId
    ? await getIncomingMediaServiceCredentialById(db, credentialId)
    : null;

  const suppliedDigest = await sha256(supplied);
  const storedDigestHex = row && SHA256_RE.test(row.token_sha256)
    ? row.token_sha256
    : DUMMY_SHA256;
  const digestMatches = timingSafeEqual(
    suppliedDigest,
    bytesFromHex(storedDigestHex),
  );

  if (!parsed || !row || !digestMatches || row.scope !== 'incoming_media_read') {
    return null;
  }

  const nowMs = now.getTime();
  const notBeforeMs = Date.parse(row.not_before);
  const expiresAtMs = Date.parse(row.expires_at);
  if (
    row.revoked_at !== null ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(notBeforeMs) ||
    !Number.isFinite(expiresAtMs) ||
    nowMs < notBeforeMs ||
    nowMs >= expiresAtMs
  ) {
    return null;
  }

  return {
    credentialId: row.id,
    lineAccountId: row.line_account_id,
    scope: row.scope,
  };
}
