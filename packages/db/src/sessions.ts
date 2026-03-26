export async function createSession(
  db: D1Database,
  apiKeyHash: string,
): Promise<string> {
  const id = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await db
    .prepare(
      "INSERT INTO sessions (id, api_key_hash, created_at, expires_at) VALUES (?, ?, datetime('now'), ?)",
    )
    .bind(id, apiKeyHash, expiresAt)
    .run()
  return id
}

export async function getSession(
  db: D1Database,
  sessionId: string,
): Promise<{ id: string; apiKeyHash: string } | null> {
  const result = await db
    .prepare(
      "SELECT id, api_key_hash as apiKeyHash FROM sessions WHERE id = ? AND expires_at > datetime('now')",
    )
    .bind(sessionId)
    .first<{ id: string; apiKeyHash: string }>()
  return result ?? null
}

export async function deleteSession(
  db: D1Database,
  sessionId: string,
): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run()
}

export async function cleanExpiredSessions(db: D1Database): Promise<number> {
  const result = await db
    .prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')")
    .run()
  return result.meta.changes ?? 0
}
