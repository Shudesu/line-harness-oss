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

export interface CreateEventInput {
  summary: string;
  start: string;   // ISO datetime string
  end: string;     // ISO datetime string
  description?: string;
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
    return calendarData?.busy ?? [];
  }

  /**
   * Create an event on Google Calendar with an auto-allocated Google Meet link.
   * Returns the created event's ID and hangoutLink (null if GCal declined to allocate one).
   */
  async createEvent(event: CreateEventInput): Promise<{ eventId: string; meetUrl: string | null }> {
    // conferenceDataVersion=1 is required for GCal to honor the createRequest
    // and allocate a hangoutsMeet conference. Without it the field is silently dropped.
    const url = `${GCAL_BASE}/calendars/${encodeURIComponent(this.config.calendarId)}/events?conferenceDataVersion=1`;

    const body = {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.start, timeZone: TIMEZONE },
      end: { dateTime: event.end, timeZone: TIMEZONE },
      conferenceData: {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
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
      throw new Error(`Google Calendar createEvent error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      id?: string;
      hangoutLink?: string;
      conferenceData?: {
        entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
        createRequest?: { status?: { statusCode?: string } };
      };
    };
    if (!data.id) {
      throw new Error('Google Calendar createEvent: response missing event id');
    }

    // Meet URL の取得優先度:
    //   1. conferenceData.entryPoints[].uri (entryPointType='video') — モダンGoogle Meet
    //   2. hangoutLink — 旧Hangouts/Meet互換の同期フィールド(fallback)
    //
    // conferenceData.createRequest.status.statusCode === 'pending' の場合は
    // Meet URL がまだ割り当てられていないので、呼び出し側で event を再取得する必要がある。
    const videoEntry = data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
    const meetUrl = videoEntry?.uri ?? data.hangoutLink ?? null;

    return { eventId: data.id, meetUrl };
  }

  /**
   * Fetch an event by id. Used to re-read Meet URL when conference allocation
   * was still pending at createEvent time.
   */
  async getEvent(eventId: string): Promise<{ meetUrl: string | null }> {
    const url = `${GCAL_BASE}/calendars/${encodeURIComponent(this.config.calendarId)}/events/${encodeURIComponent(eventId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.accessToken}` },
    });
    if (!res.ok) {
      return { meetUrl: null };
    }
    const data = (await res.json()) as {
      hangoutLink?: string;
      conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
    };
    const videoEntry = data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
    return { meetUrl: videoEntry?.uri ?? data.hangoutLink ?? null };
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
