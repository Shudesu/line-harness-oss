import {
  computeUnansweredInbox,
  type UnansweredInboxResult,
} from './unanswered-inbox.js';

const DEFAULT_HOURS = 3;
const MAX_HOURS = 24 * 7;
const CATEGORY_LIMIT = 500;

export interface ActivityDigestOptions {
  hours?: number;
  now?: Date;
  unansweredLoader?: (
    db: D1Database,
    options: { page: number; pageSize: number },
  ) => Promise<UnansweredInboxResult>;
}

interface AccountRef {
  accountId: string | null;
  accountName: string;
}

interface RawFriendRow {
  id: string;
  display_name: string | null;
  line_account_id: string | null;
  account_name: string | null;
  created_at: string;
}

interface RawMessageRow {
  id: string;
  friend_id: string;
  display_name: string | null;
  line_account_id: string | null;
  account_name: string | null;
  message_type: string;
  content: string;
  source: string | null;
  created_at: string;
}

interface RawFormSubmissionRow {
  id: string;
  form_id: string;
  form_name: string;
  friend_id: string | null;
  display_name: string | null;
  line_account_id: string | null;
  account_name: string | null;
  data: string;
  created_at: string;
}

interface RawBookingRow {
  id: string;
  friend_id: string;
  display_name: string | null;
  line_account_id: string;
  account_name: string | null;
  menu_name: string;
  staff_name: string;
  starts_at: string;
  status: string;
  customer_note: string | null;
  requested_at: string;
}

interface RawEventBookingRow {
  id: string;
  friend_id: string;
  display_name: string | null;
  line_account_id: string;
  account_name: string | null;
  event_name: string;
  starts_at: string;
  status: string;
  customer_note: string | null;
  requested_at: string;
}

export function parseActivityDigestHours(value: string | undefined): number | null {
  if (value === undefined || value === '') return DEFAULT_HOURS;
  if (!/^\d+$/.test(value)) return null;
  const hours = Number(value);
  return Number.isSafeInteger(hours) && hours >= 1 && hours <= MAX_HOURS ? hours : null;
}

function formatJstSqlTimestamp(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60_000).toISOString();
  return jst.slice(0, -1);
}

