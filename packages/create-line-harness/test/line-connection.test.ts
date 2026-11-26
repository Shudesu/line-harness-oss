import { afterEach, expect, test, vi } from 'vitest';
import { checkLineToken, InvalidLineTokenError } from '../src/lib/line-connection.js';
afterEach(() => vi.unstubAllGlobals());
test('returns account identity without exposing credentials', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ basicId: '@bot', userId: 'Ubot', displayName: 'Bot' })));
  expect(await checkLineToken('test-token')).toEqual({ basicId: '@bot', userId: 'Ubot', displayName: 'Bot' });
});
test.each([401, 403, 429, 500])('fails closed for HTTP %i without reflecting the provider body', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('test-token', { status })));
  await expect(checkLineToken('test-token')).rejects.not.toThrow('test-token');
  if (status === 401 || status === 403) await expect(checkLineToken('test-token')).rejects.toBeInstanceOf(InvalidLineTokenError);
});
test('fails closed on network errors and malformed success', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('test-token'); }));
  await expect(checkLineToken('test-token')).rejects.not.toThrow('test-token');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  await expect(checkLineToken('test-token')).rejects.toThrow('応答');
});

test('malformed JSON cannot reflect a secret through parser errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('test-token')));
  await expect(checkLineToken('test-token')).rejects.toThrow('応答');
  await expect(checkLineToken('test-token')).rejects.not.toThrow('test-token');
});
