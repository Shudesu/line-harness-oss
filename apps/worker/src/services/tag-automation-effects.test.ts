import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { friends } from '../routes/friends.js';
import { fireEvent } from './event-bus.js';
import { attachTagAndFireSideEffects } from './friend-tag-attach.js';
import { processStepDeliveries } from './step-delivery.js';
import { MAX_TAG_CHANGES_PER_DISPATCH } from './tag-automation-context.js';

vi.mock('./stealth.js', () => ({
  sleep: async () => {},
  jitterDeliveryTime: (date: Date) => date,
  addJitter: (value: number) => value,
}));

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  db.batch = async <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(statement => statement.run<T>()));
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real network allowed'));
  const requests: Array<{ token: string; method: string; path: string; body: unknown }> = [];
  vi.spyOn(LineClient.prototype, 'request').mockImplementation(async function (this: LineClient, method, path, body) {
    requests.push({ token: Reflect.get(this, 'channelAccessToken'), method, path, body });
    return { data: {}, headers: new Headers() };
  });
  for (const id of ['a', 'b']) {
    sqlite.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)')
      .run(id, `channel-${id}`, id, `synthetic-token-${id}`, 'synthetic-secret');
    sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES(?,?,?,?)')
      .run(`friend-${id}`, `line-friend-${id}`, id, `Synthetic ${id}`);
  }
  sqlite.exec("INSERT INTO tags(id,name) VALUES('tag-a','Synthetic tag A'),('tag-b','Synthetic tag B')");
  function automation(id: string, eventType: string, account: string | null, conditions: object, actions: object[]) {
    sqlite.prepare('INSERT INTO automations(id,name,event_type,line_account_id,conditions,actions) VALUES(?,?,?,?,?,?)')
      .run(id, id, eventType, account, JSON.stringify(conditions), JSON.stringify(actions));
  }
  function scenario(id: string, account: string | null, tag = 'tag-a', delay = 10) {
    sqlite.prepare('INSERT INTO scenarios(id,name,trigger_type,trigger_tag_id,line_account_id) VALUES(?,?,\'tag_added\',?,?)')
      .run(id, id, tag, account);
    sqlite.prepare('INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,message_content) VALUES(?,?,0,?,\'text\',\'Synthetic step\')')
      .run(`step-${id}`, id, delay);
  }
  const app = new Hono();
  app.route('/', friends);
  return { db, sqlite, requests, automation, scenario, app };
}

