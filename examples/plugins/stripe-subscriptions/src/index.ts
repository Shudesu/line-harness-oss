// Checkout and invoice fulfillment extracted from the existing subscription
// workflow. All business data belongs to this plugin, outside the CRM schema.
export interface Env {
  DB: D1Database; PUBLIC_URL: string; LINE_HARNESS_URL: string; LINE_HARNESS_API_KEY: string;
  LINE_ACCOUNT_ID: string; LINE_LOGIN_CHANNEL_ID: string; LIFF_ID: string;
  DELIVERY_URL: string; DELIVERY_API_TOKEN: string; PLUGIN_ADMIN_TOKEN: string;
  STRIPE_SECRET_KEY: string; STRIPE_WEBHOOK_SECRET: string;
  CATALOG_JSON: string; SHOP_TITLE: string; SALES_TERMS_URL: string; PAID_TAG_ID?: string;
}
type Plan = { id: string; name: string; stripePriceId: string; amount: number; interval: 'month' | 'year'; deliveryCount: number };
type Purchase = { id: string; friend_id: string; plan_id: string; plan: string; status: string; subscription_id: string | null; session_id: string | null; url: string | null; created_at: string };
type Job = { id: string; type: string; object_id: string; payload: string | null };
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
type ObjectData = Record<string, any>;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function origin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Configure HTTPS origins without paths');
  return url.origin;
}
function catalog(env: Env): Plan[] {
  const plans = JSON.parse(env.CATALOG_JSON) as Plan[];
  if (!Array.isArray(plans) || !plans.length || plans.length > 50) throw new Error('Invalid catalog');
  for (const p of plans) if (!p.id || !p.name || !p.stripePriceId?.startsWith('price_') || !Number.isSafeInteger(p.amount) || p.amount < 1 || !['month','year'].includes(p.interval) || !Number.isSafeInteger(p.deliveryCount) || p.deliveryCount < 1 || p.deliveryCount > 366) throw new Error('Invalid plan');
  if (new Set(plans.map(p => p.id)).size !== plans.length) throw new Error('Duplicate plans');
  return plans;
}
async function stripe(env: Env, path: string, body?: URLSearchParams, key?: string): Promise<ObjectData> {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Stripe secret is required');
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? 'POST' : 'GET', headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2024-06-20',
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    }, body,
  });
  if (!res.ok) throw new Error('Stripe API unavailable');
  return res.json();
}
async function harness(env: Env, path: string, body?: unknown): Promise<ObjectData> {
  if (!env.LINE_HARNESS_API_KEY) throw new Error('L Harness API key is required');
  const res = await fetch(`${origin(env.LINE_HARNESS_URL)}${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${env.LINE_HARNESS_API_KEY}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error('L Harness API unavailable');
  const result = await res.json() as ObjectData;
  if (!result.success) throw new Error('L Harness operation failed');
  return result;
}
async function verifyBuyer(env: Env, input: ObjectData): Promise<string> {
  if (typeof input.idToken !== 'string' || !input.idToken || typeof input.friendId !== 'string' || !input.friendId || input.friendId.length > 255) throw new HttpError(401, 'LINE login required');
  const verified = await fetch('https://api.line.me/oauth2/v2.1/verify', { method: 'POST', body: new URLSearchParams({ id_token: input.idToken, client_id: env.LINE_LOGIN_CHANNEL_ID }) });
  if (!verified.ok) throw new HttpError(401, 'LINE login expired');
  const claims = await verified.json() as ObjectData;
  if (typeof claims.sub !== 'string' || claims.aud !== env.LINE_LOGIN_CHANNEL_ID || claims.iss !== 'https://access.line.me' || typeof claims.exp !== 'number' || claims.exp <= Date.now()/1000) throw new HttpError(401, 'Invalid LINE identity');
  const { data: friend } = await harness(env, `/api/friends/${encodeURIComponent(input.friendId)}`);
  if (friend?.lineUserId !== claims.sub || friend?.lineAccountId !== env.LINE_ACCOUNT_ID) throw new HttpError(403, 'Friend or LINE account does not match');
  return input.friendId;
}
async function checkout(env: Env, input: ObjectData): Promise<Response> {
  const friendId = await verifyBuyer(env, input);
  const plan = catalog(env).find(p => p.id === input.planId);
  if (!plan) throw new HttpError(404, 'Plan not found');
  const proposedId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO purchases (id, friend_id, plan_id, plan) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(proposedId, friendId, plan.id, JSON.stringify(plan)).run();
  const purchase = await env.DB.prepare("SELECT * FROM purchases WHERE friend_id = ? AND plan_id = ? AND status IN ('pending','active')")
    .bind(friendId, plan.id).first<Purchase>();
  if (!purchase) throw new Error('Purchase reservation failed');
  if (purchase.status === 'active') throw new HttpError(409, 'An active subscription already exists');
  if (purchase.url) return json({ url: purchase.url, purchaseId: purchase.id });
  if (Date.now() - Date.parse(purchase.created_at) > 23 * 3600000) throw new HttpError(409, 'Checkout result is unresolved; operator must reconcile before starting another');
  const saved = JSON.parse(purchase.plan) as Plan;
  const price = await stripe(env, `prices/${encodeURIComponent(saved.stripePriceId)}`);
  if (!price.active || price.currency !== 'jpy' || price.unit_amount !== saved.amount || price.recurring?.interval !== saved.interval || price.recurring?.interval_count !== 1) throw new HttpError(503, 'Stripe price and displayed plan do not match');
  const publicOrigin = origin(env.PUBLIC_URL);
  const params = new URLSearchParams({ mode: 'subscription', 'payment_method_types[0]': 'card',
    'line_items[0][price]': saved.stripePriceId, 'line_items[0][quantity]': '1',
    success_url: `${publicOrigin}/success`, cancel_url: `${publicOrigin}/cancel`,
    'shipping_address_collection[allowed_countries][0]': 'JP', 'phone_number_collection[enabled]': 'true',
    client_reference_id: purchase.id, 'metadata[purchase_id]': purchase.id,
    'subscription_data[metadata][purchase_id]': purchase.id,
  });
  const session = await stripe(env, 'checkout/sessions', params, `checkout-${purchase.id}`);
  if (typeof session.id !== 'string' || typeof session.url !== 'string' || new URL(session.url).origin !== 'https://checkout.stripe.com') throw new Error('Stripe returned an invalid checkout session');
  await env.DB.prepare('UPDATE purchases SET session_id = ?, url = ? WHERE id = ?').bind(session.id, session.url, purchase.id).run();
  return json({ url: session.url, purchaseId: purchase.id });
}
async function validStripeSignature(raw: string, header: string, secret: string): Promise<boolean> {
  if (!secret) return false;
  const parts = header.split(',').map(p => p.trim().split('='));
  const timestamps = parts.filter(p => p[0] === 't');
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0][1])) return false;
  const time = Number(timestamps[0][1]);
  if (Math.abs(Date.now()/1000 - time) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  for (const [name, hex] of parts) {
    if (name !== 'v1' || !/^[0-9a-f]{64}$/.test(hex ?? '')) continue;
    const sig = Uint8Array.from(hex.match(/../g)!, b => parseInt(b,16));
    if (await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`${time}.${raw}`))) return true;
  }
  return false;
}
const idOf = (v: unknown): string | null => typeof v === 'string' ? v : (v && typeof v === 'object' && typeof (v as ObjectData).id === 'string' ? (v as ObjectData).id : null);
function subscriptionId(invoice: ObjectData): string | null {
  return idOf(invoice.subscription) ?? idOf(invoice.subscription_details?.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription);
}
function shipping(session: ObjectData): ObjectData {
  const s = session.shipping_details ?? session.collected_information?.shipping_details, c = session.customer_details;
  const a = s?.address;
  if (!s?.name || !c?.phone || !a?.postal_code || !a?.state || !a?.city || !a?.line1 || !a?.country) throw new Error('Checkout shipping information is not available yet');
  return { name: s.name, phone: c.phone, postalCode: a.postal_code, region: a.state, city: a.city, line1: a.line1, line2: a.line2 ?? '', country: a.country };
}
async function paidPayload(env: Env, invoiceId: string): Promise<ObjectData | null> {
  const invoice = await stripe(env, `invoices/${encodeURIComponent(invoiceId)}`);
  if (invoice.status !== 'paid' || invoice.paid !== true) throw new Error('Invoice is not paid');
  const subId = subscriptionId(invoice);
  if (!subId) return null;
  const sub = await stripe(env, `subscriptions/${encodeURIComponent(subId)}`);
  const purchaseId = sub.metadata?.purchase_id;
  if (!purchaseId) return null; // Invoice belongs to another application.
  const purchase = await env.DB.prepare('SELECT * FROM purchases WHERE id = ?').bind(purchaseId).first<Purchase>();
  if (!purchase) throw new Error('Missing local checkout reservation');
  const plan = JSON.parse(purchase.plan) as Plan;
  // Use the paid invoice's period, not the current (possibly later) subscription period.
  const lines = (invoice.lines?.data ?? []).filter((l: ObjectData) => l.type === 'subscription' && !l.proration && idOf(l.price) === plan.stripePriceId);
  if (invoice.lines?.has_more || lines.length !== 1 || invoice.currency !== 'jpy' || invoice.amount_paid !== plan.amount) throw new Error('Invoice is not the configured full-price recurring period; operator review required');
  const { start, end } = lines[0].period ?? {};
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) throw new Error('Missing invoice billing period');
  const sessions = await stripe(env, `checkout/sessions?subscription=${encodeURIComponent(subId)}&limit=1`);
  const session = sessions.data?.[0];
  if (!session || session.id !== purchase.session_id || session.metadata?.purchase_id !== purchase.id) throw new Error('Checkout session does not match');
  await env.DB.prepare('UPDATE purchases SET status = ?, subscription_id = ? WHERE id = ?')
    .bind(sub.status === 'canceled' ? 'canceled' : 'active', subId, purchase.id).run();
  return { provider: 'stripe', paymentId: invoice.id, subscriptionId: subId,
    planId: purchase.plan_id, friendId: purchase.friend_id, lineAccountId: env.LINE_ACCOUNT_ID,
    periodStart: new Date(start*1000).toISOString().slice(0,10), periodEnd: new Date(end*1000).toISOString().slice(0,10),
    deliveryCount: plan.deliveryCount, shipping: shipping(session),
  };
}
export async function processJob(env: Env, job: Job): Promise<void> {
  try {
    if (job.type === 'invoice.paid') {
      const payload = job.payload ? JSON.parse(job.payload) : await paidPayload(env, job.object_id);
      if (payload) {
        // Persist the exact paid-period snapshot for all retries.
        await env.DB.prepare('UPDATE stripe_jobs SET payload = COALESCE(payload, ?) WHERE id = ?').bind(JSON.stringify(payload), job.id).run();
        const response = await fetch(`${origin(env.DELIVERY_URL)}/api/periods`, {
          method: 'POST', headers: { Authorization: `Bearer ${env.DELIVERY_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (response.status !== 200 || (await response.json() as ObjectData).status !== 'ready') throw new Error('Delivery not ready; add calendar slots and retry this job');
        if (env.PAID_TAG_ID) await harness(env, `/api/friends/${encodeURIComponent(payload.friendId)}/tags`, { tagId: env.PAID_TAG_ID });
      }
    } else {
      const sub = await stripe(env, `subscriptions/${encodeURIComponent(job.object_id)}`);
      if (sub.metadata?.purchase_id) await env.DB.prepare('UPDATE purchases SET status = ?, subscription_id = ? WHERE id = ?')
        .bind(sub.status === 'canceled' ? 'canceled' : 'active', sub.id, sub.metadata.purchase_id).run();
    }
    await env.DB.prepare("UPDATE stripe_jobs SET status = 'done', error = NULL WHERE id = ?").bind(job.id).run();
  } catch {
    await env.DB.prepare('UPDATE stripe_jobs SET attempts = attempts + 1, error = ? WHERE id = ?')
      .bind('Provider, address, invoice or delivery needs reconciliation; retry after checking configuration', job.id).run();
    throw new Error('Job pending; retry or run reconciliation');
  }
}
async function reconcile(env: Env): Promise<void> {
  const jobs = (await env.DB.prepare("SELECT * FROM stripe_jobs WHERE status = 'pending' ORDER BY attempts, rowid LIMIT 20").all<Job>()).results;
  for (const job of jobs) { try { await processJob(env, job); } catch { /* Remains visible and retryable. */ } }
}
function escape(value: string): string { return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
function store(env: Env): Response {
  const plans = catalog(env);
  const terms = new URL(env.SALES_TERMS_URL);
  if (terms.protocol !== 'https:') throw new Error('Configure HTTPS sales terms');
  const cards = plans.map(p => `<article><h2>${escape(p.name)}</h2><p>${p.amount.toLocaleString('ja-JP')}円／${p.interval === 'year' ? '年' : '月'}・期間内${p.deliveryCount}回配送・自動更新</p><button data-plan="${escape(p.id)}">カードで申し込む</button></article>`).join('');
  const liffId = JSON.stringify(env.LIFF_ID).replaceAll('<','\\u003c');
  return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(env.SHOP_TITLE)}</title><style>body{font:16px system-ui;max-width:760px;margin:32px auto;padding:16px;line-height:1.7}article{padding:20px;margin:16px 0;border:1px solid #ccc;border-radius:12px}button{padding:12px;font:inherit;cursor:pointer}#error{color:#a00}</style><h1>${escape(env.SHOP_TITLE)}</h1><p>配送先はStripeの決済画面で入力します。</p><p><a href="${escape(terms.href)}" target="_blank" rel="noopener">販売条件・解約方法・特定商取引法の表示</a></p><label><input id="terms" type="checkbox">販売条件と自動更新に同意する</label><p id="error" role="alert"></p>${cards}<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script><script>
const ready=liff.init({liffId:${liffId}});
document.querySelectorAll('button[data-plan]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await ready;if(!liff.isLoggedIn()){liff.login();return}if(!document.querySelector('#terms').checked)throw Error('販売条件への同意が必要です');const r=await fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId:b.dataset.plan,friendId:new URL(location.href).searchParams.get('friendId'),idToken:liff.getIDToken(),acceptedTerms:true})});const v=await r.json();if(!r.ok)throw Error(v.error||'お申し込みを開始できませんでした');location.href=v.url}catch(e){document.querySelector('#error').textContent=e.message;b.disabled=false}});
</script></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.line-scdn.net; style-src 'unsafe-inline'; connect-src 'self' https://*.line.me https://*.line-scdn.net; frame-ancestors 'none'; base-uri 'none'", 'Referrer-Policy': 'no-referrer' } });
}
async function admin(req: Request, env: Env): Promise<boolean> {
  if (!env.PLUGIN_ADMIN_TOKEN || env.PLUGIN_ADMIN_TOKEN.length < 32) return false;
  const digest = (s: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const a = new Uint8Array(await digest(req.headers.get('Authorization') ?? '')), b = new Uint8Array(await digest(`Bearer ${env.PLUGIN_ADMIN_TOKEN}`));
  return a.every((v,i) => v === b[i]);
}
async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') return json({ ok: true });
  if (req.method === 'GET' && url.pathname === '/store') return store(env);
  if (req.method === 'GET' && ['/success','/cancel'].includes(url.pathname)) return new Response(url.pathname === '/success' ? 'お申し込みを受け付けました。入金の確認後に配送予定を登録します。' : '購入手続きを中断しました。既存の定期契約の解約は販売条件をご確認ください。', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (req.method === 'POST' && url.pathname === '/api/checkout') {
    if (req.headers.get('Origin') && req.headers.get('Origin') !== origin(env.PUBLIC_URL)) throw new HttpError(403, 'Origin does not match');
    const body = await req.json() as ObjectData;
    if (body.acceptedTerms !== true) throw new HttpError(400, 'Sales terms must be accepted');
    return checkout(env, body);
  }
  if (req.method === 'POST' && url.pathname === '/webhooks/stripe') {
    if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'Webhook secret is required');
    const raw = await req.text();
    if (!await validStripeSignature(raw, req.headers.get('Stripe-Signature') ?? '', env.STRIPE_WEBHOOK_SECRET)) throw new HttpError(401, 'Invalid Stripe signature');
    const event = JSON.parse(raw) as ObjectData;
    if (!['invoice.paid','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)) return json({ received: true });
    if (typeof event.id !== 'string' || typeof event.data?.object?.id !== 'string') throw new HttpError(400, 'Invalid event');
    await env.DB.prepare('INSERT INTO stripe_jobs (id, type, object_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(event.id, event.type, event.data.object.id).run();
    const job = await env.DB.prepare("SELECT * FROM stripe_jobs WHERE id = ? AND status = 'pending'").bind(event.id).first<Job>();
    if (job) await processJob(env, job);
    return json({ received: true });
  }
  if (url.pathname.startsWith('/admin/')) {
    if (!await admin(req, env)) throw new HttpError(401, 'Unauthorized');
    if (req.method === 'POST' && url.pathname === '/admin/reconcile') { await reconcile(env); return json({ ok: true }); }
    if (req.method === 'GET' && url.pathname === '/admin/jobs') return json({ items: (await env.DB.prepare('SELECT id, type, status, attempts, error FROM stripe_jobs ORDER BY rowid DESC LIMIT 100').all()).results });
    const release = /^\/admin\/purchases\/([^/]+)\/release$/.exec(url.pathname);
    if (req.method === 'POST' && release) {
      const p = await env.DB.prepare("SELECT * FROM purchases WHERE id = ? AND status = 'pending'").bind(release[1]).first<Purchase>();
      if (!p?.session_id) throw new HttpError(409, 'Retry checkout first to recover its session ID');
      let session = await stripe(env, `checkout/sessions/${encodeURIComponent(p.session_id)}`);
      if (session.status === 'open') session = await stripe(env, `checkout/sessions/${encodeURIComponent(p.session_id)}/expire`, new URLSearchParams());
      if (session.status !== 'expired') throw new HttpError(409, 'Checkout is complete; reconcile the subscription');
      await env.DB.prepare("UPDATE purchases SET status = 'canceled' WHERE id = ? AND status = 'pending'").bind(p.id).run();
      return json({ ok: true });
    }
  }
  return json({ error: 'Not found' }, 404);
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try { return await handle(req, env); }
    catch (e) { return json({ error: e instanceof HttpError ? e.message : e instanceof SyntaxError ? 'Invalid JSON' : 'Operation pending or unavailable; retry or contact the operator' }, e instanceof HttpError ? e.status : e instanceof SyntaxError ? 400 : 503); }
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> { await reconcile(env); },
};
