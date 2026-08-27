import { afterEach, describe, expect, test, vi } from 'vitest';
import { createZoomMeeting, deleteZoomMeeting, zoomConfigured } from './zoom.js';

const creds = {
  accountId: 'acct_1',
  clientId: 'client_1',
  clientSecret: 'secret_1',
};

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('zoomConfigured', () => {
  test('3点そろって初めて有効になる', () => {
    expect(zoomConfigured({})).toBeNull();
    expect(zoomConfigured({ ZOOM_ACCOUNT_ID: 'a' })).toBeNull();
    expect(zoomConfigured({ ZOOM_ACCOUNT_ID: 'a', ZOOM_CLIENT_ID: 'b' })).toBeNull();
    expect(
      zoomConfigured({ ZOOM_ACCOUNT_ID: 'a', ZOOM_CLIENT_ID: 'b', ZOOM_CLIENT_SECRET: 'c' }),
    ).toEqual({ accountId: 'a', clientId: 'b', clientSecret: 'c' });
  });
});

describe('createZoomMeeting', () => {
  test('トークン取得→ミーティング作成の順で叩き、join_url を返す', async () => {
    const calls: string[] = [];
    const spy = mockFetch((url) => {
      calls.push(url);
      if (url.startsWith('https://zoom.us/oauth/token')) {
        return new Response(JSON.stringify({ access_token: 'tok_1' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ join_url: 'https://zoom.us/j/999', id: 999 }),
        { status: 201 },
      );
    });

    const result = await createZoomMeeting(creds, {
      topic: '佐藤様｜個別面談',
      startAt: '2026-05-10T05:00:00.000Z',
      durationMin: 60,
    });

    expect(result).toEqual({ joinUrl: 'https://zoom.us/j/999', meetingId: '999' });
    expect(calls[0]).toContain('grant_type=account_credentials');
    expect(calls[0]).toContain('account_id=acct_1');
    expect(calls[1]).toBe('https://api.zoom.us/v2/users/me/meetings');

    const body = JSON.parse(String(spy.mock.calls[1][1]?.body));
    expect(body.type).toBe(2);
    expect(body.duration).toBe(60);
    expect(body.timezone).toBe('Asia/Tokyo');
    // Zoom は UTC の ISO を受け取る。ミリ秒は落とす。
    expect(body.start_time).toBe('2026-05-10T05:00:00Z');
  });

  test('ホスト入室前の入室を許さない（URLが第三者に渡っても先回り入室されないため）', async () => {
    const spy = mockFetch((url) =>
      url.startsWith('https://zoom.us/oauth/token')
        ? new Response(JSON.stringify({ access_token: 'tok_1' }), { status: 200 })
        : new Response(JSON.stringify({ join_url: 'https://zoom.us/j/1', id: 1 }), { status: 201 }),
    );
    await createZoomMeeting(creds, {
      topic: 't',
      startAt: '2026-05-10T05:00:00Z',
      durationMin: 60,
    });
    const body = JSON.parse(String(spy.mock.calls[1][1]?.body));
    expect(body.settings.join_before_host).toBe(false);
  });

  test('OAuth が失敗したら例外にする（本文も残す）', async () => {
    mockFetch(() => new Response('bad credentials', { status: 401 }));
    await expect(
      createZoomMeeting(creds, { topic: 't', startAt: '2026-05-10T05:00:00Z', durationMin: 30 }),
    ).rejects.toThrow(/Zoom OAuth error: 401/);
  });

  test('ミーティング作成が失敗したら例外にする', async () => {
    mockFetch((url) =>
      url.startsWith('https://zoom.us/oauth/token')
        ? new Response(JSON.stringify({ access_token: 'tok_1' }), { status: 200 })
        : new Response('scope missing', { status: 400 }),
    );
    await expect(
      createZoomMeeting(creds, { topic: 't', startAt: '2026-05-10T05:00:00Z', durationMin: 30 }),
    ).rejects.toThrow(/Zoom createMeeting error: 400/);
  });
});

describe('deleteZoomMeeting', () => {
  test('204 は成功', async () => {
    mockFetch((url) =>
      url.startsWith('https://zoom.us/oauth/token')
        ? new Response(JSON.stringify({ access_token: 'tok_1' }), { status: 200 })
        : new Response(null, { status: 204 }),
    );
    await expect(deleteZoomMeeting(creds, '999')).resolves.toBeUndefined();
  });

  test('404（すでに消えている）も成功として扱う', async () => {
    mockFetch((url) =>
      url.startsWith('https://zoom.us/oauth/token')
        ? new Response(JSON.stringify({ access_token: 'tok_1' }), { status: 200 })
        : new Response('not found', { status: 404 }),
    );
    await expect(deleteZoomMeeting(creds, '999')).resolves.toBeUndefined();
  });

  test('それ以外のエラーは例外にする', async () => {
    mockFetch((url) =>
      url.startsWith('https://zoom.us/oauth/token')
        ? new Response(JSON.stringify({ access_token: 'tok_1' }), { status: 200 })
        : new Response('boom', { status: 500 }),
    );
    await expect(deleteZoomMeeting(creds, '999')).rejects.toThrow(/Zoom deleteMeeting error: 500/);
  });
});
