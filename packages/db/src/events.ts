import { addTagToFriend, removeTagFromFriend } from './tags.js';
import { jstNow } from './utils.js';

export type UserEventSource =
  | 'line'
  | 'liff'
  | 'web'
  | 'reservation'
  | 'jalan'
  | 'gmail'
  | 'tracked_link'
  | 'broadcast'
  | 'automation'
  | 'system';

export interface UserEvent {
  id: string;
  line_account_id: string | null;
  friend_id: string | null;
  line_user_id: string | null;
  event_type: string;
  event_name: string | null;
  event_source: UserEventSource;
  subject_type: string | null;
  subject_id: string | null;
  occurred_at: string;
  received_at: string;
  session_id: string | null;
  request_id: string | null;
  idempotency_key: string | null;
  metadata: string;
  created_at: string;
}

export interface EventDefinition {
  id: string;
  event_type: string;
  name: string;
  category: string;
  description: string | null;
  is_system: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface EventTagRule {
  id: string;
  name: string;
  event_type: string;
  conditions: string;
  action: 'add_tag' | 'remove_tag';
  tag_id: string;
  priority: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface RecordUserEventInput {
  id?: string;
  lineAccountId?: string | null;
  friendId?: string | null;
  lineUserId?: string | null;
  eventType: string;
  eventName?: string | null;
  eventSource?: UserEventSource;
  subjectType?: string | null;
  subjectId?: string | null;
  occurredAt?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | string | null;
}

export interface ListUserEventsFilters {
  friendId?: string | null;
  lineAccountId?: string | null;
  eventType?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
  offset?: number;
}

export interface CreateEventTagRuleInput {
  name: string;
  eventType: string;
  conditions?: Record<string, unknown> | string | null;
  action: 'add_tag' | 'remove_tag';
  tagId: string;
  priority?: number;
  isActive?: boolean;
}

const eventSchemaReady = new WeakSet<D1Database>();

async function ensureEventSchema(db: D1Database): Promise<void> {
  if (eventSchemaReady.has(db)) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS user_events (
      id TEXT PRIMARY KEY,
      line_account_id TEXT,
      friend_id TEXT REFERENCES friends (id) ON DELETE SET NULL,
      line_user_id TEXT,
      event_type TEXT NOT NULL,
      event_name TEXT,
      event_source TEXT NOT NULL DEFAULT 'system'
        CHECK (event_source IN ('line', 'liff', 'web', 'reservation', 'jalan', 'gmail', 'tracked_link', 'broadcast', 'automation', 'system')),
      subject_type TEXT,
      subject_id TEXT,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      session_id TEXT,
      request_id TEXT,
      idempotency_key TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
    )`,
  ).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_events_friend_time ON user_events (friend_id, occurred_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_events_type_time ON user_events (event_type, occurred_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_events_subject ON user_events (subject_type, subject_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_events_line_account ON user_events (line_account_id, occurred_at)`).run();
  await db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_events_idempotency_key
     ON user_events (idempotency_key)
     WHERE idempotency_key IS NOT NULL`,
  ).run();

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS event_definitions (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
    )`,
  ).run();

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS event_tag_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      conditions TEXT NOT NULL DEFAULT '{}',
      action TEXT NOT NULL CHECK (action IN ('add_tag', 'remove_tag')),
      tag_id TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
      priority INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
    )`,
  ).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_event_tag_rules_event ON event_tag_rules (event_type, is_active, priority)`).run();
  await ensureSystemEventDefinitions(db);
  eventSchemaReady.add(db);
}

export function resetEventSchemaCacheForTest(db?: D1Database): void {
  if (!db) return;
  eventSchemaReady.delete(db);
}

