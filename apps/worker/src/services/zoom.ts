/**
 * Zoom Server-to-Server OAuth クライアント。
 *
 * 予約確定時に「その面談専用の Zoom ミーティング」を発行し、キャンセル時に削除する。
 * Server-to-Server OAuth を使うため、ユーザーごとの OAuth 同意フローは不要で、
 * アカウント単位の資格情報（Account ID / Client ID / Client Secret）だけで動く。
 *
 * Zoom 側の準備:
 *   Zoom Marketplace → Develop → Build App → Server-to-Server OAuth
 *   スコープ: meeting:write:admin（作成・削除）
 *   アプリを Activate しないとトークンが発行されない（401 になる）。
 *
 * 注意: 無料プランは 3 人以上の会議が 40 分で切れる。60 分面談を運用するなら
 * 有料プランが前提になる。
 */

export interface ZoomCredentials {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

export interface CreatedZoomMeeting {
  joinUrl: string;
  meetingId: string;
}

/** 資格情報が3点そろっているときだけ ZoomCredentials を返す。 */
export function zoomConfigured(env: {
  ZOOM_ACCOUNT_ID?: string;
  ZOOM_CLIENT_ID?: string;
  ZOOM_CLIENT_SECRET?: string;
}): ZoomCredentials | null {
  if (!env.ZOOM_ACCOUNT_ID || !env.ZOOM_CLIENT_ID || !env.ZOOM_CLIENT_SECRET) return null;
  return {
    accountId: env.ZOOM_ACCOUNT_ID,
    clientId: env.ZOOM_CLIENT_ID,
    clientSecret: env.ZOOM_CLIENT_SECRET,
  };
}

async function getZoomAccessToken(creds: ZoomCredentials): Promise<string> {
  const encoded = btoa(`${creds.clientId}:${creds.clientSecret}`);
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(creds.accountId)}`,
    { method: 'POST', headers: { Authorization: `Basic ${encoded}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Zoom OAuth error: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function createZoomMeeting(
  creds: ZoomCredentials,
  opts: {
    topic: string;
    /** 開始時刻。UTC ISO でも JST ISO でもよい（内部で UTC に正規化する）。 */
    startAt: string;
    durationMin: number;
  },
): Promise<CreatedZoomMeeting> {
  const token = await getZoomAccessToken(creds);
  const startUtc = new Date(opts.startAt).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const res = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: opts.topic,
      type: 2, // scheduled
      start_time: startUtc,
      duration: opts.durationMin,
      timezone: 'Asia/Tokyo',
      settings: {
        host_video: true,
        participant_video: true,
        // ホスト入室前の入室を許さない。参加URLは確定通知・リマインド・カレンダー本文に載るため、
        // 転送やカレンダー共有で第三者へ渡り得る。join_before_host を許すと、その第三者が
        // 面談開始前から入室して待ち構えられてしまう（個別相談は機微な内容を扱う）。
        join_before_host: false,
        // 待機室は既定で使わない（毎回の入室許可が運用の負担になるため）。
        // 参加者を毎回確認したい場合は、Zoom のアカウント設定で待機室を全体に強制できる。
        waiting_room: false,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Zoom createMeeting error: ${res.status} ${text.slice(0, 200)}`);
  }
  const meeting = (await res.json()) as { join_url: string; id: number | string };
  return { joinUrl: meeting.join_url, meetingId: String(meeting.id) };
}

export async function deleteZoomMeeting(
  creds: ZoomCredentials,
  meetingId: string,
): Promise<void> {
  const token = await getZoomAccessToken(creds);
  const res = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  // 204 = 削除成功 / 404 = すでに存在しない（どちらも成功扱い）
  if (!res.ok && res.status !== 404) {
    // 400 の内訳（scope 不足 code 4700 / meeting 不正 code 3000 等）を切り分けられるよう本文を残す
    const text = await res.text().catch(() => '');
    throw new Error(`Zoom deleteMeeting error: ${res.status} ${text.slice(0, 200)}`);
  }
}
