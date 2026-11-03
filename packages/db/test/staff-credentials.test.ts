import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { createStaffMember, getStaffByApiKey, getStaffMembers, regenerateStaffApiKey, backfillStaffApiKeyHashes, hashApiKey } from '../src/staff';
const opened: Database.Database[] = [];
afterEach(() => { opened.splice(0).forEach(x => x.close()); vi.restoreAllMocks(); });
function setup(legacy = false) {
  const sql = new Database(':memory:'); opened.push(sql);
  sql.exec(readFileSync(new URL('../migrations/011_staff_members.sql', import.meta.url), 'utf8'));
  if (!legacy) sql.exec(readFileSync(new URL('../migrations/074_security_hardening.sql', import.meta.url), 'utf8'));
  const queries: string[] = [];
  let intercept: (query: string) => void = () => {};
  const db = { prepare(query: string) {
    queries.push(query);
    // Match D1's lazy preparation errors at execution, not prepare().
    let values: unknown[] = [];
    return {
      bind(...args: unknown[]) { values = args; return this; },
      async first() { intercept(query); return sql.prepare(query).get(...values) ?? null; },
      async all() { return { results: sql.prepare(query).all(...values) }; },
      async run() { return { meta: { changes: sql.prepare(query).run(...values).changes } }; },
    };
  } } as unknown as D1Database;
  function add(id: string, key: string, active = 1) {
    sql.prepare('INSERT INTO staff_members (id,name,role,api_key,is_active) VALUES (?, ?, ?, ?, ?)').run(id,id,'staff',key,active);
  }
  return { sql, db, queries, add, intercept: (fn: typeof intercept) => { intercept=fn; } };
}

