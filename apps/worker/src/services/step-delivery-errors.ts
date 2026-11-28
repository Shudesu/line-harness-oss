/** Store one internal diagnostic per enrollment; never dispatch a notification. */
export function describeStepDeliveryError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const status = /^LINE API error:\s+(\d{3})\b/.exec(message);
  let reason = 'unexpected_error';
  if (/monthly limit|monthly quota/i.test(message)) reason = 'monthly_message_limit';
  else if (status) reason = 'line_api_error';
  else if (/no such (?:table|column):\s*[a-z_][a-z0-9_.]*/i.test(message)) {
    reason = message.match(/no such (?:table|column):\s*[a-z_][a-z0-9_.]*/i)![0];
  } else if (/constraint failed:\s*[a-z_][a-z0-9_.]*/i.test(message)) {
    reason = message.match(/constraint failed:\s*[a-z_][a-z0-9_.]*/i)![0];
  } else if (/too many subrequests/i.test(message)) reason = 'subrequest_limit';
  else if (/network|fetch failed|connection|timeout/i.test(message)) reason = 'network_error';
  // Function names only: no message bodies, URLs, SQL values or request credentials.
  const frames = error instanceof Error ? (error.stack ?? '').split('\n').slice(1)
    .map(line => /^\s*at\s+(?:async\s+)?([A-Za-z_$][\w.$]*)\s+\(/.exec(line)?.[1])
    .filter((name): name is string => !!name).slice(0, 5) : [];
  return { reason, httpStatus: status ? Number(status[1]) : null, frames };
}

/**
 * `lineAccountId` is the account the delivery resolved to (null when it failed
 * before an account was known, or on a legacy single-token install). It is
 * stored in the column so `GET /api/notifications?lineAccountId=...` — an exact
 * match — returns the diagnostic on the per-account screen and monitors.
 */
export async function recordStepDeliveryError(
  db: D1Database,
  enrollmentId: string,
  error: unknown,
  lineAccountId: string | null = null,
): Promise<void> {
  const detail = describeStepDeliveryError(error);
  const body = detail.reason === 'monthly_message_limit' && detail.httpStatus === 429
    ? 'LINEの月間送信上限に達したため、ステップ配信を一時停止しました。LINE側の送信枠と配信日時を確認してから再開してください。'
    : 'ステップ配信に失敗しました。原因: ' + detail.reason;
  try {
    await db.prepare(`INSERT INTO notifications (id, event_type, title, body, channel, status, metadata, line_account_id)
      VALUES (?, 'step_delivery_error', 'ステップ配信エラー', ?, 'internal', 'failed', ?, ?)
      ON CONFLICT(id) DO UPDATE SET body=excluded.body, metadata=excluded.metadata,
        line_account_id=excluded.line_account_id,
        created_at=strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`)
      .bind('step-delivery-error:' + enrollmentId, body, JSON.stringify({ enrollmentId, ...detail }), lineAccountId).run();
  } catch {
    // Diagnostics must never change retry/pause behavior if the database is unavailable.
    console.error('[step-delivery] could not persist error diagnostic');
  }
}
