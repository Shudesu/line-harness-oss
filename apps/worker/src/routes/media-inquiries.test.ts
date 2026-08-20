import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaInquiries } from './media-inquiries.js';
import type { Env } from '../index.js';

type RunCall = { sql: string; values: unknown[] };

function createEnv(calls: RunCall[]): Env['Bindings'] {
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              calls.push({ sql, values });
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { DB: db as unknown as D1Database } as Env['Bindings'];
}

const validBody = {
  inquiryType: 'LINE Harnessの新規導入',
  companyName: 'テスト株式会社',
  contactName: '山田 太郎',
  email: 'yamada@example.com',
  challenge: '追客を自動化したい',
  consent: true,
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/public/media-inquiries', () => {
  it('rejects origins outside the media allowlist without persisting', async () => {
    const calls: RunCall[] = [];
    const res = await mediaInquiries.request(
      '/api/public/media-inquiries',
      { method: 'POST', headers: { origin: 'https://attacker.example' }, body: JSON.stringify(validBody) },
      createEnv(calls),
    );
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('persists first, then records accepted email notification', async () => {
    const calls: RunCall[] = [];
    const notify = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', notify);

    const res = await mediaInquiries.request(
      '/api/public/media-inquiries',
      {
        method: 'POST',
        headers: { origin: 'https://the-harness.com', 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      },
      createEnv(calls),
    );

    expect(res.status).toBe(201);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain('INSERT INTO media_inquiries');
    expect(calls[1].sql).toContain('UPDATE media_inquiries SET mail_status');
    expect(calls[1].values[0]).toBe('accepted');
    expect(notify).toHaveBeenCalledTimes(1);
    const notifyRequest = notify.mock.calls[0][1] as RequestInit;
    expect(notifyRequest.headers).toMatchObject({
      Origin: 'https://the-harness.com',
      Referer: 'https://the-harness.com/contact/',
    });
    const body = await res.json() as { success: boolean; data: { notification: string } };
    expect(body.success).toBe(true);
    expect(body.data.notification).toBe('accepted');
  });

  it('records activation_required instead of claiming an email was sent', async () => {
    const calls: RunCall[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: 'false',
      message: 'This form needs Activation.',
    }), { status: 200 })));

    const res = await mediaInquiries.request(
      '/api/public/media-inquiries',
      {
        method: 'POST',
        headers: { origin: 'https://the-harness.com', 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      },
      createEnv(calls),
    );

    expect(calls[1].values[0]).toBe('activation_required');
    const body = await res.json() as { data: { notification: string } };
    expect(body.data.notification).toBe('activation_required');
  });
});
