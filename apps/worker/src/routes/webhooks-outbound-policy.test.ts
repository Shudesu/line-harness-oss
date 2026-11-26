import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { webhooks } from './webhooks.js';
import { createAuthTestDb } from '../test-support/auth-db.js';
const stores:ReturnType<typeof createAuthTestDb>[]=[];
afterEach(()=>{stores.splice(0).forEach(s=>s.close());vi.restoreAllMocks();});
function setup(policy:'warn'|'enforce'|'off'){
 const store=createAuthTestDb();stores.push(store);const app=new Hono<Env>();app.route('/',webhooks);
 const env={DB:store.db,OUTBOUND_URL_POLICY:policy,WORKER_URL:'https://worker.example.test'} as Env['Bindings'];
 const req=(path:string,body:unknown,method='POST')=>app.request('https://worker.example.test'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},env);
 return {store,req};
}
describe('ordinary outgoing webhook policy',()=>{
 it('refuses internal destinations before persistence when enforced',async()=>{
  const s=setup('enforce');const res=await s.req('/api/webhooks/outgoing',{name:'Test',url:'https://127.0.0.1',secret:'s'.repeat(32)});
  expect(res.status).toBe(400);expect(s.store.sql.prepare('SELECT COUNT(*) AS n FROM outgoing_webhooks').get()).toEqual({n:0});
 });
 it.each(['warn','off'] as const)('does not weaken the existing HTTPS requirement in %s',async policy=>{
  const res=await setup(policy).req('/api/webhooks/outgoing',{name:'Test',url:'http://example.com',secret:'s'.repeat(32)});
  expect(res.status).toBe(400);
 });
 it('warns on legacy-compatible HTTPS destinations and checks them again on activation',async()=>{
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  const s=setup('warn');const created=await s.req('/api/webhooks/outgoing',{name:'Test',url:'https://127.0.0.1',secret:'s'.repeat(32)});
  expect(created.status).toBe(201);const payload=await created.json() as {data:{id:string};warnings:string[]};expect(payload.warnings).toEqual(['non_public_address']);
  const app=new Hono<Env>();app.route('/',webhooks);
  const res=await app.request('/api/webhooks/outgoing/'+payload.data.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({isActive:true})},{DB:s.store.db,OUTBOUND_URL_POLICY:'enforce'} as Env['Bindings']);
  expect(res.status).toBe(400);
 });
});
