import { describe, expect, test } from 'vitest';
import { signWebinarToken, verifyWebinarToken } from './webinar-token.js';

const SECRET = 'test-secret';
const NOW = 1_800_000_000;

describe('webinar token', () => {
  test('sign → verify が通る', async () => {
    const token = await signWebinarToken(SECRET, 'my-seminar', NOW + 3600);
    expect(await verifyWebinarToken(SECRET, 'my-seminar', token, NOW)).toBe(true);
  });

  test('期限切れは reject', async () => {
    const token = await signWebinarToken(SECRET, 'my-seminar', NOW - 1);
    expect(await verifyWebinarToken(SECRET, 'my-seminar', token, NOW)).toBe(false);
  });

  test('slug が違うと reject', async () => {
    const token = await signWebinarToken(SECRET, 'my-seminar', NOW + 3600);
    expect(await verifyWebinarToken(SECRET, 'other', token, NOW)).toBe(false);
  });

  test('secret が違うと reject', async () => {
    const token = await signWebinarToken('another', 'my-seminar', NOW + 3600);
    expect(await verifyWebinarToken(SECRET, 'my-seminar', token, NOW)).toBe(false);
  });

  test('改ざん・不正形式は reject', async () => {
    const token = await signWebinarToken(SECRET, 'my-seminar', NOW + 3600);
    expect(await verifyWebinarToken(SECRET, 'my-seminar', token + 'x', NOW)).toBe(false);
    expect(await verifyWebinarToken(SECRET, 'my-seminar', 'garbage', NOW)).toBe(false);
    expect(await verifyWebinarToken(SECRET, 'my-seminar', '', NOW)).toBe(false);
  });
});
