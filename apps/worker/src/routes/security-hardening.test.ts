import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { authDb, seedAuthStaff, TEST_SESSION } from '../test-support/auth-db.js';
import { authMiddleware } from '../middleware/auth.js';
import { adminAuth } from './admin-auth.js';
import { staff } from './staff.js';
import { images } from './images.js';
import { lineProxy } from './line-proxy.js';
import adminUpdate from './admin-update.js';
import { hashApiKey, consumeAuthRateLimit } from '@line-crm/db';
import type { Env } from '../index.js';

let store: ReturnType<typeof authDb>;
let env: Env['Bindings'];
function app() {
  const a = new Hono<Env>();
  a.use('*', authMiddleware);
  a.route('/', lineProxy); a.route('/', adminAuth); a.route('/', staff); a.route('/', images);
  a.route('/admin/update', adminUpdate);
  a.get('/api/friends', c => c.json({success:true}));
  a.post('/api/chats/:id/send', c => c.json({success:true}));
  for (const path of ['/webhook','/t/test','/r/test','/auth/callback','/api/liff/test','/api/forms/test/submit']) a.all(path,c=>c.text('public'));
  a.get('/api/forms/:id',c=>c.json({staff:c.get('staff')??null}));
  return a;
}
const headers = {Cookie:`lh_admin_session=${TEST_SESSION}; lh_csrf=test-csrf`, 'X-CSRF-Token':'test-csrf'};
async function login(key = 'owner-key') {
  return app().request('/api/auth/login',{method:'POST',body:JSON.stringify({apiKey:key}),headers:{'Content-Type':'application/json'}},env);
}
beforeEach(() => {
  store=authDb();
  seedAuthStaff(store.sqlite,{id:'owner-1',name:'Owner',role:'owner',key:'owner-key'});
  env={ DB:store.db,API_KEY:'synthetic-env-key',IMAGES:{get:vi.fn(async()=>({body:'image',httpMetadata:{contentType:'image/png'}}))} } as unknown as Env['Bindings'];
});
afterEach(()=>{store.sqlite.close();vi.restoreAllMocks();});

