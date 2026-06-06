import type {
  ExternalReservationSourceRow,
  Reservation,
} from '@line-crm/db';
import { listExternalReservationSources, listReservations } from '@line-crm/db';
import { resolveBindingValue, type SecretLike } from './bindings.js';
import { getAccountSetting } from './account-settings-store.js';

export type DiscordNotificationTopic = 'reservation' | 'daily' | 'review';

export interface DiscordNotificationEnv {
  DB?: D1Database;
  DISCORD_WEBHOOK_URL?: SecretLike;
  DISCORD_RESERVATION_WEBHOOK_URL?: SecretLike;
  DISCORD_DAILY_WEBHOOK_URL?: SecretLike;
  DISCORD_REVIEW_WEBHOOK_URL?: SecretLike;
  DISCORD_RESERVATION_THREAD_ID?: SecretLike;
  DISCORD_DAILY_THREAD_ID?: SecretLike;
  DISCORD_REVIEW_THREAD_ID?: SecretLike;
  WEB_URL?: SecretLike;
  NEXT_PUBLIC_WEB_URL?: SecretLike;
  WORKER_URL?: SecretLike;
}

type DiscordEmbed = {
  title: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
};

type DiscordPayload = {
  content?: string;
  embeds?: DiscordEmbed[];
  components?: Array<{
    type: 1;
    components: Array<{
      type: 2;
      style: 5;
      label: string;
      url: string;
    }>;
  }>;
};

const TOPIC_COLOR: Record<DiscordNotificationTopic, number> = {
  reservation: 0x69a3d0,
  daily: 0x06c755,
  review: 0xf59e0b,
};

export async function notifyReservationToDiscord(
  db: D1Database,
  reservation: Reservation,
  env: DiscordNotificationEnv,
  event: 'created' | 'cancelled' | 'completed',
): Promise<void> {
  const title = event === 'created'
    ? '新規予約'
    : event === 'cancelled'
      ? '予約キャンセル'
      : '来園済み';
  const color = event === 'cancelled' ? 0xef4444 : event === 'completed' ? 0x22c55e : TOPIC_COLOR.reservation;

  await sendDiscordNotification(env, 'reservation', {
    embeds: [{
      title: `🫐 ${title}`,
      color,
      fields: reservationFields(reservation),
      footer: { text: `source=${reservation.source} / status=${reservation.status}` },
      timestamp: new Date().toISOString(),
    }],
    components: reservationLinkComponents(await reservationOpsUrl(env, reservation)),
  });

  await rememberDiscordNotification(db, `reservation:${event}:${reservation.id}:${reservation.updated_at}`, event, reservation.reservation_date, true);
}

export async function notifyExternalReviewToDiscord(
  env: DiscordNotificationEnv,
  source: Pick<ExternalReservationSourceRow, 'source' | 'event_type' | 'external_id' | 'dedupe_key' | 'last_error' | 'received_at' | 'created_at'>,
): Promise<void> {
  await sendDiscordNotification(env, 'review', {
    embeds: [{
      title: '⚠️ 外部予約 要確認',
      color: TOPIC_COLOR.review,
      fields: [
        { name: '取込元', value: source.source, inline: true },
        { name: 'イベント', value: source.event_type, inline: true },
        { name: '外部ID', value: safe(source.external_id ?? source.dedupe_key), inline: true },
        { name: '理由', value: safe(source.last_error), inline: false },
        { name: '受信時刻', value: safe(source.received_at ?? source.created_at), inline: false },
      ],
      timestamp: new Date().toISOString(),
    }],
    components: genericLinkComponents(await reservationOpsBaseUrl(env), '要確認を開く'),
  });
}

export async function notifyGmailImportRunToDiscord(
  env: DiscordNotificationEnv,
  result: {
    runId: string | null;
    ruleId: string;
    fetchedCount: number;
    importedCount: number;
    reviewCount: number;
    failedCount: number;
    items: Array<{ gmailMessageId: string; eventType: string; parseStatus: string; externalId?: string | null; error?: string | null }>;
  },
): Promise<void> {
  if (result.reviewCount === 0 && result.failedCount === 0) return;
  const examples = result.items
    .filter((item) => item.parseStatus === 'needs_review' || item.parseStatus === 'failed')
    .slice(0, 5)
    .map((item) => `- ${item.eventType} / ${item.parseStatus} / ${item.externalId ?? item.gmailMessageId}${item.error ? `: ${item.error}` : ''}`)
    .join('\n');

  await sendDiscordNotification(env, 'review', {
    embeds: [{
      title: '⚠️ Gmailじゃらん取り込み 要確認',
      color: TOPIC_COLOR.review,
      fields: [
        { name: '取得', value: String(result.fetchedCount), inline: true },
        { name: '取込', value: String(result.importedCount), inline: true },
        { name: '要確認', value: String(result.reviewCount), inline: true },
        { name: '失敗', value: String(result.failedCount), inline: true },
        { name: '例', value: examples || 'なし', inline: false },
      ],
      footer: { text: `rule=${result.ruleId}${result.runId ? ` / run=${result.runId}` : ''}` },
      timestamp: new Date().toISOString(),
    }],
    components: genericLinkComponents(await reservationOpsBaseUrl(env), 'reservation-opsを開く'),
  });
}

