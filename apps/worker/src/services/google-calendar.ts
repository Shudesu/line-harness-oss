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
   * Create an event on Google Calendar.
   * Returns the created event's ID.
   */
  async createEvent(event: CreateEventInput): Promise<{ eventId: string }> {
    const url = `${GCAL_BASE}/calendars/${encodeURIComponent(this.config.calendarId)}/events`;

    const body = {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.start, timeZone: TIMEZONE },
      end: { dateTime: event.end, timeZone: TIMEZONE },
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

    const data = (await res.json()) as { id?: string };
    if (!data.id) {
      throw new Error('Google Calendar createEvent: response missing event id');
    }

    return { eventId: data.id };
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
