import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import type { MockInstance } from 'vitest';
import { Hono } from 'hono';
import { issueIgLinkToken } from '@line-crm/shared';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { igLinkVectors } from '../test-support/ig-link-vectors.js';
import { liffRoutes } from './liff.js';
import type { Env } from '../index.js';

const mileage = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../services/activity-mileage.js', () => ({awardActivityMileage:mileage}));
let store: ReturnType<typeof sqliteD1>;
let env: Env['Bindings'];
let caller: string;
let network: MockInstance<typeof fetch>;
let warning: MockInstance<typeof console.warn>;
const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const app = new Hono<Env>().route('/', liffRoutes);
beforeEach(() => {
  store = sqliteD1(); store.sqlite.exec(schema);
  for (const id of ['friend-1','friend-2']) {
    store.sqlite.prepare('INSERT INTO users (id) VALUES (?)').run('user-'+id);
    store.sqlite.prepare('INSERT INTO friends (id,line_user_id,user_id,display_name) VALUES (?,?,?,?)').run(id,'line-'+id,'user-'+id,'Synthetic');
  }
  env = {DB:store.db,IG_LINK_TOKEN_SECRET:'test-shared-link-secret',IG_HARNESS_LINK_SECRET:'synthetic-notify-secret',
    IG_HARNESS_URL:'https://ig.example.test',LINE_LOGIN_CHANNEL_ID:'synthetic-channel',LINE_LOGIN_CHANNEL_SECRET:'synthetic-login-secret',
    LINE_CHANNEL_ACCESS_TOKEN:'synthetic-channel-token',LIFF_URL:'https://liff.line.me/123-Test'} as Env['Bindings'];
  caller='line-friend-1';
  vi.spyOn(Date,'now').mockReturnValue(igLinkVectors.now);
  warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
  mileage.mockClear();
  network=vi.spyOn(globalThis,'fetch').mockImplementation(async (input) => {
    const url=String(input);
    if (url.endsWith('/oauth2/v2.1/verify')) return Response.json({sub:caller,name:'Synthetic'});
    if (url.endsWith('/oauth2/v2.1/token')) return Response.json({access_token:'synthetic-access',id_token:'synthetic-id'});
    if (url.endsWith('/v2/profile')) return Response.json({userId:caller,displayName:'Synthetic'});
    if (url==='https://ig.example.test/api/followers/link-line' || url.endsWith('/v2/bot/message/push')) return Response.json({});
    throw new Error('Unexpected mocked network destination');
  });
});
afterEach(()=>{store.sqlite.close();vi.restoreAllMocks();});
function friend(id='friend-1') {
  return store.sqlite.prepare('SELECT ig_igsid,metadata FROM friends WHERE id=?').get(id) as {ig_igsid:string|null;metadata:string};
}
function notices() { return network.mock.calls.filter(([url])=>String(url)==='https://ig.example.test/api/followers/link-line'); }
async function request(route:string, input:Record<string,unknown>) {
  const pending:Promise<unknown>[]=[];
  const ctx={waitUntil(p:Promise<unknown>){pending.push(p);},passThroughOnException(){}} as ExecutionContext;
  let r:Response;
  if (route==='oauth') {
    const state=Buffer.from(JSON.stringify(input)).toString('base64');
    r=await app.request('/auth/callback?'+new URLSearchParams({code:'synthetic-code',state}),{},env,ctx);
  } else {
    r=await app.request('/api/liff/'+route,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({idToken:'synthetic-id',lineUserId:caller,formId:'synthetic-form',...input})},env,ctx);
  }
  await Promise.all(pending);
  expect([200,302]).toContain(r.status);
  if (route!=='oauth') expect(await r.json()).toMatchObject({success:true});
  return r;
}

