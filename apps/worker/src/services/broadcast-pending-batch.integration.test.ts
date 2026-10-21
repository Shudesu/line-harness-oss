import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { LineClient, LineApiError } from '@line-crm/line-sdk';
import { recoverStalledBroadcasts } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { broadcasts } from '../routes/broadcasts.js';
import { processQueuedBroadcasts } from './broadcast.js';
import { completePendingMulticastBatch, releasePendingMulticastClaim, MAX_PENDING_BATCH_AGE_MS,
  PENDING_BATCH_REVIEW, LEGACY_UNCERTAIN_REVIEW, type PendingMulticastBatch } from './broadcast-pending-batch.js';
import { BROADCAST_RECORDING_ERROR } from './broadcast-delivery-error.js';
vi.mock('./stealth.js',async importOriginal=>({...await importOriginal<typeof import('./stealth.js')>(),sleep:async()=>{},calculateStaggerDelay:()=>0}));
const schema=readFileSync(new URL('../../../../packages/db/bootstrap.sql',import.meta.url),'utf8');
const closes:Array<()=>void>=[];
afterEach(()=>{expect(globalThis.fetch).not.toHaveBeenCalled();closes.splice(0).forEach(close=>close());vi.restoreAllMocks();});
function setup(count=1001,loseAt=2,rejectCode?:number) {
 const {db,sqlite}=sqliteD1();sqlite.exec(schema);closes.push(()=>sqlite.close());
 db.batch=async<T>(statements:D1PreparedStatement[])=>{sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run<T>());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
 vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Real network forbidden'));
 vi.spyOn(LineClient.prototype,'getMessageQuota').mockResolvedValue({type:'none'});
 vi.spyOn(LineClient.prototype,'getMessageQuotaConsumption').mockResolvedValue({totalUsage:0});
 const accepted=new Map<string,{recipients:string[];messages:unknown;units:unknown}>();let calls=0;
 const row=()=>sqlite.prepare("SELECT * FROM broadcasts WHERE id='campaign'").get() as Record<string,unknown>;
 const multicast=vi.spyOn(LineClient.prototype,'multicast').mockImplementation(async(recipients,messages,units,key)=>{
  calls++;expect(key).toEqual(expect.any(String));const plan=JSON.parse(String(row().pending_batch)) as PendingMulticastBatch;
  expect(plan.id).toBe(row().pending_batch_id);expect(plan.retryKey).toBe(key);expect(plan.messages).toEqual(messages);expect(plan.recipients.map(friend=>friend.line_user_id)).toEqual(recipients);expect([plan.unit]).toEqual(units);
  if(calls===loseAt && rejectCode)throw new LineApiError(rejectCode,'Synthetic refusal','No sensitive body');
  const body={recipients,messages,units};
  if(accepted.has(key!)){expect(body).toEqual(accepted.get(key!));return {data:{},requestId:'already-accepted'};}
  accepted.set(key!,body);if(calls===loseAt)throw new Error('Local lost response after acceptance');return {data:{},requestId:'synthetic'};
 });
 sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','A','synthetic-token','synthetic-secret'); INSERT INTO tags(id,name) VALUES('tag','Tag')");
 function friend(id:string,created:string){sqlite.prepare("INSERT INTO friends(id,line_user_id,display_name,line_account_id,created_at) VALUES(?,?,?,'a',?)").run(id,`line-${id}`,id,created);sqlite.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,'tag')").run(id);}
 for(let i=0;i<count;i++)friend(`f${String(i).padStart(4,'0')}`,new Date(Date.UTC(2026,0,1,0,0,i)).toISOString());
 sqlite.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,line_account_id,status,segment_conditions,track_links)
 VALUES('campaign','Campaign','text','Hello','tag','tag','a','sending',?,0)`).run(JSON.stringify({operator:'AND',rules:[{type:'tag_exists',value:'tag'}]}));
 const run=(quotaEnv?:{QUOTA_MONTHLY_MESSAGES_MAX:string})=>processQueuedBroadcasts(db,new LineClient('unused'),undefined,quotaEnv);
 const plan=()=>JSON.parse(String(row().pending_batch)) as PendingMulticastBatch;
 const recipients=()=>[...accepted.values()].flatMap(body=>body.recipients);
 const app=new Hono();app.route('/',broadcasts);
 return {db,sqlite,row,plan,friend,run,accepted,recipients,multicast,app};
}
describe('durable standard multicast request plans',()=>{
 it('replays the original accepted unknown batch before a new eligible prefix, without duplicate acceptance',async()=>{
  const s=setup();await s.run();const original=s.row().pending_batch;s.friend('new','1900-01-01');await s.run();
  expect(s.multicast.mock.calls[1]).toEqual(s.multicast.mock.calls[2]);expect(s.recipients()).toHaveLength(1002);expect(new Set(s.recipients()).size).toBe(1002);
  expect(s.row()).toMatchObject({status:'sent',success_count:1002,total_count:1002,pending_batch_id:null,pending_batch:null});expect(original).toEqual(expect.any(String));
  expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:1002});
 });
 it('also replays a first unknown batch at offset zero before a new prefix',async()=>{
  const s=setup(501,1);await s.run();s.friend('new','1900-01-01');await s.run();expect(s.multicast.mock.calls[0]).toEqual(s.multicast.mock.calls[1]);
  expect(s.recipients()).toHaveLength(502);expect(new Set(s.recipients()).size).toBe(502);expect(s.row()).toMatchObject({status:'sent',success_count:502,total_count:502});
 });
 it.each(['unfollow','tag removal','account change','LINE identity change','deleted friend'])('keeps the plan and stops when a planned recipient changes: %s',async mutation=>{
  const s=setup();await s.run();const before=s.row().pending_batch;const id=s.plan().recipients[0].id;
  if(mutation==='unfollow')s.sqlite.prepare('UPDATE friends SET is_following=0 WHERE id=?').run(id);
  if(mutation==='tag removal')s.sqlite.prepare('DELETE FROM friend_tags WHERE friend_id=?').run(id);
  if(mutation==='LINE identity change')s.sqlite.prepare("UPDATE friends SET line_user_id='different' WHERE id=?").run(id);
  if(mutation==='deleted friend')s.sqlite.prepare('DELETE FROM friends WHERE id=?').run(id);
  if(mutation==='account change'){s.sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('b','b','B','synthetic-b','synthetic-secret')");s.sqlite.prepare("UPDATE friends SET line_account_id='b' WHERE id=?").run(id);}
  await s.run();await s.run();expect(s.multicast).toHaveBeenCalledTimes(2);expect(s.row()).toMatchObject({status:'sending',batch_offset:500,success_count:500,pending_batch:before,last_error:PENDING_BATCH_REVIEW});
 });
 it.each(['expired','future','corrupt JSON','wrong key','wrong owner','payload changed','plan ID mismatch'])('does not send or replace an unsafe saved plan: %s',async problem=>{
  const s=setup();await s.run();const plan=s.plan();
  if(problem==='expired')plan.firstAttemptAt=Date.now()-MAX_PENDING_BATCH_AGE_MS;
  if(problem==='future')plan.firstAttemptAt=Date.now()+60000;
  if(problem==='wrong key')plan.retryKey=crypto.randomUUID();
  if(problem==='wrong owner')plan.accountId='foreign';
  if(problem==='payload changed')plan.messages=[{type:'text',text:'Different payload'}];
  if(problem==='plan ID mismatch')plan.id=crypto.randomUUID();
  const serialized=problem==='corrupt JSON'?'{invalid':JSON.stringify(plan);s.sqlite.prepare('UPDATE broadcasts SET pending_batch=?').run(serialized);
  await s.run();await s.run();expect(s.multicast).toHaveBeenCalledTimes(2);expect(s.row()).toMatchObject({batch_offset:500,pending_batch:serialized,last_error:PENDING_BATCH_REVIEW});
 });
 it('keeps the same request just inside the retry age limit',async()=>{
  const s=setup();await s.run();vi.spyOn(Date,'now').mockReturnValue(s.plan().firstAttemptAt+MAX_PENDING_BATCH_AGE_MS-1);await s.run();
  expect(s.row().status).toBe('sent');expect(s.recipients()).toHaveLength(1001);expect(s.multicast.mock.calls[1]).toEqual(s.multicast.mock.calls[2]);
 });
 it('clears a definite rejection before planning a changed eligible group',async()=>{
  const s=setup(1001,2,400);await s.run();expect(s.row().pending_batch).toBeNull();s.friend('new','1900-01-01');await s.run();
  expect(s.recipients()).toHaveLength(1002);expect(new Set(s.recipients()).size).toBe(1002);expect(s.row().status).toBe('sent');
 });
 it('retains a 409 without proof of acceptance instead of inventing a new key',async()=>{
  const s=setup(1001,2,409);await s.run();const before=s.row().pending_batch;expect(before).toEqual(expect.any(String));
  await s.run();expect(s.multicast.mock.calls[1][3]).toBe(s.multicast.mock.calls[2][3]);expect(s.row().status).toBe('sent');
 });
 it('does not start a LINE request when the plan cannot be saved',async()=>{
  const s=setup(1,999);s.sqlite.exec("CREATE TRIGGER fail_plan BEFORE UPDATE OF pending_batch ON broadcasts WHEN NEW.pending_batch IS NOT NULL BEGIN SELECT RAISE(FAIL,'synthetic plan save failure'); END;");
  await s.run();expect(s.multicast).not.toHaveBeenCalled();expect(s.row()).toMatchObject({batch_offset:0,pending_batch:null,success_count:0});
  s.sqlite.exec('DROP TRIGGER fail_plan');await s.run();expect(s.multicast).toHaveBeenCalledTimes(1);expect(s.row().status).toBe('sent');
 });
 it('keeps a replayable plan if both atomic receipt progress and its fallback fail',async()=>{
  const s=setup(501,999);s.sqlite.exec("CREATE TRIGGER fail_clear BEFORE UPDATE OF pending_batch_id ON broadcasts WHEN OLD.pending_batch_id IS NOT NULL AND NEW.pending_batch_id IS NULL BEGIN SELECT RAISE(FAIL,'synthetic progress unavailable'); END;");
  await s.run();expect(s.row()).toMatchObject({batch_offset:0,success_count:0,last_error:BROADCAST_RECORDING_ERROR});expect(s.row().pending_batch).toEqual(expect.any(String));expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:0});
  s.sqlite.exec('DROP TRIGGER fail_clear');await s.run();expect(s.row()).toMatchObject({status:'sent',success_count:501,pending_batch:null});expect(s.recipients()).toHaveLength(501);
 });
 it('consumes an accepted plan only once when a recovered old execution finishes late',async()=>{
  const s=setup();await s.run();const plan=s.plan();s.sqlite.exec('UPDATE broadcasts SET batch_offset=-1');
  expect(await completePendingMulticastBatch(s.db,plan,'Hello',1001,'2026-10-21T00:00:00',BROADCAST_RECORDING_ERROR)).toEqual({owned:true,recordingFailed:false});
  expect(await completePendingMulticastBatch(s.db,plan,'Hello',1001,'2026-10-21T00:00:00',BROADCAST_RECORDING_ERROR)).toEqual({owned:false,recordingFailed:false});
  expect(s.row().success_count).toBe(1000);expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:1000});
 });
 it('does not let an old receipt or failure clear a newer plan',async()=>{
  const s=setup();await s.run();const old=s.plan();const newer={...old,id:crypto.randomUUID()};s.sqlite.prepare('UPDATE broadcasts SET pending_batch_id=?,pending_batch=?,batch_offset=-1').run(newer.id,JSON.stringify(newer));const before=s.row();
  expect(await completePendingMulticastBatch(s.db,old,'Hello',1001,'2026-10-21T00:00:00',BROADCAST_RECORDING_ERROR)).toEqual({owned:false,recordingFailed:false});
  await releasePendingMulticastClaim(s.db,old.broadcastId,old.offset,old.acceptedBefore,old.id,JSON.stringify(old),'Old failure',true);expect(s.row()).toEqual(before);
 });
 it('recovers a stale planned lock and reuses the saved request',async()=>{
  const s=setup();await s.run();s.sqlite.exec("UPDATE broadcasts SET batch_offset=-1,batch_lock_at='2000-01-01T00:00:00'");await recoverStalledBroadcasts(s.db);expect(s.row().batch_offset).toBe(500);
  await s.run();expect(s.row().status).toBe('sent');expect(s.multicast.mock.calls[1]).toEqual(s.multicast.mock.calls[2]);expect(s.recipients()).toHaveLength(1001);
 });
 it('recovers committed receipts when only the database response was lost',async()=>{
  const s=setup(501,999);const batch=s.db.batch.bind(s.db);let lose=true;
  s.db.batch=async<T>(statements:D1PreparedStatement[])=>{const results=await batch<T>(statements);if(lose){lose=false;throw new Error('Synthetic database response lost after commit');}return results;};
  await s.run();expect(s.row()).toMatchObject({status:'sending',batch_offset:-1,success_count:500,pending_batch_id:null,pending_batch:null});
  expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:500});
  s.friend('new','1900-01-01');s.sqlite.exec("UPDATE broadcasts SET batch_lock_at='2000-01-01T00:00:00'");
  await recoverStalledBroadcasts(s.db);expect(s.row().batch_offset).toBe(500);
  await s.run();expect(s.row()).toMatchObject({status:'sent',success_count:502,total_count:502});
  expect(s.recipients()).toHaveLength(502);expect(new Set(s.recipients()).size).toBe(502);expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:502});
 });
 it('finalizes a fully committed last batch after losing its database response without another send',async()=>{
  const s=setup(500,999);const batch=s.db.batch.bind(s.db);let lose=true;
  s.db.batch=async<T>(statements:D1PreparedStatement[])=>{const results=await batch<T>(statements);if(lose){lose=false;throw new Error('Synthetic database response lost after commit');}return results;};
  await s.run();expect(s.row()).toMatchObject({status:'sending',batch_offset:-1,success_count:500,pending_batch:null});
  s.sqlite.exec("UPDATE broadcasts SET batch_lock_at='2000-01-01T00:00:00'");await recoverStalledBroadcasts(s.db);await s.run();
  expect(s.row()).toMatchObject({status:'sent',success_count:500,total_count:500});expect(s.multicast).toHaveBeenCalledTimes(1);expect(s.recipients()).toHaveLength(500);
 });
 it.each(['missing receipt','duplicate friend','test receipt','incoming receipt','partial plan','recent lock'])('does not recover cleared plans without complete durable receipt proof: %s',async problem=>{
  const s=setup(501,999);const batch=s.db.batch.bind(s.db);let lose=true;
  s.db.batch=async<T>(statements:D1PreparedStatement[])=>{const results=await batch<T>(statements);if(lose){lose=false;throw new Error('Synthetic database response lost after commit');}return results;};
  await s.run();expect(s.row()).toMatchObject({batch_offset:-1,success_count:500,pending_batch:null});
  if(problem!=='recent lock')s.sqlite.exec("UPDATE broadcasts SET batch_lock_at='2000-01-01T00:00:00'");
  if(problem==='missing receipt')s.sqlite.exec('DELETE FROM messages_log WHERE id=(SELECT id FROM messages_log LIMIT 1)');
  if(problem==='duplicate friend')s.sqlite.exec("UPDATE messages_log SET friend_id='f0001' WHERE friend_id='f0000'");
  if(problem==='test receipt')s.sqlite.exec("UPDATE messages_log SET delivery_type='test' WHERE friend_id='f0000'");
  if(problem==='incoming receipt')s.sqlite.exec("UPDATE messages_log SET direction='incoming' WHERE friend_id='f0000'");
  if(problem==='partial plan')s.sqlite.exec("UPDATE broadcasts SET pending_batch_id='incomplete-plan'");
  await recoverStalledBroadcasts(s.db);expect(s.row().batch_offset).toBe(-1);expect(s.multicast).toHaveBeenCalledTimes(1);
 });
 it('keeps the unknown plan while the monthly quota is exceeded',async()=>{
  const s=setup();await s.run();const before=s.row().pending_batch;await s.run({QUOTA_MONTHLY_MESSAGES_MAX:'1'});
  expect(s.multicast).toHaveBeenCalledTimes(2);expect(s.row()).toMatchObject({status:'sending',batch_offset:500,pending_batch:before});
 });
 it('does not turn a historical unknown request without a plan into a new request on later ticks',async()=>{
  const s=setup(1,999);s.sqlite.exec("UPDATE broadcasts SET last_error='LINEの受付結果を確認できませんでした。' ");await s.run();await s.run();await s.run();
  expect(s.multicast).not.toHaveBeenCalled();expect(s.row()).toMatchObject({status:'sending',batch_offset:0,pending_batch:null,last_error:LEGACY_UNCERTAIN_REVIEW});
 });
 it('does not expose the saved recipient/request plan through the admin API',async()=>{
  const s=setup();await s.run();const response=await s.app.request('/api/broadcasts/campaign',{}, {DB:s.db});expect(response.status).toBe(200);const json=await response.json() as {data:Record<string,unknown>};
  expect(JSON.stringify(json)).not.toContain(String(s.row().pending_batch_id));expect(json.data).not.toHaveProperty('pending_batch');expect(json.data).not.toHaveProperty('pending_batch_id');
 });
 it('keeps each receipt statement under D1 parameter limits while consuming 500 receipts atomically',async()=>{
  const s=setup(500,999);const prepare=s.db.prepare.bind(s.db);const batch=s.db.batch.bind(s.db);const parameterCounts:number[]=[];const batchSizes:number[]=[];
  function wrap(statement:D1PreparedStatement):D1PreparedStatement{return new Proxy(statement,{get(target,key){
   if(key==='bind')return(...args:unknown[])=>{parameterCounts.push(args.length);return target.bind(...args);};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});}
  s.db.prepare=sql=>sql.includes('INSERT INTO messages_log')?wrap(prepare(sql)):prepare(sql);
  s.db.batch=async statements=>{batchSizes.push(statements.length);return batch(statements);};
  await s.run();expect(s.row()).toMatchObject({status:'sent',success_count:500});expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:500});
  expect(parameterCounts.length).toBeLessThanOrEqual(13);expect(Math.max(...parameterCounts)).toBeLessThanOrEqual(100);expect(Math.max(...batchSizes)).toBeLessThanOrEqual(14);
 });
 it('does not rewrite historical unknown payloads or totals before stopping',async()=>{
  const s=setup(1,999);s.sqlite.exec("UPDATE broadcasts SET last_error='LINEの受付結果を確認できませんでした。',total_count=123,track_links=1,message_content='https://example.com/original'");
  await processQueuedBroadcasts(s.db,new LineClient('unused'),'https://worker.example');await s.run();
  expect(s.row()).toMatchObject({status:'sending',batch_offset:0,total_count:123,success_count:0,message_content:'https://example.com/original',last_error:LEGACY_UNCERTAIN_REVIEW});
  expect(s.sqlite.prepare('SELECT COUNT(*) n FROM tracked_links').get()).toEqual({n:0});expect(s.multicast).not.toHaveBeenCalled();
 });

 it.each(['personalized content','different payload','different target'])('does not reinterpret an old plan after the campaign changes: %s',async change=>{
  const s=setup();await s.run();const before=s.row().pending_batch;
  if(change==='personalized content')s.sqlite.exec("UPDATE broadcasts SET message_content='Hello {{name}}'");
  if(change==='different payload')s.sqlite.exec("UPDATE broadcasts SET message_content='Changed payload'");
  if(change==='different target')s.sqlite.exec("UPDATE broadcasts SET target_type='multi-account-dedup',account_ids='[\"a\"]'");
  await s.run();expect(s.multicast).toHaveBeenCalledTimes(2);expect(s.row()).toMatchObject({batch_offset:500,pending_batch:before,last_error:PENDING_BATCH_REVIEW});
 });

 it.each(['newer plan','newer completion'])('does not let a late finalizer overwrite %s',async newer=>{
  const s=setup(1,999);const prepare=s.db.prepare.bind(s.db);let interleave=true;let newerRow:Record<string,unknown>|undefined;
  s.db.prepare=sql=>{
   if(interleave && (sql.startsWith('UPDATE broadcasts SET line_request_id = ?') || sql.includes('INSERT INTO broadcast_insights'))){
    interleave=false;
    if(newer==='newer plan')s.sqlite.prepare("UPDATE broadcasts SET pending_batch_id=?,pending_batch=?,total_count=2").run(crypto.randomUUID(),JSON.stringify({owner:'newer execution'}));
    else s.sqlite.exec("UPDATE broadcasts SET status='sent',sent_at='2026-10-21T12:00:00+09:00',success_count=2,total_count=2,line_request_id='newer-request',aggregation_unit='newer-unit',last_error='newer outcome',batch_lock_at=NULL");
    newerRow=s.row();
   }
   return prepare(sql);
  };
  await s.run();expect(interleave).toBe(false);expect(s.row()).toEqual(newerRow);expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({n:0});
  expect(s.multicast).toHaveBeenCalledTimes(1);
 });
 it('rolls back insight creation when terminal status cannot be saved, then resumes without another send',async()=>{
  const s=setup(1,999);s.sqlite.exec("CREATE TRIGGER fail_finish BEFORE UPDATE OF status ON broadcasts WHEN NEW.status='sent' BEGIN SELECT RAISE(FAIL,'Synthetic finalization failure'); END;");
  await s.run();expect(s.row()).toMatchObject({status:'sending',batch_offset:-1,success_count:1,pending_batch:null});expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({n:0});
  s.sqlite.exec("DROP TRIGGER fail_finish; UPDATE broadcasts SET batch_lock_at='2000-01-01T00:00:00'");await recoverStalledBroadcasts(s.db);await s.run();
  expect(s.row()).toMatchObject({status:'sent',success_count:1,last_error:null,line_request_id:null,aggregation_unit:'bcast_campaign'});expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({n:1});expect(s.multicast).toHaveBeenCalledTimes(1);
 });
 it('preserves an existing insight while atomically completing a standard multicast',async()=>{
  const s=setup(1,999);s.sqlite.exec("INSERT INTO broadcast_insights(id,broadcast_id,status) VALUES('existing','campaign','pending')");await s.run();
  expect(s.row()).toMatchObject({status:'sent',success_count:1,last_error:null,line_request_id:null,aggregation_unit:'bcast_campaign'});expect(s.sqlite.prepare('SELECT id FROM broadcast_insights').all()).toEqual([{id:'existing'}]);
 });
 it.each(['newer claim','newer plan','newer completion'])('does not report an old recipient query failure over a %s',async newer=>{
  const s=setup(1,999);const prepare=s.db.prepare.bind(s.db);let failed=false;let before:Record<string,unknown>|undefined;
  function wrap(statement:D1PreparedStatement):D1PreparedStatement{return new Proxy(statement,{get(target,key){
   if(key==='bind')return(...args:unknown[])=>wrap(target.bind(...args));
   if(key==='all')return async()=>{if(!failed){failed=true;
    if(newer==='newer completion')s.sqlite.exec("UPDATE broadcasts SET status='sent',sent_at='2026-10-21T12:00:00+09:00',last_error='newer outcome',aggregation_unit='newer-unit'");
    else{s.sqlite.exec("UPDATE broadcasts SET batch_lock_at='2099-01-01T00:00:00',last_error='newer failure'");if(newer==='newer plan')s.sqlite.prepare('UPDATE broadcasts SET pending_batch_id=?,pending_batch=?').run(crypto.randomUUID(),JSON.stringify({owner:'newer execution'}));}
    before=s.row();throw new Error('Synthetic delayed recipient query failure');}return target.all();};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});}
  s.db.prepare=sql=>sql.includes('FROM friends f')?wrap(prepare(sql)):prepare(sql);
  await s.run();expect(failed).toBe(true);expect(s.row()).toEqual(before);expect(s.multicast).not.toHaveBeenCalled();
 });
 it('keeps committed final state when only the final transaction response is lost',async()=>{
  const s=setup(1,999);const batch=s.db.batch.bind(s.db);let calls=0;
  s.db.batch=async<T>(statements:D1PreparedStatement[])=>{const results=await batch<T>(statements);calls++;if(calls===2)throw new Error('Synthetic lost finalization response after commit');return results;};
  await s.run();expect(calls).toBe(2);expect(s.row()).toMatchObject({status:'sent',success_count:1,total_count:1,pending_batch:null,last_error:null,aggregation_unit:'bcast_campaign'});expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:1});expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({n:1});expect(s.multicast).toHaveBeenCalledTimes(1);
 });
 it('still records a current unexpected recipient query failure',async()=>{
  const s=setup(1,999);const prepare=s.db.prepare.bind(s.db);let failed=false;
  function wrap(statement:D1PreparedStatement):D1PreparedStatement{return new Proxy(statement,{get(target,key){
   if(key==='bind')return(...args:unknown[])=>wrap(target.bind(...args));if(key==='all')return async()=>{failed=true;throw new Error('Synthetic owned recipient query failure');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});}
  s.db.prepare=sql=>sql.includes('FROM friends f')?wrap(prepare(sql)):prepare(sql);await s.run();expect(failed).toBe(true);expect(s.row()).toMatchObject({status:'sending',batch_offset:-1,success_count:0});expect(String(s.row().last_error)).toContain('配信処理を継続できませんでした');expect(s.multicast).not.toHaveBeenCalled();
 });
 it('keeps a newly acquired planned lock until the existing recovery age',async()=>{
  const s=setup(1,999);const multicast=s.multicast.getMockImplementation()!;let release!:()=>void;let entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});
  s.multicast.mockImplementation(async(...args)=>{entered();await gate;return multicast(...args);});const running=s.run();await started;
  try{await recoverStalledBroadcasts(s.db);expect(s.row().batch_offset).toBe(-1);const age=s.sqlite.prepare("SELECT abs(julianday('now','+9 hours')-julianday(batch_lock_at))*86400 seconds FROM broadcasts").get() as {seconds:number};expect(age.seconds).toBeLessThan(5);}finally{release();await running;}
  expect(s.row().status).toBe('sent');expect(s.multicast).toHaveBeenCalledTimes(1);
 });
 it('still shows a queued configuration error after releasing its own unchanged claim',async()=>{
  const s=setup(1,999);s.sqlite.exec("UPDATE broadcasts SET message_content='Hello {{unknown}}'");await s.run();expect(s.row()).toMatchObject({status:'sending',batch_offset:0,success_count:0,pending_batch:null});expect(String(s.row().last_error)).toContain('配信処理を継続できませんでした');expect(s.multicast).not.toHaveBeenCalled();
 });
 it('does not let a stale draft edit erase a newly started pending plan',async()=>{
  const s=setup(1,999);s.sqlite.exec("UPDATE broadcasts SET status='draft'");const prepare=s.db.prepare.bind(s.db);const newer=crypto.randomUUID();const serialized=JSON.stringify({owner:'newer execution'});let interleave=true;
  s.db.prepare=sql=>{if(interleave && sql.startsWith('UPDATE broadcasts SET title = ?')){interleave=false;s.sqlite.prepare("UPDATE broadcasts SET status='sending',pending_batch_id=?,pending_batch=?").run(newer,serialized);}return prepare(sql);};
  const response=await s.app.request('/api/broadcasts/campaign',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Stale edit'})},{DB:s.db});
  expect(response.status).toBe(409);expect(s.row()).toMatchObject({title:'Campaign',status:'sending',pending_batch_id:newer,pending_batch:serialized});expect(s.multicast).not.toHaveBeenCalled();
 });
 it('clears old draft resume state atomically on a permitted edit',async()=>{
  const s=setup(1,999);s.sqlite.prepare("UPDATE broadcasts SET status='draft',success_count=7,pending_batch_id=?,pending_batch='{}'").run(crypto.randomUUID());
  const response=await s.app.request('/api/broadcasts/campaign',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Edited draft'})},{DB:s.db});
  expect(response.status).toBe(200);expect(s.row()).toMatchObject({title:'Edited draft',status:'draft',success_count:0,pending_batch_id:null,pending_batch:null});
 });

});
