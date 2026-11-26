import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { consumeAuthRateLimit, writeAuthAudit, purgeAuthSecurityData } from '../src/auth-security';

const opened: Database.Database[]=[];
afterEach(()=>opened.splice(0).forEach(s=>s.close()));
function setup() {
  const sql=new Database(':memory:');opened.push(sql);
  sql.exec(readFileSync(new URL('../migrations/011_staff_members.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../migrations/074_security_hardening.sql',import.meta.url),'utf8'));
  const queries:{sql:string;params:unknown[]}[]=[];
  const db={prepare(query:string){let params:unknown[]=[];return {
    bind(...values:unknown[]){params=values;return this;},
    async first(){queries.push({sql:query,params});return sql.prepare(query).get(...params)??null;},
    async run(){queries.push({sql:query,params});return {meta:{changes:sql.prepare(query).run(...params).changes}};},
  };},async batch(statements:{run():Promise<unknown>}[]){return Promise.all(statements.map(s=>s.run()));}} as unknown as D1Database;
  return {sql,db,queries};
}
describe('D1 shared auth security storage',()=>{
  it('serializes concurrent requests through an atomic fixed-window UPSERT and recovers at expiry',async()=>{
    const s=setup();
    const attempts=await Promise.all(Array.from({length:30},()=>consumeAuthRateLimit(s.db,'login','192.0.2.1',10,300,301)));
    expect(attempts.filter(x=>x.allowed)).toHaveLength(10);
    expect(s.sql.prepare('SELECT attempts FROM auth_rate_limits').get()).toEqual({attempts:10});
    expect((await consumeAuthRateLimit(s.db,'login','192.0.2.1',10,300,599)).retryAfter).toBe(1);
    expect((await consumeAuthRateLimit(s.db,'login','192.0.2.1',10,300,600)).allowed).toBe(true);
    expect((await consumeAuthRateLimit(s.db,'key','192.0.2.1',10,300,301)).allowed).toBe(true);
    expect((await consumeAuthRateLimit(s.db,'login','192.0.2.2',10,300,301)).allowed).toBe(true);
  });
  it('persists only digest bucket identities and fixed audit fields',async()=>{
    const s=setup();await consumeAuthRateLimit(s.db,'key','lh_synthetic-secret',10,60,1000);
    const row=s.sql.prepare('SELECT * FROM auth_rate_limits').get() as {bucket_hash:string};
    expect(row.bucket_hash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(row)).not.toContain('lh_synthetic-secret');
    await writeAuthAudit(s.db,{actorId:'staff-1',action:'login',ip:'192.0.2.1',outcome:'success'},1000);
    expect(s.sql.prepare('SELECT actor_id,action,occurred_at,ip,outcome FROM auth_audit_log').get()).toEqual({actor_id:'staff-1',action:'login',occurred_at:1000,ip:'192.0.2.1',outcome:'success'});
  });
  it.each([100,10000,100000])('bounds expiry cleanup with %i unrelated records and verifies index use',async(count)=>{
    const s=setup();
    s.sql.transaction(()=>{
      const rate=s.sql.prepare('INSERT INTO auth_rate_limits VALUES (?,?,?,?)');
      const audit=s.sql.prepare('INSERT INTO auth_audit_log VALUES (?,?,?,?,?,?)');
      for(let i=0;i<count;i++){rate.run('bucket-'+i,0,1,0);audit.run('event-'+i,'synthetic','login',0,'192.0.2.1','denied');}
    })();
    await consumeAuthRateLimit(s.db,'key','synthetic-secret',10,60,10000000);
    expect(s.queries).toHaveLength(1);
    await purgeAuthSecurityData(s.db,10000000);
    expect(s.queries).toHaveLength(3);
    expect(s.sql.prepare('SELECT count(*) n FROM auth_rate_limits').get()).toEqual({n:count-100+1});
    expect(s.sql.prepare('SELECT count(*) n FROM auth_audit_log').get()).toEqual({n:count-100});
    for(const query of s.queries.slice(1)) {
      const plan=s.sql.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.params) as {detail:string}[];
      expect(plan.some(p=>/idx_auth_/.test(p.detail))).toBe(true);
      expect(plan.some(p=>/TEMP B-TREE/.test(p.detail))).toBe(false);
    }
  });
});
