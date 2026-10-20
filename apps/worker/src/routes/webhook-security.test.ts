import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getStaffByApiKey: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getLineAccountById: vi.fn(),
  getStripeEvents: vi.fn(),
  getStripeEventByStripeId: vi.fn(),
  createStripeEvent: vi.fn(),
  addTagToFriend: vi.fn(),
  applyScoring: vi.fn(),
  awardActivityMileage: vi.fn(),
  fireEvent: vi.fn(),
  dispatchLineProxyLocally: vi.fn(),
}));

vi.mock('@line-crm/db', () => mocks);
vi.mock('../services/activity-mileage.js', () => ({ awardActivityMileage: mocks.awardActivityMileage }));
vi.mock('../services/event-bus.js', () => ({ fireEvent: mocks.fireEvent }));
vi.mock('../services/local-line-proxy.js', () => ({
  dispatchLineProxyLocally: mocks.dispatchLineProxyLocally,
}));

import { authMiddleware } from '../middleware/auth.js';
import { meetCallback } from './meet-callback.js';
import { stripe } from './stripe.js';

const secret = 'test-webhook-secret';
const timestamp = 1_750_000_000;
const meetBody = JSON.stringify({
  session_id: 'session-1',
  scenario_id: 'scenario-1',
  line_user_id: `U${'1'.repeat(32)}`,
  status: 'completed',
  transcripts: [{ question_text: '希望は？', transcript: '相談したいです' }],
  completed_at: '2025-06-15T15:06:40Z',
});
const stripeBody = JSON.stringify({
  id: 'evt_purchase',
  type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_1', amount: 1000, metadata: { line_friend_id: 'friend-1', product_id: 'demo' } } },
});
const endpoints = [
  { name: 'Meet', path: '/api/meet-callback', header: 'X-Meet-Signature', binding: 'MEET_CALLBACK_SECRET', body: meetBody },
  { name: 'Stripe', path: '/api/integrations/stripe/webhook', header: 'Stripe-Signature', binding: 'STRIPE_WEBHOOK_SECRET', body: stripeBody },
] as const;

function signature(body: string, time = timestamp, signingSecret = secret): string {
  const digest = createHmac('sha256', signingSecret).update(`${time}.${body}`).digest('hex');
  return `t=${time},v1=${digest}`;
}

