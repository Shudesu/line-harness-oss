/** Atomic nonce ownership. Concurrent friends cannot both claim a token. */
export async function claimIgLinkToken(db: D1Database, nonce: string, friendId: string, expiresAt: number,
  now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (expiresAt <= now) return false;
  const inserted = await db.prepare(`INSERT INTO ig_link_token_uses (nonce,friend_id,used_at,expires_at)
    VALUES (?,?,?,?) ON CONFLICT(nonce) DO NOTHING RETURNING friend_id`)
    .bind(nonce, friendId, now, expiresAt).first<{ friend_id: string }>();
  if (inserted) return true;
  const existing = await db.prepare('SELECT friend_id FROM ig_link_token_uses WHERE nonce = ?')
    .bind(nonce).first<{ friend_id: string }>();
  return existing?.friend_id === friendId;
}

/** One indexed DELETE, at most 1,000 expired rows per hourly tick. */
export async function purgeIgLinkTokenUses(db: D1Database, now = Math.floor(Date.now() / 1000)): Promise<void> {
  await db.prepare(`DELETE FROM ig_link_token_uses WHERE nonce IN
    (SELECT nonce FROM ig_link_token_uses WHERE expires_at <= ? ORDER BY expires_at LIMIT 1000)`)
    .bind(now).run();
}
