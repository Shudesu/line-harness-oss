import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { authMiddleware, publicStaffProfile } from '../middleware/auth.js';
import { adminAuth } from './admin-auth.js';
import { staff } from './staff.js';
import { createAuthTestDb } from '../test-support/auth-db.js';
import { hashApiKey } from '@line-crm/db';

const stores: ReturnType<typeof createAuthTestDb>[]=[];
afterEach(()=>{stores.splice(0).forEach(s=>s.close());vi.restoreAllMocks();});
function setup(overrides: Partial<Env['Bindings']> = {}) {
  const store=createAuthTestDb();stores.push(store);
  const bindings={DB:store.db,API_KEY:'owner-key',WORKER_URL:'https://worker.example.test',ADMIN_ORIGIN:'https://admin.example.test',...overrides} as Env['Bindings'];
  const app=new Hono<Env>();app.use('*',authMiddleware);app.route('/',adminAuth);app.route('/',staff);
  app.get('/api/test-read',c=>c.json({data:publicStaffProfile(c.get('staff'))}));
  const req=(path:string,init:RequestInit={},env=bindings)=>app.request('https://worker.example.test'+path,init,env);
  async function login(key='staff-key') {
    const response=await req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:key})});
    expect(response.status).toBe(200);
    const body=await response.clone().json() as {csrfToken:string};
    const cookie=(response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().map(c=>c.split(';')[0]).join('; ');
    const token=/lh_admin_session=([^;]+)/.exec(cookie)![1];
    expect(token).toMatch(/^lhs_[A-Za-z0-9_-]{43}$/);
    expect(cookie).not.toContain(key);expect(await response.text()).not.toContain(key);
    return {cookie,token,csrf:body.csrfToken};
  }
  const owner={Authorization:'Bearer owner-key','Content-Type':'application/json'};
  return {store,bindings,req,login,owner};
}

