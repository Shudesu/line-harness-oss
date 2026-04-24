import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendEmail, DEFAULT_CC } from '../email.js';

const TEST_URL = 'https://script.google.com/macros/s/TEST/exec';

describe('sendEmail (GAS webhook)', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs to webhookUrl without cc when cc not provided', async () => {
    await sendEmail({
      webhookUrl: TEST_URL,
      secret: 'shh',
      to: 'mechanic@example.com',
      subject: '予約確定',
      html: '<p>OK</p>',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TEST_URL);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.secret).toBe('shh');
    expect(body.to).toEqual(['mechanic@example.com']);
    expect(body.cc).toBeUndefined();
    expect(DEFAULT_CC).toBe('fixbox-biz@fixbox.jp');
  });

  it('omits cc field when empty array passed', async () => {
    await sendEmail({
      webhookUrl: TEST_URL,
      secret: 's',
      to: 'x@y.z',
      cc: [],
      subject: 's',
      html: '<p>h</p>',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.cc).toBeUndefined();
  });

  it('does not set Authorization header', async () => {
    await sendEmail({ webhookUrl: TEST_URL, secret: 's', to: 'x@y.z', subject: 's', html: '<p>h</p>' });
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('allows overriding CC', async () => {
    await sendEmail({
      webhookUrl: TEST_URL,
      secret: 's',
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
      new Response('Server Error', { status: 500 }),
    );
    await expect(
      sendEmail({ webhookUrl: TEST_URL, secret: 's', to: 'x@y.z', subject: 's', html: '<p>h</p>' }),
    ).rejects.toThrow(/GAS mail error 500/);
  });

  it('throws when GAS returns 200 with error body (wrong secret)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 200 }),
    );
    await expect(
      sendEmail({ webhookUrl: TEST_URL, secret: 'wrong', to: 'x@y.z', subject: 's', html: '<p>h</p>' }),
    ).rejects.toThrow(/GAS mail rejected: unauthorized/);
  });

  it('sets AbortSignal timeout', async () => {
    await sendEmail({ webhookUrl: TEST_URL, secret: 's', to: 'x@y.z', subject: 's', html: '<p>h</p>' });
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeDefined();
  });
});