describe('security integration with real SQLite/D1 statements',()=>{
  it('never accepts the former raw API-key cookie',async()=>{
    expect((await app().request('/api/friends',{headers:{Cookie:'lh_admin_session=owner-key'}},env)).status).toBe(401);
  });
  it('issues opaque sessions, revokes on logout, and never stores secrets in audit/session rows',async()=>{
    const r=await login();expect(r.status).toBe(200);
    const cookie=(r.headers as Headers & {getSetCookie(): string[]}).getSetCookie().find(x=>x.startsWith('lh_admin_session='))!.split(';')[0];
    expect(cookie).toMatch(/^lh_admin_session=lhs_/);expect(cookie).not.toContain('owner-key');
    expect((await app().request('/api/friends',{headers:{Cookie:cookie}},env)).status).toBe(200);
    expect((await app().request('/api/auth/logout',{method:'POST',headers:{Cookie:cookie}},env)).status).toBe(200);
    expect((await app().request('/api/friends',{headers:{Cookie:cookie}},env)).status).toBe(401);
    const dump=JSON.stringify(store.sqlite.prepare('SELECT * FROM admin_sessions').all())+JSON.stringify(store.sqlite.prepare('SELECT * FROM auth_audit_log').all());
    expect(dump).not.toContain('owner-key');expect(dump).not.toContain(cookie.split('=')[1]);
    expect(store.sqlite.prepare('SELECT action,actor_id FROM auth_audit_log').all()).toEqual([{action:'login',actor_id:'owner-1'},{action:'logout',actor_id:'owner-1'}]);
  });
  it.each(['is_active=0',"role='staff'","api_scopes='[]'","api_key_hash='changed'"] )('invalidates sessions when %s',async(change)=>{
    store.sqlite.exec('UPDATE staff_members SET '+change);
    expect((await app().request('/api/friends',{headers},env)).status).toBe(401);
  });
  it('blocks expired sessions and honors CSRF for cookie mutations',async()=>{
    expect((await app().request('/api/auth/sessions/revoke',{method:'POST',headers:{Cookie:headers.Cookie}},env)).status).toBe(403);
    expect((await app().request('/api/auth/sessions/revoke',{method:'POST',headers},env)).status).toBe(200);
    expect((await app().request('/api/friends',{headers},env)).status).toBe(401);
  });
  it('hashes existing keys in bounded migration while official API callers retain their original credentials',async()=>{
    store.sqlite.prepare('INSERT INTO staff_members (id,name,role,api_key) VALUES (?,?,?,?)').run('legacy','Integration','admin','lh_existing-client-secret');
    const migration=await app().request('/api/auth/migrate-keys',{method:'POST',headers},env);
    expect(await migration.json()).toMatchObject({data:{migrated:1}});
    const r=await app().request('/api/friends',{headers:{Authorization:'Bearer lh_existing-client-secret'}},env);expect(r.status).toBe(200);
    expect(store.sqlite.prepare('SELECT api_key FROM staff_members WHERE id=?').get('legacy')).toEqual({api_key:'hashed:legacy'});
    expect((await app().request('/api/friends',{headers:{Authorization:'Bearer hashed:legacy'}},env)).status).toBe(401);
    expect((await app().request('/api/friends',{headers:{Authorization:'Bearer '+await hashApiKey('lh_existing-client-secret')}},env)).status).toBe(401);
  });
  it('keeps official-account proxy callers working after hashing and rejects restricted proxy keys',async()=>{
    store.sqlite.exec(`CREATE TABLE line_accounts (id TEXT, name TEXT, channel_id TEXT, channel_access_token TEXT,
      channel_secret TEXT, is_active INTEGER, display_order INTEGER, created_at TEXT);
      INSERT INTO line_accounts VALUES ('account-1','Synthetic','123','synthetic-channel-token','synthetic-channel-secret',1,0,'');`);
    const upstream=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response('{"displayName":"Synthetic"}'));
    const request=(key:string)=>app().request('/line-api/v2/bot/info',{headers:{Authorization:'Bearer '+key}},env);
    expect((await request('owner-key')).status).toBe(200);
    expect(upstream).toHaveBeenLastCalledWith('https://api.line.me/v2/bot/info',expect.objectContaining({headers:{Authorization:'Bearer synthetic-channel-token'}}));
    expect((await request('synthetic-channel-token')).status).toBe(200);
    store.sqlite.exec(`UPDATE staff_members SET api_scopes='["messages:send"]'`);
    expect((await request('owner-key')).status).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it('enforces scopes even on an owner key; scoped keys cannot create sessions or manage keys',async()=>{
    store.sqlite.exec(`UPDATE staff_members SET api_scopes='["messages:read"]'`);
    const h={Authorization:'Bearer owner-key'};
    expect((await app().request('/api/friends',{headers:h},env)).status).toBe(200);
    for (const url of ['/api/staff','/api/auth/session']) expect((await app().request(url,{headers:h},env)).status).toBe(403);
    expect((await app().request('/api/chats/1/send',{method:'POST',headers:h},env)).status).toBe(403);
    expect((await login()).status).toBe(403);
    store.sqlite.exec(`UPDATE staff_members SET api_scopes='["messages:send"]'`);
    expect((await app().request('/api/chats/1/send',{method:'POST',headers:h},env)).status).toBe(200);
    expect((await app().request('/api/friends',{headers:h},env)).status).toBe(403);
    store.sqlite.exec(`UPDATE staff_members SET api_scopes='invalid-json'`);
    expect((await app().request('/api/friends',{headers:h},env)).status).toBe(403);
  });
  it('protects old, new and encoded incoming image URLs while public images remain reachable',async()=>{
    for(const path of ['/images/incoming-test.png','/images/%69ncoming-test.png','/api/incoming-images/incoming-test.png']) {
      const denied=await app().request(path,{},env);expect([401,404]).toContain(denied.status);expect(denied.headers.get('Cache-Control')).toContain('no-store');
      const r=await app().request(path,{headers},env);expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toContain('no-store');
    }
    expect((await app().request('/images/public.png',{},env)).status).toBe(200);
  });
  it('shares login limits across independent routers and rejects with Retry-After',async()=>{
    for(let i=0;i<10;i++) expect((await login('wrong')).status).toBe(401);
    const r=await login();expect(r.status).toBe(429);expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(store.sqlite.prepare('SELECT count(*) AS n FROM auth_audit_log').get()).toEqual({n:10});
    expect(JSON.stringify(store.sqlite.prepare('SELECT * FROM auth_rate_limits').all())).not.toContain('wrong');
  });
  it('limits failed credentials across routers while valid keys bypass saturated IP buckets',async()=>{
    const now=Math.floor(Date.now()/1000);
    await consumeAuthRateLimit(store.db,'key:ip','unknown',1000,60,now);
    store.sqlite.exec('UPDATE auth_rate_limits SET attempts=1000');
    expect((await app().request('/api/friends',{headers:{Authorization:'Bearer owner-key'}},env)).status).toBe(200);
    expect((await app().request('/api/friends',{headers:{Authorization:'Bearer rotated-attempt'}},env)).status).toBe(429);
  });
  it('fails closed if shared auth storage is unavailable',async()=>{
    store.sqlite.exec('DROP TABLE auth_rate_limits');expect((await login()).status).toBe(503);
    expect((await app().request('/api/friends',{headers:{Authorization:'Bearer owner-key'}},env)).status).toBe(200);
    expect((await app().request('/api/friends',{headers:{Authorization:'Bearer wrong'}},env)).status).toBe(503);
  });
  it('requires cookie owner sessions for updates and rejects the old public admin key',async()=>{
    for(const h of [{ 'x-admin-api-key':'synthetic-env-key' },{Authorization:'Bearer owner-key'}] as Record<string,string>[]) {
      expect([401,403]).toContain((await app().request('/admin/update/history',{headers:h},env)).status);
    }
    expect((await app().request('/admin/update/start',{method:'POST',headers:{Cookie:headers.Cookie}},env)).status).toBe(403);
    store.sqlite.exec("UPDATE staff_members SET role='admin'; UPDATE admin_sessions SET role_at_issue='admin'");
    expect((await app().request('/admin/update/history',{headers},env)).status).toBe(403);
  });
  it('Access is opt-in, fails closed on invalid config and never gates public paths',async()=>{
    expect((await app().request('/api/friends',{headers},env)).status).toBe(200);
    env.ACCESS_REQUIRED='true';
    expect((await app().request('/api/friends',{headers},env)).status).toBe(403);
    for(const path of ['/webhook','/t/test','/r/test','/auth/callback','/api/liff/test','/api/forms/test/submit','/images/public.png']) expect((await app().request(path,{method:path.endsWith('/submit')?'POST':'GET'},env)).status,path).toBe(200);
    expect(await (await app().request('/api/forms/test',{headers},env)).json()).toEqual({staff:null});
  });
  it('audits mutations without recording submitted keys or staff names',async()=>{
    const r=await app().request('/api/staff',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic Staff',role:'staff',apiScopes:['messages:read']})},env);
    expect(r.status).toBe(201);const body=await r.json() as {data:{apiKey:string}};
    expect(body.data.apiKey).toMatch(/^lh_/);
    const rows=JSON.stringify(store.sqlite.prepare('SELECT * FROM auth_audit_log').all());
    expect(rows).toContain('staff_change');expect(rows).not.toContain(body.data.apiKey);expect(rows).not.toContain('Synthetic Staff');
  });
});


describe('failure-only key/session limiter', () => {
  function proxySetup() {
    store.sqlite.exec(`CREATE TABLE line_accounts (id TEXT, name TEXT, channel_id TEXT, channel_access_token TEXT,
      channel_secret TEXT, is_active INTEGER, display_order INTEGER, created_at TEXT);
      INSERT INTO line_accounts VALUES ('account-1','Synthetic','123','synthetic-channel-token','synthetic-channel-secret',1,0,'');`);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  }
  const cases = [
    ['/api/friends', 'bearer'], ['/api/friends', 'session'],
    ['/api/forms/test', 'bearer'], ['/line-api/v2/bot/info', 'bearer'],
    ['/line-api/v2/bot/info', 'channel'],
  ] as const;
  it.each(cases)('%s (%s): 1,001 successes issue zero limiter SQL', async (path, kind) => {
    proxySetup();
    const prepare = vi.spyOn(store.db, 'prepare');
    const a = app();
    const h: Record<string,string> = kind === 'session' ? headers : {Authorization:'Bearer '+(kind === 'channel' ? 'synthetic-channel-token' : 'owner-key')};
    for (let i=0; i<1001; i++) expect((await a.request(path, {headers:h}, env)).status).toBe(200);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('auth_rate_limits'))).toHaveLength(0);
  });
  it.each(cases.filter(([,kind]) => kind !== 'channel'))('%s (%s): repeated failures reach 429; successes still pass', async (path, kind) => {
    proxySetup();
    vi.spyOn(Date, 'now').mockReturnValue(1800000000000);
    // Keep the seeded synthetic session alive at the fixed clock.
    store.sqlite.exec('UPDATE admin_sessions SET expires_at=1800604800');
    const a = app();
    const h: Record<string,string> = kind === 'session' ? {Cookie:'lh_admin_session=invalid-test-session'} : {Authorization:'Bearer invalid-test-key'};
    for(let i=0; i<1000; i++) expect((await a.request(path,{headers:h},env)).status).toBe(path.includes('/forms/') ? 200 : 401);
    const rejected = await a.request(path,{headers:h},env);
    expect(rejected.status).toBe(429);
    expect(Number(rejected.headers.get('Retry-After'))).toBeGreaterThan(0);
    const before = store.sqlite.prepare('SELECT * FROM auth_rate_limits ORDER BY bucket_hash').all();
    expect((await a.request(path,{headers:kind === 'session' ? headers : {Authorization:'Bearer owner-key'}},env)).status).toBe(200);
    expect(store.sqlite.prepare('SELECT * FROM auth_rate_limits ORDER BY bucket_hash').all()).toEqual(before);
  });
});
