import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { LineClient, LineApiError } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { broadcasts } from '../routes/broadcasts.js';
import { processQueuedBroadcasts, processScheduledBroadcasts } from './broadcast.js';

vi.mock('./stealth.js', () => ({ sleep: async () => {}, calculateStaggerDelay: () => 0, addMessageVariation: (s: string) => s }));
const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const closes: Array<() => void> = [];
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  for (const close of closes.splice(0)) close();
  vi.restoreAllMocks();
});

function setup() {
  const { db, sqlite } = sqliteD1(); closes.push(() => sqlite.close()); sqlite.exec(schema);
  db.batch = async <T>(statements: D1PreparedStatement[]) => {
    sqlite.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run<T>()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  };
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network forbidden'));
  vi.spyOn(LineClient.prototype, 'getMessageQuota').mockResolvedValue({ type: 'none' });
  vi.spyOn(LineClient.prototype, 'getMessageQuotaConsumption').mockResolvedValue({ totalUsage: 0 });
  const tokens: string[] = [];
  const multicast = vi.spyOn(LineClient.prototype, 'multicast').mockImplementation(async function (this: LineClient) {
    tokens.push(Reflect.get(this, 'channelAccessToken')); return { data: {}, requestId: 'synthetic' };
  });
  const sendAll = vi.spyOn(LineClient.prototype, 'broadcast').mockImplementation(async function (this: LineClient) {
    tokens.push(Reflect.get(this, 'channelAccessToken')); return { data: {}, requestId: 'synthetic' };
  });
  const app = new Hono(); app.route('/', broadcasts);
  sqlite.exec("INSERT INTO tags(id,name) VALUES('tag','Audience')");
  const account = (id = 'a', active = 1, token = `test-token-${id}`) => sqlite.prepare(
    'INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,is_active) VALUES(?,?,?,?,?,?)',
  ).run(id,id,id,token,'synthetic-secret',active);
  function friends(count: number, accountId: string | null = 'a') {
    for (let i = 0; i < count; i++) {
      const id = `${accountId ?? 'legacy'}-${i}`;
      sqlite.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES(?,?,?,?)').run(id,`line-${id}`,id,accountId);
      sqlite.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,'tag')").run(id);
    }
  }
  function campaign(lane: 'immediate' | 'scheduled' | 'queued', accountId: string | null = 'a', type = 'tag') {
    sqlite.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,line_account_id,status,scheduled_at,segment_conditions,track_links)
      VALUES('campaign','Campaign','text','Hello',?,'tag',?,?, '2000-01-01T00:00:00Z',?,0)`)
      .run(type,accountId,lane === 'immediate' ? 'draft' : lane === 'scheduled' ? 'scheduled' : 'sending',lane === 'queued' ? '{"operator":"AND","rules":[{"type":"tag_exists","value":"tag"}]}' : null);
  }
  async function run(lane: 'immediate' | 'scheduled' | 'queued') {
    if (lane === 'immediate') return app.request('/api/broadcasts/campaign/send', { method:'POST' }, { DB:db,LINE_CHANNEL_ACCESS_TOKEN:'test-default' });
    if (lane === 'scheduled') await processScheduledBroadcasts(db,new LineClient('test-default'));
    else await processQueuedBroadcasts(db,new LineClient('test-default'));
  }
  const state = () => sqlite.prepare("SELECT status,total_count,success_count,last_error,batch_offset FROM broadcasts WHERE id='campaign'").get() as Record<string, unknown>;
  return { db,sqlite,account,friends,campaign,run,state,multicast,sendAll,tokens,app };
}

describe('broadcast source validation', () => {
  for (const lane of ['immediate','scheduled','queued'] as const) {
    it.each(['missing','inactive','blank','ambiguous'])(`${lane}: refuses %s source without using default credentials`, async problem => {
      const s=setup();
      if(problem==='inactive') s.account('a',0);
      if(problem==='blank') s.account('a',1,'   ');
      if(problem==='ambiguous') { s.account('a'); s.account('b'); }
      s.friends(1,problem==='ambiguous'||problem==='missing'?null:'a');
      s.campaign(lane,problem==='ambiguous'?null:'a',problem==='missing'?'all':'tag');
      const response=await s.run(lane);
      if(response) expect(response.status).toBe(400);
      expect(s.multicast).not.toHaveBeenCalled();expect(s.sendAll).not.toHaveBeenCalled();
      expect(s.state().status).toBe(lane==='immediate'?'draft':lane==='scheduled'?'scheduled':'sending');
      expect(s.state().last_error).toEqual(expect.any(String));
    });
    it(`${lane}: uses the explicit account without default credentials`, async () => {
      const s=setup();s.account('a');s.account('b');s.friends(1,'a');s.friends(1,'b');s.campaign(lane);
      await s.run(lane);expect(s.tokens).toEqual(['test-token-a']);expect(s.multicast.mock.calls[0][0]).toEqual(['line-a-0']);
    });
    it(`${lane}: retains account-less env delivery`, async () => {
      const s=setup();s.friends(1,null);s.campaign(lane,null);await s.run(lane);
      expect(s.tokens).toEqual(['test-default']);expect(s.state().status).toBe('sent');
    });
  }
  it.each(['missing','inactive','blank','ambiguous'])('send-segment refuses %s sender before enqueue', async problem => {
    const s=setup();
    if(problem==='inactive') s.account('a',0);
    if(problem==='blank') s.account('a',1,'   ');
    if(problem==='ambiguous') { s.account('a');s.account('b'); }
    s.campaign('immediate',problem==='ambiguous'?null:'a');
    const response=await s.app.request('/api/broadcasts/campaign/send-segment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conditions:{operator:'AND',rules:[{type:'tag_exists',value:'tag'}]}})},{DB:s.db,LINE_CHANNEL_ACCESS_TOKEN:'test-default'});
    expect(response.status).toBe(400);expect(s.state().status).toBe('draft');expect(s.multicast).not.toHaveBeenCalled();
  });
  it.each(['scheduled','queued'] as const)('%s: legacy recipients exclude orphaned account-bound friends', async lane => {
    const s=setup();
    // Model imported legacy data whose account reference is already orphaned.
    s.sqlite.exec('PRAGMA foreign_keys=OFF');
    s.friends(1,null);s.friends(1,'deleted');
    s.sqlite.exec('PRAGMA foreign_keys=ON');s.campaign(lane,null);
    await s.run(lane);expect(s.multicast.mock.calls[0][0]).toEqual(['line-legacy-0']);
  });
  it('does not fall back if account lookup fails', async () => {
    const s=setup();s.account();s.campaign('immediate');
    const prepare=s.db.prepare.bind(s.db);s.db.prepare=(sql:string)=>{if(sql==='SELECT * FROM line_accounts WHERE id = ?') throw new Error('database unavailable');return prepare(sql);};
    const response=await s.run('immediate');expect(response?.status).toBe(400);expect(s.multicast).not.toHaveBeenCalled();expect(s.state().status).toBe('draft');
  });
  it('does not guess a registered sender even when only one account exists', async () => {
    const s=setup();s.account();s.friends(1,null);s.campaign('immediate',null);
    expect((await s.run('immediate'))?.status).toBe(400);expect(s.multicast).not.toHaveBeenCalled();
  });
});

describe('delivery outcomes survive failures', () => {
  it('reports an unsuccessful inline tag send as an API failure with a durable explanation', async () => {
    const s=setup();s.account();s.friends(2);s.campaign('immediate');
    s.multicast.mockRejectedValueOnce(new LineApiError(400,'Bad Request','sensitive'));
    expect((await s.run('immediate'))?.status).toBe(502);
    expect(s.state()).toMatchObject({status:'sent',success_count:0,total_count:2});
    expect(s.state().last_error).toContain('HTTP 400');
  });
  it.each(['immediate','scheduled'] as const)('%s: failed finalization writes cannot release an accepted send claim', async lane => {
    const s=setup();s.account();s.friends(2);s.campaign(lane,'a','all');
    s.sendAll.mockImplementationOnce(async () => {
      s.sqlite.exec("CREATE TRIGGER fail_finalize BEFORE UPDATE OF status ON broadcasts WHEN NEW.status = 'sent' BEGIN SELECT RAISE(FAIL,'status unavailable'); END;");
      return {data:{},requestId:'accepted'};
    });
    await s.run(lane);await s.run(lane);
    expect(s.sendAll).toHaveBeenCalledTimes(1);expect(s.state().status).toBe('sending');
  });
  it('records a failed middle batch, preserves accepted counts and does not send the later batch or retry the campaign', async () => {
    const s=setup();s.account();s.friends(1001);s.campaign('scheduled');
    s.multicast.mockResolvedValueOnce({data:{},requestId:'first'}).mockRejectedValueOnce(new LineApiError(400,'Bad Request','sensitive upstream body'));
    await s.run('scheduled');await s.run('scheduled');
    expect(s.multicast).toHaveBeenCalledTimes(2);expect(s.state()).toMatchObject({status:'sent',success_count:500,total_count:1001});
    expect(s.state().last_error).toContain('HTTP 400');expect(s.state().last_error).not.toContain('sensitive');
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:500});
  });
  it.each(['immediate','scheduled'] as const)('%s: accepted all-send is not restored to a sendable state if its receipt write fails', async lane => {
    const s=setup();s.account();s.friends(2);s.campaign(lane,'a','all');
    s.sqlite.exec("CREATE TRIGGER fail_receipt BEFORE UPDATE OF line_request_id ON broadcasts BEGIN SELECT RAISE(FAIL,'receipt save failed'); END;");
    await s.run(lane);await s.run(lane);
    expect(s.sendAll).toHaveBeenCalledTimes(1);expect(s.state()).toMatchObject({status:'sent',success_count:2,total_count:2});expect(s.state().last_error).toContain('受付済み');
  });
  it('does not make an uncertain all-send eligible for retry', async () => {
    const s=setup();s.account();s.friends(2);s.campaign('immediate','a','all');s.sendAll.mockRejectedValueOnce(new Error('timeout with secret metadata'));
    expect((await s.run('immediate'))?.status).toBe(502);expect((await s.run('immediate'))?.status).toBe(409);
    expect(s.sendAll).toHaveBeenCalledTimes(1);expect(s.state()).toMatchObject({status:'sent',success_count:0,total_count:2});expect(s.state().last_error).toContain('受付結果');expect(s.state().last_error).not.toContain('secret');
  });
  it('records queue failures without advancing past an unaccepted batch, then clears the transient error after success', async () => {
    const s=setup();s.account();s.friends(2);s.campaign('queued');s.multicast.mockRejectedValueOnce(new LineApiError(503,'Unavailable','sensitive'));
    await s.run('queued');expect(s.state()).toMatchObject({status:'sending',success_count:0,batch_offset:0});expect(s.state().last_error).toContain('受付結果');
    await s.run('queued');expect(s.state()).toMatchObject({status:'sent',success_count:2,last_error:null});
    expect(s.multicast.mock.calls[0][3]).toBe(s.multicast.mock.calls[1][3]);
  });
  it('keeps a queue log failure visible after recording the accepted count', async () => {
    const s=setup();s.account();s.friends(2);s.campaign('queued');
    s.sqlite.exec("CREATE TRIGGER fail_log BEFORE INSERT ON messages_log BEGIN SELECT RAISE(FAIL,'log save failed'); END;");
    await s.run('queued');expect(s.state()).toMatchObject({status:'sent',success_count:2,total_count:2});expect(s.state().last_error).toContain('受付済み');expect(s.multicast).toHaveBeenCalledTimes(1);
  });
  it('distinguishes a personalized log failure from a provider rejection and reuses its retry key', async () => {
    const s=setup();s.account();s.friends(2);s.campaign('queued');
    const push=vi.spyOn(LineClient.prototype,'pushMessage').mockResolvedValue({data:{},requestId:'synthetic'});
    s.sqlite.exec("UPDATE broadcasts SET message_content='Hi {{name}}'; CREATE TRIGGER fail_log BEFORE INSERT ON messages_log BEGIN SELECT RAISE(FAIL,'sensitive database failure'); END;");
    await s.run('queued');expect(s.state()).toMatchObject({status:'sending',success_count:0,batch_offset:0});expect(s.state().last_error).toContain('受付済み');
    s.sqlite.exec('DROP TRIGGER fail_log');await s.run('queued');
    expect(push).toHaveBeenCalledTimes(3);expect(push.mock.calls[0][2]).toBe(push.mock.calls[1][2]);
    expect(s.state()).toMatchObject({status:'sent',success_count:2,total_count:2});
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:2});
  });
});
