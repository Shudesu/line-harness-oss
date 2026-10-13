export type IncomingMediaSourceType = 'user' | 'group' | 'room';
export type IncomingMediaStatus = 'pending' | 'stored' | 'failed';

export interface IncomingMediaRow {
  id: string;
  line_account_id: string;
  line_message_id: string;
  source_type: IncomingMediaSourceType;
  source_id: string;
  sender_user_id: string | null;
  r2_key: string;
  mime_type: string | null;
  byte_size: number | null;
  sha256: string | null;
  status: IncomingMediaStatus;
  stored_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReserveIncomingMediaInput {
  id: string;
  lineAccountId: string;
  lineMessageId: string;
  sourceType: IncomingMediaSourceType;
  sourceId: string;
  senderUserId: string | null;
  r2Key: string;
  now: string;
}

export async function getIncomingMedia(
  db: D1Database,
  lineAccountId: string,
  lineMessageId: string,
): Promise<IncomingMediaRow | null> {
  return db
    .prepare(
      `SELECT * FROM incoming_media
        WHERE line_account_id = ? AND line_message_id = ?`,
    )
    .bind(lineAccountId, lineMessageId)
    .first<IncomingMediaRow>();
}

export async function getStoredIncomingMedia(
  db: D1Database,
  lineAccountId: string,
  lineMessageId: string,
): Promise<IncomingMediaRow | null> {
  return db
    .prepare(
      `SELECT * FROM incoming_media
        WHERE line_account_id = ? AND line_message_id = ? AND status = 'stored'`,
    )
    .bind(lineAccountId, lineMessageId)
    .first<IncomingMediaRow>();
}

/** Reserve the composite identity before writing R2. */
export async function reserveIncomingMedia(
  db: D1Database,
  input: ReserveIncomingMediaInput,
): Promise<IncomingMediaRow | null> {
  await db
    .prepare(
      `INSERT INTO incoming_media (
         id, line_account_id, line_message_id, source_type, source_id,
         sender_user_id, r2_key, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(line_account_id, line_message_id) DO UPDATE SET
         source_type = excluded.source_type,
         source_id = excluded.source_id,
         sender_user_id = excluded.sender_user_id,
         updated_at = excluded.updated_at,
         status = CASE
           WHEN incoming_media.status = 'stored' THEN 'stored'
           ELSE 'pending'
         END`,
    )
    .bind(
      input.id,
      input.lineAccountId,
      input.lineMessageId,
      input.sourceType,
      input.sourceId,
      input.senderUserId,
      input.r2Key,
      input.now,
      input.now,
    )
    .run();

  return getIncomingMedia(db, input.lineAccountId, input.lineMessageId);
}

export async function markIncomingMediaPending(
  db: D1Database,
  lineAccountId: string,
  lineMessageId: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE incoming_media
          SET status = 'pending', stored_at = NULL, updated_at = ?
        WHERE line_account_id = ? AND line_message_id = ?`,
    )
    .bind(now, lineAccountId, lineMessageId)
    .run();
}

export async function markIncomingMediaStored(
  db: D1Database,
  lineAccountId: string,
  lineMessageId: string,
  metadata: { mimeType: string; byteSize: number; sha256: string; now: string },
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE incoming_media
          SET mime_type = ?, byte_size = ?, sha256 = ?, status = 'stored',
              stored_at = ?, updated_at = ?
        WHERE line_account_id = ? AND line_message_id = ?`,
    )
    .bind(
      metadata.mimeType,
      metadata.byteSize,
      metadata.sha256,
      metadata.now,
      metadata.now,
      lineAccountId,
      lineMessageId,
    )
    .run();
  if (result.meta.changes !== 1) {
    throw new Error('Incoming media row disappeared before finalize');
  }
}

export async function markIncomingMediaFailed(
  db: D1Database,
  lineAccountId: string,
  lineMessageId: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE incoming_media
          SET status = 'failed', updated_at = ?
        WHERE line_account_id = ? AND line_message_id = ? AND status != 'stored'`,
    )
    .bind(now, lineAccountId, lineMessageId)
    .run();
}
