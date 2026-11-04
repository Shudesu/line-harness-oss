import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

let mf, db, delivery, deliveryDb, currentPurchase, sessionId;
let lineSub = 'synthetic-line-user', friendAccount = 'synthetic-account', displayedPrice = 12000, invoicePaid = true, deliveryReady = true, deliveryCalls = 0, tagCalls = 0;
const checkoutKeys = new Set();
const secret = 'webhook-synthetic-secret', token = 'local-token-with-at-least-32-characters';
const plan = { id: 'tea', name: 'Tea', stripePriceId: 'price_test', amount: 12000, interval: 'year', deliveryCount: 2 };
const periodStart = Date.parse('2030-01-01')/1000, periodEnd = Date.parse('2031-01-01')/1000;
const ship = { name: 'Test', address: { postal_code: '0000000', state: 'Test', city: 'Test', line1: 'Test', country: 'JP' } };
const request = (path, method='GET', body, extra={}) => mf.dispatchFetch(`https://stripe.test${path}`, { method, headers: { 'Content-Type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
async function schema(db, path) {
  for (const statement of (await readFile(path, 'utf8')).replace(/^--.*$/gm,'').split(';').filter(s=>s.trim())) await db.prepare(statement).run();
}
async function webhook(type, objectId, eventId, override={}) {
  const raw = JSON.stringify({ id: eventId, type, data: { object: { id: objectId } } });
  const time = Math.floor(Date.now()/1000);
  const signature = createHmac('sha256', secret).update(`${time}.${raw}`).digest('hex');
  return mf.dispatchFetch('https://stripe.test/webhooks/stripe', { method: 'POST', headers: { 'Stripe-Signature': `t=${time},v1=${signature}`, ...override }, body: raw });
}
before(async () => {
  if (process.env.DELIVERY_PLUGIN_ROOT) {
    const root = resolve(process.env.DELIVERY_PLUGIN_ROOT);
    const script = (await build({ entryPoints: [resolve(root,'src/index.ts')], bundle:true,write:false,format:'esm',platform:'browser' })).outputFiles[0].text;
    delivery = new Miniflare({ modules:true,script,compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{DELIVERY_API_TOKEN:token} });
    deliveryDb = await delivery.getD1Database('DB');
    await schema(deliveryDb,resolve(root,'schema.sql'));
    for (const [id, arrival] of [['spring','2030-04-01'],['autumn','2030-10-01']]) await delivery.dispatchFetch('https://delivery.test/api/slots',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({id,planId:'tea',arrivalDate:arrival,shippingDate:arrival})});
  }
  const script = (await build({entryPoints:['src/index.ts'],bundle:true,write:false,format:'esm',platform:'browser'})).outputFiles[0].text;
  mf = new Miniflare({ modules:true,script,compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{
    PUBLIC_URL:'https://stripe.test', LINE_HARNESS_URL:'https://harness.test',LINE_HARNESS_API_KEY:'synthetic-key',LINE_ACCOUNT_ID:'synthetic-account',
    LINE_LOGIN_CHANNEL_ID:'synthetic-channel',LIFF_ID:'synthetic-liff',DELIVERY_URL:'https://delivery.test',DELIVERY_API_TOKEN:token,PLUGIN_ADMIN_TOKEN:token,
    STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:secret,CATALOG_JSON:JSON.stringify([plan]),SHOP_TITLE:'Tea',SALES_TERMS_URL:'https://merchant.test/terms',PAID_TAG_ID:'synthetic-tag',
  }, outboundService: async req => {
    const url = new URL(req.url);
    const out = data => Response.json(data);
    if (url.host === 'api.line.me') return out({sub:lineSub,aud:'synthetic-channel',iss:'https://access.line.me',exp:Math.floor(Date.now()/1000)+600});
    if (url.host === 'harness.test') {
      assert.equal(req.headers.get('Authorization'),'Bearer synthetic-key');
      if (req.method==='POST') {tagCalls++;return out({success:true});}
      return out({success:true,data:{id:'synthetic-friend',lineUserId:'synthetic-line-user',lineAccountId:friendAccount}});
    }
    if (url.host === 'delivery.test') {
      deliveryCalls++;
      assert.equal(req.headers.get('Authorization'),`Bearer ${token}`);
      const p = await req.json();
      assert.equal(p.paymentId,'in_paid');assert.equal(p.deliveryCount,2);assert.equal(p.periodStart,'2030-01-01');assert.equal(p.shipping.name,'Test');
      if (!deliveryReady) return out({status:'blocked'}); // Wrong status/body must not be acknowledged.
      if (delivery) return delivery.dispatchFetch(req.url,{method:'POST',headers:Object.fromEntries(req.headers),body:JSON.stringify(p)});
      return out({status:'ready'});
    }
    assert.equal(url.host,'api.stripe.com');
    assert.equal(req.headers.get('Stripe-Version'),'2024-06-20');
    if (url.pathname === '/v1/prices/price_test') return out({active:true,currency:'jpy',unit_amount:displayedPrice,recurring:{interval:'year',interval_count:1}});
    if (url.pathname === '/v1/checkout/sessions' && req.method==='POST') {
      const b = new URLSearchParams(await req.text());currentPurchase = b.get('metadata[purchase_id]');sessionId=`cs_${currentPurchase}`;
      checkoutKeys.add(req.headers.get('Idempotency-Key'));assert.equal(b.get('subscription_data[metadata][purchase_id]'),currentPurchase);
      return out({id:sessionId,url:`https://checkout.stripe.com/c/pay/${sessionId}`});
    }
    if (url.pathname === '/v1/invoices/in_paid') return out({id:'in_paid',status:invoicePaid?'paid':'open',paid:invoicePaid,currency:'jpy',amount_paid:invoicePaid?12000:0,subscription:'sub_test',lines:{has_more:false,data:[{type:'subscription',proration:false,price:{id:'price_test'},period:{start:periodStart,end:periodEnd}}]}});
    if (url.pathname === '/v1/subscriptions/sub_test') return out({id:'sub_test',status:'active',metadata:{purchase_id:currentPurchase},current_period_start:periodEnd,current_period_end:periodEnd+31536000});
    if (url.pathname === '/v1/checkout/sessions' && req.method==='GET') return out({data:[{id:sessionId,metadata:{purchase_id:currentPurchase},customer_details:{phone:'0000000000'},shipping_details:ship}]});
    throw Error(`Unexpected external request ${req.method} ${url}`);
  }});
  db = await mf.getD1Database('DB');await schema(db,'schema.sql');
});
after(async()=>{await mf?.dispose();await delivery?.dispose();});
test('renders real LIFF checkout and refuses unverified/wrong-account buyer before payment calls',async()=>{
  const html=await (await request('/store')).text();assert.ok(html.includes('liff.getIDToken()'));assert.ok(html.includes('12,000'));
  assert.equal((await request('/api/checkout','POST',{planId:'tea',friendId:'synthetic-friend',acceptedTerms:true})).status,401);
  lineSub='another-user';
  assert.equal((await request('/api/checkout','POST',{planId:'tea',friendId:'synthetic-friend',idToken:'synthetic-token',acceptedTerms:true})).status,403);
  lineSub='synthetic-line-user';friendAccount='another-account';
  assert.equal((await request('/api/checkout','POST',{planId:'tea',friendId:'synthetic-friend',idToken:'synthetic-token',acceptedTerms:true})).status,403);
  friendAccount='synthetic-account';assert.equal(checkoutKeys.size,0);
});
test('mismatched displayed and Stripe prices reject checkout before any session is created',async()=>{
  displayedPrice=15000;
  assert.equal((await request('/api/checkout','POST',{planId:'tea',friendId:'synthetic-friend',idToken:'synthetic-token',acceptedTerms:true})).status,503);
  assert.equal(checkoutKeys.size,0);displayedPrice=12000;
});
test('parallel checkout requests reserve one purchase and reuse a provider idempotency key',async()=>{
  const body={planId:'tea',friendId:'synthetic-friend',idToken:'synthetic-token',acceptedTerms:true};
  const responses=await Promise.all(Array.from({length:6},()=>request('/api/checkout','POST',body)));
  assert.ok(responses.every(r=>r.status===200));
  const urls=await Promise.all(responses.map(async r=>(await r.json()).url));assert.equal(new Set(urls).size,1);assert.equal(checkoutKeys.size,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM purchases').first()).n,1);
});
test('signature tampering and stale signatures never enqueue fulfillment',async()=>{
  assert.equal((await webhook('invoice.paid','in_paid','evt_bad',{'Stripe-Signature':'t=1,v1=bad'})).status,401);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM stripe_jobs').first()).n,0);
  const raw=JSON.stringify({id:'evt_stale',type:'invoice.paid',data:{object:{id:'in_paid'}}});
  const signature=createHmac('sha256',secret).update(`1.${raw}`).digest('hex');
  assert.equal((await mf.dispatchFetch('https://stripe.test/webhooks/stripe',{method:'POST',headers:{'Stripe-Signature':`t=1,v1=${signature}`},body:raw})).status,401);
});
test('verified paid invoice remains pending while delivery fails, then recovers without checkout or charge',async()=>{
  deliveryReady=false;
  assert.equal((await webhook('invoice.paid','in_paid','evt_paid')).status,503);
  assert.equal((await db.prepare("SELECT status FROM stripe_jobs WHERE id='evt_paid'").first()).status,'pending');
  deliveryReady=true;
  assert.equal((await request('/admin/reconcile','POST',{}, {Authorization:`Bearer ${token}`})).status,200);
  assert.equal((await db.prepare("SELECT status FROM stripe_jobs WHERE id='evt_paid'").first()).status,'done');
  assert.equal(tagCalls,1);assert.equal(checkoutKeys.size,1);
  if(deliveryDb) assert.equal((await deliveryDb.prepare('SELECT COUNT(*) AS n FROM delivery_orders').first()).n,2);
});
test('replayed invoices preserve the paid period despite a later subscription period',async()=>{
  const priorCalls=deliveryCalls;
  assert.equal((await webhook('invoice.paid','in_paid','evt_paid')).status,200);assert.equal(deliveryCalls,priorCalls);
  assert.equal((await webhook('invoice.paid','in_paid','evt_paid_duplicate_id')).status,200);
  if(deliveryDb) assert.equal((await deliveryDb.prepare('SELECT COUNT(*) AS n FROM delivery_orders').first()).n,2);
  assert.equal((await request('/api/checkout','POST',{planId:'tea',friendId:'synthetic-friend',idToken:'synthetic-token',acceptedTerms:true})).status,409);
});
test('success redirect never changes payment state and admin routes require their separate token',async()=>{
  const calls=deliveryCalls;assert.equal((await request('/success')).status,200);assert.equal(deliveryCalls,calls);
  assert.equal((await request('/admin/jobs')).status,401);
  assert.equal((await request('/api/checkout','POST',{acceptedTerms:true},{Origin:'https://another.test'})).status,403);
});
test('a signed event never fulfills an invoice that the Stripe API says is unpaid',async()=>{
  invoicePaid=false;const before=deliveryCalls;
  assert.equal((await webhook('invoice.paid','in_paid','evt_unpaid')).status,503);
  assert.equal(deliveryCalls,before);invoicePaid=true;
});
