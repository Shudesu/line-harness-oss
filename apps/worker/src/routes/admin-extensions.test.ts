import { Hono } from 'hono';
import { expect, test } from 'vitest';
import type { Env } from '../index.js';
import { adminExtensions } from './admin-extensions.js';

function app(role?: 'owner'|'admin'|'staff') {
  const instance = new Hono<Env>();
  if(role) instance.use('*', async(c,next) => { c.set('staff',{id:'synthetic-staff',name:'Test',role}); await next(); });
  instance.route('/',adminExtensions);
  return instance;
}
const config=JSON.stringify([
  {id:'reports',label:'Reports',url:'https://extensions.example/reports/'},
  {id:'restricted',label:'Restricted',url:'https://extensions.example/private/',minRole:'admin'},
  {id:'api-host',label:'API',url:'https://api.example/embedded/'},
  {id:'admin-host',label:'Admin',url:'https://admin.example/embedded/'},
]);
test('does not disclose configuration without an authenticated principal',async()=>{
  const res=await app().request('https://api.example/api/admin/extensions',{}, {ADMIN_EXTENSIONS:config});
  expect(res.status).toBe(401);
});
test('server filters role and both host origins; response is not cacheable',async()=>{
  for(const [role,count] of [['staff',1],['admin',2],['owner',2]] as const){
    const res=await app(role).request('https://api.example/api/admin/extensions',{}, {ADMIN_EXTENSIONS:config,ADMIN_ORIGIN:'https://admin.example'});
    expect(res.status).toBe(200);expect(res.headers.get('cache-control')).toBe('no-store');
    const body=await res.json() as {extensions: Array<{id:string}>};
    expect(body.extensions).toHaveLength(count);
    expect(body.extensions.map(e=>e.id)).not.toContain('api-host');
    expect(body.extensions.map(e=>e.id)).not.toContain('admin-host');
  }
});
test('unset configuration returns an empty list, no DB or provider required',async()=>{
  const res=await app('owner').request('https://api.example/api/admin/extensions',{}, {});
  expect(await res.json()).toEqual({extensions:[]});
});
