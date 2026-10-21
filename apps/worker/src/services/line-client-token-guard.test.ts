import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineClient } from '@line-crm/line-sdk';

// Why: an empty channel token must never reach LINE. Sending "Bearer " (or
// "Bearer undefined") only earns a 401 and, worse, hides that no store token
// was resolved. The guard stops it before fetch, at all three call sites.
// ponytail: SDK has no vitest config of its own, so this lives in apps/worker
// (alias reads the SDK src). Move to the SDK when it gets its own test setup.

const NOT_CONFIGURED = 'LINE access token is not configured';
const VALID_TOKEN = 'test-token-valid';

const emptyTokens: Array<[string, unknown]> = [
  ['empty string', ''],
  ['spaces only', '   '],
  ['tab and newline', '\t\n'],
  ['undefined', undefined],
  ['null', null],
];

type Entry = [string, (c: LineClient) => Promise<unknown>];
const entries: Entry[] = [
  ['pushMessage (request)', (c) => c.pushMessage('U1', [{ type: 'text', text: 'hi' }])],
  ['getDefaultRichMenuId', (c) => c.getDefaultRichMenuId()],
  ['uploadRichMenuImage', (c) => c.uploadRichMenuImage('rm-1', new ArrayBuffer(4))],
];

function stubFetch(status = 200) {
  const fetchMock = vi.fn(
    async () =>
      new Response(status === 200 ? '{"richMenuId":"rm-1"}' : '', {
        status,
        headers: status === 200 ? { 'content-type': 'application/json' } : {},
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LineClient empty-token guard', () => {
  it('constructing with an empty token does not throw and does not call fetch', () => {
    const fetchMock = stubFetch();
    for (const [, token] of emptyTokens) {
      expect(() => new LineClient(token as string)).not.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  for (const [tokenLabel, token] of emptyTokens) {
    for (const [entryLabel, call] of entries) {
      it(`rejects without calling fetch: ${tokenLabel} x ${entryLabel}`, async () => {
        const fetchMock = stubFetch();
        const client = new LineClient(token as string);
        const err = await call(client).then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe(NOT_CONFIGURED);
        expect(fetchMock).not.toHaveBeenCalled();
      });
    }
  }

  for (const [entryLabel, call] of entries) {
    it(`sends exactly once with the token as given: ${entryLabel}`, async () => {
      const fetchMock = stubFetch();
      await call(new LineClient(VALID_TOKEN));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0][1] as unknown as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${VALID_TOKEN}`);
    });
  }

  it('does not trim a non-empty token before sending', async () => {
    const fetchMock = stubFetch();
    await new LineClient(' padded ').getDefaultRichMenuId();
    const init = fetchMock.mock.calls[0][1] as unknown as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer  padded ');
  });

  it('keeps getDefaultRichMenuId 404 -> null', async () => {
    const fetchMock = stubFetch(404);
    await expect(new LineClient(VALID_TOKEN).getDefaultRichMenuId()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
