import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { createAuthorizedRouter } from './authorized-router.js';
import { authMiddleware } from './auth.js';
import { adminAuth } from '../routes/admin-auth.js';
import { staff } from '../routes/staff.js';
import { createAuthTestDb } from '../test-support/auth-db.js';
import type { Env } from '../index.js';
const stores:ReturnType<typeof createAuthTestDb>[]=[];
afterEach(()=>stores.splice(0).forEach(s=>s.close()));
function setup(policy:'legacy'|'strict'){
 const s=createAuthTestDb();stores.push(s);
 s.sql.prepare("UPDATE staff_members SET role='staff' WHERE id='staff-1'").run();
 s.sql.prepare("INSERT INTO staff_members(id,name,role,api_key,api_scopes) VALUES('admin','Admin','admin','admin-key',NULL),('machine','Limited','staff','limited-key','[\"messages:read\"]')").run();
 const app=createAuthorizedRouter<Env>();app.use('*',authMiddleware);app.route('/',adminAuth);app.route('/',staff);
 const touched:string[]=[];
 // Register the new static path before the old parameterized path.
 app.get('/api/friends/credentials',c=>{touched.push('credentials');return c.json({secret:'synthetic-secret'});});
 for(const [method,path] of [['GET','/api/friends/:id'],['GET','/api/templates'],['GET','/api/line-accounts'],['GET','/api/webhooks/outgoing'],['POST','/api/friends/:id/messages'],['POST','/api/friends/:id/tags'],['PUT','/api/friends/:id/metadata'],['POST','/api/broadcasts'],['POST','/api/automations'],['PUT','/api/ad-platforms/:id'],['POST','/api/future-admin-action']] as const){
  app.on(method,path,c=>{touched.push(path);return c.json({ok:true});});
 }
 app.get('/api/forms/:id',c=>c.json({privileged:!!c.get('staff')}));
 const env={DB:s.db,API_KEY:'owner-key',STAFF_ROLE_POLICY:policy,WORKER_URL:'https://worker.example.test'} as Env['Bindings'];
 const req=(method:string,path:string,token:string,cookie=false)=>app.request('https://worker.example.test'+path,{method,headers:cookie?{Cookie:`lh_admin_session=${token}; lh_csrf=csrf`,'X-CSRF-Token':'csrf'}:{Authorization:'Bearer '+token}},env);
 return {...s,app,env,req,touched};
}
describe('staff role policy',()=>{
 const restricted=[['GET','/api/webhooks/outgoing'],['POST','/api/broadcasts'],['POST','/api/automations'],['PUT','/api/ad-platforms/x'],['POST','/api/future-admin-action']] as const;
 it.each([false,true])('strict staff denies administrative operations (cookie=%s)',async cookie=>{
  const s=setup('strict');
  for(const [method,path] of restricted)expect((await s.req(method,path,'staff-key',cookie)).status).toBe(403);
  expect(s.touched).toEqual([]);
 });
 it.each(['owner-key','admin-key'])('keeps administrator behavior for %s',async key=>{
  const s=setup('strict');for(const [method,path] of restricted)expect((await s.req(method,path,key)).status).toBe(200);
 });
 it('keeps ordinary CRM operations and existing owner-only guards',async()=>{
  const s=setup('strict');
  for(const [method,path] of [['GET','/api/friends/x'],['GET','/api/templates'],['GET','/api/line-accounts'],['POST','/api/friends/x/messages'],['POST','/api/friends/x/tags'],['PUT','/api/friends/x/metadata']])expect((await s.req(method,path,'staff-key')).status).toBe(200);
  expect((await s.req('GET','/api/staff','admin-key')).status).toBe(403);
  expect((await s.req('GET','/api/staff','owner-key')).status).toBe(200);
  expect(await (await s.req('GET','/api/forms/form','staff-key')).json()).toEqual({privileged:false});
 });
 it('preserves legacy callers without weakening existing owner-only controls',async()=>{
  const s=setup('legacy');for(const [method,path] of restricted)expect((await s.req(method,path,'staff-key')).status).toBe(200);
  expect((await s.req('GET','/api/staff','staff-key')).status).toBe(403);
 });
 it('does not let new static routes inherit a parameterized read permission',async()=>{
  const s=setup('strict');
  expect((await s.req('GET','/api/friends/credentials','staff-key')).status).toBe(403);
  expect((await s.req('GET','/api/friends/credentials','limited-key')).status).toBe(403);
  expect(s.touched).toEqual([]);
  expect((await s.req('GET','/api/friends/real-id','limited-key')).status).toBe(200);
 });
 it('preserves basePath and actual registered route identity',async()=>{
  const s=setup('strict');const nested=createAuthorizedRouter<Env>().basePath('/api');
  nested.get('/chats/:id',c=>c.json({ok:true}));s.app.route('/',nested);
  expect((await s.req('GET','/api/chats/x','staff-key')).status).toBe(200);
 });
 it('requires authorization-aware registration in production route modules',()=>{
  const dir=new NodeURL('../routes/',import.meta.url);
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.ts')&&!f.includes('.test.'))){
   expect(readFileSync(new NodeURL(file,dir),'utf8'),file).not.toMatch(/\bnew\s+Hono[<(]/);
  }
 });
});