describe('hashed staff credentials', () => {
  it('returns new plaintext only once while storing a digest and display suffix', async () => {
    const s=setup();
    const created=await createStaffMember(s.db,{ name:'Test',role:'staff',apiScopes:['messages:read'] });
    expect(created.apiKey).toMatch(/^lh_[0-9a-f]{32}$/);
    expect(created.member.api_key).toBe(`hashed:${created.member.id}`);
    expect(created.member.api_key_hash).toBe(await hashApiKey(created.apiKey));
    expect(created.member.api_key_last4).toBe(created.apiKey.slice(-4));
    expect(JSON.stringify(await getStaffMembers(s.db))).not.toContain(created.apiKey);
    expect((await getStaffByApiKey(s.db,created.apiKey))?.id).toBe(created.member.id);
    const rotated=await regenerateStaffApiKey(s.db,created.member.id);
    expect(await getStaffByApiKey(s.db,created.apiKey)).toBeNull();
    expect((await getStaffByApiKey(s.db,rotated))?.api_scopes).toBe('["messages:read"]');
    expect(JSON.stringify(s.sql.prepare('SELECT * FROM staff_members').all())).not.toContain(rotated);
  });
  it('migrates an existing credential without changing the accepted key', async () => {
    const s=setup();s.add('old','lh_legacy-secret');
    const row=await getStaffByApiKey(s.db,'lh_legacy-secret');
    expect(row?.api_key).toBe('hashed:old');
    expect(row?.api_key_hash).toBe(await hashApiKey('lh_legacy-secret'));
    expect(row?.api_key_created_at).toBeNull(); // legacy creation time is unknown
    expect(await getStaffByApiKey(s.db,'hashed:old')).toBeNull();
    s.sql.prepare('UPDATE staff_members SET is_active=0').run();
    expect(await getStaffByApiKey(s.db,'lh_legacy-secret')).toBeNull();
  });
  it('fails closed on missing migration and database outages', async () => {
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    const s=setup(true);s.add('old','lh_legacy-secret');
    await expect(getStaffByApiKey(s.db,'lh_legacy-secret')).rejects.toThrow();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('lh_legacy-secret');
    const broken=setup();broken.intercept(()=>{ throw new Error('Database offline'); });
    await expect(getStaffByApiKey(broken.db,'lh_valid')).rejects.toThrow('offline');
    expect(broken.queries).toHaveLength(1);
  });
  it('does not overwrite or accept a concurrently rotated/revoked legacy key', async () => {
    for (const revoked of [false,true]) {
      const s=setup();s.add('old','lh_legacy-secret');
      const newHash=await hashApiKey('lh_replacement');
      s.intercept(query=>{
        if (query.startsWith('UPDATE')) {
          s.intercept(()=>{});
          s.sql.prepare('UPDATE staff_members SET api_key=?, api_key_hash=?, is_active=? WHERE id=?').run('hashed:old',newHash,revoked?0:1,'old');
        }
      });
      expect(await getStaffByApiKey(s.db,'lh_legacy-secret')).toBeNull();
      expect(s.sql.prepare('SELECT api_key_hash FROM staff_members').get()).toEqual({api_key_hash:newHash});
    }
  });
  it('fails closed when the migration write fails', async () => {
    vi.spyOn(console,'warn').mockImplementation(()=>{});
    const s=setup();s.add('old','lh_legacy-secret');
    s.intercept(q=>{if(q.startsWith('UPDATE'))throw new Error('write unavailable');});
    await expect(getStaffByApiKey(s.db,'lh_legacy-secret')).rejects.toThrow();
  });
  it('bounds maintenance and leaves no plaintext after repeated batches', async () => {
    const s=setup();for(let i=0;i<5;i++)s.add(`id-${i}`,`lh_key-${i}`,i%2);
    expect(await backfillStaffApiKeyHashes(s.db,{limit:2})).toBe(2);
    expect(await backfillStaffApiKeyHashes(s.db,{limit:2})).toBe(2);
    expect(await backfillStaffApiKeyHashes(s.db,{limit:2})).toBe(1);
    s.queries.length=0;
    expect(await backfillStaffApiKeyHashes(s.db,{limit:2})).toBe(0);
    expect(s.queries).toHaveLength(1);
    const rows=s.sql.prepare('SELECT api_key,api_key_hash FROM staff_members').all() as {api_key:string;api_key_hash:string}[];
    expect(rows.every(r=>r.api_key.startsWith('hashed:')&&r.api_key_hash.length===64)).toBe(true);
    const plan=s.sql.prepare('EXPLAIN QUERY PLAN '+s.queries[0]).all(2) as {detail:string}[];
    expect(plan.some(r=>r.detail.includes('idx_staff_members_plaintext'))).toBe(true);
  });
  it('caps even oversized backfill requests below the Free invocation query limit', async () => {
    const s=setup();for(let i=0;i<30;i++)s.add(`id-${i}`,`lh_key-${i}`);
    expect(await backfillStaffApiKeyHashes(s.db,{limit:1000})).toBe(25);
    expect(s.queries).toHaveLength(26);
  });
  it.each([100, 10_000, 100_000])('bounds backfill even with %i pending keys', async count => {
    const s=setup();
    s.sql.transaction(()=>{for(let i=0;i<count;i++)s.add(`id-${String(i).padStart(7,'0')}`,`lh_secret-${i}`);})();
    expect(await backfillStaffApiKeyHashes(s.db,{limit:3})).toBe(3);
    expect(s.queries).toHaveLength(4); // one bounded read + three CAS writes
    const plan=s.sql.prepare('EXPLAIN QUERY PLAN '+s.queries[0]).all(3) as {detail:string}[];
    expect(plan.some(r=>r.detail.includes('idx_staff_members_plaintext'))).toBe(true);
    expect(plan.some(r=>/TEMP B-TREE/.test(r.detail))).toBe(false);
    s.sql.exec('DROP INDEX idx_staff_members_plaintext');
    await expect(backfillStaffApiKeyHashes(s.db,{limit:3})).rejects.toThrow('idx_staff_members_plaintext');
  });

  it('reconciles a late legacy-worker key rotation without accepting the stale digest', async () => {
    const s=setup();s.add('old','lh_before');
    expect((await getStaffByApiKey(s.db,'lh_before'))?.id).toBe('old');
    s.sql.prepare('UPDATE staff_members SET api_key=? WHERE id=?').run('lh_after','old');
    expect(await getStaffByApiKey(s.db,'lh_before')).toBeNull();
    expect((await getStaffByApiKey(s.db,'lh_after'))?.id).toBe('old');
    expect(s.sql.prepare('SELECT api_key,api_key_hash FROM staff_members').get()).toEqual({api_key:'hashed:old',api_key_hash:await hashApiKey('lh_after')});
  });

  it('does not accept a stale digest when a legacy writer wins the migration race', async () => {
    const s=setup();s.add('old','lh_before');
    s.sql.prepare('UPDATE staff_members SET api_key_hash=? WHERE id=?').run(await hashApiKey('lh_before'),'old');
    s.intercept(query=>{if(query.startsWith('UPDATE')){s.intercept(()=>{});s.sql.prepare('UPDATE staff_members SET api_key=? WHERE id=?').run('lh_after','old');}});
    expect(await getStaffByApiKey(s.db,'lh_before')).toBeNull();
    expect(await backfillStaffApiKeyHashes(s.db,{limit:1})).toBe(1);
    expect((await getStaffByApiKey(s.db,'lh_after'))?.id).toBe('old');
  });

});
