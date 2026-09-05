import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  createFormSubmission: vi.fn(),
  verifyCallerLineUserId: vi.fn(),
  getLineAccountById: vi.fn(),
  dispatchLineProxyLocally: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getForms: vi.fn(),
  getFormsWithStats: vi.fn(),
  getFormById: mocks.getFormById,
  createForm: vi.fn(),
  updateForm: vi.fn(),
  deleteForm: vi.fn(),
  getFormSubmissions: vi.fn(),
  createFormSubmission: mocks.createFormSubmission,
  getFriendByLineUserId: mocks.getFriendByLineUserId,
  getFriendById: vi.fn(),
  getTrackedLinkById: vi.fn(),
  getMessageTemplateById: vi.fn(),
  getLineAccountById: mocks.getLineAccountById,
  // フォームの公開 URL（formUrl）組み立てに使う。既定は「1本に決まらない」= null で、
  // その場合 formUrl も null になる（LIFF 未構成テナントと同じ扱い）。
  resolveDefaultLineAccount: vi.fn(async () => null),
  enrollFriendInScenario: vi.fn(),
  jstNow: vi.fn(() => '2026-08-04T12:00:00+09:00'),
}));

vi.mock('../services/liff-auth.js', () => ({
  verifyCallerLineUserId: mocks.verifyCallerLineUserId,
}));

vi.mock('../services/friend-tag-attach.js', () => ({
  attachTagAndFireSideEffects: vi.fn(),
}));

vi.mock('../services/local-line-proxy.js', () => ({
  dispatchLineProxyLocally: mocks.dispatchLineProxyLocally,
}));

import { forms } from './forms.js';

const baseForm = {
  id: 'form-1',
  name: '診断フォーム',
  description: '説明',
  fields: JSON.stringify([{ name: 'x_username', label: 'X ID', type: 'text' }]),
  on_submit_tag_id: 'tag-secret-id',
  on_submit_scenario_id: 'scenario-secret-id',
  on_submit_message_type: 'text',
  on_submit_message_content: '完了しました',
  on_submit_webhook_url:
    'https://verify.example.test/api/engagement-gates/gate-1/verify?username={x_username}',
  on_submit_webhook_headers: JSON.stringify({ Authorization: 'Bearer secret' }),
  on_submit_webhook_fail_message: '条件を満たしていません',
  save_to_metadata: 1,
  is_active: 1,
  submit_count: 10,
  og_title: null,
  og_description: null,
  og_image_url: null,
  created_at: '2026-01-01T00:00:00+09:00',
  updated_at: '2026-08-01T00:00:00+09:00',
};

function env() {
  const run = vi.fn(async () => ({ success: true }));
  const first = vi.fn(async () => null as { slug: string } | null);
  const bind = vi.fn((..._args: unknown[]) => ({ run, first }));
  const prepare = vi.fn((_sql: string) => ({ bind }));
  return {
    bindings: {
      DB: { prepare } as unknown as D1Database,
      LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
      LINE_LOGIN_CHANNEL_ID: 'login-channel',
      WORKER_URL: 'https://worker.example.test',
    } as Env['Bindings'],
    prepare,
    bind,
    first,
  };
}

function app(asAdmin = false) {
  const a = new Hono<Env>();
  if (asAdmin) {
    a.use('/api/forms/*', async (c, next) => {
      c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner' });
      return next();
    });
  }
  a.route('/', forms);
  return a;
}

