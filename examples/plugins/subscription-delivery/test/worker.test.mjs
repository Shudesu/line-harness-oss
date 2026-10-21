import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

let mf, db;
const token = 'local-test-token-with-at-least-32-characters';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const period = {
  provider: 'test', paymentId: 'paid-1', subscriptionId: 'sub-1', planId: 'tea',
  friendId: 'synthetic-friend', lineAccountId: 'synthetic-account',
  periodStart: '2030-01-01', periodEnd: '2031-01-01', deliveryCount: 2,
  shipping: { name: '=1+1', phone: '0000000000', postalCode: '0000000', region: 'Test', city: 'Test', line1: 'Test, "Street"', country: 'JP' },
};
const request = (path, method = 'GET', body) => mf.dispatchFetch(`http://plugin.test${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
before(async () => {
  const built = await build({ entryPoints: ['src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  mf = new Miniflare({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-07-30', d1Databases: ['DB'], bindings: { DELIVERY_API_TOKEN: token } });
  db = await mf.getD1Database('DB');
  const sql = (await readFile('schema.sql', 'utf8')).replace(/^--.*$/gm, '');
  for (const statement of sql.split(';').filter(s => s.trim())) await db.prepare(statement).run();
});
after(async () => { await mf?.dispose(); });
test('requires authorization and rejects invalid calendar dates before writes', async () => {
  assert.equal((await mf.dispatchFetch('http://plugin.test/api/orders')).status, 401);
  assert.equal((await request('/api/slots', 'POST', { id: 'bad', planId: 'tea', arrivalDate: '2030-02-30', shippingDate: '2030-02-01' })).status, 400);
  assert.equal((await request('/api/periods', 'POST', { ...period, periodEnd: period.periodStart })).status, 400);
});
test('records payment without partial fulfillment, then recovers without charging', async () => {
  await request('/api/slots', 'POST', { id: 'spring', planId: 'tea', arrivalDate: '2030-04-01', shippingDate: '2030-03-28' });
  assert.equal((await request('/api/periods', 'POST', period)).status, 202);
  assert.equal((await (await request('/api/orders')).json()).items.length, 0);
  assert.equal((await (await request('/api/blocked')).json()).items.length, 1);
  await request('/api/slots', 'POST', { id: 'autumn', planId: 'tea', arrivalDate: '2030-10-01', shippingDate: '2030-09-28' });
  await request('/api/reconcile', 'POST');
  assert.equal((await (await request('/api/orders')).json()).items.length, 2);
  assert.equal((await (await request('/api/blocked')).json()).items.length, 0);
});
test('parallel retries create exactly two orders and conflicting payments are rejected', async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, () => request('/api/periods', 'POST', period)));
  assert.ok(responses.every(r => r.status === 200));
  assert.equal((await (await request('/api/orders')).json()).items.length, 2);
  assert.equal((await request('/api/periods', 'POST', { ...period, shipping: { ...period.shipping, name: 'changed' } })).status, 409);
  assert.equal((await request('/api/periods', 'POST', { ...period, paymentId: 'another-payment-for-same-period' })).status, 409);
});
test('CSV escapes formulas, quotes and commas; shipping transitions use compare-and-set', async () => {
  const csv = await (await request('/api/orders.csv')).text();
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"Test, ""Street"""'));
  const order = (await (await request('/api/orders')).json()).items[0];
  assert.equal((await request(`/api/orders/${order.id}`, 'PATCH', { status: 'delivered' })).status, 409);
  assert.equal((await request(`/api/orders/${order.id}`, 'PATCH', { status: 'preparing' })).status, 200);
  assert.equal((await request(`/api/orders/${order.id}`, 'PATCH', { status: 'shipped', trackingNumber: 'TEST' })).status, 200);
  assert.equal((await request(`/api/orders/${order.id}`, 'PATCH', { status: 'canceled' })).status, 409);
  // A retry never rewrites an already-shipped snapshot.
  await request('/api/periods', 'POST', period);
  assert.equal((await (await request('/api/orders')).json()).items.find(o => o.id === order.id).status, 'shipped');
});
test('billing boundaries exclude next year and allow delivery counts other than 1/2/4', async () => {
  for (let i = 1; i <= 3; i++) await request('/api/slots', 'POST', { id: `monthly-${i}`, planId: 'rice', arrivalDate: `2030-0${i}-15`, shippingDate: `2030-0${i}-12` });
  await request('/api/slots', 'POST', { id: 'next-year', planId: 'rice', arrivalDate: '2031-01-01', shippingDate: '2030-12-28' });
  const p = { ...period, paymentId: 'rice-paid', subscriptionId: 'rice-sub', planId: 'rice', deliveryCount: 3 };
  assert.equal((await request('/api/periods', 'POST', p)).status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM delivery_orders o JOIN paid_periods p ON p.id = o.period_id WHERE p.plan_id = 'rice'").first()).count, 3);
  assert.equal((await request('/api/slots', 'POST', { id: 'monthly-1', planId: 'rice', arrivalDate: '2030-01-16', shippingDate: '2030-01-12' })).status, 409);
});
test('D1 rolls back the whole order batch if one insert fails, preserving recoverable payment', async () => {
  for (const month of ['03','09']) await request('/api/slots', 'POST', { id: `atomic-${month}`, planId: 'atomic', arrivalDate: `2030-${month}-01`, shippingDate: `2030-${month}-01` });
  await db.prepare("CREATE TRIGGER reject_test_order BEFORE INSERT ON delivery_orders WHEN NEW.slot_id = 'atomic-09' BEGIN SELECT RAISE(ABORT, 'synthetic DB failure'); END").run();
  const p = { ...period, paymentId: 'atomic-payment', subscriptionId: 'atomic-sub', planId: 'atomic' };
  assert.equal((await request('/api/periods', 'POST', p)).status, 500);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM delivery_orders WHERE slot_id LIKE 'atomic-%'").first()).n, 0);
  await db.prepare('DROP TRIGGER reject_test_order').run();
  assert.equal((await request('/api/periods', 'POST', p)).status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM delivery_orders WHERE slot_id LIKE 'atomic-%'").first()).n, 2);
});
