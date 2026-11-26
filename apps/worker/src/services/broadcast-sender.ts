import { getLineAccountById, type Broadcast } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';

export class BroadcastSenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BroadcastSenderError';
  }
}

/** A NULL sender is supported only by the original, account-less installation. */
export async function resolveBroadcastSender(
  db: D1Database,
  broadcast: Pick<Broadcast, 'id' | 'line_account_id' | 'target_type'>,
  defaultClient: LineClient,
): Promise<LineClient> {
  // Dedup resolves and validates each selected sender inside its own executor.
  if (broadcast.target_type === 'multi-account-dedup') return defaultClient;
  try {
    if (broadcast.line_account_id != null) {
      const account = await getLineAccountById(db, broadcast.line_account_id);
      if (!account || account.is_active !== 1 || !account.channel_access_token?.trim()) {
        throw new BroadcastSenderError('送信元アカウントが見つからないか、無効・未設定です。アカウント設定を確認してください。');
      }
      return new LineClient(account.channel_access_token);
    }
    const registered = await db.prepare('SELECT id FROM line_accounts LIMIT 1').first<{ id: string }>();
    if (registered) {
      throw new BroadcastSenderError('送信元が未指定のため停止しました。送信元と配信状況を確認してください。');
    }
    return defaultClient;
  } catch (error) {
    const failure = error instanceof BroadcastSenderError
      ? error
      : new BroadcastSenderError('送信元情報を確認できないため、配信を停止しました。時間をおいて確認してください。');
    // Recording failure must never turn an unavailable sender into a fallback.
    try {
      await db.prepare(
        "UPDATE broadcasts SET last_error = ? WHERE id = ? AND status IN ('draft','scheduled','sending')",
      ).bind(failure.message, broadcast.id).run();
    } catch { /* fail closed */ }
    throw failure;
  }
}
