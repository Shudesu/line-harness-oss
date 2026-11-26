import { hashApiKey } from './staff';
export async function createMagicLink(
  db: D1Database,
  input: { staffId: string; email: string; credentialFp: string },
  now = Math.floor(Date.now() / 1000),
) {
  const token =
    'lhm_' +
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  await db
    .prepare(
      'INSERT INTO admin_magic_links(token_hash,staff_id,email,credential_fp,created_at,expires_at) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      await hashApiKey(token),
      input.staffId,
      input.email,
      input.credentialFp,
      now,
      now + 900,
    )
    .run();
  return token;
}
export async function consumeMagicLink(
  db: D1Database,
  token: unknown,
  now = Math.floor(Date.now() / 1000),
) {
  if (typeof token !== 'string' || !/^lhm_[A-Za-z0-9_-]{43}$/.test(token))
    return null;
  return db
    .prepare(
      'UPDATE admin_magic_links SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>? RETURNING staff_id,email,credential_fp',
    )
    .bind(now, await hashApiKey(token), now)
    .first<{ staff_id: string; email: string; credential_fp: string }>();
}
export async function purgeMagicLinks(
  db: D1Database,
  now = Math.floor(Date.now() / 1000),
) {
  await db
    .prepare(
      'DELETE FROM admin_magic_links WHERE token_hash IN (SELECT token_hash FROM admin_magic_links WHERE expires_at<=? ORDER BY expires_at,token_hash LIMIT 100)',
    )
    .bind(now)
    .run();
}
