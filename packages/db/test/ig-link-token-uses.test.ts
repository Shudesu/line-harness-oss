import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claimIgLinkToken, purgeIgLinkTokenUses } from '../src/ig-link-token-uses.js';

const opened: Database.Database[]=[];
afterEach(()=>opened.splice(0).forEach(s=>s.close()));
const schema=readFileSync(new URL('../migrations/075_ig_link_token_uses.sql',import.meta.url),'utf8');
function setup() {
  const sql=new Database(':memory:');opened.push(sql);sql.exec(schema);
  const queries:{sql:string;params:unknown[]}[]=[];
  const db={prepare(query:string){let params:unknown[]=[];return {
    bind(...values:unknown[]){params=values;return this;},
    async first(){queries.push({sql:query,params});return sql.prepare(query).get(...params)??null;},
    async run(){queries.push({sql:query,params});return {meta:{changes:sql.prepare(query).run(...params).changes}};},
  };}} as unknown as D1Database;
  return {sql,db,queries};
}
describe('IG nonce ownership and cleanup',()=>{
  it('reserves atomically, permits only the same friend, and rejects expired input',async()=>{
    const s=setup();
    const claims=await Promise.all(['friend-1','friend-2'].map(f=>claimIgLinkToken(s.db,'synthetic-nonce',f,200,100)));
    expect(claims).toEqual([true,false]);
    expect(await claimIgLinkToken(s.db,'synthetic-nonce','friend-1',200,101)).toBe(true);
    expect(await claimIgLinkToken(s.db,'expired','friend-1',100,100)).toBe(false);
    expect(s.sql.prepare('SELECT count(*) n FROM ig_link_token_uses').get()).toEqual({n:1});
  });
  it('migration can be reapplied and cleanup retains unexpired ownership',async()=>{
    const s=setup();s.sql.exec(schema);
    await claimIgLinkToken(s.db,'old','friend-1',200,100);
    await claimIgLinkToken(s.db,'current','friend-1',400,100);
    await purgeIgLinkTokenUses(s.db,200);
    expect(s.sql.prepare('SELECT nonce FROM ig_link_token_uses').all()).toEqual([{nonce:'current'}]);
  });
  it.each([100,10000,100000])('bounds SQL and rows at %i records; uses expiry and nonce indexes',async count=>{
    const s=setup();
    s.sql.transaction(()=>{
      const insert=s.sql.prepare('INSERT INTO ig_link_token_uses VALUES (?,?,?,?)');
      for(let i=0;i<count;i++) insert.run('nonce-'+i,'synthetic-friend',0,50);
    })();
    expect(await claimIgLinkToken(s.db,'target','friend-1',1000,100)).toBe(true);
    expect(s.queries).toHaveLength(1);
    expect(await claimIgLinkToken(s.db,'target','friend-2',1000,100)).toBe(false);
    expect(s.queries).toHaveLength(3);
    await purgeIgLinkTokenUses(s.db,100);
    expect(s.queries).toHaveLength(4);
    expect(s.sql.prepare('SELECT count(*) n FROM ig_link_token_uses').get()).toEqual({n:Math.max(0,count-1000)+1});
    const cleanup=s.queries[3]!;
    const plan=s.sql.prepare('EXPLAIN QUERY PLAN '+cleanup.sql).all(...cleanup.params) as {detail:string}[];
    expect(plan.some(r=>r.detail.includes('idx_ig_link_token_uses_expires'))).toBe(true);
    expect(plan.some(r=>/TEMP B-TREE|SCAN ig_link_token_uses/.test(r.detail))).toBe(false);
  });
  it('measures actual helper SQL at 1x/100x/1000x with a missing-index negative control',async()=>{
    const s=setup();
    await claimIgLinkToken(s.db,'target','friend-1',2000,1000);
    await claimIgLinkToken(s.db,'target','friend-2',2000,1000);
    await purgeIgLinkTokenUses(s.db,1000);
    const result=spawnSync('python3',[fileURLToPath(new URL('./helpers/ig-link-cost-probe.py',import.meta.url))],{
      input:JSON.stringify({schema,queries:s.queries}),encoding:'utf8',timeout:30000,
    });
    expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);
    const report=JSON.parse(result.stdout);
    expect(report.unit).toBe('sqlite_vm_instructions_not_d1_rows');
    expect(report.scales.map((r:{scale:number})=>r.scale)).toEqual([1,100,1000]);
    console.info('ig-link-cost-report',JSON.stringify(report));
  });
});
