import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { LineClient, LineApiError } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { processQueuedBroadcasts } from './broadcast.js';
vi.mock('./stealth.js',async importOriginal=>({...await importOriginal<typeof import('./stealth.js')>(),sleep:async()=>{},calculateStaggerDelay:()=>0}));
const schema=readFileSync(new URL('../../../../packages/db/bootstrap.sql',import.meta.url),'utf8');
const closes:Array<()=>void>=[];
afterEach(()=>{expect(globalThis.fetch).not.toHaveBeenCalled();closes.splice(0).forEach(close=>close());vi.restoreAllMocks();});
function setup(marker:string, uncertain=false) {
 const {db,sqlite}=sqliteD1();sqlite.exec(schema);closes.push(()=>sqlite.close());
 db.batch=async<T>(statements:D1PreparedStatement[])=>{sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run<T>());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
 vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Real network forbidden'));
 vi.spyOn(LineClient.prototype,'getMessageQuota').mockResolvedValue({type:'none'});
 vi.spyOn(LineClient.prototype,'getMessageQuotaConsumption').mockResolvedValue({totalUsage:0});
 const accepted:string[]=[];let call=0;const receiptKeys=new Set<string>();
 const multicast=vi.spyOn(LineClient.prototype,'multicast').mockImplementation(async (recipients,_message,_units,key)=>{
  call++;if(key && receiptKeys.has(key))return {data:{},requestId:'already-accepted'};
  if(call===2 && !uncertain)throw new LineApiError(400,'Bad Request','Synthetic rejected batch');
  accepted.push(...recipients);if(key)receiptKeys.add(key);
  if(call===2)throw new Error('Local lost response after acceptance');
  return {data:{},requestId:'synthetic'};
 });
 sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','A','synthetic-token','synthetic-secret'); INSERT INTO tags(id,name) VALUES('tag','Tag')");
 function friend(id:string,created:string){sqlite.prepare("INSERT INTO friends(id,line_user_id,display_name,line_account_id,created_at) VALUES(?,?,?,'a',?)").run(id,`line-${id}`,id,created);sqlite.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,'tag')").run(id);}
 for(let i=0;i<1001;i++)friend(`f${String(i).padStart(4,'0')}`,new Date(Date.UTC(2026,0,1,0,0,i)).toISOString());
 sqlite.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,line_account_id,status,segment_conditions,track_links)
 VALUES('campaign','Campaign','text','Hello','tag','tag','a','sending',?,0)`).run(marker);
 const run=()=>processQueuedBroadcasts(db,new LineClient('unused'));
 const state=()=>sqlite.prepare("SELECT status,batch_offset,total_count,success_count FROM broadcasts WHERE id='campaign'").get() as Record<string,unknown>;
 return {db,sqlite,friend,run,state,accepted,multicast};
}
const segment=JSON.stringify({operator:'AND',rules:[{type:'tag_exists',value:'tag'}]});
describe.each([['segment',segment],['legacy tag','']])('multicast %s continuation audience audit',(_lane,marker)=>{
 it.each(['unfollow','tag removal'])('does not skip an unsent recipient after a logged member changes: %s',async mutation=>{
  const s=setup(marker);await s.run();expect(s.state()).toMatchObject({status:'sending',batch_offset:500,success_count:500});
  const first=s.accepted[0];
  if(mutation==='unfollow')s.sqlite.prepare('UPDATE friends SET is_following=0 WHERE line_user_id=?').run(first);
  else s.sqlite.prepare('DELETE FROM friend_tags WHERE friend_id=(SELECT id FROM friends WHERE line_user_id=?)').run(first);
  await s.run();expect(s.state().status).toBe('sent');expect(s.accepted).toHaveLength(1001);expect(new Set(s.accepted).size).toBe(1001);
  expect(s.multicast.mock.calls[1][3]).toBe(s.multicast.mock.calls[2][3]);
 });
 it('does not duplicate logged recipients or omit a newly eligible prefix member',async()=>{
  const s=setup(marker);await s.run();s.friend('new',marker?'1900-01-01':'2099-01-01');await s.run();
  expect(s.accepted).toHaveLength(1002);expect(new Set(s.accepted).size).toBe(1002);expect(s.accepted).toContain('line-new');expect(s.state()).toMatchObject({success_count:1002,total_count:1002});
 });
 it('keeps the same failed-batch retry key when membership is unchanged',async()=>{
  const s=setup(marker);await s.run();await s.run();expect(s.accepted).toHaveLength(1001);expect(s.multicast.mock.calls[1][3]).toBe(s.multicast.mock.calls[2][3]);
 });
 it('does not resend an accepted batch whose log write failed',async()=>{
  const s=setup(marker);s.sqlite.exec("CREATE TRIGGER fail_log BEFORE INSERT ON messages_log BEGIN SELECT RAISE(FAIL,'synthetic log unavailable'); END;");
  await s.run();expect(s.state()).toMatchObject({batch_offset:500,success_count:500});s.sqlite.exec('DROP TRIGGER fail_log');await s.run();
  expect(s.accepted).toHaveLength(1001);expect(new Set(s.accepted).size).toBe(1001);expect(s.state().success_count).toBe(1001);
 });
 it('keeps the uncertain batch retry identity when only a previously logged member leaves',async()=>{
  const s=setup(marker,true);await s.run();s.sqlite.prepare('UPDATE friends SET is_following=0 WHERE line_user_id=?').run(s.accepted[0]);await s.run();
  expect(s.multicast.mock.calls[1][3]).toBe(s.multicast.mock.calls[2][3]);expect(s.accepted).toHaveLength(1001);expect(new Set(s.accepted).size).toBe(1001);
 });
 it.each(['missing receipt','duplicate receipt','counter mismatch'])('keeps positional resume when receipt evidence is incomplete: %s',async problem=>{
  const s=setup(marker);await s.run();
  if(problem==='missing receipt')s.sqlite.exec("DELETE FROM messages_log WHERE id=(SELECT id FROM messages_log LIMIT 1)");
  if(problem==='duplicate receipt')s.sqlite.exec("INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id) SELECT 'duplicate',friend_id,'outgoing','text','Synthetic','campaign' FROM messages_log LIMIT 1");
  if(problem==='counter mismatch')s.sqlite.exec("UPDATE broadcasts SET success_count=499");
  await s.run();expect(s.accepted).toHaveLength(1001);expect(new Set(s.accepted).size).toBe(1001);
  expect(s.multicast.mock.calls[1][3]).toBe(s.multicast.mock.calls[2][3]);
 });
 it('rejects a stale success counter even if the persisted offset is unchanged',async()=>{
  const s=setup(marker);await s.run();const prepare=s.db.prepare.bind(s.db);let mutate=true;
  function wrap(statement:D1PreparedStatement):D1PreparedStatement{return new Proxy(statement,{get(target,key){
   if(key==='bind')return(...args:unknown[])=>wrap(target.bind(...args));
   if(key==='run')return async()=>{if(mutate){mutate=false;s.sqlite.exec("UPDATE broadcasts SET success_count=501");}return target.run();};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});}
  s.db.prepare=sql=>sql.startsWith('UPDATE broadcasts SET batch_offset = -1')?wrap(prepare(sql)):prepare(sql);
  await s.run();expect(s.multicast).toHaveBeenCalledTimes(2);expect(s.state()).toMatchObject({status:'sending',batch_offset:500,success_count:501});
 });

});