export async function processDiscordDailyReservationSummary(
  db: D1Database,
  env: DiscordNotificationEnv,
  now = new Date(),
): Promise<void> {
  const jst = toJstParts(now);
  if (jst.hour !== 8 || jst.minute >= 10) return;

  const reservations = await listReservations(db, { date: jst.date, limit: 500 });
  const activeReservations = reservations.filter((item) => item.status === 'pending' || item.status === 'confirmed');
  if (activeReservations.length === 0) return;

  const runId = `daily-summary:${jst.date}`;
  const inserted = await reserveDailyNotificationRun(db, runId, jst.date);
  if (!inserted) return;

  const reviewSources = await listExternalReservationSources(db, { parseStatus: 'needs_review', limit: 20 });
  const groupedByTime = groupReservationsByTime(activeReservations);
  const totalPeople = activeReservations.reduce((sum, item) => sum + item.total_people, 0);
  const capacityPeople = activeReservations.reduce((sum, item) => sum + item.capacity_people, 0);
  const lineCount = activeReservations.filter((item) => item.source === 'line').length;
  const jalanCount = activeReservations.filter((item) => item.source === 'jalan' || item.source === 'gmail').length;

  await sendDiscordNotification(env, 'daily', {
    content: `🫐 ${formatJapaneseDate(jst.date)} の予約サマリー`,
    embeds: [{
      title: '本日の予約情報',
      color: TOPIC_COLOR.daily,
      fields: [
        { name: '予約件数', value: `${activeReservations.length}件`, inline: true },
        { name: '人数', value: `${totalPeople}名 / 枠消費 ${capacityPeople}`, inline: true },
        { name: '経路', value: `LINE ${lineCount}件 / じゃらん ${jalanCount}件`, inline: true },
        { name: '時間別', value: groupedByTime || 'なし', inline: false },
        { name: '要確認', value: `${reviewSources.length}件`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
    components: genericLinkComponents(await reservationOpsUrl(env, { reservation_date: jst.date }), '今日の予約を開く'),
  });

  await markDailyNotificationRunSent(db, runId);
}

async function sendDiscordNotification(
  env: DiscordNotificationEnv,
  topic: DiscordNotificationTopic,
  payload: DiscordPayload,
): Promise<void> {
  const url = await resolveDiscordWebhookUrl(env, topic);
  if (!url) return;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      ...payload,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Discord webhook error ${response.status}: ${text}`);
  }
}

async function resolveDiscordWebhookUrl(env: DiscordNotificationEnv, topic: DiscordNotificationTopic): Promise<string> {
  const db = env.DB;
  const settingTopicUrl = db
    ? await getAccountSetting(
      db,
      env as DiscordNotificationEnv & { DB: D1Database },
      topic === 'reservation'
        ? 'discord.reservation_webhook_url'
        : topic === 'daily'
          ? 'discord.daily_webhook_url'
          : 'discord.review_webhook_url',
    ).catch(() => '')　
    : '';
  const topicUrl = await resolveBindingValue(
    topic === 'reservation'
      ? env.DISCORD_RESERVATION_WEBHOOK_URL
      : topic === 'daily'
        ? env.DISCORD_DAILY_WEBHOOK_URL
        : env.DISCORD_REVIEW_WEBHOOK_URL,
  );
  const settingBaseUrl = db
    ? await getAccountSetting(db, env as DiscordNotificationEnv & { DB: D1Database }, 'discord.webhook_url').catch(() => '')
    : '';
  const baseUrl = settingTopicUrl || topicUrl || settingBaseUrl || await resolveBindingValue(env.DISCORD_WEBHOOK_URL);
  if (!baseUrl) return '';

  const settingThreadId = db
    ? await getAccountSetting(
      db,
      env as DiscordNotificationEnv & { DB: D1Database },
      topic === 'reservation'
        ? 'discord.reservation_thread_id'
        : topic === 'daily'
          ? 'discord.daily_thread_id'
          : 'discord.review_thread_id',
    ).catch(() => '')
    : '';
  const threadId = await resolveBindingValue(
    topic === 'reservation'
      ? env.DISCORD_RESERVATION_THREAD_ID
      : topic === 'daily'
        ? env.DISCORD_DAILY_THREAD_ID
        : env.DISCORD_REVIEW_THREAD_ID,
  );
  const resolvedThreadId = settingThreadId || threadId;
  if (!resolvedThreadId || baseUrl.includes('thread_id=')) return baseUrl;

  const url = new URL(baseUrl);
  url.searchParams.set('thread_id', resolvedThreadId);
  return url.toString();
}

function reservationFields(reservation: Reservation): DiscordEmbed['fields'] {
  return [
    { name: '日時', value: `${reservation.reservation_date} ${timeRange(reservation)}`, inline: false },
    { name: '名前', value: safe(reservation.customer_name_snapshot), inline: true },
    { name: '人数', value: peopleText(reservation), inline: true },
    { name: '料金', value: amountText(reservation), inline: true },
    { name: '電話', value: safe(reservation.customer_phone_snapshot), inline: true },
    { name: 'メール', value: safe(reservation.customer_email_snapshot), inline: true },
  ];
}

function reservationLinkComponents(url: string): DiscordPayload['components'] {
  return genericLinkComponents(url, '予約を開く');
}

function genericLinkComponents(url: string, label: string): DiscordPayload['components'] {
  if (!url) return undefined;
  return [{
    type: 1,
    components: [{
      type: 2,
      style: 5,
      label,
      url,
    }],
  }];
}

async function reservationOpsUrl(env: DiscordNotificationEnv, reservation: { id?: string; reservation_date?: string | null }): Promise<string> {
  const base = await reservationOpsBaseUrl(env);
  if (!base) return '';
  const url = new URL('/reservation-ops', base);
  if (reservation.reservation_date) url.searchParams.set('date', reservation.reservation_date);
  if ('id' in reservation && reservation.id) url.searchParams.set('reservationId', reservation.id);
  return url.toString();
}

async function reservationOpsBaseUrl(env: DiscordNotificationEnv): Promise<string> {
  const webUrl = await resolveBindingValue(env.WEB_URL) || await resolveBindingValue(env.NEXT_PUBLIC_WEB_URL);
  if (webUrl) return webUrl;
  return resolveBindingValue(env.WORKER_URL);
}

function peopleText(reservation: Reservation): string {
  return [
    `大人${reservation.adult_count}`,
    `小学生${reservation.child_count}`,
    `幼児${reservation.infant_count}`,
    `3歳以下${reservation.under_three_count}`,
  ].join(' / ');
}

function amountText(reservation: Reservation): string {
  if (reservation.total_amount === null || reservation.total_amount === undefined) return '-';
  return `${Number(reservation.total_amount).toLocaleString('ja-JP')}円`;
}

function timeRange(reservation: Pick<Reservation, 'start_at' | 'end_at'>): string {
  return `${reservation.start_at.slice(11, 16)}-${reservation.end_at.slice(11, 16)}`;
}

function groupReservationsByTime(reservations: Reservation[]): string {
  const groups = new Map<string, Reservation[]>();
  for (const reservation of reservations) {
    const key = timeRange(reservation);
    groups.set(key, [...groups.get(key) ?? [], reservation]);
  }
  return Array.from(groups.entries())
    .map(([time, items]) => {
      const people = items.reduce((sum, item) => sum + item.total_people, 0);
      const names = items.map((item) => item.customer_name_snapshot || '名前未設定').slice(0, 4).join('、');
      const more = items.length > 4 ? ` 他${items.length - 4}件` : '';
      return `${time}: ${items.length}件 / ${people}名（${names}${more}）`;
    })
    .join('\n')
    .slice(0, 1000);
}

function safe(value: string | null | undefined): string {
  return value?.trim() || '-';
}

function toJstParts(date: Date): { date: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function formatJapaneseDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

async function ensureDiscordNotificationRunsTable(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS discord_notification_runs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT
    )`,
  ).run();
}

async function reserveDailyNotificationRun(db: D1Database, id: string, date: string): Promise<boolean> {
  await ensureDiscordNotificationRunsTable(db);
  const result = await db.prepare(
    `INSERT OR IGNORE INTO discord_notification_runs (id, type, target_date, status)
     VALUES (?, 'daily_summary', ?, 'pending')`,
  ).bind(id, date).run();
  return result.meta.changes > 0;
}

async function markDailyNotificationRunSent(db: D1Database, id: string): Promise<void> {
  await ensureDiscordNotificationRunsTable(db);
  await db.prepare(
    `UPDATE discord_notification_runs SET status = 'sent', sent_at = datetime('now') WHERE id = ?`,
  ).bind(id).run();
}

async function rememberDiscordNotification(
  db: D1Database,
  id: string,
  type: string,
  date: string | null,
  sent: boolean,
): Promise<void> {
  await ensureDiscordNotificationRunsTable(db);
  await db.prepare(
    `INSERT OR IGNORE INTO discord_notification_runs (id, type, target_date, status, sent_at)
     VALUES (?, ?, ?, ?, CASE WHEN ? THEN datetime('now') ELSE NULL END)`,
  ).bind(id, type, date, sent ? 'sent' : 'pending', sent ? 1 : 0).run();
}
