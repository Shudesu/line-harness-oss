/** INSERT-once guard backed by message_log's UNIQUE dedupe_key. */
export async function claimOnce(db: D1Database, memberId: string, kind: string, dedupeKey: string): Promise<boolean> {
  const res = await db
    .prepare('INSERT INTO message_log (id, member_id, kind, dedupe_key) VALUES (?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING')
    .bind(crypto.randomUUID(), memberId, kind, dedupeKey)
    .run()
  return Boolean(res.meta.changes)
}
