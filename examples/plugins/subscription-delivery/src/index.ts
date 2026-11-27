// Extracted from the subscription delivery workflow; calendar rules are now
// explicit per plan, with no product names, season assumptions or CRM D1 access.
export interface Env { DB: D1Database; DELIVERY_API_TOKEN?: string }
type Shipping = { name: string; phone: string; postalCode: string; region: string; city: string; line1: string; line2?: string; country: string };
type PaidPeriod = {
  provider: string; paymentId: string; subscriptionId: string; planId: string;
  friendId: string; lineAccountId: string; periodStart: string; periodEnd: string;
  deliveryCount: number; shipping: Shipping;
};
type PeriodRow = { id: string; plan_id: string; period_start: string; period_end: string; delivery_count: number; shipping: string; status: string; payload: string };
type Slot = { id: string; arrival_date: string; shipping_date: string };
class InputError extends Error {}
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function text(value: unknown, name: string, max = 255): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(`Invalid ${name}`);
  return value.trim();
}
function date(value: unknown, name: string): string {
  const str = text(value, name, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || !Number.isFinite(Date.parse(str)) || new Date(str).toISOString().slice(0, 10) !== str) throw new InputError(`Invalid ${name}`);
  return str;
}
function normalize(value: unknown): PaidPeriod {
  if (!value || typeof value !== 'object') throw new InputError('Expected paid period');
  const b = value as Record<string, unknown>;
  const s = b.shipping as Record<string, unknown> | undefined;
  if (!s || typeof s !== 'object') throw new InputError('Shipping is required');
  const periodStart = date(b.periodStart, 'periodStart'), periodEnd = date(b.periodEnd, 'periodEnd');
  if (periodEnd <= periodStart || Date.parse(periodEnd) - Date.parse(periodStart) > 367 * 86400000) throw new InputError('Period must be positive and at most 367 days');
  if (!Number.isInteger(b.deliveryCount) || Number(b.deliveryCount) < 1 || Number(b.deliveryCount) > 366) throw new InputError('Invalid deliveryCount');
  return {
    provider: text(b.provider, 'provider', 40), paymentId: text(b.paymentId, 'paymentId'),
    subscriptionId: text(b.subscriptionId, 'subscriptionId'), planId: text(b.planId, 'planId'),
    friendId: text(b.friendId, 'friendId'), lineAccountId: text(b.lineAccountId, 'lineAccountId'),
    periodStart, periodEnd, deliveryCount: Number(b.deliveryCount),
    shipping: {
      name: text(s.name, 'shipping.name'), phone: text(s.phone, 'shipping.phone', 40),
      postalCode: text(s.postalCode, 'shipping.postalCode', 40), region: text(s.region, 'shipping.region'),
      city: text(s.city, 'shipping.city'), line1: text(s.line1, 'shipping.line1'),
      line2: s.line2 ? text(s.line2, 'shipping.line2') : '', country: text(s.country, 'shipping.country', 2),
    },
  };
}
async function authorized(req: Request, token?: string): Promise<boolean> {
  if (!token || token.length < 32) return false;
  const expected = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`Bearer ${token}`));
  const actual = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(req.headers.get('Authorization') ?? ''));
  return new Uint8Array(expected).every((v, i) => v === new Uint8Array(actual)[i]);
}
export async function materialize(db: D1Database, row: PeriodRow): Promise<boolean> {
  if (row.status === 'ready') return true;
  const slots = (await db.prepare(`SELECT id, arrival_date, shipping_date FROM delivery_slots
    WHERE plan_id = ? AND arrival_date >= ? AND arrival_date < ? ORDER BY arrival_date`)
    .bind(row.plan_id, row.period_start, row.period_end).all<Slot>()).results;
  // Validate the whole paid period before any order write. Reconciliation only
  // creates missing orders; it never invokes a payment provider.
  if (slots.length !== row.delivery_count) {
    await db.prepare(`UPDATE paid_periods SET error = ? WHERE id = ? AND status = 'blocked'`)
      .bind(`Expected ${row.delivery_count} delivery slots; found ${slots.length}`, row.id).run();
    return false;
  }
  await db.batch([
    ...slots.map(s => db.prepare(`INSERT INTO delivery_orders
      (id, period_id, slot_id, arrival_date, shipping_date, shipping) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(period_id, slot_id) DO NOTHING`)
      .bind(crypto.randomUUID(), row.id, s.id, s.arrival_date, s.shipping_date, row.shipping)),
    db.prepare(`UPDATE paid_periods SET status = 'ready', error = NULL WHERE id = ?`).bind(row.id),
  ]);
  return true;
}
async function acceptPeriod(db: D1Database, input: PaidPeriod): Promise<Response> {
  const payload = JSON.stringify(input);
  await db.prepare(`INSERT INTO paid_periods
    (id, provider, payment_id, subscription_id, plan_id, friend_id, line_account_id,
     period_start, period_end, delivery_count, shipping, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
    .bind(crypto.randomUUID(), input.provider, input.paymentId, input.subscriptionId, input.planId,
      input.friendId, input.lineAccountId, input.periodStart, input.periodEnd, input.deliveryCount,
      JSON.stringify(input.shipping), payload).run();
  const row = await db.prepare(`SELECT * FROM paid_periods WHERE provider = ? AND payment_id = ?`)
    .bind(input.provider, input.paymentId).first<PeriodRow>();
  if (!row || row.payload !== payload) return json({ error: 'Conflicting payment or subscription period; reconcile with the provider' }, 409);
  const ready = await materialize(db, row);
  return json({ id: row.id, status: ready ? 'ready' : 'blocked' }, ready ? 200 : 202);
}
export async function reconcile(env: Env): Promise<void> {
  const blocked = (await env.DB.prepare(`SELECT * FROM paid_periods WHERE status = 'blocked' ORDER BY rowid LIMIT 100`).all<PeriodRow>()).results;
  for (const row of blocked) await materialize(env.DB, row);
  await env.DB.prepare(`UPDATE delivery_orders SET status = 'preparing'
    WHERE status = 'scheduled' AND shipping_date <= ?`).bind(new Date().toISOString().slice(0, 10)).run();
}
function csvCell(value: unknown): string {
  let str = String(value ?? '');
  // Quote CSV syntax and neutralize spreadsheet formulas, including leading whitespace.
  if (/^[\s]*[=+@-]/.test(str) || /^[\t\r\n]/.test(str)) str = `'${str}`;
  return `"${str.replaceAll('"', '""')}"`;
}
async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === '/health' && req.method === 'GET') return json({ ok: true });
  if (!env.DELIVERY_API_TOKEN || env.DELIVERY_API_TOKEN.length < 32) return json({ error: 'Configure a token of at least 32 characters' }, 503);
  if (!await authorized(req, env.DELIVERY_API_TOKEN)) return json({ error: 'Unauthorized' }, 401);
  if (req.method === 'POST' && url.pathname === '/api/periods') return acceptPeriod(env.DB, normalize(await req.json()));
  if (req.method === 'POST' && url.pathname === '/api/slots') {
    const b = await req.json() as Record<string, unknown>;
    const id = text(b.id, 'id'), plan = text(b.planId, 'planId');
    const arrival = date(b.arrivalDate, 'arrivalDate'), shipping = date(b.shippingDate, 'shippingDate');
    if (shipping > arrival) throw new InputError('Shipping must precede arrival');
    const existing = await env.DB.prepare('SELECT * FROM delivery_slots WHERE id = ?').bind(id).first<{ plan_id: string; arrival_date: string; shipping_date: string }>();
    if (existing && (existing.plan_id !== plan || existing.arrival_date !== arrival || existing.shipping_date !== shipping)) return json({ error: 'Slots are immutable; use a new ID after reconciling any paid periods' }, 409);
    const conflict = await env.DB.prepare('SELECT id FROM delivery_slots WHERE plan_id = ? AND arrival_date = ?').bind(plan, arrival).first<{ id: string }>();
    if (conflict && conflict.id !== id) return json({ error: 'A slot already exists for this plan and date' }, 409);
    await env.DB.prepare('INSERT INTO delivery_slots (id, plan_id, arrival_date, shipping_date) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .bind(id, plan, arrival, shipping).run();
    return json({ id });
  }
  if (req.method === 'POST' && url.pathname === '/api/reconcile') { await reconcile(env); return json({ ok: true }); }
  if (req.method === 'GET' && url.pathname === '/api/blocked') {
    const result = await env.DB.prepare(`SELECT id, provider, payment_id, plan_id, period_start, period_end, error FROM paid_periods WHERE status = 'blocked' ORDER BY rowid LIMIT 100`).all();
    return json({ items: result.results });
  }
  if (req.method === 'GET' && ['/api/orders', '/api/orders.csv'].includes(url.pathname)) {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new InputError('Invalid offset');
    const rows = (await env.DB.prepare(`SELECT o.*, p.plan_id, p.friend_id, p.line_account_id FROM delivery_orders o
      JOIN paid_periods p ON p.id = o.period_id ORDER BY o.arrival_date, o.id LIMIT 1001 OFFSET ?`).bind(offset).all()).results;
    const hasMore = rows.length > 1000, items = rows.slice(0, 1000);
    if (url.pathname === '/api/orders') return json({ items, hasMore, nextOffset: hasMore ? offset + 1000 : null });
    if (hasMore) return json({ error: 'More than 1000 orders; use paginated /api/orders to export all rows' }, 409);
    const cols = ['id', 'plan_id', 'arrival_date', 'shipping_date', 'status', 'tracking_number', 'name', 'phone', 'postalCode', 'region', 'city', 'line1', 'line2', 'country'];
    const lines = items.map(r => { const shipping = JSON.parse(String(r.shipping)); return cols.map(k => csvCell(k in r ? r[k] : shipping[k])).join(','); });
    return new Response('\uFEFF' + [cols.join(','), ...lines].join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="delivery-orders.csv"', 'Cache-Control': 'no-store' } });
  }
  const match = /^\/api\/orders\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'PATCH' && match) {
    const b = await req.json() as { status?: string; trackingNumber?: string };
    const next: Record<string, string[]> = { scheduled: ['preparing', 'canceled'], preparing: ['shipped', 'canceled'], shipped: ['delivered'], delivered: [], canceled: [] };
    const row = await env.DB.prepare('SELECT status FROM delivery_orders WHERE id = ?').bind(match[1]).first<{ status: string }>();
    if (!row) return json({ error: 'Not found' }, 404);
    if (!b.status || !next[row.status]?.includes(b.status)) return json({ error: 'Invalid status transition' }, 409);
    const tracking = b.trackingNumber ? text(b.trackingNumber, 'trackingNumber') : null;
    const result = await env.DB.prepare('UPDATE delivery_orders SET status = ?, tracking_number = COALESCE(?, tracking_number) WHERE id = ? AND status = ?')
      .bind(b.status, tracking, match[1], row.status).run();
    return json({ ok: result.meta.changes === 1 }, result.meta.changes === 1 ? 200 : 409);
  }
  return json({ error: 'Not found' }, 404);
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try { return await handle(req, env); }
    catch (e) { return json({ error: e instanceof InputError || e instanceof SyntaxError ? e.message : 'Delivery operation failed; retry or inspect blocked periods' }, e instanceof InputError || e instanceof SyntaxError ? 400 : 500); }
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> { await reconcile(env); },
};
