import {it,expect,afterEach} from 'vitest';
import {createAuthTestDb} from '../test-support/auth-db.js';
import {createAuthorizedRouter} from './authorized-router.js';
import {authMiddleware} from './auth.js';
import {adminAuth} from '../routes/admin-auth.js';
import {createStaffMember,getStaffByApiKey,regenerateStaffApiKey} from '@line-crm/db';
import type {Env} from '../index.js';
const opened:ReturnType<typeof createAuthTestDb>[]=[];afterEach(()=>opened.splice(0).forEach(x=>x.close()));
it('stages dual-read before irreversible erasure and preserves active credentials when reverting to compat',async()=>{
 const s=createAuthTestDb();opened.push(s);const env={DB:s.db,API_KEY:'root',SECURITY_MIGRATION_STAGE:'compat'};
 const app=createAuthorizedRouter<Env>();app.use('*',authMiddleware);app.route('/',adminAuth);
 const login=()=>app.request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:'staff-key'})},env);
 const compat=await login();expect(compat.status).toBe(200);expect(compat.headers.get('Set-Cookie')).toContain('lh_admin_session=staff-key');
 expect(s.sql.prepare("SELECT api_key FROM staff_members WHERE id='staff-1'").get()).toEqual({api_key:'staff-key'});
 env.SECURITY_MIGRATION_STAGE='active';const active=await login();expect(active.status).toBe(200);const cookie=active.headers.get('Set-Cookie')!.match(/lh_admin_session=([^;]+)/)![1];expect(cookie).toMatch(/^lhs_/);
 expect(s.sql.prepare("SELECT api_key FROM staff_members WHERE id='staff-1'").get()).toEqual({api_key:'hashed:staff-1'});
 env.SECURITY_MIGRATION_STAGE='compat';expect((await app.request('/api/auth/session',{headers:{Cookie:'lh_admin_session='+cookie}},env)).status).toBe(200);
 expect((await app.request('/api/auth/session',{headers:{Authorization:'Bearer staff-key'}},env)).status).toBe(200);
});
it('keeps newly issued and rotated keys readable by the prior runtime only during compat',async()=>{
 const s=createAuthTestDb();opened.push(s);const issued=await createStaffMember(s.db,{name:'Compat',role:'staff'},{erasePlaintext:false});
 expect(issued.member.api_key).toBe(issued.apiKey);const rotated=await regenerateStaffApiKey(s.db,issued.member.id,{erasePlaintext:false});
 expect((await getStaffByApiKey(s.db,rotated,{erasePlaintext:false}))?.api_key).toBe(rotated);
 expect((await getStaffByApiKey(s.db,rotated))?.api_key).toBe('hashed:'+issued.member.id);
 expect(await getStaffByApiKey(s.db,issued.apiKey)).toBeNull();
});
