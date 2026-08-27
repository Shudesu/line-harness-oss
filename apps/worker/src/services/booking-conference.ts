/**
 * 予約が確定したときに、オンライン会議URLを発行して予約に紐づける。
 *
 * 対応プロバイダは 2 つ。
 *   - 'google_meet'（既定）… Googleカレンダーのイベントに Meet を同時発行する。
 *                            追加の外部サービス契約が不要。
 *   - 'zoom'                … Zoom Server-to-Server OAuth で専用ミーティングを作る。
 *                            Zoom 側でアプリ作成と有効化が要る（無料プランは 40 分制限）。
 *
 * プロバイダの決め方は account_settings（key = 'booking_conference_provider'）が正で、
 * 行が無ければ環境変数 BOOKING_CONFERENCE_PROVIDER、それも無ければ 'google_meet'。
 *
 * Zoom を選んだ場合の順序は「Zoom 発行 → D1 保存 → Googleカレンダー登録」。
 * カレンダー登録が失敗したら発行済み Zoom を削除して元に戻す（孤児ミーティングを残さない）。
 * Google Meet を選んだ場合はカレンダー登録が発行そのものなので、登録後に URL を保存する。
 *
 * 会議URLの発行に失敗しても予約自体は成立させる（ベストエフォート）。面談日時が押さえられて
 * いることのほうが重要で、URL は後から repair で入れ直せるため。
 */

import {
  syncConfirmedBookingToGoogle,
  type GoogleCalendarCredentials,
} from './booking-calendar-sync.js';
import { createZoomMeeting, deleteZoomMeeting, zoomConfigured } from './zoom.js';

export type ConferenceProvider = 'google_meet' | 'zoom';

export interface ConferenceEnv {
  BOOKING_CONFERENCE_PROVIDER?: string;
  ZOOM_ACCOUNT_ID?: string;
  ZOOM_CLIENT_ID?: string;
  ZOOM_CLIENT_SECRET?: string;
}

const SETTINGS_KEY = 'booking_conference_provider';

function normalizeProvider(value: string | null | undefined): ConferenceProvider | null {
  if (value === 'zoom' || value === 'google_meet') return value;
  return null;
}

/** アカウント設定 → 環境変数 → 既定値 の順でプロバイダを決める。 */
export async function resolveConferenceProvider(
  db: D1Database,
  lineAccountId: string,
  env: ConferenceEnv,
): Promise<ConferenceProvider> {
  const row = await db
    .prepare(`SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?`)
    .bind(lineAccountId, SETTINGS_KEY)
    .first<{ value: string }>();
  return (
    normalizeProvider(row?.value) ??
    normalizeProvider(env.BOOKING_CONFERENCE_PROVIDER) ??
    'google_meet'
  );
}

interface BookingConferenceRow {
  line_account_id: string;
  starts_at: string;
  ends_at: string;
  menu_name: string;
  friend_name: string | null;
  conference_url: string | null;
}

async function loadBookingForConference(
  db: D1Database,
  bookingId: string,
): Promise<BookingConferenceRow | null> {
  return await db
    .prepare(
      `SELECT b.line_account_id, b.starts_at, b.ends_at, b.conference_url,
              m.name AS menu_name, f.display_name AS friend_name
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN friends f ON f.id = b.friend_id
        WHERE b.id = ? AND b.status = 'confirmed'`,
    )
    .bind(bookingId)
    .first<BookingConferenceRow>();
}

