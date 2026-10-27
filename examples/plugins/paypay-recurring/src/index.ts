import {
  createPayPayAccountLink, createPayPayContinuousPayment, getPayPayPaymentDetails,
  isPayPayCheckoutAvailable, unlinkPayPayUser, verifyPayPayResponseToken,
  type PayPayBindings,
} from './paypay.js';
import { HttpError, origin, harness, verifyBuyer, admin } from './harness.js';
export interface Env extends PayPayBindings {
  DB: D1Database; PUBLIC_URL: string; LINE_HARNESS_URL: string; LINE_HARNESS_API_KEY: string;
  LINE_ACCOUNT_ID: string; LINE_LOGIN_CHANNEL_ID: string; LIFF_ID: string;
  DELIVERY_URL: string; DELIVERY_API_TOKEN: string; PLUGIN_ADMIN_TOKEN: string;
  CATALOG_JSON: string; SHOP_TITLE: string; SALES_TERMS_URL: string;
  PAYPAY_PRODUCTION_APPROVED?: string; PAID_TAG_ID?: string;
}
type Plan = { id: string; name: string; amount: number; billingMonths: number; deliveryCount: number };
type Shipping = { name: string; phone: string; postalCode: string; region: string; city: string; line1: string; line2: string; country: string };
type Subscription = { id: string; friend_id: string; plan_id: string; plan: string; shipping: string; line_account_id: string; user_authorization_id: string; status: string; period_start: string; next_charge_at: string; paid_through: string | null; retry_no: number; unlink_pending: number };
type Attempt = { id: string; subscription_id: string; period_start: string; period_end: string; retry_no: number; status: string; result_code: string | null; payload: string | null; delivery_status: string };
const json = (v: unknown, status=200) => Response.json(v,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
function available(env: Env): boolean {
  return isPayPayCheckoutAvailable(env) && !!env.PAYPAY_CLIENT_ID && (env.ENVIRONMENT !== 'production' || env.PAYPAY_PRODUCTION_APPROVED === 'true');
}
function catalog(env: Env): Plan[] {
  const plans = JSON.parse(env.CATALOG_JSON) as Plan[];
  if (!Array.isArray(plans) || !plans.length || plans.length>50) throw new Error('Invalid catalog');
  for (const p of plans) if (!p.id || !p.name || !Number.isSafeInteger(p.amount) || p.amount<1 || !Number.isSafeInteger(p.billingMonths) || p.billingMonths<1 || p.billingMonths>12 || !Number.isSafeInteger(p.deliveryCount) || p.deliveryCount<1 || p.deliveryCount>366) throw new Error('Invalid plan');
  if (new Set(plans.map(p=>p.id)).size!==plans.length) throw new Error('Duplicate plan IDs');
  return plans;
}
function shipping(value: unknown): Shipping {
  if (!value || typeof value!=='object') throw new HttpError(400,'Shipping required');
  const s=value as Record<string, unknown>, fields=['name','phone','postalCode','region','city','line1','country'];
  for (const field of fields) if(typeof s[field]!=='string' || !s[field].trim() || s[field].length>255) throw new HttpError(400,`Shipping ${field} required`);
  if(s.country!=='JP') throw new HttpError(400,'This adapter supports JPY and Japan shipping');
  if(s.line2!==undefined && (typeof s.line2!=='string' || s.line2.length>255)) throw new HttpError(400,'Invalid address line2');
  return Object.fromEntries([...fields.map(f=>[f,(s[f] as string).trim()]),['line2',s.line2??'']]) as Shipping;
}
// Clamp month ends rather than silently overflowing February into March.
export function nextPeriod(start: string, months: number): string {
  const date=new Date(start), day=date.getUTCDate();
  date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
  const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,last));return date.toISOString();
}
async function link(req: Request, env: Env): Promise<Response> {
  if(!available(env)) throw new HttpError(503,'PayPay is not configured for this environment');
  if(req.headers.get('Origin') && req.headers.get('Origin')!==origin(env.PUBLIC_URL)) throw new HttpError(403,'Origin does not match');
  const input=await req.json() as Record<string, unknown>;
  if(input.acceptedTerms!==true) throw new HttpError(400,'Sales terms must be accepted');
  const friendId=await verifyBuyer(env,input);
  const plan=catalog(env).find(p=>p.id===input.planId);
  if(!plan) throw new HttpError(404,'Plan not found');
  const address=shipping(input.shipping), now=new Date().toISOString();
  const open=await env.DB.prepare("SELECT id FROM paypay_subscriptions WHERE friend_id=? AND plan_id=? AND status IN ('pending','active','past_due')").bind(friendId,plan.id).first();
  if(open) throw new HttpError(409,'A subscription already exists');
  await env.DB.prepare("UPDATE authorization_sessions SET status='expired' WHERE friend_id=? AND plan_id=? AND status='pending' AND expires_at<=?").bind(friendId,plan.id,now).run();
  const id=crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO authorization_sessions (id,reference_id,nonce,friend_id,plan_id,plan,shipping,line_account_id,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
    .bind(id,`ref_${id.replaceAll('-','')}`,crypto.randomUUID().replaceAll('-',''),friendId,plan.id,JSON.stringify(plan),JSON.stringify(address),env.LINE_ACCOUNT_ID,new Date(Date.now()+15*60000).toISOString()).run();
  const session=await env.DB.prepare("SELECT * FROM authorization_sessions WHERE friend_id=? AND plan_id=? AND status='pending'").bind(friendId,plan.id).first<{id:string;reference_id:string;nonce:string;url:string|null;shipping:string}>();
  if(!session) throw new Error('Authorization reservation failed');
  if(session.shipping!==JSON.stringify(address)) throw new HttpError(409,'Existing authorization has a different shipping address; wait for its expiry');
  if(session.url) return json({url:session.url});
  const url=await createPayPayAccountLink(env,{nonce:session.nonce,referenceId:session.reference_id,redirectUrl:`${origin(env.PUBLIC_URL)}/callback`,userAgent:req.headers.get('User-Agent')??undefined});
  const target=new URL(url);
  if(target.protocol!=='https:' || !(target.hostname==='paypay.ne.jp' || target.hostname.endsWith('.paypay.ne.jp'))) throw new Error('Unexpected PayPay link URL');
  await env.DB.prepare('UPDATE authorization_sessions SET url=? WHERE id=?').bind(url,session.id).run();
  return json({url});
}
async function deliver(env: Env, attempt: Attempt): Promise<void> {
  if(attempt.status!=='completed' || attempt.delivery_status==='ready' || !attempt.payload) return;
  const result=await fetch(`${origin(env.DELIVERY_URL)}/api/periods`,{method:'POST',headers:{Authorization:`Bearer ${env.DELIVERY_API_TOKEN}`,'Content-Type':'application/json'},body:attempt.payload});
  if(result.status!==200 || (await result.json() as {status?:string}).status!=='ready') return;
  const payload=JSON.parse(attempt.payload);
  if(env.PAID_TAG_ID) await harness(env,`/api/friends/${encodeURIComponent(payload.friendId)}/tags`,{tagId:env.PAID_TAG_ID});
  await env.DB.prepare("UPDATE payment_attempts SET delivery_status='ready' WHERE id=? AND status='completed'").bind(attempt.id).run();
}
async function finalize(env: Env, attempt: Attempt, sub: Subscription, paymentId: string): Promise<void> {
  const plan=JSON.parse(sub.plan) as Plan;
  const payload=JSON.stringify({provider:'paypay',paymentId:attempt.id,subscriptionId:sub.id,planId:sub.plan_id,friendId:sub.friend_id,lineAccountId:sub.line_account_id,
    periodStart:attempt.period_start.slice(0,10),periodEnd:attempt.period_end.slice(0,10),deliveryCount:plan.deliveryCount,shipping:JSON.parse(sub.shipping)});
  await env.DB.batch([
    env.DB.prepare("UPDATE payment_attempts SET status='completed',payment_id=?,payload=COALESCE(payload,?),result_code='SUCCESS' WHERE id=? AND status IN ('processing','unknown','completed')").bind(paymentId,payload,attempt.id),
    env.DB.prepare("UPDATE paypay_subscriptions SET status=CASE WHEN status='canceled' THEN 'canceled' ELSE 'active' END,period_start=?,next_charge_at=?,paid_through=?,retry_no=0 WHERE id=? AND period_start=?")
      .bind(attempt.period_end,attempt.period_end,attempt.period_end,sub.id,attempt.period_start),
  ]);
  // Payment is final. A failed delivery sync must never cause another charge.
  try { await deliver(env,{...attempt,status:'completed',payload}); } catch { /* Visible as completed / delivery pending. */ }
}
async function applyResult(env: Env, attempt: Attempt, sub: Subscription, result: Awaited<ReturnType<typeof getPayPayPaymentDetails>>): Promise<string> {
  const code=result.response.resultInfo.code, data=result.response.data;
  if(result.httpStatus===200 && code==='SUCCESS' && data?.status==='COMPLETED' && data.paymentId && (!data.merchantPaymentId || data.merchantPaymentId===attempt.id)) {
    await finalize(env,attempt,sub,data.paymentId);return 'completed';
  }
  // Only explicit, final failure can be retried by an operator. Timeouts,
  // 5xx, CREATED/AUTHORIZED and unrecognized errors require provider lookup.
  const knownFailure=result.httpStatus<500 && (['NO_SUFFICIENT_FUND','USER_AUTHORIZATION_NOT_FOUND','USER_AUTHORIZATION_INVALID'].includes(code) || (code==='SUCCESS' && ['FAILED','CANCELED'].includes(data?.status??'')));
  const state=knownFailure?'failed':'unknown';
  await env.DB.batch([
    env.DB.prepare("UPDATE payment_attempts SET status=?,result_code=? WHERE id=? AND status IN ('processing','unknown')").bind(state,code,attempt.id),
    env.DB.prepare("UPDATE paypay_subscriptions SET status='past_due' WHERE id=? AND status!='canceled'").bind(sub.id),
  ]);
  return state;
}
export async function charge(env: Env, subId: string): Promise<string> {
  if(!available(env)) throw new HttpError(503,'PayPay is unavailable');
  const sub=await env.DB.prepare('SELECT * FROM paypay_subscriptions WHERE id=?').bind(subId).first<Subscription>();
  if(!sub || sub.status==='canceled' || sub.next_charge_at>new Date().toISOString()) return 'not_due';
  const plan=JSON.parse(sub.plan) as Plan;
  const attemptId=`pp_${sub.id.replaceAll('-','')}_${sub.period_start.slice(0,10).replaceAll('-','')}_${sub.retry_no}`;
  const end=nextPeriod(sub.period_start,plan.billingMonths);
  if(end<=new Date().toISOString()) {
    await env.DB.prepare("UPDATE paypay_subscriptions SET status='past_due' WHERE id=? AND status!='canceled'").bind(sub.id).run();
    return 'overdue_review';
  }
  const claim=await env.DB.prepare(`INSERT INTO payment_attempts (id,subscription_id,period_start,period_end,retry_no)
    SELECT ?,id,?,?,? FROM paypay_subscriptions
    WHERE id=? AND status IN ('pending','active','past_due') AND period_start=? AND retry_no=?
    AND NOT EXISTS(SELECT 1 FROM payment_attempts WHERE subscription_id=? AND status IN ('processing','unknown'))
    ON CONFLICT DO NOTHING`).bind(attemptId,sub.period_start,end,sub.retry_no,sub.id,sub.period_start,sub.retry_no,sub.id).run();
  if(!claim.meta.changes) return 'already_processed';
  const attempt={id:attemptId,subscription_id:sub.id,period_start:sub.period_start,period_end:end,retry_no:sub.retry_no,status:'processing',result_code:null,payload:null,delivery_status:'pending'};
  try {
    const result=await createPayPayContinuousPayment(env,{merchantPaymentId:attemptId,userAuthorizationId:sub.user_authorization_id,amount:plan.amount,description:plan.name});
    return await applyResult(env,attempt,sub,result);
  } catch {
    await env.DB.prepare("UPDATE payment_attempts SET status='unknown',result_code='NETWORK_OR_LOCAL_ERROR' WHERE id=? AND status='processing'").bind(attemptId).run();
    return 'unknown';
  }
}
async function callback(req: Request, env: Env): Promise<Response> {
  if(!available(env)) throw new HttpError(503,'PayPay is unavailable');
  const token=new URL(req.url).searchParams.get('responseToken');
  if(!token) throw new HttpError(400,'Missing response token');
  let claims: Record<string,unknown>;
  try { claims=await verifyPayPayResponseToken(env,token); } catch { throw new HttpError(401,'Invalid PayPay response token'); }
  if(typeof claims.referenceId!=='string') throw new HttpError(400,'Missing authorization reference');
  const session=await env.DB.prepare('SELECT * FROM authorization_sessions WHERE reference_id=?').bind(claims.referenceId).first<{id:string;nonce:string;friend_id:string;plan_id:string;plan:string;shipping:string;line_account_id:string;expires_at:string;status:string}>();
  if(!session || session.nonce!==claims.nonce) throw new HttpError(401,'Invalid authorization session');
  if(session.status==='accepted') return redirect(`/status?id=${session.id}`);
  if(session.status!=='pending' || session.expires_at<=new Date().toISOString()) throw new HttpError(409,'Authorization session expired or consumed');
  if(claims.result!=='succeeded' || typeof claims.userAuthorizationId!=='string' || !claims.userAuthorizationId) {
    await env.DB.prepare("UPDATE authorization_sessions SET status='declined' WHERE id=? AND status='pending'").bind(session.id).run();
    throw new HttpError(400,'Authorization declined');
  }
  const now=new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO paypay_subscriptions(id,friend_id,plan_id,plan,shipping,line_account_id,user_authorization_id,period_start,next_charge_at)
        SELECT id,friend_id,plan_id,plan,shipping,line_account_id,?,?,? FROM authorization_sessions WHERE id=? AND status='pending'
        ON CONFLICT(id) DO NOTHING`).bind(claims.userAuthorizationId,now,now,session.id),
      env.DB.prepare("UPDATE authorization_sessions SET status='accepted' WHERE id=? AND status='pending'").bind(session.id),
    ]);
  } catch { throw new HttpError(409,'An open authorization or subscription already exists'); }
  await charge(env,session.id);
  return redirect(`/status?id=${session.id}`);
}
const redirect=(path:string) => new Response(null,{status:303,headers:{Location:path,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
async function cancel(env: Env, id: string): Promise<Response> {
  const sub=await env.DB.prepare('SELECT * FROM paypay_subscriptions WHERE id=?').bind(id).first<Subscription>();
  if(!sub) throw new HttpError(404,'Subscription not found');
  if(sub.status==='canceled' && sub.unlink_pending===0) return json({status:'canceled',paidThrough:sub.paid_through});
  const stop=await env.DB.prepare(`UPDATE paypay_subscriptions SET status='canceled',unlink_pending=1
    WHERE id=? AND NOT EXISTS(SELECT 1 FROM payment_attempts WHERE subscription_id=? AND status IN ('processing','unknown'))`).bind(id,id).run();
  if(!stop.meta.changes) throw new HttpError(409,'Reconcile unresolved payment before cancellation');
  // The database stop persists even when remote unlink fails.
  const result=await unlinkPayPayUser(env,sub.user_authorization_id);
  if(result.response.resultInfo.code!=='SUCCESS') throw new HttpError(502,'Future billing stopped; retry unlink');
  await env.DB.prepare('UPDATE paypay_subscriptions SET unlink_pending=0 WHERE id=?').bind(id).run();
  return json({status:'canceled',paidThrough:sub.paid_through});
}
export async function reconcile(env: Env): Promise<void> {
  // Lookup and delivery recovery run independently of initiating any charge.
  const uncertain=(await env.DB.prepare("SELECT * FROM payment_attempts WHERE status IN ('processing','unknown') ORDER BY rowid LIMIT 20").all<Attempt>()).results;
  for(const attempt of uncertain) {
    const sub=await env.DB.prepare('SELECT * FROM paypay_subscriptions WHERE id=?').bind(attempt.subscription_id).first<Subscription>();
    if(!sub) continue;
    try { await applyResult(env,attempt,sub,await getPayPayPaymentDetails(env,attempt.id)); } catch { /* Leave unresolved; no re-charge. */ }
  }
  const pending=(await env.DB.prepare("SELECT * FROM payment_attempts WHERE status='completed' AND delivery_status='pending' ORDER BY rowid LIMIT 20").all<Attempt>()).results;
  for(const a of pending) {try {await deliver(env,a);}catch{/* Leave visible. */}}
}
function escape(s:string):string {return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
function store(env: Env): Response {
  const terms=new URL(env.SALES_TERMS_URL);if(terms.protocol!=='https:')throw new Error('HTTPS sales terms required');
  const plans=catalog(env), enabled=available(env), liff=JSON.stringify(env.LIFF_ID).replaceAll('<','\\u003c');
  const fields=['name','phone','postalCode','region','city','line1','line2'];
  const labels=['配送先氏名','電話番号','郵便番号','都道府県','市区町村','番地・建物名','部屋番号など（任意）'];
  const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(env.SHOP_TITLE)}</title><style>body{font:16px system-ui;max-width:680px;margin:32px auto;padding:16px;line-height:1.7}label{display:block;margin:12px 0}input{padding:8px}button{padding:12px;margin:8px}#error{color:#a00}</style><h1>${escape(env.SHOP_TITLE)}</h1><p><a href="${escape(terms.href)}" target="_blank" rel="noopener">販売条件・自動更新・解約方法・特商法表記</a></p>${fields.map((f,i)=>`<label>${labels[i]}<input id="${f}" ${f==='line2'?'':'required'}></label>`).join('')}<label><input id="terms" type="checkbox">販売条件と自動更新に同意する</label><p id="error" role="alert"></p>${plans.map(p=>`<article><h2>${escape(p.name)}</h2><p>${p.amount.toLocaleString('ja-JP')}円／${p.billingMonths}か月・期間内${p.deliveryCount}回配送・自動更新</p><button data-plan="${escape(p.id)}" ${enabled?'':'disabled'}>${enabled?'PayPayの認可へ進む':'PayPayは準備中です'}</button></article>`).join('')}<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script><script>
const ready=liff.init({liffId:${liff}});document.querySelectorAll('button[data-plan]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await ready;if(!liff.isLoggedIn()){liff.login();return}if(!document.querySelector('#terms').checked)throw Error('販売条件への同意が必要です');const shipping={country:'JP'};for(const id of ${JSON.stringify(fields)})shipping[id]=document.getElementById(id).value.trim();const r=await fetch('/api/link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId:b.dataset.plan,friendId:new URL(location.href).searchParams.get('friendId'),idToken:liff.getIDToken(),acceptedTerms:true,shipping})});const v=await r.json();if(!r.ok)throw Error(v.error||'認可を開始できませんでした');location.href=v.url}catch(e){document.querySelector('#error').textContent=e.message;b.disabled=false}});
</script></html>`;
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' https://static.line-scdn.net; style-src 'unsafe-inline'; connect-src 'self' https://*.line.me https://*.line-scdn.net; base-uri 'none'; frame-ancestors 'none'"}});
}
async function handle(req: Request, env: Env): Promise<Response> {
  const url=new URL(req.url);
  if(req.method==='GET' && url.pathname==='/health') return json({ok:true,checkoutAvailable:available(env)});
  if(req.method==='GET' && url.pathname==='/store') return store(env);
  if(req.method==='POST' && url.pathname==='/api/link') return link(req,env);
  if(req.method==='GET' && url.pathname==='/callback') return callback(req,env);
  if(req.method==='GET' && url.pathname==='/status') return new Response('お手続きを受け付けました。入金状態と配送予定は運営者が確認できます。決済結果が不明な場合は、再度申し込まずお問い合わせください。',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  if(url.pathname.startsWith('/admin/')) {
    if(!await admin(req,env)) throw new HttpError(401,'Unauthorized');
    if(req.method==='GET' && url.pathname==='/admin/attempts') return json({items:(await env.DB.prepare('SELECT id,subscription_id,status,result_code,delivery_status FROM payment_attempts ORDER BY rowid DESC LIMIT 100').all()).results});
    if(req.method==='GET' && url.pathname==='/admin/subscriptions') return json({items:(await env.DB.prepare('SELECT id,plan_id,status,next_charge_at,paid_through,unlink_pending FROM paypay_subscriptions ORDER BY rowid DESC LIMIT 100').all()).results});
    if(req.method==='POST' && url.pathname==='/admin/reconcile') {await reconcile(env);return json({ok:true});}
    const single=/^\/admin\/attempts\/([^/]+)\/reconcile$/.exec(url.pathname);
    if(req.method==='POST' && single) {
      const a=await env.DB.prepare('SELECT * FROM payment_attempts WHERE id=?').bind(single[1]).first<Attempt>();
      if(!a) throw new HttpError(404,'Attempt not found');
      const s=await env.DB.prepare('SELECT * FROM paypay_subscriptions WHERE id=?').bind(a.subscription_id).first<Subscription>();
      if(!s) throw new HttpError(404,'Subscription not found');
      if(['processing','unknown'].includes(a.status)) await applyResult(env,a,s,await getPayPayPaymentDetails(env,a.id));
      else await deliver(env,a);
      return json({ok:true});
    }
    const m=/^\/admin\/subscriptions\/([^/]+)\/(cancel|charge|retry)$/.exec(url.pathname);
    if(req.method==='POST' && m) {
      if(m[2]==='cancel') return cancel(env,m[1]);
      if(m[2]==='retry') {
        const result=await env.DB.prepare(`UPDATE paypay_subscriptions SET retry_no=retry_no+1
          WHERE id=? AND status='past_due' AND EXISTS(SELECT 1 FROM payment_attempts a WHERE a.subscription_id=paypay_subscriptions.id AND a.period_start=paypay_subscriptions.period_start AND a.retry_no=paypay_subscriptions.retry_no AND a.status='failed')
          AND NOT EXISTS(SELECT 1 FROM payment_attempts WHERE subscription_id=? AND status IN ('processing','unknown'))`).bind(m[1],m[1]).run();
        if(!result.meta.changes) throw new HttpError(409,'Only definitive failures can be retried');
      }
      return json({status:await charge(env,m[1])});
    }
  }
  return json({error:'Not found'},404);
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try{return await handle(req,env);}catch(e){return json({error:e instanceof HttpError?e.message:e instanceof SyntaxError?'Invalid JSON':'Operation unavailable; inspect reconciliation state'},e instanceof HttpError?e.status:e instanceof SyntaxError?400:503);}
  },
  async scheduled(_event: ScheduledEvent,env: Env):Promise<void> {
    await reconcile(env);
    if(!available(env))return;
    const due=(await env.DB.prepare("SELECT id FROM paypay_subscriptions WHERE status IN ('pending','active') AND next_charge_at<=? ORDER BY next_charge_at LIMIT 20").bind(new Date().toISOString()).all<{id:string}>()).results;
    for(const s of due)await charge(env,s.id);
  },
};
