/**
 * Lark 通知設定の DB ヘルパー。
 *
 * 用途: hyhome Harness の各種イベント (友だち追加・フォーム回答・未返信タイムアウト等) を
 * Lark に転送する設定を CRUD する。
 *
 * 設計のポイント:
 * - 通知本文 (PII を含む可能性あり) は logs テーブルに保存しない
 * - HTTP ステータス・所要 ms・エラー文言だけ残してデバッグに使う
 */

import { jstNow } from './utils';

export type LarkEventType =
  | 'friend_added'
  | 'friend_blocked'
  | 'form_submitted'
  | 'unread_timeout'
  | 'daily_summary';

export type LarkTargetType = 'chat' | 'user' | 'email';

export interface LarkNotification {
  id: string;
  line_account_id: string;
  name: string;
  event_type: LarkEventType;
  target_type: LarkTargetType;
  target_id: string;
  template_text: string | null;
  filter_form_id: string | null;
  unread_threshold_minutes: number;
  is_enabled: number;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export async function listLarkNotifications(
  db: D1Database,
  lineAccountId?: string,
): Promise<LarkNotification[]> {
  if (lineAccountId) {
    const result = await db
      .prepare(
        'SELECT * FROM lark_notifications WHERE line_account_id = ? ORDER BY event_type, created_at DESC',
      )
      .bind(lineAccountId)
      .all<LarkNotification>();
    return result.results ?? [];
  }
  const result = await db
    .prepare('SELECT * FROM lark_notifications ORDER BY line_account_id, event_type, created_at DESC')
    .all<LarkNotification>();
  return result.results ?? [];
}

export async function getEnabledLarkNotifications(
  db: D1Database,
  lineAccountId: string,
  eventType: LarkEventType,
): Promise<LarkNotification[]> {
  const result = await db
    .prepare(
      'SELECT * FROM lark_notifications WHERE line_account_id = ? AND event_type = ? AND is_enabled = 1',
    )
    .bind(lineAccountId, eventType)
    .all<LarkNotification>();
  return result.results ?? [];
}

export async function getLarkNotification(
  db: D1Database,
  id: string,
): Promise<LarkNotification | null> {
  const row = await db
    .prepare('SELECT * FROM lark_notifications WHERE id = ?')
    .bind(id)
    .first<LarkNotification>();
  return row ?? null;
}

export interface CreateLarkNotificationInput {
  lineAccountId: string;
  name: string;
  eventType: LarkEventType;
  targetType: LarkTargetType;
  targetId: string;
  templateText?: string | null;
  filterFormId?: string | null;
  unreadThresholdMinutes?: number;
  memo?: string | null;
}

export async function createLarkNotification(
  db: D1Database,
  input: CreateLarkNotificationInput,
): Promise<LarkNotification> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO lark_notifications
        (id, line_account_id, name, event_type, target_type, target_id,
         template_text, filter_form_id, unread_threshold_minutes,
         is_enabled, memo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.name,
      input.eventType,
      input.targetType,
      input.targetId,
      input.templateText ?? null,
      input.filterFormId ?? null,
      input.unreadThresholdMinutes ?? 30,
      input.memo ?? null,
      now,
      now,
    )
    .run();
  const row = await getLarkNotification(db, id);
  if (!row) throw new Error('failed to read back lark_notification');
  return row;
}

export interface UpdateLarkNotificationInput {
  name?: string;
  targetType?: LarkTargetType;
  targetId?: string;
  templateText?: string | null;
  filterFormId?: string | null;
  unreadThresholdMinutes?: number;
  isEnabled?: boolean;
  memo?: string | null;
}

export async function updateLarkNotification(
  db: D1Database,
  id: string,
  input: UpdateLarkNotificationInput,
): Promise<LarkNotification | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    binds.push(input.name);
  }
  if (input.targetType !== undefined) {
    sets.push('target_type = ?');
    binds.push(input.targetType);
  }
  if (input.targetId !== undefined) {
    sets.push('target_id = ?');
    binds.push(input.targetId);
  }
  if (input.templateText !== undefined) {
    sets.push('template_text = ?');
    binds.push(input.templateText);
  }
  if (input.filterFormId !== undefined) {
    sets.push('filter_form_id = ?');
    binds.push(input.filterFormId);
  }
  if (input.unreadThresholdMinutes !== undefined) {
    sets.push('unread_threshold_minutes = ?');
    binds.push(input.unreadThresholdMinutes);
  }
  if (input.isEnabled !== undefined) {
    sets.push('is_enabled = ?');
    binds.push(input.isEnabled ? 1 : 0);
  }
  if (input.memo !== undefined) {
    sets.push('memo = ?');
    binds.push(input.memo);
  }
  if (sets.length === 0) return getLarkNotification(db, id);
  sets.push('updated_at = ?');
  binds.push(jstNow());
  binds.push(id);
  await db
    .prepare(`UPDATE lark_notifications SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  return getLarkNotification(db, id);
}

export async function deleteLarkNotification(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM lark_notifications WHERE id = ?').bind(id).run();
}

export type LarkLogStatus = 'sent' | 'failed' | 'timeout' | 'skipped';

export async function logLarkNotificationResult(
  db: D1Database,
  notificationId: string,
  args: {
    status: LarkLogStatus;
    httpStatus?: number;
    durationMs?: number;
    errorMessage?: string;
    triggerSummary?: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO lark_notification_logs
        (id, lark_notification_id, status, http_status, duration_ms, error_message, trigger_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      notificationId,
      args.status,
      args.httpStatus ?? null,
      args.durationMs ?? null,
      args.errorMessage ?? null,
      args.triggerSummary ?? null,
      jstNow(),
    )
    .run();
}

export async function pruneLarkNotificationLogs(
  db: D1Database,
  notificationId: string,
  keepCount: number = 200,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM lark_notification_logs
        WHERE lark_notification_id = ?
          AND id NOT IN (
            SELECT id FROM lark_notification_logs
             WHERE lark_notification_id = ?
             ORDER BY created_at DESC
             LIMIT ?
          )`,
    )
    .bind(notificationId, notificationId, keepCount)
    .run();
}

export async function listLarkNotificationLogs(
  db: D1Database,
  notificationId: string,
  limit: number = 50,
): Promise<
  Array<{
    id: string;
    lark_notification_id: string;
    status: LarkLogStatus;
    http_status: number | null;
    duration_ms: number | null;
    error_message: string | null;
    trigger_summary: string | null;
    created_at: string;
  }>
> {
  const result = await db
    .prepare(
      `SELECT id, lark_notification_id, status, http_status, duration_ms,
              error_message, trigger_summary, created_at
         FROM lark_notification_logs
        WHERE lark_notification_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(notificationId, limit)
    .all<{
      id: string;
      lark_notification_id: string;
      status: LarkLogStatus;
      http_status: number | null;
      duration_ms: number | null;
      error_message: string | null;
      trigger_summary: string | null;
      created_at: string;
    }>();
  return result.results ?? [];
}