const SYSTEM_EVENT_DEFINITIONS = [
  ['reservation.created', '予約作成', 'reservation', '予約が作成された'],
  ['reservation.confirmed', '予約確定', 'reservation', '仮予約が確定された'],
  ['reservation.cancelled', '予約キャンセル', 'reservation', '予約がキャンセルされた'],
  ['reservation.completed', '来園完了', 'reservation', '予約が来園完了になった'],
  ['reservation.no_show', '無断キャンセル', 'reservation', '予約がno_showになった'],
  ['tracked_link.click', 'トラッキングリンククリック', 'campaign', '短縮/計測リンクがクリックされた'],
  ['rich_menu.tap', 'リッチメニュータップ', 'line', 'リッチメニューのpostbackが押された'],
  ['liff.booking.open', 'LIFF予約画面表示', 'liff', '予約画面が開かれた'],
  ['liff.booking.resource_selected', '予約対象選択', 'liff', 'LIFF予約画面で予約対象が選択された'],
  ['liff.booking.menu_selected', 'メニュー選択', 'liff', 'LIFF予約画面でメニューが選択された'],
  ['liff.booking.date_selected', '日付選択', 'liff', 'LIFF予約画面で日付が選択された'],
  ['liff.booking.slot_selected', '時間枠選択', 'liff', 'LIFF予約画面で時間枠が選択された'],
  ['liff.booking.confirm_open', '予約確認画面表示', 'liff', 'LIFF予約画面で確認画面が表示された'],
  ['liff.booking.completed', '予約完了', 'liff', 'LIFF予約画面から予約が完了した'],
  ['liff.mine.open', '自分の予約一覧表示', 'liff', 'LIFFで自分の予約一覧が表示された'],
  ['liff.cancel.open', 'キャンセル確認表示', 'liff', 'LIFFでキャンセル確認画面が表示された'],
] as const;

async function ensureSystemEventDefinitions(db: D1Database): Promise<void> {
  const now = jstNow();
  for (const [eventType, name, category, description] of SYSTEM_EVENT_DEFINITIONS) {
    await db.prepare(
      `INSERT INTO event_definitions (id, event_type, name, category, description, is_system, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
       ON CONFLICT(event_type) DO UPDATE SET
         name = excluded.name,
         category = excluded.category,
         description = COALESCE(event_definitions.description, excluded.description),
         is_system = 1,
         is_active = 1,
         updated_at = excluded.updated_at`,
    ).bind(crypto.randomUUID(), eventType, name, category, description, now, now).run();
  }
}

function metadataToText(metadata: Record<string, unknown> | string | null | undefined): string {
  if (!metadata) return '{}';
  if (typeof metadata === 'string') return metadata.trim() || '{}';
  return JSON.stringify(metadata);
}