for (const route of ['link','send-form-link','oauth']) {
  describe(`${route}: signed IG linking`,()=>{
    for (const policy of ['off','prefer','require'] as const) {
      it.each(['ig','igt','conflicting','invalid','expired','empty'])(`${policy}: %s`,async kind=>{
        env.IG_LINK_TOKEN_POLICY=policy;
        const input:Record<string,unknown>={iga:'untrusted-account',igan:'synthetic-name'};
        if (kind!=='igt') input.ig='unsigned-igsid';
        if (kind==='igt' || kind==='conflicting') input.igt=igLinkVectors.direct;
        if (kind==='invalid') input.igt='invalid.fake-token';
        if (kind==='empty') input.igt='';
        if (kind==='expired') input.igt=await issueIgLinkToken(env,'test-igsid',undefined,igLinkVectors.now-8*86400000);
        await request(route,input);
        const signed=kind==='igt'||kind==='conflicting';
        const accepted=signed||(kind==='ig'&&policy!=='require');
        expect(friend().ig_igsid).toBe(accepted ? signed ? 'test-igsid':'unsigned-igsid' : null);
        expect(mileage).toHaveBeenCalledTimes(accepted&&(signed||policy==='off') ? 1:0);
        expect(notices()).toHaveLength(accepted?1:0);
        if (signed) {
          expect(JSON.parse(friend().metadata).ig_account_id).toBe('test-iga');
          expect(JSON.parse((notices()[0]![1] as RequestInit).body as string)).toMatchObject({igsid:'test-igsid',line_friend_uuid:'friend-1'});
        }
        if (!accepted) expect(friend().metadata).toBe('{}');
        if (policy==='prefer'&&kind==='ig') expect(warning).toHaveBeenCalledWith('[ig-link] unsigned_ig_param');
        if (['invalid','expired','empty'].includes(kind)) expect(warning).toHaveBeenCalledWith('[ig-link] invalid_token');
        expect(warning.mock.calls.every(call=>call.length===1)).toBe(true);
      });
    }
    it('require: same friend revisit succeeds, different friend reuse has no IG side effects',async()=>{
      env.IG_LINK_TOKEN_POLICY='require';
      await request(route,{igt:igLinkVectors.direct});
      await request(route,{igt:igLinkVectors.direct});
      expect(mileage).toHaveBeenCalledTimes(2); // Real mileage helper deduplicates the stable event ID.
      expect(notices()).toHaveLength(2);
      caller='line-friend-2';
      await request(route,{igt:igLinkVectors.direct,ig:'forged'});
      expect(friend('friend-2').ig_igsid).toBeNull();
      expect(mileage).toHaveBeenCalledTimes(2);
      expect(notices()).toHaveLength(2);
      expect(warning).toHaveBeenCalledWith('[ig-link] replay_rejected');
    });
  });
}
it('default off preserves unsigned linking and mileage',async()=>{
  await request('link',{ig:'legacy-igsid'});
  expect(friend().ig_igsid).toBe('legacy-igsid');expect(mileage).toHaveBeenCalledOnce();
});
it('missing secrets and replay storage failure skip only IG linking',async()=>{
  delete env.IG_LINK_TOKEN_SECRET;delete env.IG_HARNESS_LINK_SECRET;
  await request('link',{igt:igLinkVectors.direct,ig:'forged'});
  expect(friend().ig_igsid).toBeNull();
  env.IG_LINK_TOKEN_SECRET='test-shared-link-secret';env.IG_LINK_TOKEN_POLICY='require';
  store.sqlite.exec('DROP TABLE ig_link_token_uses');
  await request('link',{igt:igLinkVectors.direct});
  expect(friend().ig_igsid).toBeNull();expect(mileage).not.toHaveBeenCalled();expect(notices()).toHaveLength(0);
});
it('signed token without iga cannot adopt an unsigned iga',async()=>{
  const igt=await issueIgLinkToken(env,'test-igsid');
  await request('link',{igt,iga:'forged-account'});
  expect(JSON.parse(friend().metadata).ig_account_id).toBeUndefined();
});
it('OAuth state preserves igt through direct and liff.state input, then verifies it at callback',async()=>{
  const fields={igt:igLinkVectors.direct,ig:'forged',iga:'forged-account'};
  for (const query of [new URLSearchParams(fields),new URLSearchParams({'liff.state':'/?'+new URLSearchParams(fields)})]) {
    const r=await app.request('/auth/oauth?'+query,{},env);
    expect(r.status).toBe(302);
    const state=JSON.parse(Buffer.from(new URL(r.headers.get('location')!).searchParams.get('state')!,'base64').toString());
    expect(state.igt).toBe(fields.igt);
    await request('oauth',state);
    expect(friend().ig_igsid).toBe('test-igsid');
  }
});

it('an empty direct igt overrides liff.state and stays invalid through OAuth',async()=>{
  const r=await app.request('/auth/oauth?'+new URLSearchParams({igt:'',ig:'unsigned','liff.state':'?igt='+igLinkVectors.direct}),{},env);
  const state=JSON.parse(Buffer.from(new URL(r.headers.get('location')!).searchParams.get('state')!,'base64').toString());
  expect(state.igt).toBe('');
  await request('oauth',state);
  expect(friend().ig_igsid).toBeNull();expect(mileage).not.toHaveBeenCalled();expect(notices()).toHaveLength(0);
});
