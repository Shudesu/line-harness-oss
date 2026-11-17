import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LineClient } from '@line-crm/line-sdk';
import { cancelFriendReminder, getDueReminderDeliveries, getDueReminderStep } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { processReminderDeliveries } from './reminder-delivery.js';

vi.mock('./stealth.js', () => ({ sleep: async () => {}, addJitter: () => 0 }));
const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('generic reminder lifecycle during dispatch', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let messages: string[];
  let afterFirst: () => void | Promise<void>;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.pragma('foreign_keys = ON');
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec(`
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
        VALUES('account','channel','Test','local-token','local-secret');
      INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','LINE-USER','account');
      INSERT INTO reminders(id,name,line_account_id) VALUES('reminder','Test','account');
      INSERT INTO reminder_steps(id,reminder_id,offset_minutes,message_type,message_content)
        VALUES('first','reminder',0,'text','first'),('second','reminder',1,'text','second');
      INSERT INTO friend_reminders(id,friend_id,reminder_id,target_date)
        VALUES('enrollment','friend','reminder','2020-01-01T00:00:00Z');
    `);
    messages = [];
    afterFirst = () => {};
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real network allowed'));
    vi.spyOn(LineClient.prototype, 'request').mockImplementation(async function (this: LineClient, method, path, body) {
      expect(method).toBe('POST');
      expect(path).toBe('/v2/bot/message/push');
      expect(Reflect.get(this, 'channelAccessToken')).toBe('local-token');
      const payload = body as { to: string; messages: Array<{ text: string }> };
      expect(payload.to).toBe('LINE-USER');
      messages.push(payload.messages[0].text);
      if (messages.length === 1) await afterFirst();
      return { data: {}, headers: new Headers() };
    });
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    fixture.sqlite.close();
  });
  const run = () => processReminderDeliveries(fixture.db, new LineClient('unused'));
  const status = () => (fixture.sqlite.prepare("SELECT status FROM friend_reminders WHERE id='enrollment'").get() as { status: string }).status;
  const delivered = () => fixture.sqlite.prepare('SELECT reminder_step_id FROM friend_reminder_deliveries ORDER BY reminder_step_id').all();

  it('keeps normal delivery order, one log per step and completion on replay', async () => {
    await run();
    await run();
    expect(messages).toEqual(['first', 'second']);
    expect(delivered()).toEqual([{ reminder_step_id: 'first' }, { reminder_step_id: 'second' }]);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 2 });
    expect(status()).toBe('completed');
  });

  it('honors cancellation between two already-selected steps', async () => {
    afterFirst = () => cancelFriendReminder(fixture.db, 'enrollment');
    await run();
    expect(messages).toEqual(['first']);
    expect(delivered()).toEqual([{ reminder_step_id: 'first' }]);
    expect(status()).toBe('cancelled');
  });

  it('preserves cancellation committed while the final send is already in flight', async () => {
    fixture.sqlite.exec("DELETE FROM reminder_steps WHERE id='second'");
    afterFirst = () => cancelFriendReminder(fixture.db, 'enrollment');
    await run();
    expect(messages).toEqual(['first']);
    expect(delivered()).toEqual([{ reminder_step_id: 'first' }]);
    expect(status()).toBe('cancelled');
  });

  it.each([
    ['disabled reminder', "UPDATE reminders SET is_active=0 WHERE id='reminder'"],
    ['deleted step', "DELETE FROM reminder_steps WHERE id='second'"],
    ['rescheduled enrollment', "UPDATE friend_reminders SET target_date='2099-01-01T00:00:00Z' WHERE id='enrollment'"],
    ['rescheduled step', "UPDATE reminder_steps SET offset_minutes=100000000 WHERE id='second'"],
    ['unfollowed friend', "UPDATE friends SET is_following=0 WHERE id='friend'"],
  ])('rechecks a %s before the next step', async (_label, sql) => {
    afterFirst = () => { fixture.sqlite.exec(sql); };
    await run();
    expect(messages).toEqual(['first']);
    expect(delivered()).toEqual([{ reminder_step_id: 'first' }]);
  });

  it('reads the current content of a selected step before sending it', async () => {
    afterFirst = () => { fixture.sqlite.exec("UPDATE reminder_steps SET message_content='updated' WHERE id='second'"); };
    await run();
    expect(messages).toEqual(['first', 'updated']);
    expect(status()).toBe('completed');
  });

  it('resumes an enabled reminder without repeating an already delivered step', async () => {
    afterFirst = () => { fixture.sqlite.exec("UPDATE reminders SET is_active=0 WHERE id='reminder'"); };
    await run();
    expect(messages).toEqual(['first']);
    expect(status()).toBe('active');
    fixture.sqlite.exec("UPDATE reminders SET is_active=1 WHERE id='reminder'");
    await run();
    expect(messages).toEqual(['first', 'second']);
    expect(status()).toBe('completed');
  });

  it('skips a step completed by another invocation while the first send is in flight', async () => {
    afterFirst = () => { fixture.sqlite.exec("INSERT INTO friend_reminder_deliveries(id,friend_reminder_id,reminder_step_id) VALUES('other-send','enrollment','second')"); };
    await run();
    expect(messages).toEqual(['first']);
    expect(delivered()).toEqual([{ reminder_step_id: 'first' }, { reminder_step_id: 'second' }]);
    expect(status()).toBe('completed');
  });

  it('rechecks another enrollment already selected in the same batch', async () => {
    fixture.sqlite.exec(`INSERT INTO friend_reminders(id,friend_id,reminder_id,target_date)
      VALUES('other-enrollment','friend','reminder','2020-01-01T00:00:00Z')`);
    const selected = await getDueReminderDeliveries(fixture.db, '2026-10-21T00:00:00Z');
    const cancelledId = selected[1].id;
    afterFirst = () => cancelFriendReminder(fixture.db, cancelledId);
    await run();
    expect(messages).toEqual(['first', 'second']);
    expect(fixture.sqlite.prepare('SELECT status FROM friend_reminders WHERE id=?').get(cancelledId))
      .toEqual({ status: 'cancelled' });
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM friend_reminder_deliveries WHERE friend_reminder_id=?').get(cancelledId))
      .toEqual({ n: 0 });
  });

  it('keeps original date parsing and exact due-boundary behavior for current steps', async () => {
    let cases = 0;
    for (const target of ['2026-10-21T09:00:00Z', '2026-10-21 09:00:00', '2026-10-21T18:00:00+09:00', 'invalid-date']) {
      for (const offset of [-60, 0, 60]) {
        fixture.sqlite.prepare("UPDATE friend_reminders SET target_date=? WHERE id='enrollment'").run(target);
        fixture.sqlite.prepare("UPDATE reminder_steps SET offset_minutes=? WHERE id='first'").run(offset);
        for (const now of ['2026-10-21T07:59:59Z', '2026-10-21T08:00:00Z', '2026-10-21T09:00:00Z', '2026-10-21T10:00:00Z']) {
          const batch = await getDueReminderDeliveries(fixture.db, now);
          const expected = batch.flatMap(row => row.steps).find(step => step.id === 'first') ?? null;
          const current = await getDueReminderStep(fixture.db, 'enrollment', 'first', now);
          expect(current ? { id: current.id, offset_minutes: current.offset_minutes } : null)
            .toEqual(expected ? { id: expected.id, offset_minutes: expected.offset_minutes } : null);
          cases++;
        }
      }
    }
    expect(cases).toBe(48);
  });
});
