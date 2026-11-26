import { afterEach, expect, test, vi } from 'vitest';
import { getApiConfig } from '../src/config.js';
afterEach(() => vi.unstubAllEnvs());
test.each(['', 'invalid', 'file:///tmp/test', 'https://secret@host', 'https://host?secret=key'])('rejects unsafe config without reflecting values: %s', url => {
  vi.stubEnv('LINE_HARNESS_API_URL', url);
  vi.stubEnv('LINE_HARNESS_API_KEY', 'test-key');
  expect(() => getApiConfig()).toThrow('LINE_HARNESS_API_URL');
});
test('requires key and normalizes a valid URL', () => {
  vi.stubEnv('LINE_HARNESS_API_URL', 'https://example.test/');
  vi.stubEnv('LINE_HARNESS_API_KEY', ' ');
  expect(() => getApiConfig()).toThrow('required');
  vi.stubEnv('LINE_HARNESS_API_KEY', 'test-key');
  expect(getApiConfig()).toEqual({ apiUrl: 'https://example.test', apiKey: 'test-key' });
});
