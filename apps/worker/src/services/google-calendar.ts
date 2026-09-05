// Google Calendar API client

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';
const TIMEZONE = 'Asia/Tokyo';

export interface GoogleCalendarConfig {
  calendarId: string;
  accessToken: string;
}

export interface BusyInterval {
  start: string;
  end: string;
}

interface CalendarEvent {
  status?: string;
  eventType?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

export interface CreateEventInput {
  summary: string;
  start: string;   // ISO datetime string
  end: string;     // ISO datetime string
  description?: string;
  addGoogleMeet?: boolean;
  /** Google event IDとして使う冪等キー（base32hex: a-v / 0-9）。 */
  externalId?: string;
}

export class GoogleCalendarClient {
  constructor(private config: GoogleCalendarConfig) {}

  /**
   * Get busy time intervals from Google Calendar FreeBusy API.
   * Returns an array of { start, end } intervals when the calendar is busy.
   */
  async getFreeBusy(timeMin: string, timeMax: string): Promise<BusyInterval[]> {
    const url = `${GCAL_BASE}/freeBusy`;
    const body = {
      timeMin,
      timeMax,
      items: [{ id: this.config.calendarId }],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google FreeBusy API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
    };

    const calendarData = data.calendars?.[this.config.calendarId];
    const freeBusy = calendarData?.busy ?? [];

    // GoogleのFreeBusyは「予定あり」のイベントだけを返す。終日予定が
    // transparency=transparent（空き時間扱い）だと画面上に予定があっても返らず、
    // 予約枠が開いてしまう。events.listで終日イベントだけを補完し、終日予定は
    // ユーザーの明示的なブロックとして扱う。
    const allDayBusy = await this.getAllDayBusy(timeMin, timeMax);
    return mergeBusyIntervals([...freeBusy, ...allDayBusy]);
  }

  private async getAllDayBusy(timeMin: string, timeMax: string): Promise<BusyInterval[]> {
    const intervals: BusyInterval[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(
        `${GCAL_BASE}/calendars/${encodeURIComponent(this.config.calendarId)}/events`,
      );
      url.searchParams.set('timeMin', timeMin);
      url.searchParams.set('timeMax', timeMax);
      url.searchParams.set('timeZone', TIMEZONE);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('showDeleted', 'false');
      url.searchParams.set('maxResults', '2500');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.config.accessToken}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Google Calendar events.list error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as {
        items?: CalendarEvent[];
        nextPageToken?: string;
      };
      for (const event of data.items ?? []) {
        if (event.status === 'cancelled') continue;
        // 誕生日と勤務場所はカレンダー上の情報表示であり、面談不可日ではない。
        if (event.eventType === 'birthday' || event.eventType === 'workingLocation') continue;
        if (!event.start?.date || !event.end?.date) continue;
        intervals.push({
          start: new Date(`${event.start.date}T00:00:00+09:00`).toISOString(),
          // Google Calendarの終日イベントのend.dateは排他的。
          end: new Date(`${event.end.date}T00:00:00+09:00`).toISOString(),
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return intervals;
  }

  /**
   * Create an event on Google Calendar.
   * Returns the created event's ID.
   */
  async createEvent(event: CreateEventInput): Promise<{ eventId: string; meetUrl?: string }> {
    const url = new URL(
      `${GCAL_BASE}/calendars/${encodeURIComponent(this.config.calendarId)}/events`,
    );
    if (event.addGoogleMeet) url.searchParams.set('conferenceDataVersion', '1');

    const body = {
      ...(event.externalId ? { id: event.externalId } : {}),
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.start, timeZone: TIMEZONE },
      end: { dateTime: event.end, timeZone: TIMEZONE },
      ...(event.addGoogleMeet
        ? {
            conferenceData: {
              createRequest: {
                requestId: crypto.randomUUID(),
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
          }
        : {}),
    };

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // 同じexternalIdで前回の作成だけ成功し、応答が届かなかった場合は既存イベントを
    // 再取得する。これによりCTAの再タップ/通信再試行で予定を二重作成しない。
    if (res.status === 409 && event.externalId) {
      return this.getCreatedEvent(event.externalId, Boolean(event.addGoogleMeet));
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google Calendar createEvent error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      id?: string;
      hangoutLink?: string;
      conferenceData?: {
        entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
      };
    };
    if (!data.id) {
      throw new Error('Google Calendar createEvent: response missing event id');
    }

    return this.parseCreatedEvent(data, Boolean(event.addGoogleMeet));
  }

  private parseCreatedEvent(
    data: {
      id?: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
    },
    requireMeet: boolean,
  ): { eventId: string; meetUrl?: string } {
    if (!data.id) {
      throw new Error('Google Calendar createEvent: response missing event id');
    }
    const meetUrl = data.hangoutLink ?? data.conferenceData?.entryPoints?.find(
      (entry) => entry.entryPointType === 'video' && entry.uri?.startsWith('https://meet.google.com/'),
    )?.uri;
    if (requireMeet && !meetUrl) {
      throw new Error('Google Calendar createEvent: response missing Google Meet URL');
    }
    return { eventId: data.id, meetUrl };
  }

  private async getCreatedEvent(
    eventId: string,
    requireMeet: boolean,
  ): Promise<{ eventId: string; meetUrl?: string }> {
    const url = `${GCAL_BASE}/calendars/${encodeURIComponent(this.config.calendarId)}` +
      `/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google Calendar getEvent error ${res.status}: ${text}`);
    }
    return this.parseCreatedEvent(await res.json(), requireMeet);
  }

  /**
   * Delete an event from Google Calendar.
   */
  async deleteEvent(eventId: string): Promise<void> {
    const url = `${GCAL_BASE}/calendars/${encodeURIComponent(this.config.calendarId)}/events/${encodeURIComponent(eventId)}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
      },
    });

    // 204 = success, 410 = already deleted — both are acceptable
    if (!res.ok && res.status !== 410) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google Calendar deleteEvent error ${res.status}: ${text}`);
    }
  }
}

function mergeBusyIntervals(intervals: BusyInterval[]): BusyInterval[] {
  const sorted = intervals
    .filter((interval) => {
      const start = new Date(interval.start).getTime();
      const end = new Date(interval.end).getTime();
      return Number.isFinite(start) && Number.isFinite(end) && start < end;
    })
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
  const merged: BusyInterval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (!last || new Date(interval.start).getTime() > new Date(last.end).getTime()) {
      merged.push({ ...interval });
      continue;
    }
    if (new Date(interval.end).getTime() > new Date(last.end).getTime()) {
      last.end = interval.end;
    }
  }
  return merged;
}