beforeEach(() => {
  mocks.getFormById.mockResolvedValue({ ...baseForm });
  mocks.verifyCallerLineUserId.mockResolvedValue(null);
  mocks.getFriendByLineUserId.mockResolvedValue(null);
  mocks.createFormSubmission.mockImplementation(async (_db, input) => ({
    id: 'submission-1',
    form_id: input.formId,
    friend_id: input.friendId,
    data: input.data,
    created_at: '2026-08-04T12:00:00+09:00',
  }));
  mocks.dispatchLineProxyLocally.mockResolvedValue(new Response(null, { status: 200 }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('public form representation', () => {
  test('redacts webhook secrets and internal automation IDs', async () => {
    const { bindings } = env();
    const res = await app().request('/api/forms/form-1', {}, bindings);
    expect(res.status).toBe(200);

    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      id: 'form-1',
      hasSubmitWebhook: true,
      webhookOrigin: 'https://verify.example.test',
      webhookGateId: 'gate-1',
    });
    expect(body.data).not.toHaveProperty('onSubmitWebhookUrl');
    expect(body.data).not.toHaveProperty('onSubmitWebhookHeaders');
    expect(body.data).not.toHaveProperty('onSubmitTagId');
    expect(body.data).not.toHaveProperty('onSubmitScenarioId');
    expect(JSON.stringify(body.data)).not.toContain('Bearer secret');
  });

  test('returns the active webinar consultation route for the LIFF form', async () => {
    const { bindings, first } = env();
    first.mockResolvedValue({ slug: 'ritz-voice-1-l1b' });
    const res = await app().request('/api/forms/form-1', {}, bindings);
    expect(res.status).toBe(200);

    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data.consultationWebinarSlug).toBe('ritz-voice-1-l1b');
  });

  test('keeps the full representation for an authenticated admin', async () => {
    const { bindings } = env();
    const res = await app(true).request('/api/forms/form-1', {}, bindings);
    expect(res.status).toBe(200);

    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data.onSubmitWebhookUrl).toBe(baseForm.on_submit_webhook_url);
    expect(body.data.onSubmitWebhookHeaders).toBe(baseForm.on_submit_webhook_headers);
    expect(body.data.onSubmitTagId).toBe('tag-secret-id');
    expect(body.data.onSubmitScenarioId).toBe('scenario-secret-id');
  });
});

