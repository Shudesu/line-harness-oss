import { describe, expect, test, beforeEach, vi } from 'vitest';

const dbMocks = {
  getDueWebinarRegistrations: vi.fn(),
  markWebinarRegistrationNotified: vi.fn(),
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { processWebinarReminders, sendWebinarRegistrationConfirmation, buildWebinarUrl } =
  await import('./webinar-reminders.js');

const NOW = 1_800_000_000;
const REG = {
  id: 'reg-1', webinar_id: 'w1', friend_id: 'friend-1',
  session_start_at: NOW + 240, notified_at: null, created_at: 'x',
  slug: 'test-webinar', title: 'テスト', account_id: 'acc-1', duration_seconds: 1200,
};
const OPTIONS = {
  proxyBaseUrl: 'https://proxy.example.com/',
  defaultAccessToken: 'default-token',
  defaultLiffId: '999-def',
};
const proxyFetch = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW * 1000));
  dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', line_user_id: 'U1', is_following: 1 });
  dbMocks.getLineAccountById.mockResolvedValue({
    id: 'acc-1', channel_access_token: 'tok', liff_id: '111-aaa',
  });
  dbMocks.markWebinarRegistrationNotified.mockResolvedValue(true);
  proxyFetch.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', proxyFetch);
});

describe('processWebinarReminders', () => {
  test('Harness proxy 経由で送信し、成功後に notified を刻む', async () => {
    dbMocks.getDueWebinarRegistrations.mockResolvedValue([REG]);
    const result = await processWebinarReminders({} as D1Database, OPTIONS);
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(dbMocks.markWebinarRegistrationNotified).toHaveBeenCalledWith(expect.anything(), 'reg-1');
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    const [url, init] = proxyFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proxy.example.com/line-api/v2/bot/message/push');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'X-Line-Retry-Key': 'reg-1',
    });
    const body = JSON.parse(String(init.body)) as { to: string; messages: Array<{ text: string }> };
    expect(body.to).toBe('U1');
    expect(body.messages[0].text).toContain(
      buildWebinarUrl('111-aaa', 'test-webinar', REG.session_start_at),
    );
    expect(body.messages[0].text).toContain(`sessionStartAt=${REG.session_start_at}`);
    expect(body.messages[0].text).toContain('何度でも開けます');
    expect(body.messages[0].text).toContain('まもなく');
    expect(proxyFetch.mock.invocationCallOrder[0]).toBeLessThan(
      dbMocks.markWebinarRegistrationNotified.mock.invocationCallOrder[0],
    );
  });

  test('proxy 送信失敗時は notified を刻まず、次 tick で再試行できる', async () => {
    dbMocks.getDueWebinarRegistrations.mockResolvedValue([REG]);
    proxyFetch.mockResolvedValue(
      new Response('{"message":"upstream failed"}', { status: 502, statusText: 'Bad Gateway' }),
    );
    const result = await processWebinarReminders({} as D1Database, OPTIONS);
    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(dbMocks.markWebinarRegistrationNotified).not.toHaveBeenCalled();
  });

  test('同じ retry key が LINE で受理済みの 409 は成功扱いにして notified を刻む', async () => {
    dbMocks.getDueWebinarRegistrations.mockResolvedValue([REG]);
    proxyFetch.mockResolvedValue(
      new Response(null, {
        status: 409,
        headers: { 'x-line-accepted-request-id': 'accepted-1' },
      }),
    );
    const result = await processWebinarReminders({} as D1Database, OPTIONS);
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(dbMocks.markWebinarRegistrationNotified).toHaveBeenCalledWith(expect.anything(), 'reg-1');
  });

  test('ブロック済み friend は送らず消化する', async () => {
    dbMocks.getDueWebinarRegistrations.mockResolvedValue([REG]);
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', line_user_id: 'U1', is_following: 0 });
    const result = await processWebinarReminders({} as D1Database, OPTIONS);
    expect(proxyFetch).not.toHaveBeenCalled();
    expect(dbMocks.markWebinarRegistrationNotified).toHaveBeenCalledWith(expect.anything(), 'reg-1');
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  test('開始済みセッションは「始まりました」文言になる', async () => {
    dbMocks.getDueWebinarRegistrations.mockResolvedValue([
      { ...REG, session_start_at: NOW - 30 },
    ]);
    await processWebinarReminders({} as D1Database, OPTIONS);
    const [, init] = proxyFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { messages: Array<{ text: string }> };
    expect(body.messages[0].text).toContain('始まりました');
  });
});

describe('sendWebinarRegistrationConfirmation', () => {
  test('予約直後の確認も Harness proxy 経由で送り、履歴化する', async () => {
    await sendWebinarRegistrationConfirmation(
      {} as D1Database,
      { account_id: 'acc-1', title: 'テスト', slug: 'test-webinar' },
      'friend-1',
      NOW + 3600,
      OPTIONS,
    );
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    const [url, init] = proxyFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proxy.example.com/line-api/v2/bot/message/push');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
    const body = JSON.parse(String(init.body)) as { messages: Array<{ text: string }> };
    expect(body.messages[0].text).toContain('受付しました');
    expect(body.messages[0].text).toContain(
      buildWebinarUrl('111-aaa', 'test-webinar', NOW + 3600),
    );
    expect(body.messages[0].text).toContain('専用の入場リンク');
  });
});
