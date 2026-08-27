import { afterEach, describe, expect, test, vi } from 'vitest';

// booking-calendar-sync をモックしてから対象を読み込む（実 Google API を叩かないため）。
const syncMock = vi.hoisted(() => vi.fn());
vi.mock('./booking-calendar-sync.js', () => ({
  syncConfirmedBookingToGoogle: syncMock,
}));

const zoomCreate = vi.hoisted(() => vi.fn());
const zoomDelete = vi.hoisted(() => vi.fn());
vi.mock('./zoom.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./zoom.js')>();
  return {
    ...actual,
    createZoomMeeting: zoomCreate,
    deleteZoomMeeting: zoomDelete,
  };
});

const { provisionBookingConference, releaseBookingConference, resolveConferenceProvider } =
  await import('./booking-conference.js');

/** 最小限の D1 スタブ。SQL の頭で分岐して固定行を返す。 */
function makeDb(opts: {
  settingValue?: string | null;
  booking?: Record<string, unknown> | null;
  releaseRow?: Record<string, unknown> | null;
}) {
  const updates: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes('FROM account_settings')) {
                return opts.settingValue == null ? null : { value: opts.settingValue };
              }
              if (sql.includes('conference_provider, conference_external_id')) {
                return opts.releaseRow ?? null;
              }
              if (sql.includes('FROM bookings b')) {
                return opts.booking ?? null;
              }
              return null;
            },
            async run() {
              updates.push({ sql, args });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, updates };
}

const booking = {
  line_account_id: 'acct-1',
  starts_at: '2026-05-10T05:00:00.000Z',
  ends_at: '2026-05-10T06:00:00.000Z',
  menu_name: '個別面談',
  friend_name: '佐藤',
  conference_url: null,
};

const googleCreds = {} as never;

afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveConferenceProvider', () => {
  test('アカウント設定が最優先', async () => {
    const { db } = makeDb({ settingValue: 'zoom' });
    await expect(
      resolveConferenceProvider(db, 'acct-1', { BOOKING_CONFERENCE_PROVIDER: 'google_meet' }),
    ).resolves.toBe('zoom');
  });
  test('設定が無ければ環境変数', async () => {
    const { db } = makeDb({ settingValue: null });
    await expect(
      resolveConferenceProvider(db, 'acct-1', { BOOKING_CONFERENCE_PROVIDER: 'zoom' }),
    ).resolves.toBe('zoom');
  });
  test('どちらも無ければ google_meet', async () => {
    const { db } = makeDb({ settingValue: null });
    await expect(resolveConferenceProvider(db, 'acct-1', {})).resolves.toBe('google_meet');
  });
  test('不正な値は無視して既定に落ちる', async () => {
    const { db } = makeDb({ settingValue: 'teams' });
    await expect(resolveConferenceProvider(db, 'acct-1', {})).resolves.toBe('google_meet');
  });
});

describe('provisionBookingConference — google_meet', () => {
  test('カレンダー登録時に Meet を発行し、URLを保存する', async () => {
    const { db, updates } = makeDb({ settingValue: null, booking });
    syncMock.mockResolvedValue({
      synced: true,
      eventId: 'evt',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    });

    const result = await provisionBookingConference(db, googleCreds, {}, 'bk-1');

    expect(syncMock).toHaveBeenCalledWith(db, googleCreds, 'bk-1', { addGoogleMeet: true });
    expect(result.conferenceUrl).toBe('https://meet.google.com/abc-defg-hij');
    expect(result.calendarSynced).toBe(true);
    const saved = updates.find((u) => u.sql.includes('SET conference_provider = ?'));
    expect(saved?.args.slice(0, 3)).toEqual([
      'google_meet',
      'https://meet.google.com/abc-defg-hij',
      null,
    ]);
  });

  test('Googleが未接続ならURLなしで静かに終わる（予約は成立させる）', async () => {
    const { db } = makeDb({ settingValue: null, booking });
    syncMock.mockResolvedValue({ synced: false });
    const result = await provisionBookingConference(db, googleCreds, {}, 'bk-1');
    expect(result.conferenceUrl).toBeNull();
    expect(result.calendarSynced).toBe(false);
  });
});

