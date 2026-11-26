import { hashApiKey } from './staff';
export interface PasskeyRow {
  id: string;
  staff_id: string;
  credential_id: string;
  public_key: string;
  sign_count: number;
  transports: string;
  aaguid: string;
  name: string;
  user_handle: string;
  context_hash: string;
  created_at: number;
  last_used_at: number | null;
}
export interface ChallengeRow {
  id: string;
  challenge_hash: string;
  purpose: string;
  staff_id: string | null;
  context_hash: string;
  expires_at: number;
  used_at: number | null;
}
export async function createWebauthnChallenge(
  db: D1Database,
  challenge: string,
  purpose: 'register' | 'login',
  staffId: string | null,
  contextHash: string,
) {
  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO admin_webauthn_challenges(id,challenge_hash,purpose,staff_id,context_hash,expires_at) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      id,
      await hashApiKey(challenge),
      purpose,
      staffId,
      contextHash,
      Math.floor(Date.now() / 1000) + 300,
    )
    .run();
  return id;
}
export async function getWebauthnChallenge(
  db: D1Database,
  id: string,
  purpose: string,
  contextHash: string,
) {
  return db
    .prepare(
      'SELECT * FROM admin_webauthn_challenges WHERE id=? AND purpose=? AND context_hash=? AND used_at IS NULL AND expires_at>?',
    )
    .bind(id, purpose, contextHash, Math.floor(Date.now() / 1000))
    .first<ChallengeRow>();
}
export async function consumeWebauthnChallenge(db: D1Database, id: string) {
  const result = await db
    .prepare(
      'UPDATE admin_webauthn_challenges SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?',
    )
    .bind(Math.floor(Date.now() / 1000), id, Math.floor(Date.now() / 1000))
    .run();
  return result.meta.changes === 1;
}
export async function listPasskeys(db: D1Database, staffId: string) {
  return (
    await db
      .prepare(
        'SELECT * FROM admin_passkeys WHERE staff_id=? ORDER BY id LIMIT 21',
      )
      .bind(staffId)
      .all<PasskeyRow>()
  ).results;
}
export async function getPasskey(db: D1Database, credentialId: string) {
  return db
    .prepare('SELECT * FROM admin_passkeys WHERE credential_id=?')
    .bind(credentialId)
    .first<PasskeyRow>();
}
export async function insertPasskey(
  db: D1Database,
  row: Omit<PasskeyRow, 'id' | 'created_at' | 'last_used_at'>,
) {
  await db
    .prepare(
      `INSERT INTO admin_passkeys(id,staff_id,credential_id,public_key,sign_count,transports,aaguid,name,user_handle,context_hash,created_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      crypto.randomUUID(),
      row.staff_id,
      row.credential_id,
      row.public_key,
      row.sign_count,
      row.transports,
      row.aaguid,
      row.name,
      row.user_handle,
      row.context_hash,
      Math.floor(Date.now() / 1000),
    )
    .run();
}
export async function advancePasskeyCounter(
  db: D1Database,
  id: string,
  previous: number,
  next: number,
) {
  const result = await db
    .prepare(
      'UPDATE admin_passkeys SET sign_count=?,last_used_at=? WHERE id=? AND sign_count=?',
    )
    .bind(next, Math.floor(Date.now() / 1000), id, previous)
    .run();
  return result.meta.changes === 1;
}
export async function purgeWebauthnChallenges(
  db: D1Database,
  now = Math.floor(Date.now() / 1000),
) {
  await db
    .prepare(
      'DELETE FROM admin_webauthn_challenges WHERE id IN (SELECT id FROM admin_webauthn_challenges WHERE expires_at<=? ORDER BY expires_at,id LIMIT 100)',
    )
    .bind(now)
    .run();
}