describe('tag automation side effects with real SQLite and mocked LINE transport', () => {
  it('a keyword add_tag action starts its matching scenario once', async () => {
    const s = setup();
    try {
      s.scenario('scenario-a', 'a');
      s.automation('keyword', 'message_received', 'a', { keyword: 'start' }, [
        { type: 'add_tag', params: { tagId: 'tag-a' } },
      ]);
      for (let attempt = 0; attempt < 2; attempt++) {
        await fireEvent(s.db, 'message_received', { friendId: 'friend-a', eventData: { text: 'start' } }, 'synthetic-token-a', 'a');
      }
      expect(s.sqlite.prepare("SELECT scenario_id,current_step_order,status FROM friend_scenarios WHERE friend_id='friend-a'").all())
        .toEqual([{ scenario_id: 'scenario-a', current_step_order: -1, status: 'active' }]);
      expect(s.sqlite.prepare("SELECT COUNT(*) n FROM friend_tags WHERE friend_id='friend-a' AND tag_id='tag-a'").get()).toEqual({ n: 1 });
      expect(s.sqlite.prepare("SELECT status FROM automation_logs WHERE automation_id='keyword'").all())
        .toEqual([{ status: 'success' }, { status: 'success' }]);
    } finally { s.sqlite.close(); }
  });

  it('automatic tag attachment without a push context resolves the friend account token for menu switching', async () => {
    const s = setup();
    try {
      for (const account of ['a', 'b']) {
        s.automation(`menu-${account}`, 'tag_change', account, { tag_id: 'tag-a' }, [
          { type: 'switch_rich_menu', params: { richMenuId: `synthetic-menu-${account}` } },
        ]);
      }
      await attachTagAndFireSideEffects(s.db, 'friend-a', 'tag-a');
      await attachTagAndFireSideEffects(s.db, 'friend-a', 'tag-a');
      expect(s.requests).toHaveLength(1);
      expect(s.requests[0]).toMatchObject({ token: 'synthetic-token-a', method: 'POST' });
      expect(s.requests[0].path).toContain('synthetic-menu-a');
      expect(s.sqlite.prepare('SELECT automation_id,status FROM automation_logs').all())
        .toEqual([{ automation_id: 'menu-a', status: 'success' }]);
    } finally { s.sqlite.close(); }
  });

  it('manual tag requests preserve their per-click event but resolve the target friend account', async () => {
    const s = setup();
    try {
      s.scenario('scenario-a', 'a');
      s.automation('menu-a', 'tag_change', 'a', { tag_id: 'tag-a' }, [
        { type: 'switch_rich_menu', params: { richMenuId: 'synthetic-menu-a' } },
      ]);
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await s.app.request('/api/friends/friend-a/tags', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tagId: 'tag-a' }),
        }, { DB: s.db, LINE_CHANNEL_ACCESS_TOKEN: 'wrong-synthetic-default' });
        expect(response.status).toBe(201);
      }
      expect(s.requests).toHaveLength(2);
      expect(s.requests.every(request => request.token === 'synthetic-token-a')).toBe(true);
      expect(s.sqlite.prepare('SELECT COUNT(*) n FROM friend_scenarios').get()).toEqual({ n: 1 });
    } finally { s.sqlite.close(); }
  });

  it('concurrent duplicate attachment has one event and independent friends do not share dispatch state', async () => {
    const s = setup();
    try {
      for (const account of ['a', 'b']) {
        s.automation(`menu-${account}`, 'tag_change', account, { tag_id: 'tag-a' }, [
          { type: 'switch_rich_menu', params: { richMenuId: `synthetic-menu-${account}` } },
        ]);
      }
      const attached = await Promise.all([
        attachTagAndFireSideEffects(s.db, 'friend-a', 'tag-a'),
        attachTagAndFireSideEffects(s.db, 'friend-a', 'tag-a'),
      ]);
      expect(attached.filter(result => result.added)).toHaveLength(1);
      await attachTagAndFireSideEffects(s.db, 'friend-b', 'tag-a');
      expect(s.requests.map(request => request.token)).toEqual(['synthetic-token-a', 'synthetic-token-b']);
    } finally { s.sqlite.close(); }
  });

  it('global automations remain active alongside the target account automation', async () => {
    const s = setup();
    try {
      s.automation('global', 'tag_change', null, { tag_id: 'tag-a' }, [
        { type: 'set_metadata', params: { data: '{"globalAction":true}' } },
      ]);
      s.automation('account-a', 'tag_change', 'a', { tag_id: 'tag-a' }, [
        { type: 'set_metadata', params: { data: '{"accountAction":true}' } },
      ]);
      s.automation('wrong-account', 'tag_change', 'b', { tag_id: 'tag-a' }, [
        { type: 'set_metadata', params: { data: '{"wrongAction":true}' } },
      ]);
      await attachTagAndFireSideEffects(s.db, 'friend-a', 'tag-a');
      const row = s.sqlite.prepare("SELECT metadata FROM friends WHERE id='friend-a'").get()!;
      expect(JSON.parse(String(row.metadata))).toEqual({ globalAction: true, accountAction: true });
    } finally { s.sqlite.close(); }
  });

  it('uses the current DB token rather than a stale token passed by the caller', async () => {
    const s = setup();
    try {
      s.automation('menu-a', 'tag_change', 'a', {}, [
        { type: 'switch_rich_menu', params: { richMenuId: 'synthetic-menu-a' } },
      ]);
      s.sqlite.exec("UPDATE line_accounts SET channel_access_token='synthetic-rotated-a' WHERE id='a'");
      await fireEvent(s.db, 'tag_change', { friendId: 'friend-a', eventData: { tagId: 'tag-a', action: 'add' } }, 'synthetic-stale-a', 'a');
      expect(s.requests.map(request => request.token)).toEqual(['synthetic-rotated-a']);
    } finally { s.sqlite.close(); }
  });

  it.each(['empty token', 'inactive account'])(
    'records %s as failed instead of silently succeeding or using another account', async unavailable => {
    const s = setup();
    try {
      if (unavailable === 'empty token') s.sqlite.exec("UPDATE line_accounts SET channel_access_token='' WHERE id='a'");
      else s.sqlite.exec("UPDATE line_accounts SET is_active=0 WHERE id='a'");
      s.automation('menu-a', 'tag_change', 'a', {}, [
        { type: 'switch_rich_menu', params: { richMenuId: 'synthetic-menu-a' } },
      ]);
      await attachTagAndFireSideEffects(s.db, 'friend-a', 'tag-a', {
        defaultAccessToken: 'synthetic-token-b', accountChannelId: 'channel-b',
      });
      expect(s.requests).toEqual([]);
      const row = s.sqlite.prepare("SELECT status,actions_result FROM automation_logs WHERE automation_id='menu-a'").get()!;
      expect(row.status).toBe('failed');
      expect(JSON.parse(String(row.actions_result))).toEqual([
        { action: 'switch_rich_menu', success: false, error: 'LINE account credentials are unavailable for this action' },
      ]);
    } finally { s.sqlite.close(); }
    },
  );

  it('does not guess among multiple accounts for an unassigned legacy friend', async () => {
    const s = setup();
    try {
      s.sqlite.exec("UPDATE friends SET line_account_id=NULL WHERE id='friend-a'");
      for (const [id, account] of [['global-menu', null], ['account-menu', 'a']] as const) {
        s.automation(id, 'tag_change', account, {}, [
          { type: 'switch_rich_menu', params: { richMenuId: 'synthetic-menu' } },
        ]);
      }
      await attachTagAndFireSideEffects(s.db, 'friend-a', 'tag-a');
      expect(s.requests).toEqual([]);
      expect(s.sqlite.prepare('SELECT automation_id,status FROM automation_logs').all())
        .toEqual([{ automation_id: 'global-menu', status: 'failed' }]);
    } finally { s.sqlite.close(); }
  });

  it('uses a verified OAuth channel for an unassigned friend even when multiple accounts exist', async () => {
    const s = setup();
    try {
      s.sqlite.exec("UPDATE friends SET line_account_id=NULL WHERE id='friend-a'; UPDATE line_accounts SET channel_access_token='synthetic-rotated-b' WHERE id='b'");
      for (const account of ['a', 'b']) {
        s.automation(`menu-${account}`, 'tag_change', account, {}, [
          { type: 'switch_rich_menu', params: { richMenuId: `synthetic-menu-${account}` } },
        ]);
      }
      await attachTagAndFireSideEffects(s.db, 'friend-a', 'tag-a', {
        defaultAccessToken: 'synthetic-stale-b', accountChannelId: 'channel-b',
      });
      expect(s.requests).toHaveLength(1);
      expect(s.requests[0]).toMatchObject({ token: 'synthetic-rotated-b' });
      expect(s.requests[0].path).toContain('synthetic-menu-b');
      expect(s.sqlite.prepare('SELECT automation_id,status FROM automation_logs').all())
        .toEqual([{ automation_id: 'menu-b', status: 'success' }]);
    } finally { s.sqlite.close(); }
  });

  it('rejects an explicit foreign account before changing tags or starting a scenario', async () => {
    const s = setup();
    try {
      s.scenario('scenario-a', 'a');
      await expect(attachTagAndFireSideEffects(s.db, 'friend-a', 'tag-a', undefined, { lineAccountId: 'b' }))
        .rejects.toThrow('Tag event account does not match the target friend');
      expect(s.sqlite.prepare('SELECT COUNT(*) n FROM friend_tags').get()).toEqual({ n: 0 });
      expect(s.sqlite.prepare('SELECT COUNT(*) n FROM friend_scenarios').get()).toEqual({ n: 0 });
      expect(s.requests).toEqual([]);
    } finally { s.sqlite.close(); }
  });

  it('bounds an add/remove/add cycle to one tag effect, one enrollment and one menu action', async () => {
    const s = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      s.scenario('scenario-a', 'a');
      s.automation('cycle', 'tag_change', 'a', { tag_id: 'tag-a' }, [
        { type: 'remove_tag', params: { tagId: 'tag-a' } },
        { type: 'add_tag', params: { tagId: 'tag-a' } },
        { type: 'switch_rich_menu', params: { richMenuId: 'synthetic-menu-a' } },
      ]);
      await attachTagAndFireSideEffects(s.db, 'friend-a', 'tag-a');
      expect(s.requests).toHaveLength(1);
      expect(s.sqlite.prepare('SELECT COUNT(*) n FROM friend_scenarios').get()).toEqual({ n: 1 });
      expect(s.sqlite.prepare("SELECT COUNT(*) n FROM engagement_events WHERE event_type='tag_added'").get()).toEqual({ n: 1 });
      expect(s.sqlite.prepare('SELECT COUNT(*) n FROM automation_logs').get()).toEqual({ n: 1 });
      const audit = s.sqlite.prepare("SELECT status,actions_result FROM automation_logs WHERE automation_id='cycle'").get()!;
      expect(audit.status).toBe('partial');
      expect(JSON.parse(String(audit.actions_result))).toEqual([
        { action: 'remove_tag', success: true },
        { action: 'add_tag', success: false, error: 'Tag automation cycle detected: repeated side effects were skipped' },
        { action: 'switch_rich_menu', success: true },
      ]);
      expect(warn).toHaveBeenCalledWith('Repeated tag automation side effects skipped within this dispatch');
    } finally { s.sqlite.close(); }
  });

  it('limits a long unique-tag chain and records the stopped action without writing the next tag', async () => {
    const s = setup();
    try {
      for (let index = 0; index <= MAX_TAG_CHANGES_PER_DISPATCH; index++) {
        s.sqlite.prepare('INSERT INTO tags(id,name) VALUES(?,?)').run(`chain-${index}`, `Synthetic ${index}`);
        s.automation(`chain-${index}`, 'tag_change', 'a', { tag_id: `chain-${index}` }, [
          { type: 'add_tag', params: { tagId: `chain-${index + 1}` } },
        ]);
      }
      await attachTagAndFireSideEffects(s.db, 'friend-a', 'chain-0');
      expect(s.sqlite.prepare('SELECT COUNT(*) n FROM friend_tags').get()).toEqual({ n: MAX_TAG_CHANGES_PER_DISPATCH });
      expect(s.sqlite.prepare("SELECT COUNT(*) n FROM automation_logs WHERE status='failed'").get()).toEqual({ n: 1 });
      const row = s.sqlite.prepare("SELECT actions_result FROM automation_logs WHERE status='failed'").get()!;
      expect(String(row.actions_result)).toContain('Tag automation chain limit reached');
    } finally { s.sqlite.close(); }
  });

  it('preserves UUID-linked cross-account scenario delivery through the existing cron resolver', async () => {
    const s = setup();
    try {
      s.sqlite.exec("INSERT INTO users(id,display_name) VALUES('linked-user','Synthetic person'); UPDATE friends SET user_id='linked-user'");
      s.scenario('scenario-b', 'b');
      s.automation('keyword', 'message_received', 'a', { keyword: 'start' }, [
        { type: 'add_tag', params: { tagId: 'tag-a' } },
      ]);
      await fireEvent(s.db, 'message_received', { friendId: 'friend-a', eventData: { text: 'start' } }, 'synthetic-token-a', 'a');
      s.sqlite.exec("UPDATE friend_scenarios SET next_delivery_at='2020-01-01T00:00:00.000+09:00'");
      await processStepDeliveries(s.db, new LineClient('wrong-synthetic-default'));
      const pushes = s.requests.filter(request => request.path.endsWith('/message/push'));
      expect(pushes).toHaveLength(1);
      expect(pushes[0]).toMatchObject({ token: 'synthetic-token-b', body: { to: 'line-friend-b' } });
    } finally { s.sqlite.close(); }
  });

  it('instant tag scenarios use the linked recipient and scenario token while tag automations use the source account', async () => {
    const s = setup();
    try {
      s.sqlite.exec("INSERT INTO users(id,display_name) VALUES('linked-user','Synthetic person'); UPDATE friends SET user_id='linked-user'");
      s.scenario('scenario-b', 'b', 'tag-a', 0);
      // The condition must still see tags on the UUID-linked source friend.
      s.sqlite.exec("UPDATE scenario_steps SET condition_type='tag_exists',condition_value='tag-a' WHERE scenario_id='scenario-b'");
      s.automation('menu-a', 'tag_change', 'a', {}, [
        { type: 'switch_rich_menu', params: { richMenuId: 'synthetic-menu-a' } },
      ]);
      await attachTagAndFireSideEffects(s.db, 'friend-a', 'tag-a', {
        defaultAccessToken: 'wrong-synthetic-default', accountChannelId: 'channel-a',
      });
      expect(s.requests).toHaveLength(2);
      expect(s.requests[0]).toMatchObject({ token: 'synthetic-token-b', body: { to: 'line-friend-b' } });
      expect(s.requests[1]).toMatchObject({ token: 'synthetic-token-a' });
      expect(s.requests[1].path).toContain('synthetic-menu-a');
      expect(s.sqlite.prepare('SELECT friend_id,status FROM friend_scenarios').all())
        .toEqual([{ friend_id: 'friend-a', status: 'completed' }]);
    } finally { s.sqlite.close(); }
  });

  it('does not instant-send a foreign account scenario when the source has no linked destination', async () => {
    const s = setup();
    try {
      s.scenario('scenario-b', 'b', 'tag-a', 0);
      await attachTagAndFireSideEffects(s.db, 'friend-a', 'tag-a', {
        defaultAccessToken: 'synthetic-token-a', accountChannelId: 'channel-a',
      });
      await processStepDeliveries(s.db, new LineClient('wrong-synthetic-default'));
      expect(s.requests).toEqual([]);
      expect(s.sqlite.prepare('SELECT status FROM friend_scenarios').all()).toEqual([{ status: 'paused' }]);
    } finally { s.sqlite.close(); }
  });
});
