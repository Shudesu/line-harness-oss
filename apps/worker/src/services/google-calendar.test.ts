import { afterEach, describe, expect, test, vi } from 'vitest';
import { GoogleCalendarClient } from './google-calendar.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GoogleCalendarClient.getFreeBusy', () => {
  test('FreeBusyに出ない透明な終日予定も一日分のbusyとして返す', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/freeBusy')) {
        return new Response(JSON.stringify({
          calendars: {
            primary: {
              busy: [{
                start: '2026-08-27T07:00:00.000Z',
                end: '2026-08-27T07:15:00.000Z',
              }],
            },
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        items: [{
          status: 'confirmed',
          transparency: 'transparent',
          start: { date: '2026-08-28' },
          end: { date: '2026-08-29' },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = new GoogleCalendarClient({ calendarId: 'primary', accessToken: 'token' });

    await expect(client.getFreeBusy(
      '2026-08-27T15:00:00.000Z',
      '2026-08-28T15:00:00.000Z',
    )).resolves.toEqual([
      { start: '2026-08-27T07:00:00.000Z', end: '2026-08-27T07:15:00.000Z' },
      { start: '2026-08-27T15:00:00.000Z', end: '2026-08-28T15:00:00.000Z' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('singleEvents=true');
    expect(String(fetchMock.mock.calls[1][0])).toContain('timeZone=Asia%2FTokyo');
  });

  test('時刻指定予定・キャンセル済み・誕生日・勤務場所は終日補完の対象外', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/freeBusy')) {
        return new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        items: [
          { start: { dateTime: '2026-08-28T11:00:00+09:00' }, end: { dateTime: '2026-08-28T12:00:00+09:00' } },
          { status: 'cancelled', start: { date: '2026-08-28' }, end: { date: '2026-08-29' } },
          { eventType: 'birthday', start: { date: '2026-08-28' }, end: { date: '2026-08-29' } },
          { eventType: 'workingLocation', start: { date: '2026-08-28' }, end: { date: '2026-08-29' } },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = new GoogleCalendarClient({ calendarId: 'primary', accessToken: 'token' });

    await expect(client.getFreeBusy(
      '2026-08-27T15:00:00.000Z',
      '2026-08-28T15:00:00.000Z',
    )).resolves.toEqual([]);
  });
});

describe('GoogleCalendarClient.createEvent', () => {
  test('Google Meetを要求し、返されたMeet URLを返す', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        id: 'event-1',
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new GoogleCalendarClient({
      calendarId: 'primary@example.com',
      accessToken: 'token',
    });

    const result = await client.createEvent({
      summary: '個別相談',
      start: '2026-08-20T02:00:00.000Z',
      end: '2026-08-20T02:15:00.000Z',
      addGoogleMeet: true,
      externalId: '0123456789abcdef0123456789abcdef',
    });

    expect(result).toEqual({
      eventId: 'event-1',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('conferenceDataVersion=1');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: '0123456789abcdef0123456789abcdef',
      conferenceData: {
        createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
    });
  });

  test('同じexternalIdが既にあれば既存イベントを再取得し二重作成しない', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('already exists', { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: '0123456789abcdef0123456789abcdef',
        hangoutLink: 'https://meet.google.com/existing-room',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = new GoogleCalendarClient({ calendarId: 'primary', accessToken: 'token' });
    await expect(client.createEvent({
      summary: '個別相談',
      start: '2026-08-20T02:00:00.000Z',
      end: '2026-08-20T02:15:00.000Z',
      addGoogleMeet: true,
      externalId: '0123456789abcdef0123456789abcdef',
    })).resolves.toEqual({
      eventId: '0123456789abcdef0123456789abcdef',
      meetUrl: 'https://meet.google.com/existing-room',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      '/events/0123456789abcdef0123456789abcdef?conferenceDataVersion=1',
    );
  });

  test('Meet要求時にURLが返らなければ成功扱いにしない', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'event-without-meet' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new GoogleCalendarClient({ calendarId: 'primary', accessToken: 'token' });
    await expect(client.createEvent({
      summary: '個別相談',
      start: '2026-08-20T02:00:00.000Z',
      end: '2026-08-20T02:15:00.000Z',
      addGoogleMeet: true,
    })).rejects.toThrow('response missing Google Meet URL');
  });

  test('通常イベントは従来どおりconferenceDataを付けない', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'event-2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new GoogleCalendarClient({ calendarId: 'primary', accessToken: 'token' });
    await expect(client.createEvent({
      summary: '通常予約',
      start: '2026-08-20T02:00:00.000Z',
      end: '2026-08-20T02:15:00.000Z',
    })).resolves.toEqual({ eventId: 'event-2', meetUrl: undefined });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain('conferenceDataVersion');
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('conferenceData');
  });
});
