import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import {
  cancelMeetConsultation,
  processDueMeetConsultationReminders,
  registerMeetConsultation,
  type RegisterMeetConsultationInput,
} from './meet-consultation-reminders.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const registeredAt = new Date('2026-08-08T00:00:00.000Z');
const tickAt = new Date('2026-08-08T00:01:00.000Z');
const input: RegisterMeetConsultationInput = {
  externalEventId: 'event-a', friendId: 'friend-a', title: 'Consultation',
  startsAt: '2026-08-08T12:00:00.000Z', endsAt: '2026-08-08T12:30:00.000Z',
  meetUrl: 'https://meet.google.com/abc-defg-hij',
};

describe('Meet reminder lifecycle during a due batch', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  beforeEach(() => {
    fixture = sqliteD1(); fixture.sqlite.exec(schema); fixture.sqlite.pragma('foreign_keys = ON');
    fixture.sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
      VALUES('account','channel','Consultations','local-token','local-secret');
      INSERT INTO friends(id,line_user_id,line_account_id) VALUES
      ('friend-a','LINE-A','account'),('friend-b','LINE-B','account'),('friend-c','LINE-C','account')`);
  });
  afterEach(() => fixture.sqlite.close());
  const process = (dispatch: (request: Request) => Promise<Response>) =>
    processDueMeetConsultationReminders(fixture.db, {
      now: tickAt, proxyBaseUrl: 'https://local-proxy.example', proxyDispatch: dispatch,
    });
  const second = { ...input, externalEventId: 'event-b', friendId: 'friend-b' };

  test.each(['cancel', 'reschedule', 'recipient', 'url', 'unfollow', 'inactive'] as const)(
    'skips the stale second delivery after %s while the first one is sending', async change => {
      await registerMeetConsultation(fixture.db, input, registeredAt);
      await registerMeetConsultation(fixture.db, second, new Date(registeredAt.getTime() + 1000));
      const bodies: Array<{ to: string; messages: Array<{ text: string }> }> = [];
      const dispatch = vi.fn(async (request: Request) => {
        expect(request.headers.has('x-line-harness-source')).toBe(false);
        bodies.push(await request.json() as (typeof bodies)[number]);
        if (bodies.length === 1) {
          if (change === 'cancel') await cancelMeetConsultation(fixture.db, 'event-b', tickAt);
          if (change === 'reschedule') await registerMeetConsultation(fixture.db, {
            ...second, startsAt: '2026-08-10T12:00:00.000Z', endsAt: '2026-08-10T12:30:00.000Z',
          }, tickAt);
          if (change === 'recipient') await registerMeetConsultation(fixture.db, { ...second, friendId: 'friend-c' }, tickAt);
          if (change === 'url') await registerMeetConsultation(fixture.db, { ...second, meetUrl: 'https://meet.google.com/xyz-abcd-efg' }, tickAt);
          if (change === 'unfollow') fixture.sqlite.exec("UPDATE friends SET is_following=0 WHERE id='friend-b'");
          if (change === 'inactive') fixture.sqlite.exec("UPDATE line_accounts SET is_active=0 WHERE id='account'");
        }
        return new Response('{}', { status: 200 });
      });
      expect(await process(dispatch)).toEqual({ sent: 1, failed: 0 });
      expect(bodies.map(body => body.to)).toEqual(['LINE-A']);
      // A replacement delivery remains eligible for the next tick and uses
      // its new recipient/URL, rather than the discarded batch snapshot.
      if (change === 'recipient' || change === 'url') {
        expect(await process(dispatch)).toEqual({ sent: 1, failed: 0 });
        expect(bodies[1].to).toBe(change === 'recipient' ? 'LINE-C' : 'LINE-B');
        if (change === 'url') expect(bodies[1].messages[0].text).toContain('https://meet.google.com/xyz-abcd-efg');
      }
    },
  );

  test.each(['accepted', 'failed'] as const)(
    'does not overwrite cancellation when an in-flight send finishes as %s', async outcome => {
      await registerMeetConsultation(fixture.db, input, registeredAt);
      const dispatch = vi.fn(async () => {
        await cancelMeetConsultation(fixture.db, 'event-a', tickAt);
        if (outcome === 'failed') throw new Error('local response failure');
        return new Response('{}', { status: 200 });
      });
      expect(await process(dispatch)).toEqual(outcome === 'accepted' ? { sent: 1, failed: 0 } : { sent: 0, failed: 1 });
      expect(fixture.sqlite.prepare('SELECT status,retry_count,sent_at FROM meet_consultation_reminders ORDER BY kind').all())
        .toEqual([
          { status: 'cancelled', retry_count: 0, sent_at: null },
          { status: 'cancelled', retry_count: 0, sent_at: null },
        ]);
      expect(await process(dispatch)).toEqual({ sent: 0, failed: 0 });
      expect(dispatch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['accepted', 'failed'] as const)(
    'leaves the replacement pending when the old in-flight send finishes as %s', async outcome => {
      await registerMeetConsultation(fixture.db, input, registeredAt);
      const dispatch = vi.fn(async () => {
        await registerMeetConsultation(fixture.db, {
          ...input, meetUrl: 'https://meet.google.com/xyz-abcd-efg',
        }, tickAt);
        if (outcome === 'failed') throw new Error('old request failed');
        return new Response('{}', { status: 200 });
      });
      expect(await process(dispatch)).toEqual(outcome === 'accepted' ? { sent: 1, failed: 0 } : { sent: 0, failed: 1 });
      expect(fixture.sqlite.prepare('SELECT status,retry_count,sent_at FROM meet_consultation_reminders ORDER BY kind').all())
        .toEqual([
          { status: 'pending', retry_count: 0, sent_at: null },
          { status: 'pending', retry_count: 0, sent_at: null },
        ]);
    },
  );
});
