import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LineClient } from '@line-crm/line-sdk';
import { claimFriendScenarioForDelivery, updateScenario } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { processStepDeliveries } from './step-delivery.js';
import { pushImmediateFirstStep } from './immediate-first-step.js';

vi.mock('./stealth.js', () => ({ sleep: async () => {}, addJitter: () => 0, jitterDeliveryTime: (date: Date) => date }));
const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('scenario stop boundaries', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let sends: string[];
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.pragma('foreign_keys = ON');
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec(`
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
        VALUES('account','channel','Test','local-token','local-secret');
      INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','LINE-USER','account');
      INSERT INTO scenarios(id,name,trigger_type,line_account_id) VALUES('scenario','Test','manual','account');
      INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,message_content)
        VALUES('step','scenario',1,0,'text','Hello');
      INSERT INTO friend_scenarios(id,friend_id,scenario_id,current_step_order,status,next_delivery_at,started_at)
        VALUES('enrollment','friend','scenario',0,'active','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z');
    `);
    sends = [];
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real network allowed'));
    vi.spyOn(LineClient.prototype, 'request').mockImplementation(async function (method, path, body) {
      expect(method).toBe('POST');
      expect(path).toBe('/v2/bot/message/push');
      sends.push((body as { to: string }).to);
      return { data: {}, headers: new Headers() };
    });
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    fixture.sqlite.close();
    vi.restoreAllMocks();
  });
  function hooked(afterRead: (sql: string) => Promise<void>): D1Database {
    function prepare(sql: string, values: unknown[] = []): D1PreparedStatement {
      const statement = values.length ? fixture.db.prepare(sql).bind(...values) : fixture.db.prepare(sql);
      return {
        ...statement,
        bind(...params: unknown[]) { return prepare(sql, params); },
        async first<T>() { const row = await statement.first<T>(); await afterRead(sql); return row; },
        async all<T>() { const rows = await statement.all<T>(); await afterRead(sql); return rows; },
      } as D1PreparedStatement;
    }
    return { prepare } as D1Database;
  }
  const state = () => fixture.sqlite.prepare("SELECT status,current_step_order,next_delivery_at FROM friend_scenarios WHERE id='enrollment'").get();
  const stop = () => updateScenario(fixture.db, 'scenario', { is_active: 0 });
  const resume = () => updateScenario(fixture.db, 'scenario', { is_active: 1 });
  const run = async (lane: 'cron' | 'immediate', db = fixture.db) => {
    if (lane === 'cron') await processStepDeliveries(db, new LineClient('unused'));
    else await pushImmediateFirstStep(db, 'friend', 'scenario', { defaultAccessToken: 'unused' });
  };

  it('does not claim a selected enrollment after its parent scenario stops', async () => {
    await stop();
    const before = state();
    expect(await claimFriendScenarioForDelivery(fixture.db, 'enrollment', 0)).toBe(false);
    expect(state()).toEqual(before);
    await resume();
    expect(await claimFriendScenarioForDelivery(fixture.db, 'enrollment', 0)).toBe(true);
  });

  for (const lane of ['cron', 'immediate'] as const) {
    it(`${lane}: keeps normal delivery and completion unchanged`, async () => {
      await run(lane);
      expect(sends).toEqual(['LINE-USER']);
      expect(state()).toMatchObject({ status: 'completed' });
      expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 1 });
    });

    it(`${lane}: skips a scenario stopped after the initial eligibility read`, async () => {
      let changed = false;
      const db = hooked(async sql => {
        const boundary = lane === 'cron' ? sql.includes('SELECT fs.* FROM friend_scenarios')
          : sql.includes('SELECT * FROM scenario_steps WHERE scenario_id');
        if (!changed && boundary) { changed = true; await stop(); }
      });
      await run(lane, db);
      expect(changed).toBe(true);
      expect(sends).toEqual([]);
      expect(state()).toMatchObject({ status: 'active', current_step_order: 0 });
      await resume();
      await run(lane);
      expect(sends).toEqual(['LINE-USER']);
    });

    it.each(['stop', 'delete enrollment', 'pause enrollment', 'advanced enrollment'] as const)(
      `${lane}: rechecks %s after message preparation`, async change => {
        let changed = false;
        const db = hooked(async sql => {
          if (!changed && sql.includes('SELECT * FROM line_accounts WHERE id')) {
            changed = true;
            if (change === 'stop') await stop();
            else if (change === 'delete enrollment') fixture.sqlite.exec("DELETE FROM friend_scenarios WHERE id='enrollment'");
            else if (change === 'pause enrollment') fixture.sqlite.exec("UPDATE friend_scenarios SET status='paused' WHERE id='enrollment'");
            else fixture.sqlite.exec("UPDATE friend_scenarios SET current_step_order=1 WHERE id='enrollment'");
          }
        });
        await run(lane, db);
        expect(changed).toBe(true);
        expect(sends).toEqual([]);
        expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 0 });
        if (change === 'stop') {
          expect(state()).toMatchObject({ status: 'active', current_step_order: 0 });
          await resume(); await run(lane);
          expect(sends).toEqual(['LINE-USER']);
        } else if (change === 'pause enrollment') expect(state()).toMatchObject({ status: 'paused', current_step_order: 0 });
        else if (change === 'advanced enrollment') expect(state()).toMatchObject({ status: 'delivering', current_step_order: 1 });
        else expect(state()).toBeUndefined();
      },
    );
  }

  it('checks a stopped scenario for an advanced every-click re-delivery without changing the enrollment', async () => {
    fixture.sqlite.exec(`INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,message_content)
      VALUES('second','scenario',2,60,'text','Later');
      UPDATE friend_scenarios SET current_step_order=1 WHERE id='enrollment'`);
    const before = state();
    let changed = false;
    const db = hooked(async sql => {
      if (!changed && sql.includes('SELECT * FROM line_accounts WHERE id')) { changed = true; await stop(); }
    });
    expect(await pushImmediateFirstStep(db, 'friend', 'scenario', { defaultAccessToken: 'unused' }, { mode: 'every-click' })).toBe(false);
    expect(changed).toBe(true);
    expect(sends).toEqual([]);
    expect(state()).toEqual(before);
    await resume();
    expect(await pushImmediateFirstStep(fixture.db, 'friend', 'scenario', { defaultAccessToken: 'unused' }, { mode: 'every-click' })).toBe(true);
    expect(sends).toEqual(['LINE-USER']);
    expect(state()).toEqual(before);
  });

  it('applies the final stop check to an automatic reply before consuming its token', async () => {
    const reply = vi.spyOn(LineClient.prototype, 'replyMessage').mockResolvedValue(undefined);
    const options = { reply: { client: new LineClient('local-token'), replyToken: 'local-reply-token' } };
    let changed = false;
    const db = hooked(async sql => {
      if (!changed && sql.includes('SELECT * FROM line_accounts WHERE id')) { changed = true; await stop(); }
    });
    expect(await pushImmediateFirstStep(db, 'friend', 'scenario', { defaultAccessToken: 'unused' }, options)).toBe(false);
    expect(changed).toBe(true);
    expect(reply).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ status: 'active', current_step_order: 0 });
    await resume();
    expect(await pushImmediateFirstStep(fixture.db, 'friend', 'scenario', { defaultAccessToken: 'unused' }, options)).toBe(true);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ status: 'completed' });
  });
});