describe('provisionBookingConference — zoom', () => {
  const zoomEnv = {
    BOOKING_CONFERENCE_PROVIDER: 'zoom',
    ZOOM_ACCOUNT_ID: 'a',
    ZOOM_CLIENT_ID: 'b',
    ZOOM_CLIENT_SECRET: 'c',
  };

  test('Zoomを発行してから、そのURL入りでカレンダーへ登録する', async () => {
    const { db, updates } = makeDb({ settingValue: null, booking });
    zoomCreate.mockResolvedValue({ joinUrl: 'https://zoom.us/j/1', meetingId: '1' });
    syncMock.mockResolvedValue({ synced: true, eventId: 'evt' });

    const result = await provisionBookingConference(db, googleCreds, zoomEnv, 'bk-1');

    expect(zoomCreate).toHaveBeenCalledWith(
      { accountId: 'a', clientId: 'b', clientSecret: 'c' },
      { topic: '佐藤｜個別面談', startAt: booking.starts_at, durationMin: 60 },
    );
    // Meet は付けない（Zoomを使うため）
    expect(syncMock).toHaveBeenCalledWith(db, googleCreds, 'bk-1', { addGoogleMeet: false });
    expect(result.conferenceUrl).toBe('https://zoom.us/j/1');
    const saved = updates.find((u) => u.sql.includes('SET conference_provider = ?'));
    expect(saved?.args.slice(0, 3)).toEqual(['zoom', 'https://zoom.us/j/1', '1']);
  });

  test('カレンダー登録が失敗したら、発行済みZoomを削除して巻き戻す', async () => {
    const { db, updates } = makeDb({ settingValue: null, booking });
    zoomCreate.mockResolvedValue({ joinUrl: 'https://zoom.us/j/1', meetingId: '1' });
    syncMock.mockRejectedValue(new Error('calendar down'));
    zoomDelete.mockResolvedValue(undefined);

    const result = await provisionBookingConference(db, googleCreds, zoomEnv, 'bk-1');

    expect(zoomDelete).toHaveBeenCalledWith(
      { accountId: 'a', clientId: 'b', clientSecret: 'c' },
      '1',
    );
    expect(result.conferenceUrl).toBeNull();
    expect(updates.some((u) => u.sql.includes('conference_provider = NULL'))).toBe(true);
  });

  test('Zoom発行が失敗しても予約は残し、カレンダーだけは登録する', async () => {
    const { db } = makeDb({ settingValue: null, booking });
    zoomCreate.mockRejectedValue(new Error('zoom down'));
    syncMock.mockResolvedValue({ synced: true, eventId: 'evt' });

    const result = await provisionBookingConference(db, googleCreds, zoomEnv, 'bk-1');

    expect(result.conferenceUrl).toBeNull();
    expect(result.calendarSynced).toBe(true);
  });

  test('資格情報が無いのに zoom 指定なら、発行を飛ばして続行する', async () => {
    const { db } = makeDb({ settingValue: 'zoom', booking });
    syncMock.mockResolvedValue({ synced: true, eventId: 'evt' });

    const result = await provisionBookingConference(db, googleCreds, {}, 'bk-1');

    expect(zoomCreate).not.toHaveBeenCalled();
    expect(result.conferenceUrl).toBeNull();
  });
});

describe('カレンダーの状態を潰さない', () => {
  test('Google APIがエラーなら failed（未連携と区別する）', async () => {
    const { db } = makeDb({ settingValue: null, booking });
    syncMock.mockRejectedValue(new Error('calendar down'));
    const result = await provisionBookingConference(db, googleCreds, {}, 'bk-1');
    expect(result.calendarStatus).toBe('failed');
  });

  test('未連携なら not_configured', async () => {
    const { db } = makeDb({ settingValue: null, booking });
    syncMock.mockResolvedValue({ synced: false });
    const result = await provisionBookingConference(db, googleCreds, {}, 'bk-1');
    expect(result.calendarStatus).toBe('not_configured');
  });

  test('登録できたら synced', async () => {
    const { db } = makeDb({ settingValue: null, booking });
    syncMock.mockResolvedValue({ synced: true, eventId: 'evt', meetUrl: 'https://meet.example/x' });
    const result = await provisionBookingConference(db, googleCreds, {}, 'bk-1');
    expect(result.calendarStatus).toBe('synced');
  });

  test('Zoomをロールバックしたときも failed が残る', async () => {
    const { db } = makeDb({ settingValue: null, booking });
    zoomCreate.mockResolvedValue({ joinUrl: 'https://zoom.us/j/1', meetingId: '1' });
    syncMock.mockRejectedValue(new Error('calendar down'));
    zoomDelete.mockResolvedValue(undefined);
    const result = await provisionBookingConference(db, googleCreds, {
      BOOKING_CONFERENCE_PROVIDER: 'zoom',
      ZOOM_ACCOUNT_ID: 'a',
      ZOOM_CLIENT_ID: 'b',
      ZOOM_CLIENT_SECRET: 'c',
    }, 'bk-1');
    expect(result.calendarStatus).toBe('failed');
  });
});

describe('provisionBookingConference — 冪等性', () => {
  test('すでにURLが入っている予約では作り直さない', async () => {
    const { db } = makeDb({
      settingValue: null,
      booking: { ...booking, conference_url: 'https://zoom.us/j/existing' },
    });
    syncMock.mockResolvedValue({ synced: true, eventId: 'evt' });

    const result = await provisionBookingConference(db, googleCreds, {}, 'bk-1');

    expect(zoomCreate).not.toHaveBeenCalled();
    expect(result.conferenceUrl).toBe('https://zoom.us/j/existing');
  });

  test('確定していない予約には何もしない', async () => {
    const { db } = makeDb({ settingValue: null, booking: null });
    const result = await provisionBookingConference(db, googleCreds, {}, 'bk-1');
    expect(result.conferenceUrl).toBeNull();
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe('releaseBookingConference', () => {
  test('Zoom予約はミーティングを削除する', async () => {
    const { db } = makeDb({
      releaseRow: { conference_provider: 'zoom', conference_external_id: '1' },
    });
    zoomDelete.mockResolvedValue(undefined);
    await releaseBookingConference(db, {
      ZOOM_ACCOUNT_ID: 'a',
      ZOOM_CLIENT_ID: 'b',
      ZOOM_CLIENT_SECRET: 'c',
    }, 'bk-1');
    expect(zoomDelete).toHaveBeenCalled();
  });

  test('Google Meet はカレンダー削除で消えるので何もしない', async () => {
    const { db } = makeDb({
      releaseRow: { conference_provider: 'google_meet', conference_external_id: null },
    });
    await releaseBookingConference(db, {}, 'bk-1');
    expect(zoomDelete).not.toHaveBeenCalled();
  });

  test('Zoom削除が失敗しても例外を投げない（キャンセル処理は止めない）', async () => {
    const { db } = makeDb({
      releaseRow: { conference_provider: 'zoom', conference_external_id: '1' },
    });
    zoomDelete.mockRejectedValue(new Error('zoom down'));
    await expect(
      releaseBookingConference(db, {
        ZOOM_ACCOUNT_ID: 'a',
        ZOOM_CLIENT_ID: 'b',
        ZOOM_CLIENT_SECRET: 'c',
      }, 'bk-1'),
    ).resolves.toBeUndefined();
  });
});