describe('LIFF identity enforcement', () => {
  test('stores every required AI consultation field including the selected meeting slot', async () => {
    mocks.getFormById.mockResolvedValue({
      ...baseForm,
      fields: JSON.stringify([
        { name: 'name', label: 'お名前', type: 'text', required: true },
        { name: 'company', label: '会社名・屋号', type: 'text', required: true },
        { name: 'annual_revenue', label: '年商規模', type: 'select', required: true },
        { name: 'budget', label: '予算感', type: 'select', required: true },
        { name: 'ai_goal', label: '改善したいこと', type: 'textarea', required: true },
        { name: 'meeting_date_1', label: '第1希望日', type: 'date', required: true },
        { name: 'meeting_time_1', label: '第1希望開始時刻', type: 'select', required: true },
      ]),
      on_submit_tag_id: null,
      on_submit_scenario_id: null,
      on_submit_message_type: null,
      on_submit_message_content: null,
      on_submit_webhook_url: null,
      on_submit_webhook_headers: null,
      on_submit_webhook_fail_message: null,
      save_to_metadata: 0,
    });
    mocks.verifyCallerLineUserId.mockResolvedValue('line-real');
    mocks.getFriendByLineUserId.mockResolvedValue({
      id: 'friend-real',
      line_user_id: null,
      display_name: 'Real User',
      metadata: '{}',
    });
    const { bindings } = env();
    const data = {
      name: '山田太郎',
      company: '株式会社テスト',
      annual_revenue: '3,000万〜1億円',
      budget: '10万〜30万円',
      ai_goal: '問い合わせ対応を自動化したい',
      meeting_date_1: '2026-08-12',
      meeting_time_1: '14:30',
    };

    const res = await app().request('/api/forms/form-1/submit', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-line-id-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data }),
    }, bindings);

    expect(res.status).toBe(201);
    expect(mocks.createFormSubmission).toHaveBeenCalledWith(bindings.DB, {
      formId: 'form-1',
      friendId: 'friend-real',
      data: JSON.stringify(data),
    });
  });

  test('rejects partial metadata writes without a valid LINE ID token', async () => {
    const { bindings, prepare } = env();
    const res = await app().request('/api/forms/form-1/partial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendId: 'victim-friend', data: { score: 999 } }),
    }, bindings);

    expect(res.status).toBe(401);
    expect(mocks.getFriendByLineUserId).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  test('writes partial metadata only to the token-authenticated friend', async () => {
    mocks.verifyCallerLineUserId.mockResolvedValue('line-real');
    mocks.getFriendByLineUserId.mockResolvedValue({
      id: 'friend-real',
      metadata: JSON.stringify({ existing: true }),
    });
    const { bindings, bind } = env();

    const res = await app().request('/api/forms/form-1/partial', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-line-id-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ friendId: 'victim-friend', data: { score: 42 } }),
    }, bindings);

    expect(res.status).toBe(200);
    expect(mocks.getFriendByLineUserId).toHaveBeenCalledWith(bindings.DB, 'line-real');
    expect(bind).toHaveBeenCalledWith(
      JSON.stringify({ existing: true, score: 42 }),
      '2026-08-04T12:00:00+09:00',
      'friend-real',
    );
  });

  test('rejects submit without a valid LINE ID token even when a friendId is supplied', async () => {
    const { bindings } = env();
    const res = await app().request('/api/forms/form-1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendId: 'victim-friend', data: { x_username: 'alice' } }),
    }, bindings);

    expect(res.status).toBe(401);
    expect(mocks.createFormSubmission).not.toHaveBeenCalled();
  });

  test('ignores _skipWebhook and checks the webhook for the authenticated friend', async () => {
    mocks.verifyCallerLineUserId.mockResolvedValue('line-real');
    mocks.getFriendByLineUserId.mockResolvedValue({
      id: 'friend-real',
      line_user_id: null,
      display_name: 'Real User',
      metadata: '{}',
    });
    const webhookFetch = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => new Response(
      JSON.stringify({ eligible: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', webhookFetch);
    const { bindings } = env();

    const res = await app().request('/api/forms/form-1/submit', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-line-id-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        friendId: 'victim-friend',
        lineUserId: 'victim-line-user',
        _skipWebhook: true,
        data: { x_username: 'alice' },
      }),
    }, bindings);

    expect(res.status).toBe(201);
    expect(webhookFetch).toHaveBeenCalledOnce();
    expect(webhookFetch.mock.calls[0][0]).toBe(
      'https://verify.example.test/api/engagement-gates/gate-1/verify?username=alice',
    );
    expect(webhookFetch.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
      },
    });
    expect(mocks.createFormSubmission).toHaveBeenCalledWith(bindings.DB, expect.objectContaining({
      formId: 'form-1',
      friendId: 'friend-real',
    }));
    expect(mocks.createFormSubmission).not.toHaveBeenCalledWith(
      bindings.DB,
      expect.objectContaining({ friendId: 'victim-friend' }),
    );
    expect((await res.json() as { data: { webhookPassed: boolean } }).data.webhookPassed).toBe(false);
  });

  test('webhook rejection reply goes through the Harness proxy', async () => {
    mocks.verifyCallerLineUserId.mockResolvedValue('line-real');
    mocks.getFriendByLineUserId.mockResolvedValue({
      id: 'friend-real',
      line_user_id: 'U-real',
      line_account_id: null,
      display_name: 'Real User',
      metadata: '{}',
    });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = String(input);
      if (url.startsWith('https://verify.example.test/')) {
        return new Response(JSON.stringify({ eligible: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { bindings } = env();

    const res = await app().request('/api/forms/form-1/submit', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-line-id-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: { x_username: 'alice' } }),
    }, bindings);

    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchLineProxyLocally).toHaveBeenCalledTimes(1);
    const proxyRequest = mocks.dispatchLineProxyLocally.mock.calls[0][0] as Request;
    expect(proxyRequest.url).toBe('http://localhost/line-api/v2/bot/message/push');
    expect(proxyRequest.headers.get('Authorization')).toBe('Bearer line-token');
    expect(await proxyRequest.json()).toEqual({
      to: 'U-real',
      messages: [{ type: 'text', text: '条件を満たしていません' }],
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('api.line.me'))).toBe(false);
  });
});