function normalizeJstTimestamp(value: string): string {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  const parsed = new Date(`${value.replace(' ', 'T')}+09:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function normalizeUtcTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function accountRef(row: {
  line_account_id: string | null;
  account_name: string | null;
}): AccountRef {
  return {
    accountId: row.line_account_id,
    accountName: row.account_name ?? '(未分類)',
  };
}

function takeCategory<T>(rows: T[]): { items: T[]; truncated: boolean } {
  return {
    items: rows.slice(0, CATEGORY_LIMIT),
    truncated: rows.length > CATEGORY_LIMIT,
  };
}

export async function getActivityDigest(
  db: D1Database,
  options: ActivityDigestOptions = {},
) {
  const hours = options.hours ?? DEFAULT_HOURS;
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > MAX_HOURS) {
    throw new RangeError(`hours must be an integer between 1 and ${MAX_HOURS}`);
  }

  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - hours * 60 * 60_000);
  const sinceUtc = since.toISOString();
  const sinceJst = formatJstSqlTimestamp(since);
  const queryLimit = CATEGORY_LIMIT + 1;
  const unansweredLoader = options.unansweredLoader ?? computeUnansweredInbox;

  const [
    friendsResult,
    messagesResult,
    formsResult,
    bookingsResult,
    eventBookingsResult,
    unanswered,
  ] = await Promise.all([
    db.prepare(
      `/* activity-digest:friends */
       SELECT f.id, f.display_name, f.line_account_id,
              la.name AS account_name, f.created_at
         FROM friends f
         LEFT JOIN line_accounts la ON la.id = f.line_account_id
        WHERE julianday(f.created_at) >= julianday(?)
        ORDER BY f.created_at DESC
        LIMIT ?`,
    ).bind(sinceJst, queryLimit).all<RawFriendRow>(),
    db.prepare(
      `/* activity-digest:messages */
       SELECT ml.id, ml.friend_id, f.display_name,
              COALESCE(ml.line_account_id, f.line_account_id) AS line_account_id,
              la.name AS account_name,
              ml.message_type, ml.content, ml.source, ml.created_at
         FROM messages_log ml
         INNER JOIN friends f ON f.id = ml.friend_id
         LEFT JOIN line_accounts la
           ON la.id = COALESCE(ml.line_account_id, f.line_account_id)
        WHERE ml.direction = 'incoming'
          AND julianday(ml.created_at) >= julianday(?)
        ORDER BY ml.created_at DESC
        LIMIT ?`,
    ).bind(sinceJst, queryLimit).all<RawMessageRow>(),
    db.prepare(
      `/* activity-digest:forms */
       SELECT fs.id, fs.form_id, fm.name AS form_name,
              fs.friend_id, f.display_name, f.line_account_id,
              la.name AS account_name, fs.data, fs.created_at
         FROM form_submissions fs
         INNER JOIN forms fm ON fm.id = fs.form_id
         LEFT JOIN friends f ON f.id = fs.friend_id
         LEFT JOIN line_accounts la ON la.id = f.line_account_id
        WHERE julianday(fs.created_at) >= julianday(?)
        ORDER BY fs.created_at DESC
        LIMIT ?`,
    ).bind(sinceJst, queryLimit).all<RawFormSubmissionRow>(),
    db.prepare(
      `/* activity-digest:bookings */
       SELECT b.id, b.friend_id, f.display_name,
              b.line_account_id, la.name AS account_name,
              m.name AS menu_name, s.display_name AS staff_name,
              b.starts_at, b.status, b.customer_note, b.requested_at
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN friends f ON f.id = b.friend_id
         LEFT JOIN line_accounts la ON la.id = b.line_account_id
        WHERE julianday(b.requested_at) >= julianday(?)
        ORDER BY b.requested_at DESC
        LIMIT ?`,
    ).bind(sinceUtc, queryLimit).all<RawBookingRow>(),
    db.prepare(
      `/* activity-digest:event-bookings */
       SELECT b.id, b.friend_id, f.display_name,
              b.line_account_id, la.name AS account_name,
              e.name AS event_name, es.starts_at,
              b.status, b.customer_note, b.requested_at
         FROM event_bookings b
         INNER JOIN events e ON e.id = b.event_id
         INNER JOIN event_slots es ON es.id = b.slot_id
         LEFT JOIN friends f ON f.id = b.friend_id
         LEFT JOIN line_accounts la ON la.id = b.line_account_id
        WHERE julianday(b.requested_at) >= julianday(?)
        ORDER BY b.requested_at DESC
        LIMIT ?`,
    ).bind(sinceUtc, queryLimit).all<RawEventBookingRow>(),
    unansweredLoader(db, { page: 1, pageSize: 2000 }),
  ]);

  const friends = takeCategory((friendsResult.results ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    ...accountRef(row),
    occurredAt: normalizeJstTimestamp(row.created_at),
  })));
  const incomingMessages = takeCategory((messagesResult.results ?? []).map((row) => ({
    id: row.id,
    friendId: row.friend_id,
    displayName: row.display_name,
    ...accountRef(row),
    messageType: row.message_type,
    content: row.content,
    source: row.source,
    occurredAt: normalizeJstTimestamp(row.created_at),
  })));
  const formSubmissions = takeCategory((formsResult.results ?? []).map((row) => ({
    id: row.id,
    formId: row.form_id,
    formName: row.form_name,
    friendId: row.friend_id,
    displayName: row.display_name,
    ...accountRef(row),
    data: parseJsonObject(row.data),
    occurredAt: normalizeJstTimestamp(row.created_at),
  })));
  const bookingRequests = takeCategory((bookingsResult.results ?? []).map((row) => ({
    id: row.id,
    friendId: row.friend_id,
    displayName: row.display_name,
    ...accountRef(row),
    menuName: row.menu_name,
    staffName: row.staff_name,
    startsAt: normalizeUtcTimestamp(row.starts_at),
    status: row.status,
    customerNote: row.customer_note,
    occurredAt: normalizeUtcTimestamp(row.requested_at),
  })));
  const eventBookingRequests = takeCategory((eventBookingsResult.results ?? []).map((row) => ({
    id: row.id,
    friendId: row.friend_id,
    displayName: row.display_name,
    ...accountRef(row),
    eventName: row.event_name,
    startsAt: normalizeUtcTimestamp(row.starts_at),
    status: row.status,
    customerNote: row.customer_note,
    occurredAt: normalizeUtcTimestamp(row.requested_at),
  })));

  const actionGroups = [
    friends.items,
    incomingMessages.items,
    formSubmissions.items,
    bookingRequests.items,
    eventBookingRequests.items,
  ];
  const byAccountMap = new Map<string, { accountId: string | null; accountName: string; count: number }>();
  for (const item of actionGroups.flat()) {
    const key = item.accountId ?? '__unassigned__';
    const current = byAccountMap.get(key);
    if (current) current.count += 1;
    else byAccountMap.set(key, {
      accountId: item.accountId,
      accountName: item.accountName,
      count: 1,
    });
  }

  const unansweredByAccount = new Map<string, { accountId: string; accountName: string; count: number }>();
  let oldestUnansweredAt: string | null = null;
  for (const row of unanswered.rows) {
    const current = unansweredByAccount.get(row.accountId);
    if (current) current.count += 1;
    else unansweredByAccount.set(row.accountId, {
      accountId: row.accountId,
      accountName: row.accountName,
      count: 1,
    });
    if (oldestUnansweredAt === null || row.lastIncomingAt < oldestUnansweredAt) {
      oldestUnansweredAt = row.lastIncomingAt;
    }
  }

  return {
    generatedAt: now.toISOString(),
    window: {
      hours,
      since: sinceUtc,
      until: now.toISOString(),
    },
    summary: {
      totalNewActions: actionGroups.reduce((sum, group) => sum + group.length, 0),
      newFriends: friends.items.length,
      incomingMessages: incomingMessages.items.length,
      formSubmissions: formSubmissions.items.length,
      bookingRequests: bookingRequests.items.length,
      eventBookingRequests: eventBookingRequests.items.length,
      unansweredTotal: unanswered.total,
      newActionsByAccount: [...byAccountMap.values()].sort((a, b) => b.count - a.count),
    },
    newActions: {
      friends,
      incomingMessages,
      formSubmissions,
      bookingRequests,
      eventBookingRequests,
    },
    unanswered: {
      total: unanswered.total,
      rows: unanswered.rows,
      truncated: unanswered.rows.length < unanswered.total,
      byAccount: [...unansweredByAccount.values()].sort((a, b) => b.count - a.count),
      oldestWaitMinutes: oldestUnansweredAt === null
        ? null
        : Math.max(0, Math.floor((now.getTime() - new Date(oldestUnansweredAt).getTime()) / 60_000)),
    },
  };
}
