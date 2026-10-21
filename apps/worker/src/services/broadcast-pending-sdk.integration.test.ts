import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { LineClient } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { processQueuedBroadcasts } from './broadcast.js';
vi.mock('./stealth.js',async importOriginal=>({...await importOriginal<typeof import('./stealth.js')>(),sleep:async()=>{},calculateStaggerDelay:()=>0}));
afterEach(()=>vi.restoreAllMocks());
it('uses the actual SDK to reconcile a lost-response batch before a new eligible prefix, without duplicate provider acceptance',async()=>{
 const {db,sqlite}=sqliteD1();
 db.batch=async<T>(statements:D1PreparedStatement[])=>{sqlite.exec('BEGIN');try{const rows=[];for(const statement of statements)rows.push(await statement.run<T>());sqlite.exec('COMMIT');return rows;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
 const accepted=new Map<string,{raw:string;recipients:string[]}>();let calls=0;let alreadyAccepted=0;const unexpected:string[]=[];
 // Every fetch terminates locally. There is no forwarding path to real LINE.
 const http=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  const headers=new Headers(init?.headers);expect(headers.get('authorization')).toBe('Bearer synthetic-token');expect(headers.has('x-line-harness-source')).toBe(false);
  if(String(url)==='https://api.line.me/v2/bot/message/quota')return Response.json({type:'none'});
  if(String(url)==='https://api.line.me/v2/bot/message/quota/consumption')return Response.json({totalUsage:0});
  if(String(url)!=='https://api.line.me/v2/bot/message/multicast'){unexpected.push(String(url));throw new Error('Unexpected local fixture request');}
  calls++;const key=headers.get('x-line-retry-key');expect(key).toEqual(expect.any(String));const raw=String(init?.body);const body=JSON.parse(raw);
  const stored=sqlite.prepare("SELECT pending_batch FROM broadcasts WHERE id='campaign'").get() as {pending_batch:string};const plan=JSON.parse(stored.pending_batch);
  expect(plan.retryKey).toBe(key);expect(plan.messages).toEqual(body.messages);expect(plan.recipients.map((friend:{line_user_id:string})=>friend.line_user_id)).toEqual(body.to);
  if(accepted.has(key!)){expect(raw).toBe(accepted.get(key!)!.raw);alreadyAccepted++;return new Response('accepted',{status:409,headers:{'x-line-accepted-request-id':'local-original'}});}
  accepted.set(key!,{raw,recipients:body.to});if(calls===2)throw new Error('Local lost response after acceptance');return Response.json({},{headers:{'x-line-request-id':'local-receipt'}});
 });
 try {
  sqlite.exec(readFileSync(new URL('../../../../packages/db/bootstrap.sql',import.meta.url),'utf8'));
  sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','A','synthetic-token','synthetic-secret'); INSERT INTO tags(id,name) VALUES('tag','Tag')");
  function friend(id:string,created:string){sqlite.prepare("INSERT INTO friends(id,line_user_id,line_account_id,created_at) VALUES(?,?,'a',?)").run(id,`line-${id}`,created);sqlite.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,'tag')").run(id);}
  for(let i=0;i<1001;i++)friend(`f${String(i).padStart(4,'0')}`,new Date(Date.UTC(2026,0,1,0,0,i)).toISOString());
  sqlite.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,line_account_id,status,segment_conditions,track_links)
   VALUES('campaign','Campaign','text','Hello','tag','tag','a','sending',?,0)`).run(JSON.stringify({operator:'AND',rules:[{type:'tag_exists',value:'tag'}]}));
  const run=()=>processQueuedBroadcasts(db,new LineClient('must-not-be-used'));
  const state=()=>sqlite.prepare("SELECT status,success_count,total_count,pending_batch_id,pending_batch FROM broadcasts WHERE id='campaign'").get();
  await run();expect(state()).toMatchObject({status:'sending',success_count:500,total_count:1001});
  friend('new','1900-01-01');await run();
  const recipients=[...accepted.values()].flatMap(item=>item.recipients);
  expect(calls).toBe(4);expect(alreadyAccepted).toBe(1);expect(http).toHaveBeenCalledTimes(6);expect(unexpected).toEqual([]);
  expect(recipients).toHaveLength(1002);expect(new Set(recipients).size).toBe(1002);
  expect(state()).toEqual({status:'sent',success_count:1002,total_count:1002,pending_batch_id:null,pending_batch:null});
  expect(sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:1002});
 }finally{sqlite.close();}
});
