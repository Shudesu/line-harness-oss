import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

let mf,db,delivery,deliveryDb,library;
let mode='completed',lookupMode='completed',deliveryReady=false,unlinkOk=true,postCount=0,lookupCount=0,unlinkCount=0,tagCount=0;
let chargeGate,chargeStarted,releaseCharge;
const token='local-token-with-at-least-32-characters',apiSecret=Buffer.from('synthetic-paypay-secret').toString('base64url');
const plan={id:'tea',name:'Tea',amount:12000,billingMonths:12,deliveryCount:2};
const shipping={name:'Test',phone:'0000000000',postalCode:'0000000',region:'Test',city:'Test',line1:'Test',country:'JP'};
const admin={Authorization:`Bearer ${token}`};
const request=(path,method='GET',body,headers={})=>mf.dispatchFetch(`https://paypay.test${path}`,{method,headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
const jwt=(payload,secret=apiSecret)=>{
  const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.${createHmac('sha256',Buffer.from(secret,'base64url')).update(`${h}.${p}`).digest('base64url')}`;
};
async function schema(database,path){for(const s of (await readFile(path,'utf8')).replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()))await database.prepare(s).run();}
async function start(friendId){
  const r=await request('/api/link','POST',{planId:'tea',friendId,idToken:'synthetic-id-token',acceptedTerms:true,shipping});assert.equal(r.status,200,await r.clone().text());
  return db.prepare('SELECT * FROM authorization_sessions WHERE friend_id=? ORDER BY rowid DESC LIMIT 1').bind(friendId).first();
}
async function callback(session,overrides={}){
  const claims={iss:'paypay.ne.jp',aud:'synthetic-client',exp:Math.floor(Date.now()/1000)+600,referenceId:session.reference_id,nonce:session.nonce,result:'succeeded',userAuthorizationId:`auth_${session.id}`,...overrides};
  return mf.dispatchFetch(`https://paypay.test/callback?responseToken=${encodeURIComponent(jwt(claims))}`,{redirect:'manual'});
}
const sub=id=>db.prepare('SELECT * FROM paypay_subscriptions WHERE id=?').bind(id).first();
const attempts=id=>db.prepare('SELECT * FROM payment_attempts WHERE subscription_id=? ORDER BY rowid').bind(id).all();
before(async()=>{
  if(process.env.DELIVERY_PLUGIN_ROOT){
    const root=resolve(process.env.DELIVERY_PLUGIN_ROOT),script=(await build({entryPoints:[resolve(root,'src/index.ts')],bundle:true,write:false,format:'esm',platform:'browser'})).outputFiles[0].text;
    delivery=new Miniflare({modules:true,script,compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{DELIVERY_API_TOKEN:token}});deliveryDb=await delivery.getD1Database('DB');await schema(deliveryDb,resolve(root,'schema.sql'));
    const now=new Date();
    for(const n of [1,6]){const date=new Date(now);date.setUTCMonth(date.getUTCMonth()+n);const arrival=date.toISOString().slice(0,10);await delivery.dispatchFetch('https://delivery.test/api/slots',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({id:`tea-${n}`,planId:'tea',arrivalDate:arrival,shippingDate:arrival})});}
  }
  const compiled=(await build({entryPoints:['src/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',external:['node:crypto']})).outputFiles[0].text;
  library=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  mf=new Miniflare({modules:true,script:compiled,compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{
    ENVIRONMENT:'development',PAYPAY_ENVIRONMENT:'sandbox',PAYPAY_API_KEY:'synthetic-api-key',PAYPAY_API_SECRET:apiSecret,PAYPAY_MERCHANT_ID:'synthetic-merchant',PAYPAY_CLIENT_ID:'synthetic-client',
    PUBLIC_URL:'https://paypay.test',LINE_HARNESS_URL:'https://harness.test',LINE_HARNESS_API_KEY:'synthetic-key',LINE_ACCOUNT_ID:'synthetic-account',LINE_LOGIN_CHANNEL_ID:'synthetic-channel',LIFF_ID:'synthetic-liff',
    DELIVERY_URL:'https://delivery.test',DELIVERY_API_TOKEN:token,PLUGIN_ADMIN_TOKEN:token,CATALOG_JSON:JSON.stringify([plan]),SHOP_TITLE:'Tea',SALES_TERMS_URL:'https://merchant.test/terms',PAID_TAG_ID:'synthetic-tag',
  },outboundService:async req=>{
    const url=new URL(req.url),out=data=>Response.json(data);
    if(url.host==='api.line.me')return out({sub:'synthetic-line-user',aud:'synthetic-channel',iss:'https://access.line.me',exp:Math.floor(Date.now()/1000)+600});
    if(url.host==='harness.test'){
      assert.equal(req.headers.get('Authorization'),'Bearer synthetic-key');
      if(req.method==='POST'){tagCount++;return out({success:true});}
      return out({success:true,data:{lineUserId:'synthetic-line-user',lineAccountId:'synthetic-account'}});
    }
    if(url.host==='delivery.test'){
      assert.equal(req.headers.get('Authorization'),`Bearer ${token}`);
      const payload=await req.json();assert.equal(payload.provider,'paypay');assert.equal(payload.deliveryCount,2);
      if(!deliveryReady)return new Response(JSON.stringify({status:'blocked'}),{status:202});
      if(delivery)return delivery.dispatchFetch(req.url,{method:'POST',headers:Object.fromEntries(req.headers),body:JSON.stringify(payload)});
      return out({status:'ready'});
    }
    assert.equal(url.host,'apigw.sandbox.paypay.ne.jp');assert.equal(req.headers.get('X-ASSUME-MERCHANT'),'synthetic-merchant');
    const body=['POST','DELETE'].includes(req.method)?await req.text():'';
    const header=req.headers.get('Authorization'),parts=header.split(':');
    assert.ok(header.startsWith('hmac OPA-Auth:synthetic-api-key:'));
    const nonce=parts[3],epoch=parts[4],hash=body?createHash('md5').update('application/json;charset=UTF-8;'+body).digest('base64'):'empty';
    assert.equal(parts[5],hash);
    const signed=[url.pathname,req.method,nonce,epoch,body?'application/json;charset=UTF-8;':'empty',hash].join('\n');
    assert.equal(parts[2],createHmac('sha256',apiSecret).update(signed).digest('base64'));
    if(url.pathname==='/v1/qr/sessions'){
      const b=JSON.parse(body);assert.deepEqual(b.scopes,['continuous_payments']);assert.equal(b.redirectUrl,'https://paypay.test/callback');
      return new Response(JSON.stringify({resultInfo:{code:'SUCCESS'},data:{linkQRCodeURL:'https://paypay.ne.jp/synthetic-link'}}),{status:201});
    }
    if(url.pathname==='/v1/subscription/payments'){
      postCount++;const b=JSON.parse(body);assert.equal(b.amount.amount,12000);assert.equal(b.amount.currency,'JPY');
      if(chargeGate){chargeStarted();await chargeGate;chargeGate=undefined;}
      if(mode==='unknown')return new Response('temporary upstream failure',{status:503});
      if(mode==='failed')return out({resultInfo:{code:'NO_SUFFICIENT_FUND'}});
      return out({resultInfo:{code:'SUCCESS'},data:{paymentId:`payment_${b.merchantPaymentId}`,merchantPaymentId:b.merchantPaymentId,status:mode==='pending'?'CREATED':'COMPLETED'}});
    }
    if(url.pathname.startsWith('/v2/payments/')){
      lookupCount++;const id=decodeURIComponent(url.pathname.split('/').at(-1));
      return out({resultInfo:{code:'SUCCESS'},data:{paymentId:`payment_${id}`,merchantPaymentId:id,status:lookupMode==='completed'?'COMPLETED':'CREATED'}});
    }
    if(req.method==='DELETE'){
      unlinkCount++;return out({resultInfo:{code:unlinkOk?'SUCCESS':'INTERNAL_SERVER_ERROR'}});
    }
    throw Error(`Unexpected request ${url}`);
  }});
  db=await mf.getD1Database('DB');await schema(db,'schema.sql');
});
after(async()=>{await mf?.dispose();await delivery?.dispose();});
test('uses clamped UTC billing months and renders a real authorization form',async()=>{
  assert.equal(library.nextPeriod('2030-01-31T12:00:00.000Z',1),'2030-02-28T12:00:00.000Z');
  assert.equal(library.nextPeriod('2032-02-29T12:00:00.000Z',12),'2033-02-28T12:00:00.000Z');
  const html=await(await request('/store')).text();assert.ok(html.includes('liff.getIDToken()'));assert.ok(html.includes('postalCode'));
  assert.equal((await request('/api/link','POST',{planId:'tea',acceptedTerms:true,shipping})).status,401);
});
test('rejects invalid callback audience and nonce before billing',async()=>{
  const s=await start('friend-invalid'),before=postCount;
  assert.equal((await callback(s,{aud:'wrong-client'})).status,401);
  assert.equal((await callback(s,{nonce:'wrong-nonce'})).status,401);
  assert.equal(postCount,before);assert.equal(await sub(s.id),null);
});
test('concurrent callbacks bill once and delivery recovers without another payment',async()=>{
  const s=await start('friend-success'),before=postCount;mode='completed';deliveryReady=false;
  const replies=await Promise.all(Array.from({length:6},()=>callback(s)));
  assert.ok(replies.every(r=>r.status===303));assert.equal(postCount,before+1);
  let a=(await attempts(s.id)).results;assert.equal(a.length,1);assert.equal(a[0].status,'completed');assert.equal(a[0].delivery_status,'pending');
  deliveryReady=true;await request('/admin/reconcile','POST',{},admin);
  a=(await attempts(s.id)).results;assert.equal(a[0].delivery_status,'ready');assert.equal(postCount,before+1);assert.ok(tagCount>=1);
  if(deliveryDb)assert.equal((await deliveryDb.prepare('SELECT COUNT(*) AS n FROM delivery_orders').first()).n,2);
});
test('unsettled payment stops retries and cancellation until provider lookup resolves it',async()=>{
  const s=await start('friend-unsettled');mode='pending';lookupMode='pending';await callback(s);const before=postCount;
  assert.equal((await attempts(s.id)).results[0].status,'unknown');
  assert.equal((await request(`/admin/subscriptions/${s.id}/retry`,'POST',{},admin)).status,409);
  assert.equal((await request(`/admin/subscriptions/${s.id}/cancel`,'POST',{},admin)).status,409);
  await request(`/admin/subscriptions/${s.id}/charge`,'POST',{},admin);assert.equal(postCount,before);
  lookupMode='completed';await request('/admin/reconcile','POST',{},admin);
  assert.equal((await attempts(s.id)).results[0].status,'completed');assert.equal(postCount,before);assert.ok(lookupCount>0);
});
test('definitive insufficient funds can be retried only by explicit admin action',async()=>{
  const s=await start('friend-failed');mode='failed';await callback(s);const before=postCount;
  assert.equal((await sub(s.id)).status,'past_due');assert.equal((await attempts(s.id)).results[0].status,'failed');
  assert.equal((await request(`/admin/subscriptions/${s.id}/retry`,'POST',{})).status,401);
  mode='completed';assert.equal((await request(`/admin/subscriptions/${s.id}/retry`,'POST',{},admin)).status,200);
  const a=(await attempts(s.id)).results;assert.equal(a.length,2);assert.notEqual(a[0].id,a[1].id);assert.equal(a[1].status,'completed');assert.equal(postCount,before+1);
});
test('cancellation racing with a charge is blocked; failed unlink still stops future billing',async()=>{
  const s=await start('friend-cancel');mode='completed';
  let started;const signal=new Promise(r=>{started=r;});chargeStarted=started;chargeGate=new Promise(r=>{releaseCharge=r;});
  const completing=callback(s);await signal;
  assert.equal((await request(`/admin/subscriptions/${s.id}/cancel`,'POST',{},admin)).status,409);
  releaseCharge();assert.equal((await completing).status,303);
  unlinkOk=false;assert.equal((await request(`/admin/subscriptions/${s.id}/cancel`,'POST',{},admin)).status,502);
  const before=postCount;assert.equal((await sub(s.id)).status,'canceled');assert.equal((await sub(s.id)).unlink_pending,1);
  await request(`/admin/subscriptions/${s.id}/charge`,'POST',{},admin);assert.equal(postCount,before);
  unlinkOk=true;assert.equal((await request(`/admin/subscriptions/${s.id}/cancel`,'POST',{},admin)).status,200);
  const unlinked=unlinkCount;await request(`/admin/subscriptions/${s.id}/cancel`,'POST',{},admin);assert.equal(unlinkCount,unlinked);
  assert.equal((await attempts(s.id)).results[0].status,'completed');assert.ok((await sub(s.id)).paid_through);
});
test('5xx results remain unresolved and expired authorizations never charge',async()=>{
  const s=await start('friend-network');mode='unknown';await callback(s);assert.equal((await attempts(s.id)).results[0].status,'unknown');
  const expired=await start('friend-expired');await db.prepare("UPDATE authorization_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(expired.id).run();
  const before=postCount;assert.equal((await callback(expired)).status,409);assert.equal(postCount,before);
});
test('a due renewal advances one paid period and a repeated job cannot charge again',async()=>{
  const id=crypto.randomUUID(),start=new Date(Date.now()-86400000).toISOString();mode='completed';
  await db.prepare("INSERT INTO paypay_subscriptions(id,friend_id,plan_id,plan,shipping,line_account_id,user_authorization_id,status,period_start,next_charge_at) VALUES(?,?,?,?,?,?,?,'active',?,?)")
    .bind(id,'friend-renewal','tea',JSON.stringify(plan),JSON.stringify(shipping),'synthetic-account',`auth_${id}`,start,start).run();
  const before=postCount;
  const r=await request(`/admin/subscriptions/${id}/charge`,'POST',{},admin);assert.equal(r.status,200);assert.equal((await r.json()).status,'completed');
  assert.equal((await sub(id)).paid_through,library.nextPeriod(start,12));assert.equal(postCount,before+1);
  await request(`/admin/subscriptions/${id}/charge`,'POST',{},admin);assert.equal(postCount,before+1);
});
test('production environment mismatch or unapproved merchant rejects checkout before any API call',async()=>{
  const minimal={ENVIRONMENT:'production',PAYPAY_ENVIRONMENT:'sandbox',PAYPAY_API_KEY:'synthetic',PAYPAY_API_SECRET:apiSecret,PAYPAY_MERCHANT_ID:'synthetic',PAYPAY_CLIENT_ID:'synthetic'};
  for(const e of [minimal,{...minimal,PAYPAY_ENVIRONMENT:'production'},{...minimal,PAYPAY_ENVIRONMENT:undefined}]){
    const r=await library.default.fetch(new Request('https://paypay.test/api/link',{method:'POST',body:'{}'}),e);assert.equal(r.status,503);
  }
});
