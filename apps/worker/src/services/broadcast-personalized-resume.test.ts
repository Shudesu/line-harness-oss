import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { LineClient } from '@line-crm/line-sdk';
import { recoverStalledBroadcasts } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { processQueuedBroadcasts } from './broadcast.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const closes: Array<() => void> = [];
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  closes.splice(0).forEach(close => close()); vi.restoreAllMocks();
});
function setup(marker: string) {
  const { db, sqlite } = sqliteD1(); sqlite.exec(schema); closes.push(() => sqlite.close());
  db.batch=async<T>(statements:D1PreparedStatement[])=>{sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run<T>());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network forbidden'));
  vi.spyOn(LineClient.prototype, 'getMessageQuota').mockResolvedValue({type:'none'});
  vi.spyOn(LineClient.prototype, 'getMessageQuotaConsumption').mockResolvedValue({totalUsage:0});
  const push = vi.spyOn(LineClient.prototype, 'pushMessage').mockResolvedValue({data:{},requestId:'synthetic'});
  sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','A','synthetic-token','synthetic-secret'); INSERT INTO tags(id,name) VALUES('tag','Tag')");
  function friend(id: string, created: string, following = 1, account = 'a', tagged = true) {
    if (account === 'b') sqlite.exec("INSERT OR IGNORE INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('b','b','B','synthetic-b','synthetic-secret')");
    sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name,created_at,is_following) VALUES(?,?,?,?,?,?)').run(id,`line-${id}`,account,id,created,following);
    if (tagged) sqlite.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,'tag')").run(id);
  }
  for (let i=0;i<25;i++) friend(`f${i}`,`2026-01-${String(i+1).padStart(2,'0')}T00:00:00`);
  friend('foreign','2026-01-01T00:00:00',1,'b'); friend('blocked','2026-01-01T00:00:00',0); friend('untagged','2026-01-01T00:00:00',1,'a',false);
  sqlite.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,line_account_id,status,segment_conditions,track_links)
    VALUES('campaign','Campaign','text','Hello {{name}}','tag','tag','a','sending',?,0)`).run(marker);
  const run = () => processQueuedBroadcasts(db,new LineClient('unused'));
  const state = () => sqlite.prepare("SELECT status,batch_offset,total_count,success_count FROM broadcasts WHERE id='campaign'").get() as Record<string,unknown>;
  async function finish() { for(let i=0;i<8 && state().status!=='sent';i++) await run(); expect(state().status).toBe('sent'); }
  return {db,sqlite,push,friend,run,finish,state};
}
function failNextFriendLookup(db:D1Database,onFailure:()=>void) {
  const prepare=db.prepare.bind(db);let failed=false;
  function wrap(statement:D1PreparedStatement):D1PreparedStatement {
    return new Proxy(statement,{get(target,key){
      if(key==='bind')return(...values:unknown[])=>wrap(target.bind(...values));
      if(key==='first')return async()=>{if(!failed){failed=true;onFailure();throw new Error('Synthetic delayed database read failure');}return target.first();};
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
  }
  db.prepare=sql=>sql.includes('AS owned')?wrap(prepare(sql)):prepare(sql);
  return()=>failed;
}
const segment = JSON.stringify({operator:'AND',rules:[{type:'tag_exists',value:'tag'}]});
describe.each([['segment',segment],['legacy tag','']])('personalized %s continuation follows recipient identity', (_lane,marker) => {
  it.each(['unfollow','tag removal','order change'])('does not skip unsent friends after a sent friend changes: %s', async mutation => {
    const s=setup(marker); await s.run(); expect(s.push).toHaveBeenCalledTimes(10);
    const sent=s.push.mock.calls[0][0];
    if(mutation==='unfollow') s.sqlite.prepare('UPDATE friends SET is_following=0 WHERE line_user_id=?').run(sent);
    if(mutation==='tag removal') s.sqlite.prepare('DELETE FROM friend_tags WHERE friend_id=(SELECT id FROM friends WHERE line_user_id=?)').run(sent);
    if(mutation==='order change') s.sqlite.prepare('UPDATE friends SET created_at=? WHERE line_user_id=?').run(marker ? '2099-01-01' : '1900-01-01',sent);
    await s.finish();
    const recipients=s.push.mock.calls.map(call=>call[0]);expect(recipients).toHaveLength(25);expect(new Set(recipients).size).toBe(25);
    expect(recipients.sort()).toEqual(Array.from({length:25},(_,i)=>`line-f${i}`).sort());
    expect(s.state().success_count).toBe(25);
  });
  it('includes a new eligible friend inserted before the old offset without resending previous friends', async () => {
    const s=setup(marker);await s.run();s.friend('new',marker?'1900-01-01':'2099-01-01');await s.finish();
    const recipients=s.push.mock.calls.map(call=>call[0]);expect(recipients).toHaveLength(26);expect(new Set(recipients).size).toBe(26);expect(recipients).toContain('line-new');
    expect(s.state()).toMatchObject({success_count:26,total_count:26});
  });
  it('continues normally when membership is unchanged, preserving the ten-send budget', async () => {
    const s=setup(marker);await s.run();expect(s.state()).toMatchObject({batch_offset:10,success_count:10});
    await s.run();expect(s.state()).toMatchObject({batch_offset:20,success_count:20});await s.finish();expect(s.push).toHaveBeenCalledTimes(25);
    const ids=Array.from({length:25},(_,i)=>`line-f${i}`);expect(s.push.mock.calls.map(call=>call[0])).toEqual(marker?ids:ids.reverse());
  });
  it('excludes a now-ineligible unsent friend and still sends every other eligible friend', async () => {
    const s=setup(marker);await s.run();const sent=new Set(s.push.mock.calls.map(call=>call[0]));
    const unsent=Array.from({length:25},(_,i)=>`line-f${i}`).find(id=>!sent.has(id))!;
    s.sqlite.prepare('UPDATE friends SET is_following=0 WHERE line_user_id=?').run(unsent);await s.finish();
    expect(s.push).toHaveBeenCalledTimes(24);expect(s.push.mock.calls.map(call=>call[0])).not.toContain(unsent);
    expect(s.state()).toMatchObject({success_count:24,total_count:25});
  });
  it.each(['test','incoming'])('does not mistake a %s log for an accepted campaign send', async kind => {
    const s=setup(marker);
    s.sqlite.prepare(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,source,delivery_type)
      VALUES('irrelevant','f0',?,'text','Synthetic','campaign','broadcast',?)`).run(kind==='incoming'?'incoming':'outgoing',kind==='test'?'test':null);
    await s.finish();expect(s.push).toHaveBeenCalledTimes(25);expect(s.state()).toMatchObject({success_count:25,total_count:25});
  });
  it('preserves a failed recipient retry key after an earlier accepted friend leaves the audience', async () => {
    const s=setup(marker);s.push.mockRejectedValueOnce(new Error('Synthetic timeout'));
    await s.run();expect(s.state()).toMatchObject({batch_offset:0,success_count:0});
    const key=s.push.mock.calls[0][2];await s.run();expect(s.push.mock.calls[1][2]).toBe(key);
    s.sqlite.prepare('UPDATE friends SET is_following=0 WHERE line_user_id=?').run(s.push.mock.calls[1][0]);
    await s.finish();expect(new Set(s.push.mock.calls.map(call=>call[0])).size).toBe(25);expect(s.state().success_count).toBe(25);
  });
  it('records one receipt per friend when an old accepted push returns after recovery', async () => {
    const s=setup(marker);let release!:()=>void;let entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});
    const accepted=new Map<string,string>();let calls=0;
    s.push.mockImplementation(async(friend,messages,key)=>{
      calls++;const body=JSON.stringify({friend,messages});if(accepted.has(key!))expect(body).toBe(accepted.get(key!));else accepted.set(key!,body);
      if(calls===1){entered();await gate;}return {data:{},requestId:'synthetic-accepted'};
    });
    const old=s.run();await started;await new Promise(resolve=>setTimeout(resolve,5));
    await recoverStalledBroadcasts(s.db);expect(s.state().batch_offset).toBe(-1);
    const age=s.sqlite.prepare("SELECT abs(julianday('now','+9 hours')-julianday(batch_lock_at))*86400 AS seconds FROM broadcasts").get() as {seconds:number};expect(age.seconds).toBeLessThan(5);
    try{s.sqlite.exec("UPDATE broadcasts SET batch_lock_at='2000-01-01T00:00:00'");await recoverStalledBroadcasts(s.db);await s.run();}
    finally{release();await old;}
    await s.finish();expect(accepted.size).toBe(25);expect(s.sqlite.prepare('SELECT COUNT(*) n,COUNT(DISTINCT friend_id) unique_n FROM messages_log WHERE broadcast_id=\'campaign\'').get()).toEqual({n:25,unique_n:25});
    expect(s.state()).toMatchObject({status:'sent',success_count:25,total_count:25});
  });
  it('does not let an old failed push overwrite the recovered execution progress', async () => {
    const s=setup(marker);let release!:()=>void;let entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});let calls=0;
    s.push.mockImplementation(async()=>{calls++;if(calls===1){entered();await gate;throw new Error('Synthetic old timeout');}return {data:{},requestId:'synthetic'};});
    const old=s.run();await started;await new Promise(resolve=>setTimeout(resolve,5));
    let before:Record<string,unknown>|undefined;
    try{s.sqlite.exec("UPDATE broadcasts SET batch_lock_at='2000-01-01T00:00:00'");await recoverStalledBroadcasts(s.db);await s.run();before=s.sqlite.prepare('SELECT * FROM broadcasts').get() as Record<string,unknown>;}
    finally{release();await old;}
    expect(s.sqlite.prepare('SELECT * FROM broadcasts').get()).toEqual(before);expect(s.state()).toMatchObject({batch_offset:10,success_count:10});await s.finish();expect(s.state().success_count).toBe(25);
  });
  it('keeps a recovered final result when the old last push returns late', async () => {
    const s=setup(marker);s.sqlite.exec("DELETE FROM friends WHERE id!='f0'");let release!:()=>void;let entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});let calls=0;
    s.push.mockImplementation(async()=>{calls++;if(calls===1){entered();await gate;}return {data:{},requestId:'synthetic'};});
    const old=s.run();await started;await new Promise(resolve=>setTimeout(resolve,5));let before:Record<string,unknown>|undefined;
    try{s.sqlite.exec("UPDATE broadcasts SET batch_lock_at='2000-01-01T00:00:00'");await recoverStalledBroadcasts(s.db);await s.run();before=s.sqlite.prepare('SELECT * FROM broadcasts').get() as Record<string,unknown>;}
    finally{release();await old;}
    expect(s.sqlite.prepare('SELECT * FROM broadcasts').get()).toEqual(before);expect(s.state()).toMatchObject({status:'sent',success_count:1,total_count:1});expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:1});expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({n:1});
  });
  it.each(['newer claim','newer completion'])('does not finalize an all-logged audience over a %s',async newer=>{
    const s=setup(marker);s.sqlite.exec("DELETE FROM friends WHERE id!='f0'; INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,source) VALUES('saved','f0','outgoing','text','Saved','campaign','broadcast'); UPDATE broadcasts SET success_count=1,batch_offset=1,total_count=1");
    const prepare=s.db.prepare.bind(s.db);let interleave=true;let before:Record<string,unknown>|undefined;
    s.db.prepare=sql=>{if(interleave && sql.includes('INSERT INTO broadcast_insights')){interleave=false;
      if(newer==='newer claim')s.sqlite.exec("UPDATE broadcasts SET batch_lock_at='2099-01-01T00:00:00'");
      else s.sqlite.exec("UPDATE broadcasts SET status='sent',sent_at='2026-10-21T12:00:00+09:00',aggregation_unit='newer-unit',last_error='newer result'");
      before=s.sqlite.prepare('SELECT * FROM broadcasts').get() as Record<string,unknown>;
    }return prepare(sql);};
    await s.run();expect(interleave).toBe(false);expect(s.sqlite.prepare('SELECT * FROM broadcasts').get()).toEqual(before);expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({n:0});expect(s.push).not.toHaveBeenCalled();
  });
  it('does not revert a newer claim to draft after an old quota check returns',async()=>{
    const s=setup(marker);let before:Record<string,unknown>|undefined;
    vi.spyOn(LineClient.prototype,'getMessageQuota').mockImplementation(async()=>{
      s.sqlite.exec("UPDATE broadcasts SET batch_lock_at='2099-01-01T00:00:00'");before=s.sqlite.prepare('SELECT * FROM broadcasts').get() as Record<string,unknown>;
      return {type:'limited',value:0};
    });
    await s.run();expect(before).toBeDefined();expect(s.sqlite.prepare('SELECT * FROM broadcasts').get()).toEqual(before);expect(s.push).not.toHaveBeenCalled();
  });
  it('does not reset a newer claim total while an old audience lookup finishes',async()=>{
    const s=setup(marker);const prepare=s.db.prepare.bind(s.db);let interleave=true;let before:Record<string,unknown>|undefined;
    s.db.prepare=sql=>{if(interleave && sql.startsWith('UPDATE broadcasts SET total_count = ?')){interleave=false;s.sqlite.exec("UPDATE broadcasts SET batch_lock_at='2099-01-01T00:00:00',total_count=77");before=s.sqlite.prepare('SELECT * FROM broadcasts').get() as Record<string,unknown>;}return prepare(sql);};
    await s.run();expect(interleave).toBe(false);expect(s.sqlite.prepare('SELECT * FROM broadcasts').get()).toEqual(before);expect(s.push).not.toHaveBeenCalled();
  });
  it.each(['newer claim','newer completion'])('does not report a stale unexpected database failure over a %s',async newer=>{
    const s=setup(marker);let before:Record<string,unknown>|undefined;
    const failed=failNextFriendLookup(s.db,()=>{
      if(newer==='newer claim')s.sqlite.exec("UPDATE broadcasts SET batch_lock_at='2099-01-01T00:00:00',last_error='newer failure'");
      else s.sqlite.exec("UPDATE broadcasts SET status='sent',sent_at='2026-10-21T12:00:00+09:00',last_error='newer outcome',aggregation_unit='newer-unit'");
      before=s.sqlite.prepare('SELECT * FROM broadcasts').get() as Record<string,unknown>;
    });
    await s.run();expect(failed()).toBe(true);expect(s.sqlite.prepare('SELECT * FROM broadcasts').get()).toEqual(before);expect(s.push).not.toHaveBeenCalled();
  });
  it('keeps a committed final outcome when only the database transaction response is lost',async()=>{
    const s=setup(marker);s.sqlite.exec("DELETE FROM friends WHERE id!='f0'");const batch=s.db.batch.bind(s.db);let lose=true;
    s.db.batch=async<T>(statements:D1PreparedStatement[])=>{const results=await batch<T>(statements);if(lose){lose=false;throw new Error('Synthetic lost database response after finalization commit');}return results;};
    await s.run();const row=s.sqlite.prepare('SELECT * FROM broadcasts').get() as Record<string,unknown>;expect(row).toMatchObject({status:'sent',success_count:1,total_count:1,last_error:null,aggregation_unit:'bcast_campaign'});expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:1});expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({n:1});expect(s.push).toHaveBeenCalledTimes(1);
  });
  it('still records an unexpected database failure owned by the current execution',async()=>{
    const s=setup(marker);const failed=failNextFriendLookup(s.db,()=>{});
    await s.run();expect(failed()).toBe(true);expect(s.state()).toMatchObject({status:'sending',batch_offset:-1,success_count:0});expect((s.sqlite.prepare('SELECT last_error FROM broadcasts').get() as {last_error:string}).last_error).toContain('配信処理を継続できませんでした');expect(s.push).not.toHaveBeenCalled();
  });
  it('still shows a configuration error after releasing its own unchanged claim',async()=>{
    const s=setup(marker);s.sqlite.exec("UPDATE broadcasts SET message_content='Hello {{name}} {{unknown}}'");await s.run();expect(s.state()).toMatchObject({status:'sending',batch_offset:0,success_count:0});expect(String((s.sqlite.prepare('SELECT last_error FROM broadcasts').get() as {last_error:string}).last_error)).toContain('配信処理を継続できませんでした');expect(s.push).not.toHaveBeenCalled();
  });
  it('resumes a recovered offset-zero row with a saved accepted prefix', async () => {
    const s=setup(marker);const order=Array.from({length:25},(_,i)=>`f${i}`);if(!marker)order.reverse();
    for(const id of order.slice(0,20))s.sqlite.prepare(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,source)
      VALUES(?,?,'outgoing','text','Saved accepted receipt','campaign','broadcast')`).run(`saved-${id}`,id);
    s.sqlite.exec("UPDATE broadcasts SET success_count=20,total_count=25,batch_offset=0");
    await s.run();expect(s.push).toHaveBeenCalledTimes(5);expect(s.push.mock.calls.map(call=>call[0])).toEqual(order.slice(20).map(id=>`line-${id}`));
    expect(s.state()).toMatchObject({status:'sent',success_count:25,total_count:25});
  });

});

describe('personalized pending request safety', () => {
  it.each(['name change','expired'])('holds unknown acceptance after %s without another send',async mutation=>{
    const s=setup(segment);s.sqlite.exec("DELETE FROM friends WHERE id!='f0'");
    s.push.mockRejectedValueOnce(new Error('Synthetic response lost after provider acceptance'));
    await s.run();
    const saved=(s.sqlite.prepare('SELECT dedup_progress FROM broadcasts').get() as {dedup_progress:string}).dedup_progress;
    if(mutation==='name change')s.sqlite.exec("UPDATE friends SET display_name='Changed'");
    else vi.spyOn(Date,'now').mockReturnValue(Date.now()+24*3600_000);
    await s.run();expect(s.push).toHaveBeenCalledTimes(1);
    expect(s.state()).toMatchObject({status:'sending',batch_offset:0,success_count:0});
    expect(s.sqlite.prepare('SELECT dedup_progress FROM broadcasts').get()).toEqual({dedup_progress:saved});
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:0});
    expect(String((s.sqlite.prepare('SELECT last_error FROM broadcasts').get() as {last_error:string}).last_error)).toContain('要確認');
  });
});

describe('personalized request journal reconciliation',()=>{
  function one(){const s=setup(segment);s.sqlite.exec("DELETE FROM friends WHERE id!='f0'");return s;}
  const journal=(s:ReturnType<typeof setup>)=>(s.sqlite.prepare('SELECT dedup_progress FROM broadcasts').get() as {dedup_progress:string|null}).dedup_progress;
  const reason=(s:ReturnType<typeof setup>)=>String((s.sqlite.prepare('SELECT last_error FROM broadcasts').get() as {last_error:string}).last_error);
  it('replays exactly the saved body and key after unknown acceptance, then consumes one receipt',async()=>{
    const s=one();s.push.mockRejectedValueOnce(new Error('Unknown'));await s.run();const before=journal(s);expect(before).toBeTruthy();
    expect(before).not.toContain('synthetic-token');await s.run();expect(s.push.mock.calls[1]).toEqual(s.push.mock.calls[0]);
    expect(s.state()).toMatchObject({status:'sent',success_count:1,total_count:1});expect(journal(s)).toBeNull();
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:1});
  });
  it.each(['unfollow','tag removal','line ID','channel ID','content','no variable','target conditions','invalid journal','future','23 hours'])('holds pending %s without another send or invented receipt',async mutation=>{
    const s=one();s.push.mockRejectedValueOnce(new Error('Unknown'));await s.run();
    if(mutation==='unfollow')s.sqlite.exec('UPDATE friends SET is_following=0');
    if(mutation==='tag removal')s.sqlite.exec('DELETE FROM friend_tags');
    if(mutation==='line ID')s.sqlite.exec("UPDATE friends SET line_user_id='changed'");
    if(mutation==='channel ID')s.sqlite.exec("UPDATE line_accounts SET channel_id='changed' WHERE id='a'");
    if(mutation==='content')s.sqlite.exec("UPDATE broadcasts SET message_content='Changed {{name}}'");
    if(mutation==='no variable')s.sqlite.exec("UPDATE broadcasts SET message_content='No name'");
    if(mutation==='target conditions')s.sqlite.exec("UPDATE broadcasts SET segment_conditions=''");
    if(mutation==='invalid journal')s.sqlite.exec("UPDATE broadcasts SET dedup_progress='not-json'");
    if(mutation==='future'||mutation==='23 hours'){
      const p=JSON.parse(journal(s)!);p.pending.firstAttemptAt=Date.now()+(mutation==='future'?3600_000:-23*3600_000);
      s.sqlite.prepare('UPDATE broadcasts SET dedup_progress=?').run(JSON.stringify(p));
    }
    const raw=journal(s);await s.run();expect(s.push).toHaveBeenCalledTimes(1);expect(journal(s)).toBe(raw);expect(reason(s)).toContain('要確認');
    expect(s.state()).toMatchObject({status:'sending',batch_offset:0,success_count:0});expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:0});
  });
  it('reconciles the saved recipient before newly eligible friends without exceeding ten sends',async()=>{
    const s=setup(segment);s.push.mockRejectedValueOnce(new Error('Unknown'));await s.run();const first=s.push.mock.calls[0];
    s.friend('new','1900-01-01');await s.run();expect(s.push.mock.calls[1]).toEqual(first);expect(s.push).toHaveBeenCalledTimes(11);
    await s.finish();expect(s.state()).toMatchObject({success_count:26,total_count:26});
  });
  it.each([400,429])('clears a definite %s rejection before a fresh retry',async status=>{
    const s=one();s.push.mockRejectedValueOnce(Object.assign(new Error('Rejected'),{status}));await s.run();expect(journal(s)).toBeNull();
    s.sqlite.exec("UPDATE friends SET display_name='Changed'");await s.run();expect(s.state().status).toBe('sent');expect(s.push).toHaveBeenCalledTimes(2);
  });
  it('retains a bare409 as unknown rather than rotating the key',async()=>{
    const s=one();s.push.mockRejectedValueOnce(Object.assign(new Error('No accepted request ID'),{status:409}));await s.run();expect(journal(s)).toBeTruthy();
    await s.run();expect(s.push.mock.calls[1]).toEqual(s.push.mock.calls[0]);expect(s.state().success_count).toBe(1);
  });
  it('does not revert an unknown acceptance to draft when provider quota is now exhausted',async()=>{
    const s=one();s.push.mockRejectedValueOnce(new Error('Unknown'));await s.run();
    vi.mocked(LineClient.prototype.getMessageQuota).mockResolvedValue({type:'limited',value:0});
    await s.run();expect(s.state()).toMatchObject({status:'sent',success_count:1});expect(s.push).toHaveBeenCalledTimes(2);
  });
  it('retains the exact request after an atomic receipt rollback and safely replays it',async()=>{
    const s=one();const batch=s.db.batch.bind(s.db);let fail=true;
    s.db.batch=async<T>(statements:D1PreparedStatement[])=>{if(fail){fail=false;throw new Error('Synthetic rolled back transaction');}return batch<T>(statements);};
    await s.run();expect(journal(s)).toBeTruthy();expect(s.state().success_count).toBe(0);await s.run();
    expect(s.push.mock.calls[1]).toEqual(s.push.mock.calls[0]);expect(s.state()).toMatchObject({status:'sent',success_count:1});
  });
  it('does not send when persisting the intent fails before HTTP',async()=>{
    const s=one();const prepare=s.db.prepare.bind(s.db);
    s.db.prepare=sql=>{if(sql.startsWith('UPDATE broadcasts SET dedup_progress = ?'))throw new Error('Synthetic save failure');return prepare(sql);};
    await s.run();expect(s.push).not.toHaveBeenCalled();expect(s.state()).toMatchObject({status:'sending',success_count:0});
  });
});

describe('personalized continuation quota and write fences',()=>{
  it('reconciles a saved acceptance then stops fresh sends when its receipt fills the monthly quota',async()=>{
    const s=setup(segment);s.push.mockRejectedValueOnce(new Error('Unknown'));await s.run();const request=s.push.mock.calls[0];
    const env={QUOTA_MONTHLY_MESSAGES_MAX:'1'};
    await processQueuedBroadcasts(s.db,new LineClient('unused'),undefined,env);
    expect(s.push).toHaveBeenCalledTimes(2);expect(s.push.mock.calls[1]).toEqual(request);
    expect(s.state()).toMatchObject({status:'sending',success_count:1,batch_offset:1});
    await processQueuedBroadcasts(s.db,new LineClient('unused'),undefined,env);expect(s.push).toHaveBeenCalledTimes(2);
  });
  it('does not repeat automatic link generation at offset zero after unknown acceptance',async()=>{
    const s=setup(segment);s.sqlite.exec("DELETE FROM friends WHERE id!='f0'; UPDATE broadcasts SET track_links=1,message_content='Hello {{name}} https://example.com'");
    s.push.mockRejectedValueOnce(new Error('Unknown'));await processQueuedBroadcasts(s.db,new LineClient('unused'),'https://worker.example.com');
    const links=s.sqlite.prepare('SELECT * FROM tracked_links').all();expect(links).toHaveLength(1);
    await processQueuedBroadcasts(s.db,new LineClient('unused'),'https://worker.example.com');
    expect(s.sqlite.prepare('SELECT * FROM tracked_links').all()).toEqual(links);expect(s.push.mock.calls[1]).toEqual(s.push.mock.calls[0]);expect(s.state().status).toBe('sent');
  });
  it('holds pending content with a new unsupported variable instead of releasing it as fresh',async()=>{
    const s=setup(segment);s.push.mockRejectedValueOnce(new Error('Unknown'));await s.run();
    s.sqlite.exec("UPDATE broadcasts SET message_content='Hello {{name}} {{unknown}}'");await s.run();
    expect(s.push).toHaveBeenCalledTimes(1);expect(String((s.sqlite.prepare('SELECT last_error FROM broadcasts').get() as {last_error:string}).last_error)).toContain('要確認');
  });
  it('does not claim a stale queue snapshot over a newer pending request',async()=>{
    const s=setup(segment);const prepare=s.db.prepare.bind(s.db);let once=true;
    s.db.prepare=sql=>{if(once&&sql.startsWith('UPDATE broadcasts SET batch_offset = -1')){once=false;s.sqlite.exec("UPDATE broadcasts SET dedup_progress='newer request'");}return prepare(sql);};
    await s.run();expect(once).toBe(false);expect(s.push).not.toHaveBeenCalled();
    expect(s.sqlite.prepare('SELECT dedup_progress,batch_offset FROM broadcasts').get()).toEqual({dedup_progress:'newer request',batch_offset:0});
  });
});

describe('pre-journal personalized uncertain receipts',()=>{
  it.each(['unknown response','missing receipt'])('holds a legacy %s without inventing a new first attempt',async kind=>{
    const s=setup(segment);
    const reason=kind==='unknown response'
      ? 'LINEの受付結果を確認できませんでした。重複配信を避けるため、再送前に配信状況を確認してください。'
      : 'LINEでは受付済みですが、送信記録の保存に失敗しました。再送せず配信状況を確認してください。';
    s.sqlite.prepare('UPDATE broadcasts SET last_error=?,total_count=25').run(reason);
    await s.run();expect(s.push).not.toHaveBeenCalled();expect(s.state()).toMatchObject({status:'sending',batch_offset:0,success_count:0,total_count:25});
    expect(s.sqlite.prepare('SELECT dedup_progress FROM broadcasts').get()).toEqual({dedup_progress:null});
    expect(String((s.sqlite.prepare('SELECT last_error FROM broadcasts').get() as {last_error:string}).last_error)).toContain('要確認');
    await s.run();expect(s.push).not.toHaveBeenCalled();
  });
});

describe('pre-HTTP failure is distinct from legacy unknown acceptance',()=>{
  it('can retry after a transient intent-save failure that never called LINE',async()=>{
    const s=setup(segment);s.sqlite.exec("DELETE FROM friends WHERE id!='f0'");const prepare=s.db.prepare.bind(s.db);let once=true;
    s.db.prepare=sql=>{if(once&&sql.startsWith('UPDATE broadcasts SET dedup_progress = ?')){once=false;throw new Error('Synthetic storage unavailable');}return prepare(sql);};
    await s.run();expect(s.push).not.toHaveBeenCalled();expect(String((s.sqlite.prepare('SELECT last_error FROM broadcasts').get() as {last_error:string}).last_error)).toContain('LINEを呼ばず');
    await s.run();expect(s.push).toHaveBeenCalledTimes(1);expect(s.state()).toMatchObject({status:'sent',success_count:1,total_count:1});
  });
  it('preserves an old known prefix and counters while holding its unjournaled unknown suffix',async()=>{
    const s=setup(segment);s.sqlite.exec("INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,source) VALUES('old','f0','outgoing','text','Saved','campaign','broadcast'); UPDATE broadcasts SET success_count=1,total_count=25,batch_offset=0,last_error='LINEの受付結果を確認できませんでした。'");
    await s.run();expect(s.push).not.toHaveBeenCalled();expect(s.state()).toMatchObject({status:'sending',success_count:1,total_count:25,batch_offset:0});expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:1});
  });
});

describe('saved requests obey the existing soft quota gate',()=>{
  it('does not let an uncertain request make a new provider acceptance while already over quota',async()=>{
    const s=setup(segment);s.push.mockRejectedValueOnce(new Error('Uncertain but not actually accepted'));
    await s.run();const raw=(s.sqlite.prepare('SELECT dedup_progress FROM broadcasts').get() as {dedup_progress:string}).dedup_progress;
    await processQueuedBroadcasts(s.db,new LineClient('unused'),undefined,{QUOTA_FRIENDS_MAX:'1'});
    expect(s.push).toHaveBeenCalledTimes(1);expect(s.state()).toMatchObject({status:'sending',success_count:0,batch_offset:0});
    expect(s.sqlite.prepare('SELECT dedup_progress FROM broadcasts').get()).toEqual({dedup_progress:raw});
  });
});

describe('quota pauses retain the original retry expiry',()=>{
  it('does not reset an old attempt after the quota is relaxed a day later',async()=>{
    const s=setup(segment);s.push.mockRejectedValueOnce(new Error('Unknown'));await s.run();
    await processQueuedBroadcasts(s.db,new LineClient('unused'),undefined,{QUOTA_FRIENDS_MAX:'1'});expect(s.push).toHaveBeenCalledTimes(1);
    vi.spyOn(Date,'now').mockReturnValue(Date.now()+24*3600_000);
    await processQueuedBroadcasts(s.db,new LineClient('unused'),undefined,{QUOTA_FRIENDS_MAX:'100'});
    expect(s.push).toHaveBeenCalledTimes(1);expect(s.state()).toMatchObject({status:'sending',success_count:0});
    expect(String((s.sqlite.prepare('SELECT last_error FROM broadcasts').get() as {last_error:string}).last_error)).toContain('要確認');
  });
});

describe('legacy uncertainty cannot be masked by preliminary errors',()=>{
  function legacy(){const s=setup(segment);s.sqlite.exec("UPDATE broadcasts SET last_error='LINEの受付結果を確認できませんでした。'");return s;}
  it('keeps holding when the receipt lookup would fail before the claim',async()=>{
    const s=legacy();const prepare=s.db.prepare.bind(s.db);let fail=true;
    s.db.prepare=sql=>{if(fail&&sql.includes('SELECT friend_id FROM messages_log')){fail=false;throw new Error('Synthetic receipt lookup unavailable');}return prepare(sql);};
    await s.run();s.db.prepare=prepare;await s.run();expect(s.push).not.toHaveBeenCalled();
    expect(String((s.sqlite.prepare('SELECT last_error FROM broadcasts').get() as {last_error:string}).last_error)).toContain('要確認');
  });
  it('keeps holding after an unavailable sender is restored',async()=>{
    const s=legacy();s.sqlite.exec("UPDATE line_accounts SET is_active=0 WHERE id='a'");await s.run();
    s.sqlite.exec("UPDATE line_accounts SET is_active=1 WHERE id='a'");await s.run();expect(s.push).not.toHaveBeenCalled();
    expect(String((s.sqlite.prepare('SELECT last_error FROM broadcasts').get() as {last_error:string}).last_error)).toContain('要確認');
  });
});

describe('legacy hold metadata failure remains fail closed',()=>{
  it('retains the old uncertain reason when saving its review label fails',async()=>{
    const s=setup(segment);const old='LINEの受付結果を確認できませんでした。';s.sqlite.prepare('UPDATE broadcasts SET last_error=?').run(old);
    const prepare=s.db.prepare.bind(s.db);s.db.prepare=sql=>{if(sql.startsWith('UPDATE broadcasts SET last_error = ?'))throw new Error('Synthetic hold metadata unavailable');return prepare(sql);};
    await s.run();await s.run();expect(s.push).not.toHaveBeenCalled();expect(s.state()).toMatchObject({status:'sending',batch_offset:0,success_count:0});
    expect(s.sqlite.prepare('SELECT last_error FROM broadcasts').get()).toEqual({last_error:old});
  });
});
