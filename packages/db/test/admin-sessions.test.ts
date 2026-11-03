import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { createAdminSession, getAdminSession, revokeAdminSession, revokeAdminSessionsForStaff, purgeExpiredAdminSessions, adminSessionTtl } from '../src/admin-sessions';
import { hashApiKey } from '../src/staff';
const opened: Database.Database[]=[];
afterEach(()=>opened.splice(0).forEach(s=>s.close()));
function setup(){
 const sql=new Database(':memory:');opened.push(sql);sql.exec(readFileSync(new URL('../migrations/011_staff_members.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../migrations/074_security_hardening.sql',import.meta.url),'utf8'));
 const queries:string[]=[];
 const db={prepare(query:string){
  queries.push(query);let values:unknown[]=[];
  return {bind(...args:unknown[]){values=args;return this;},async first(){return sql.prepare(query).get(...values)??null;},async run(){return {meta:{changes:sql.prepare(query).run(...values).changes}};}};
 }} as unknown as D1Database;
 const issue=(staffId='staff-1',now=1000,ttlSeconds=1000)=>createAdminSession(db,{staffId,role:'staff',credentialFp:'a'.repeat(64),authMethod:'api_key',now,ttlSeconds});
 return {sql,db,queries,issue};
}
describe('admin session store',()=>{
 it('persists only a digest, enforces expiry and bounds TTL',async()=>{
  const s=setup();const issued=await s.issue();
  expect(issued.token).toMatch(/^lhs_[A-Za-z0-9_-]{43}$/);
  const stored=s.sql.prepare('SELECT * FROM admin_sessions').get() as {id_hash:string};
  expect(stored.id_hash).toBe(await hashApiKey(issued.token));expect(JSON.stringify(stored)).not.toContain(issued.token);
  expect(await getAdminSession(s.db,issued.token,1999)).not.toBeNull();
  expect(await getAdminSession(s.db,issued.token,2000)).toBeNull();
  expect(adminSessionTtl(1e12)).toBe(2592000);expect(adminSessionTtl(undefined)).toBe(604800);
 });
 it('updates last_seen at most once per five-minute window',async()=>{
  const s=setup();const issued=await s.issue('staff-1',0,1000);s.queries.length=0;
  await getAdminSession(s.db,issued.token,299);await getAdminSession(s.db,issued.token,300);await getAdminSession(s.db,issued.token,301);
  expect(s.queries.filter(q=>q.startsWith('UPDATE'))).toHaveLength(1);
  expect(s.sql.prepare('SELECT last_seen_at FROM admin_sessions').get()).toEqual({last_seen_at:300});
 });
 it('revokes one token or all tokens for one staff identity',async()=>{
  const s=setup();const a=await s.issue();const b=await s.issue();const other=await s.issue('staff-2');
  await revokeAdminSession(s.db,a.token,1001);expect(await getAdminSession(s.db,a.token,1001)).toBeNull();
  expect(await revokeAdminSessionsForStaff(s.db,'staff-1',1002)).toBe(1);
  expect(await getAdminSession(s.db,b.token,1002)).toBeNull();expect(await getAdminSession(s.db,other.token,1002)).not.toBeNull();
 });
 it('rejects malformed IDs without touching D1 and purges only bounded expired rows',async()=>{
  const s=setup();expect(await getAdminSession(s.db,'not-a-token',1000)).toBeNull();expect(s.queries).toHaveLength(0);
  for(let i=0;i<5;i++)await s.issue('staff-1',0,1);
  const active=await s.issue();expect(await purgeExpiredAdminSessions(s.db,1000,2)).toBe(2);
  expect(await purgeExpiredAdminSessions(s.db,1000,2)).toBe(2);expect(await purgeExpiredAdminSessions(s.db,1000,2)).toBe(1);
  expect(await getAdminSession(s.db,active.token,1001)).not.toBeNull();
 });
 it.each([100,10_000,100_000])('uses indexed lookups with %i unrelated sessions',async count=>{
  const s=setup();const issued=await s.issue();
  const insert=s.sql.prepare("INSERT INTO admin_sessions(id_hash,staff_id,credential_fp,role_at_issue,auth_method,created_at,last_seen_at,expires_at) VALUES(?,?,'fp','staff','api_key',0,0,999999)");
  s.sql.transaction(()=>{for(let i=0;i<count;i++)insert.run('unrelated-'+i,'other');})();
  s.queries.length=0;expect(await getAdminSession(s.db,issued.token,1001)).not.toBeNull();expect(s.queries).toHaveLength(1);
  const lookup=s.sql.prepare('EXPLAIN QUERY PLAN '+s.queries[0]).all(await hashApiKey(issued.token),1001) as {detail:string}[];
  expect(lookup.some(r=>/SEARCH admin_sessions USING INDEX sqlite_autoindex_admin_sessions_1/.test(r.detail))).toBe(true);
  s.queries.length=0;expect(await purgeExpiredAdminSessions(s.db,1001,2)).toBe(0);
  const purge=s.sql.prepare('EXPLAIN QUERY PLAN '+s.queries[0]).all(1001,2) as {detail:string}[];
  expect(purge.some(r=>r.detail.includes('idx_admin_sessions_expires'))).toBe(true);
  expect(purge.some(r=>/SCAN admin_sessions/.test(r.detail))).toBe(false);
 });
});