describe('opaque session HTTP lifecycle',()=>{
  it('stores no bearer credential in the cookie or session table and never accepts the session as Bearer',async()=>{
    const s=setup();const session=await s.login();
    const rows=s.store.sql.prepare('SELECT * FROM admin_sessions').all();
    expect(JSON.stringify(rows)).not.toContain(session.token);expect(JSON.stringify(rows)).not.toContain('staff-key');
    expect((await s.req('/api/test-read',{headers:{Cookie:session.cookie}})).status).toBe(200);
    expect((await s.req('/api/test-read',{headers:{Authorization:'Bearer '+session.token}})).status).toBe(401);
    expect((await s.req('/api/test-read',{headers:{Authorization:'Bearer staff-key'}})).status).toBe(200);
    const profile=await (await s.req('/api/auth/session',{headers:{Cookie:session.cookie}})).json() as any;
    expect(profile.data.authMethod).toBe('api_key');expect(profile.data.sessionId).toBeUndefined();
  });
  it('revokes logout and logout-all without revoking the API key',async()=>{
    const s=setup();const first=await s.login();const second=await s.login();
    expect((await s.req('/api/auth/logout',{method:'POST',headers:{Cookie:first.cookie}})).status).toBe(200);
    expect((await s.req('/api/test-read',{headers:{Cookie:first.cookie}})).status).toBe(401);
    expect((await s.req('/api/test-read',{headers:{Cookie:second.cookie}})).status).toBe(200);
    expect((await s.req('/api/auth/logout-all',{method:'POST',headers:{Cookie:second.cookie}})).status).toBe(403);
    expect((await s.req('/api/auth/logout-all',{method:'POST',headers:{Cookie:second.cookie,'X-CSRF-Token':second.csrf}})).status).toBe(200);
    expect((await s.req('/api/test-read',{headers:{Cookie:second.cookie}})).status).toBe(401);
    expect((await s.req('/api/test-read',{headers:{Authorization:'Bearer staff-key'}})).status).toBe(200);
  });
  it.each(['rotate','disable','delete','role','scope'])('invalidates existing sessions on staff %s',async action=>{
    const s=setup();const session=await s.login();
    let response:Response;
    if(action==='rotate')response=await s.req('/api/staff/staff-1/regenerate-key',{method:'POST',headers:s.owner});
    else if(action==='delete')response=await s.req('/api/staff/staff-1',{method:'DELETE',headers:s.owner});
    else response=await s.req('/api/staff/staff-1',{method:'PATCH',headers:s.owner,body:JSON.stringify(action==='disable'?{isActive:false}:action==='role'?{role:'staff'}:{role:'staff',apiScopes:['messages:read']})});
    expect(response.status).toBe(200);
    expect((await s.req('/api/test-read',{headers:{Cookie:session.cookie}})).status).toBe(401);
  });
  it('checks current key fingerprint even if the explicit cleanup hook did not run',async()=>{
    const s=setup();const session=await s.login();
    s.store.sql.prepare('UPDATE staff_members SET api_key_hash=? WHERE id=?').run(await hashApiKey('replacement'),'staff-1');
    expect((await s.req('/api/test-read',{headers:{Cookie:session.cookie}})).status).toBe(401);
  });
  it('enforces env-owner rotation and preserves an explicit legacy-key grace slot',async()=>{
    const s=setup();const session=await s.login('owner-key');
    const rotated={...s.bindings,API_KEY:'replacement'};
    expect((await s.req('/api/test-read',{headers:{Cookie:session.cookie}},rotated)).status).toBe(401);
    expect((await s.req('/api/test-read',{headers:{Cookie:session.cookie}},{...rotated,LEGACY_API_KEY:'owner-key'})).status).toBe(200);
  });
  it('upgrades a valid legacy cookie transparently and supports rejecting the old format',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>{});
    const s=setup();const old='lh_admin_session=staff-key';
    const response=await s.req('/api/test-read',{headers:{Cookie:old}});
    expect(response.status).toBe(200);expect(response.headers.get('Set-Cookie')).toContain('lh_admin_session=lhs_');
    expect((await s.req('/api/test-read',{headers:{Cookie:old}},{...s.bindings,ADMIN_LEGACY_SESSION_COOKIE:'reject'})).status).toBe(401);
    expect((await s.req('/api/test-read',{headers:{Authorization:'Bearer staff-key'}},{...s.bindings,ADMIN_LEGACY_SESSION_COOKIE:'reject'})).status).toBe(200);
  });
  it('fails closed for expired/cross-database sessions',async()=>{
    const a=setup(),b=setup();const session=await a.login();
    expect((await b.req('/api/test-read',{headers:{Cookie:session.cookie}})).status).toBe(401);
    a.store.sql.prepare('UPDATE admin_sessions SET expires_at=0').run();
    expect((await a.req('/api/test-read',{headers:{Cookie:session.cookie}})).status).toBe(401);
  });
  it('keeps verified legacy cookies during schema rollout but never issues a raw-key cookie',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>{});
    const s=setup();s.store.sql.exec('DROP TABLE admin_sessions');
    const legacy=await s.req('/api/test-read',{headers:{Cookie:'lh_admin_session=staff-key'}});
    expect(legacy.status).toBe(200);expect(legacy.headers.get('Set-Cookie')).toBeNull();
    const login=await s.req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:'staff-key'})});
    expect(login.status).toBe(503);expect(login.headers.get('Set-Cookie')).toBeNull();
    expect((await s.req('/api/test-read',{headers:{Cookie:'lh_admin_session=lhs_'+'a'.repeat(43)}})).status).toBe(503);
  });
  it('clears browser cookies and reports failed server revocation when storage is unavailable',async()=>{
    const s=setup();const session=await s.login();s.store.sql.exec('DROP TABLE admin_sessions');
    const response=await s.req('/api/auth/logout',{method:'POST',headers:{Cookie:session.cookie}});
    expect(response.status).toBe(503);expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
  it('rejects old sessions after a late plaintext-only rotation by an older Worker',async()=>{
    const s=setup();const session=await s.login();
    s.store.sql.prepare('UPDATE staff_members SET api_key=? WHERE id=?').run('lh_rotated_by_old_worker','staff-1');
    expect((await s.req('/api/test-read',{headers:{Cookie:session.cookie}})).status).toBe(401);
    expect((await s.req('/api/test-read',{headers:{Authorization:'Bearer lh_rotated_by_old_worker'}})).status).toBe(200);
  });

});
