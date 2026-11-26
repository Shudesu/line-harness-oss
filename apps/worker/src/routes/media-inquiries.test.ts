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
  inquiryType: 'L Harnessの新規導入',
  companyName: 'テスト株式会社',
  contactName: '山田 太郎',
  email: 'yamada@example.com',
  challenge: '追客を自動化したい',
  consent: true,
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

  // タイムスタンプはプロジェクト共通の JST ISO-8601（+09:00 付き）で保存する。
  // SQLite 側の now 系関数はオフセットなしの UTC 文字列を返すため、それを
  // 使うと読み手がローカル時刻として解釈し、JST 00:00〜09:00 の問い合わせが
  // 前日の日付として扱われる。
  it('persists offset-bearing JST timestamps instead of offset-less UTC', async () => {
    const calls: RunCall[] = [];
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 })));

    await mediaInquiries.request(
      '/api/public/media-inquiries',
      {
        method: 'POST',
        headers: { origin: 'https://the-harness.com', 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      },
      createEnv(calls),
    );

    const JST_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/;

    // INSERT: created_at / updated_at は末尾 2 バインド。
    const [createdAt, initialUpdatedAt] = calls[0].values.slice(-2) as [string, string];
    expect(createdAt).toMatch(JST_ISO);
    expect(initialUpdatedAt).toMatch(JST_ISO);
    // 同一イベントなので初期値は完全一致させる（無駄な数 ms 差を作らない）。
    expect(initialUpdatedAt).toBe(createdAt);

    // UPDATE: updated_at は id の 1 つ手前。
    const notifiedUpdatedAt = calls[1].values.at(-2) as string;
    expect(notifiedUpdatedAt).toMatch(JST_ISO);

    // タイムスタンプを SQL 側で生成しない（オフセットなし UTC への逆戻り防止）。
    expect(calls[0].sql).not.toContain('datetime(');
    expect(calls[1].sql).not.toContain('datetime(');
  });

  it.each([
    ['2026-08-19T15:30:00.123Z', '2026-08-20T00:30:00.123+09:00', false],
    ['2026-08-31T15:10:00.999Z', '2026-09-01T00:10:00.999+09:00', false],
    ['2026-12-31T15:05:00.456Z', '2027-01-01T00:05:00.456+09:00', true],
  ] as const)('preserves the instant across JST date boundaries (%s)', async (utc, expectedJst, notificationFails) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(utc));
    const calls: RunCall[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      vi.setSystemTime(new Date(new Date(utc).getTime() + 2500));
      if (notificationFails) throw new Error('notification unavailable');
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }));

    const response = await mediaInquiries.request('/api/public/media-inquiries', {
      method: 'POST',
      headers: { origin: 'https://the-harness.com', 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    }, createEnv(calls));

    expect(response.status).toBe(201);
    expect(calls).toHaveLength(2);
    const [createdAt, updatedAt] = calls[0].values.slice(-2) as [string, string];
    expect(createdAt).toBe(expectedJst);
    expect(updatedAt).toBe(createdAt);
    expect(new Date(createdAt).toISOString()).toBe(utc);
    const afterNotification = calls[1].values.at(-2) as string;
    expect(afterNotification).toMatch(/\+09:00$/);
    expect(new Date(afterNotification).getTime() - new Date(createdAt).getTime()).toBe(2500);
    expect(calls[1].values[0]).toBe(notificationFails ? 'failed' : 'accepted');
  });
});