export async function recordUserEvent(db: D1Database, input: RecordUserEventInput): Promise<UserEvent> {
  await ensureEventSchema(db);
  const now = jstNow();
  const id = input.id ?? crypto.randomUUID();
  const occurredAt = input.occurredAt || now;
  const receivedAt = now;
  const metadata = metadataToText(input.metadata);

  await db.prepare(
    `INSERT OR IGNORE INTO user_events
       (id, line_account_id, friend_id, line_user_id, event_type, event_name, event_source,
        subject_type, subject_id, occurred_at, received_at, session_id, request_id, idempotency_key, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    input.lineAccountId ?? null,
    input.friendId ?? null,
    input.lineUserId ?? null,
    input.eventType,
    input.eventName ?? null,
    input.eventSource ?? 'system',
    input.subjectType ?? null,
    input.subjectId ?? null,
    occurredAt,
    receivedAt,
    input.sessionId ?? null,
    input.requestId ?? null,
    normalizeNullable(input.idempotencyKey),
    metadata,
    now,
  ).run();

  const event = await db.prepare(`SELECT * FROM user_events WHERE id = ?`).bind(id).first<UserEvent>();
  if (event) {
    await applyEventTagRules(db, event);
    return event;
  }

  const existing = input.idempotencyKey
    ? await db.prepare(`SELECT * FROM user_events WHERE idempotency_key = ?`).bind(input.idempotencyKey).first<UserEvent>()
    : null;
  if (!existing) throw new Error('failed to record user event');
  return existing;
}

export async function listUserEvents(db: D1Database, filters: ListUserEventsFilters = {}): Promise<UserEvent[]> {
  await ensureEventSchema(db);
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters.friendId) {
    where.push('friend_id = ?');
    values.push(filters.friendId);
  }
  if (filters.lineAccountId) {
    where.push('line_account_id = ?');
    values.push(filters.lineAccountId);
  }
  if (filters.eventType) {
    where.push('event_type = ?');
    values.push(filters.eventType);
  }
  if (filters.dateFrom) {
    where.push('occurred_at >= ?');
    values.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    where.push('occurred_at <= ?');
    values.push(filters.dateTo);
  }

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  const sql = `SELECT * FROM user_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY occurred_at DESC LIMIT ? OFFSET ?`;
  const result = await db.prepare(sql).bind(...values, limit, offset).all<UserEvent>();
  return result.results ?? [];
}

export async function getEventDefinitions(db: D1Database): Promise<EventDefinition[]> {
  await ensureEventSchema(db);
  const result = await db.prepare(`SELECT * FROM event_definitions WHERE is_active = 1 ORDER BY category ASC, event_type ASC`).all<EventDefinition>();
  return result.results ?? [];
}

export async function createEventTagRule(db: D1Database, input: CreateEventTagRuleInput): Promise<EventTagRule> {
  await ensureEventSchema(db);
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(
    `INSERT INTO event_tag_rules (id, name, event_type, conditions, action, tag_id, priority, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    input.name,
    input.eventType,
    metadataToText(input.conditions ?? {}),
    input.action,
    input.tagId,
    input.priority ?? 0,
    input.isActive === false ? 0 : 1,
    now,
    now,
  ).run();
  return (await db.prepare(`SELECT * FROM event_tag_rules WHERE id = ?`).bind(id).first<EventTagRule>())!;
}

export async function getEventTagRules(db: D1Database): Promise<EventTagRule[]> {
  await ensureEventSchema(db);
  const result = await db.prepare(`SELECT * FROM event_tag_rules ORDER BY priority DESC, created_at DESC`).all<EventTagRule>();
  return result.results ?? [];
}

export async function deleteEventTagRule(db: D1Database, id: string): Promise<void> {
  await ensureEventSchema(db);
  await db.prepare(`DELETE FROM event_tag_rules WHERE id = ?`).bind(id).run();
}

async function applyEventTagRules(db: D1Database, event: UserEvent): Promise<void> {
  if (!event.friend_id) return;
  const result = await db.prepare(
    `SELECT * FROM event_tag_rules
     WHERE event_type = ? AND is_active = 1
     ORDER BY priority DESC, created_at ASC`,
  ).bind(event.event_type).all<EventTagRule>();

  for (const rule of result.results ?? []) {
    if (!matchesConditions(rule.conditions, event)) continue;
    if (rule.action === 'add_tag') {
      await addTagToFriend(db, event.friend_id, rule.tag_id, {
        source: 'automation',
        sourceEventId: event.id,
        metadata: JSON.stringify({ eventType: event.event_type, ruleId: rule.id }),
      });
    } else {
      await removeTagFromFriend(db, event.friend_id, rule.tag_id);
    }
  }
}

function matchesConditions(rawConditions: string, event: UserEvent): boolean {
  const conditions = parseJsonObject(rawConditions);
  const metadata = parseJsonObject(event.metadata);
  for (const [key, expected] of Object.entries(conditions)) {
    const actual = eventFieldValue(event, metadata, key);
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if (!matchOperator(actual, expected as Record<string, unknown>)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function eventFieldValue(event: UserEvent, metadata: Record<string, unknown>, key: string): unknown {
  if (key.startsWith('metadata.')) return metadata[key.slice('metadata.'.length)];
  if (key in metadata) return metadata[key];
  const eventRecord = event as unknown as Record<string, unknown>;
  return eventRecord[toSnakeCase(key)] ?? eventRecord[key];
}

function matchOperator(actual: unknown, condition: Record<string, unknown>): boolean {
  const actualNumber = typeof actual === 'number' ? actual : Number(actual);
  if ('eq' in condition && actual !== condition.eq) return false;
  if ('neq' in condition && actual === condition.neq) return false;
  if ('gte' in condition && !(actualNumber >= Number(condition.gte))) return false;
  if ('lte' in condition && !(actualNumber <= Number(condition.lte))) return false;
  if ('in' in condition && Array.isArray(condition.in) && !condition.in.includes(actual)) return false;
  return true;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
