import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendEmail, DEFAULT_CC } from '../email.js';

describe('sendEmail', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_123' }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs to Resend with CC fixbox-biz@fixbox.jp by default', async () => {
    await sendEmail({
      apiKey: 'test_key',
      from: 'noreply@fixbox.jp',
      to: 'mechanic@example.com',
      subject: '予約確定',
      html: '<p>OK</p>',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe('noreply@fixbox.jp');
    expect(body.to).toEqual(['mechanic@example.com']);
    expect(body.cc).toEqual([DEFAULT_CC]);
    expect(DEFAULT_CC).toBe('fixbox-biz@fixbox.jp');
    expect(init.headers.Authorization).toBe('Bearer test_key');
  });

  it('allows overriding CC', async () => {
    await sendEmail({
      apiKey: 'k',
      from: 'a@b.c',
      to: 'x@y.z',
      cc: ['override@example.com'],
      subject: 's',
      html: '<p>h</p>',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.cc).toEqual(['override@example.com']);
  });

  it('throws on non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'rate_limited' }), { status: 429 }),
    );
    await expect(
      sendEmail({ apiKey: 'k', from: 'a@b.c', to: 'x@y.z', subject: 's', html: '<p>h</p>' }),
    ).rejects.toThrow(/rate_limited/);
  });

  it('sets AbortSignal timeout of 30s', async () => {
    await sendEmail({ apiKey: 'k', from: 'a@b.c', to: 'x@y.z', subject: 's', html: '<p>h</p>' });
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeDefined();
  });
});