async function saveConference(
  db: D1Database,
  bookingId: string,
  provider: ConferenceProvider,
  url: string,
  externalId: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE bookings
          SET conference_provider = ?, conference_url = ?, conference_external_id = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ?`,
    )
    .bind(provider, url, externalId, bookingId)
    .run();
}

export type CalendarStatus = 'synced' | 'not_configured' | 'failed';

export interface ProvisionResult {
  provider: ConferenceProvider;
  conferenceUrl: string | null;
  calendarSynced: boolean;
  /**
   * 'failed' は Google API がエラーを返した状態で、'not_configured'（未連携）とは区別する。
   * ここを潰すと、カレンダーに予定が入っていない予約を障害として検知できなくなる。
   */
  calendarStatus: CalendarStatus;
}

function toCalendarStatus(r: { ok: boolean; synced: boolean }): CalendarStatus {
  if (!r.ok) return 'failed';
  return r.synced ? 'synced' : 'not_configured';
}

/**
 * 確定した予約に会議URLを用意し、Googleカレンダーへも登録する。
 *
 * 呼び出し側は「予約が confirmed になった直後」に1回だけ呼ぶ。
 * 例外は投げない（失敗しても予約は成立させる）。結果は戻り値と console で報告する。
 */
export async function provisionBookingConference(
  db: D1Database,
  googleCredentials: GoogleCalendarCredentials,
  env: ConferenceEnv,
  bookingId: string,
): Promise<ProvisionResult> {
  const row = await loadBookingForConference(db, bookingId);
  if (!row) {
    return {
      provider: 'google_meet',
      conferenceUrl: null,
      calendarSynced: false,
      calendarStatus: 'not_configured',
    };
  }

  const provider = await resolveConferenceProvider(db, row.line_account_id, env);

  // すでに発行済みなら作り直さない（再実行・冪等性のため）。
  if (row.conference_url) {
    const synced = await syncCalendarQuietly(db, googleCredentials, bookingId, false);
    return {
      provider,
      conferenceUrl: row.conference_url,
      calendarSynced: synced.synced,
      calendarStatus: toCalendarStatus(synced),
    };
  }

  if (provider === 'zoom') {
    const creds = zoomConfigured(env);
    if (!creds) {
      console.warn('booking conference: zoom selected but credentials are missing — skipping');
      const synced = await syncCalendarQuietly(db, googleCredentials, bookingId, false);
      return {
        provider,
        conferenceUrl: null,
        calendarSynced: synced.synced,
        calendarStatus: toCalendarStatus(synced),
      };
    }

    const durationMin = Math.max(
      1,
      Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60_000),
    );
    let created: { joinUrl: string; meetingId: string } | null = null;
    try {
      created = await createZoomMeeting(creds, {
        topic: `${row.friend_name ?? 'お客様'}｜${row.menu_name}`,
        startAt: row.starts_at,
        durationMin,
      });
      await saveConference(db, bookingId, 'zoom', created.joinUrl, created.meetingId);
    } catch (error) {
      console.error('booking conference: zoom create failed:', error);
      const synced = await syncCalendarQuietly(db, googleCredentials, bookingId, false);
      return {
        provider,
        conferenceUrl: null,
        calendarSynced: synced.synced,
        calendarStatus: toCalendarStatus(synced),
      };
    }

    // カレンダー登録が失敗したら Zoom を巻き戻す（孤児ミーティングを残さない）。
    const synced = await syncCalendarQuietly(db, googleCredentials, bookingId, false);
    if (!synced.ok) {
      try {
        await deleteZoomMeeting(creds, created.meetingId);
        await db
          .prepare(
            `UPDATE bookings
                SET conference_provider = NULL, conference_url = NULL, conference_external_id = NULL
              WHERE id = ?`,
          )
          .bind(bookingId)
          .run();
        console.warn('booking conference: rolled back zoom meeting after calendar failure');
        return {
          provider,
          conferenceUrl: null,
          calendarSynced: false,
          calendarStatus: 'failed',
        };
      } catch (error) {
        // 巻き戻しにも失敗した場合は手動掃除が要る。URLは残しておく（予約者には案内済みのため）。
        console.error('booking conference: zoom rollback failed — manual cleanup required:', error);
      }
    }
    return {
      provider,
      conferenceUrl: created.joinUrl,
      calendarSynced: synced.synced,
      calendarStatus: toCalendarStatus(synced),
    };
  }

  // google_meet: カレンダーイベントの作成そのものが Meet の発行になる。
  const synced = await syncCalendarQuietly(db, googleCredentials, bookingId, true);
  if (synced.meetUrl) {
    await saveConference(db, bookingId, 'google_meet', synced.meetUrl, null);
  }
  return {
    provider,
    conferenceUrl: synced.meetUrl ?? null,
    calendarSynced: synced.synced,
    calendarStatus: toCalendarStatus(synced),
  };
}

/** 例外を投げないカレンダー同期。ok=false は「呼び出しが失敗した」ことを示す。 */
async function syncCalendarQuietly(
  db: D1Database,
  credentials: GoogleCalendarCredentials,
  bookingId: string,
  addGoogleMeet: boolean,
): Promise<{ ok: boolean; synced: boolean; meetUrl?: string }> {
  try {
    const result = await syncConfirmedBookingToGoogle(db, credentials, bookingId, {
      addGoogleMeet,
    });
    return { ok: true, synced: result.synced, meetUrl: result.meetUrl };
  } catch (error) {
    console.error('Google Calendar sync failed:', error);
    return { ok: false, synced: false };
  }
}

/**
 * 予約が取り消されたときに、発行済みの会議を片付ける。
 * Google Meet はカレンダーイベントに紐づくので、イベント削除で一緒に消える（ここでは何もしない）。
 */
export async function releaseBookingConference(
  db: D1Database,
  env: ConferenceEnv,
  bookingId: string,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT conference_provider, conference_external_id
         FROM bookings WHERE id = ?`,
    )
    .bind(bookingId)
    .first<{ conference_provider: string | null; conference_external_id: string | null }>();
  if (row?.conference_provider !== 'zoom' || !row.conference_external_id) return;

  const creds = zoomConfigured(env);
  if (!creds) return;
  try {
    await deleteZoomMeeting(creds, row.conference_external_id);
  } catch (error) {
    console.error('booking conference: zoom delete failed:', error);
  }
}