function fixture() {
  const run = vi.fn(async () => ({ success: true }));
  const first = vi.fn(async () => ({ id: 'tag-1' }));
  const bind = vi.fn((..._values: unknown[]) => ({ run, first }));
  const prepare = vi.fn(() => ({ bind, first }));
  const env = {
    DB: { prepare },
    LINE_CHANNEL_ACCESS_TOKEN: 'default-token',
    WORKER_URL: 'https://worker.example.test',
    MEET_CALLBACK_SECRET: secret,
    STRIPE_WEBHOOK_SECRET: secret,
  } as unknown as Env['Bindings'];
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', meetCallback);
  app.route('/', stripe);
  return { app, env, prepare, bind, run };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(timestamp * 1000);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected external request'); }));
  mocks.getFriendByLineUserId.mockResolvedValue({
    id: 'friend-1',
    line_user_id: `U${'1'.repeat(32)}`,
    line_account_id: 'account-1',
    metadata: '{"existing":true}',
  });
  mocks.getLineAccountById.mockResolvedValue({ channel_access_token: 'account-token' });
  mocks.dispatchLineProxyLocally.mockResolvedValue(new Response('{}', { status: 200 }));
  mocks.getStripeEventByStripeId.mockResolvedValue(null);
  mocks.createStripeEvent.mockResolvedValue({
    id: 'event-1',
    stripe_event_id: 'evt_purchase',
    event_type: 'payment_intent.succeeded',
    processed_at: '2025-06-15T15:06:40Z',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(endpoints)('$name webhook authentication', (endpoint) => {
  test.each([undefined, '', '   '])('rejects unconfigured secret (%s) before side effects', async (missing) => {
    const { app, env, prepare } = fixture();
    env[endpoint.binding] = missing;
    const response = await app.request(endpoint.path, {
      method: 'POST',
      headers: { [endpoint.header]: signature(endpoint.body) },
      body: endpoint.body,
    }, env);
    expect(response.status).toBe(503);
    expect(prepare).not.toHaveBeenCalled();
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', () => ''],
    ['wrong secret', (body: string) => signature(body, timestamp, 'attacker')],
    ['tampered body', (body: string) => signature(`${body} `)],
    ['expired', (body: string) => signature(body, timestamp - 301)],
    ['future', (body: string) => signature(body, timestamp + 301)],
    ['invalid timestamp', () => `t=NaN,v1=${'0'.repeat(64)}`],
    ['duplicate timestamp', (body: string) => `t=${timestamp},${signature(body)}`],
    ['invalid hex', () => `t=${timestamp},v1=${'z'.repeat(64)}`],
  ] as const)('rejects %s signatures before side effects', async (_label, makeHeader) => {
    const { app, env, prepare } = fixture();
    const response = await app.request(endpoint.path, {
      method: 'POST',
      headers: { [endpoint.header]: makeHeader(endpoint.body), Authorization: 'Bearer admin-key' },
      body: endpoint.body,
    }, env);
    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(['{', 'null', '{}'])('rejects signed invalid body %s', async (body) => {
    const { app, env, prepare } = fixture();
    const response = await app.request(endpoint.path, {
      method: 'POST',
      headers: { [endpoint.header]: signature(body) },
      body,
    }, env);
    expect(response.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
  });
});

test('signed Meet callback saves metadata and sends through the proxy using the friend account', async () => {
  const { app, env, bind, run } = fixture();
  const response = await app.request(endpoints[0].path, {
    method: 'POST',
    headers: { 'X-Meet-Signature': signature(meetBody) },
    body: meetBody,
  }, env);
  expect(response.status).toBe(200);
  expect(mocks.getLineAccountById).toHaveBeenCalledWith(env.DB, 'account-1');
  expect(mocks.dispatchLineProxyLocally).toHaveBeenCalledTimes(1);
  const [request, dispatchEnv] = mocks.dispatchLineProxyLocally.mock.calls[0] as [Request, Env['Bindings']];
  expect(dispatchEnv).toBe(env);
  expect(request.url).toBe('https://worker.example.test/line-api/v2/bot/message/push');
  expect(request.headers.get('Authorization')).toBe('Bearer account-token');
  expect(request.headers.has('X-Line-Harness-Source')).toBe(false);
  expect(await request.json()).toMatchObject({
    to: `U${'1'.repeat(32)}`,
    messages: [{ type: 'flex', altText: 'ヒアリング結果' }],
  });
  expect(JSON.parse(bind.mock.calls[0][0] as string)).toMatchObject({
    existing: true,
    meet_hearing: { session_id: 'session-1' },
  });
  expect(run).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

test('Meet does not fall back to another account when the assigned account is missing', async () => {
  const { app, env, prepare } = fixture();
  mocks.getLineAccountById.mockResolvedValue(null);
  const response = await app.request(endpoints[0].path, {
    method: 'POST',
    headers: { 'X-Meet-Signature': signature(meetBody) },
    body: meetBody,
  }, env);
  expect(response.status).toBe(503);
  expect(mocks.dispatchLineProxyLocally).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});

test('signed Stripe purchase still triggers purchase effects and supports rotating signatures', async () => {
  const { app, env } = fixture();
  const response = await app.request(endpoints[1].path, {
    method: 'POST',
    headers: { 'Stripe-Signature': `${signature(stripeBody)},v1=${'0'.repeat(64)}` },
    body: stripeBody,
  }, env);
  expect(response.status).toBe(200);
  expect(mocks.createStripeEvent).toHaveBeenCalledTimes(1);
  expect(mocks.applyScoring).toHaveBeenCalledWith(env.DB, 'friend-1', 'purchase');
  expect(mocks.addTagToFriend).toHaveBeenCalledWith(env.DB, 'friend-1', 'tag-1');
  expect(mocks.awardActivityMileage).toHaveBeenCalledTimes(1);
  expect(mocks.fireEvent).toHaveBeenCalledTimes(1);
});

test('Stripe duplicate event does not repeat purchase effects', async () => {
  const { app, env } = fixture();
  mocks.getStripeEventByStripeId.mockResolvedValue({ id: 'event-1' });
  const response = await app.request(endpoints[1].path, {
    method: 'POST',
    headers: { 'Stripe-Signature': signature(stripeBody) },
    body: stripeBody,
  }, env);
  expect(response.status).toBe(200);
  expect(mocks.createStripeEvent).not.toHaveBeenCalled();
  expect(mocks.applyScoring).not.toHaveBeenCalled();
  expect(mocks.addTagToFriend).not.toHaveBeenCalled();
  expect(mocks.awardActivityMileage).not.toHaveBeenCalled();
  expect(mocks.fireEvent).not.toHaveBeenCalled();
});
