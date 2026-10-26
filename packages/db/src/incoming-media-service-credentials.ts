export interface IncomingMediaServiceCredentialRow {
  id: string;
  line_account_id: string;
  scope: 'incoming_media_read';
  token_sha256: string;
  label: string;
  not_before: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

/**
 * Resolve only the public credential identifier. Secret verification remains
 * in the Worker and uses a constant-time digest comparison.
 */
export async function getIncomingMediaServiceCredentialById(
  db: D1Database,
  credentialId: string,
): Promise<IncomingMediaServiceCredentialRow | null> {
  return db
    .prepare(
      `SELECT id, line_account_id, scope, token_sha256, label,
              not_before, expires_at, revoked_at, created_at
         FROM incoming_media_service_credentials
        WHERE id = ?`,
    )
    .bind(credentialId)
    .first<IncomingMediaServiceCredentialRow>();
}
