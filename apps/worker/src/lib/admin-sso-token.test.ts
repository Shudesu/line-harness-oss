import { describe, expect, test } from 'vitest';
import {
  ADMIN_SSO_AUDIENCE,
  ADMIN_SSO_MAX_CLOCK_SKEW_SECONDS,
  ADMIN_SSO_MAX_TTL_SECONDS,
  signAdminSsoToken,
  verifyAdminSsoToken,
  type AdminSsoPayload,
} from './admin-sso-token.js';

const SECRET = 'a'.repeat(32);
const OTHER_SECRET = 'b'.repeat(32);
const NOW = 1_735_689_600;

function payload(overrides: Partial<AdminSsoPayload> = {}): AdminSsoPayload {
  return {
    aud: ADMIN_SSO_AUDIENCE,
    iat: NOW,
    exp: NOW + 60,
    jti: 'jti-0123456789',
    ...overrides,
  };
}

async function reason(token: string, now = NOW): Promise<string> {
  const result = await verifyAdminSsoToken(SECRET, token, now);
  expect(result.ok).toBe(false);
  return result.ok ? 'ok' : result.reason;
}

describe('happy path', () => {
  test('a freshly signed token verifies and returns its claims', async () => {
    const token = await signAdminSsoToken(SECRET, payload({ sub: 'ops@example.test' }));
    const result = await verifyAdminSsoToken(SECRET, token, NOW);

    expect(result).toEqual({
      ok: true,
      payload: {
        aud: ADMIN_SSO_AUDIENCE,
        iat: NOW,
        exp: NOW + 60,
        jti: 'jti-0123456789',
        sub: 'ops@example.test',
      },
    });
  });

  test('sub is optional', async () => {
    const token = await signAdminSsoToken(SECRET, payload());
    const result = await verifyAdminSsoToken(SECRET, token, NOW);
    expect(result.ok && result.payload.sub).toBeUndefined();
  });

  test('token is two unpadded base64url segments joined by a dot', async () => {
    const token = await signAdminSsoToken(SECRET, payload());
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    // The payload segment decodes back to the exact JSON that was signed.
    const json = JSON.parse(atob(parts[0].replaceAll('-', '+').replaceAll('_', '/')));
    expect(json.aud).toBe(ADMIN_SSO_AUDIENCE);
  });
});

describe('signature forgery', () => {
  test('a tampered payload is rejected (signature no longer matches)', async () => {
    const token = await signAdminSsoToken(SECRET, payload());
    const [, signature] = token.split('.');
    const forgedPayload = btoa(JSON.stringify(payload({ sub: 'attacker' })))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');

    expect(await reason(`${forgedPayload}.${signature}`)).toBe('bad_signature');
  });

  test('a tampered signature is rejected', async () => {
    const token = await signAdminSsoToken(SECRET, payload());
    const [encoded, signature] = token.split('.');
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);

    expect(await reason(`${encoded}.${flipped}`)).toBe('bad_signature');
  });

  test('a token signed with a different secret is rejected', async () => {
    const token = await signAdminSsoToken(OTHER_SECRET, payload());
    expect(await reason(token)).toBe('bad_signature');
  });

  test('an unsigned (bare payload) token is rejected', async () => {
    const [encoded] = (await signAdminSsoToken(SECRET, payload())).split('.');
    expect(await reason(encoded)).toBe('malformed');
  });

  test.each([
    ['empty string', ''],
    ['no separator', 'abcdef'],
    ['empty payload segment', '.abc'],
    ['empty signature segment', 'abc.'],
    ['three segments (JWT-shaped)', 'aaa.bbb.ccc'],
    ['non-base64url characters', 'aa*aa.bbbb'],
  ])('malformed token rejected: %s', async (_label, token) => {
    expect(await reason(token)).toBe('malformed');
  });

  test('a correctly signed payload that is not JSON is rejected', async () => {
    const encoded = 'bm90LWpzb24'; // base64url("not-json")
    expect(await reason(`${encoded}.${await forge(encoded)}`)).toBe('malformed');
  });
});

/** Sign an arbitrary (possibly non-JSON) payload segment with the real secret. */
async function forge(encodedPayload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload));
  let binary = '';
  for (const byte of new Uint8Array(sig)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

describe('claim validation', () => {
  test('a token minted for another audience is rejected', async () => {
    const token = await signAdminSsoToken(SECRET, payload({ aud: 'some-other-app' }));
    expect(await reason(token)).toBe('bad_audience');
  });

  test('an expired token is rejected', async () => {
    const token = await signAdminSsoToken(SECRET, payload({ iat: NOW - 300, exp: NOW - 60 }));
    expect(await reason(token)).toBe('expired');
  });

  test('exp exactly at now is rejected (no zero-second grace)', async () => {
    const token = await signAdminSsoToken(SECRET, payload({ iat: NOW - 60, exp: NOW }));
    expect(await reason(token)).toBe('expired');
  });

  test(`a long-lived token (exp - iat > ${ADMIN_SSO_MAX_TTL_SECONDS}s) is rejected`, async () => {
    const token = await signAdminSsoToken(
      SECRET,
      payload({ iat: NOW, exp: NOW + ADMIN_SSO_MAX_TTL_SECONDS + 1 }),
    );
    expect(await reason(token)).toBe('ttl_too_long');
  });

  test('a token at exactly the maximum TTL is accepted', async () => {
    const token = await signAdminSsoToken(
      SECRET,
      payload({ iat: NOW, exp: NOW + ADMIN_SSO_MAX_TTL_SECONDS }),
    );
    expect((await verifyAdminSsoToken(SECRET, token, NOW)).ok).toBe(true);
  });

  test('exp <= iat is rejected', async () => {
    const token = await signAdminSsoToken(SECRET, payload({ iat: NOW, exp: NOW }));
    expect(await reason(token)).toBe('ttl_too_long');
  });

  test('a far-future iat cannot be used to smuggle a long-lived token', async () => {
    // exp - iat is a legal 300s, but relative to `now` the token would be
    // usable for an hour. The clock-skew bound rejects it.
    const iat = NOW + 3600;
    const token = await signAdminSsoToken(SECRET, payload({ iat, exp: iat + 300 }));
    expect(await reason(token)).toBe('future_iat');
  });

  test('a modest clock skew is tolerated', async () => {
    const iat = NOW + ADMIN_SSO_MAX_CLOCK_SKEW_SECONDS;
    const token = await signAdminSsoToken(SECRET, payload({ iat, exp: iat + 60 }));
    expect((await verifyAdminSsoToken(SECRET, token, NOW)).ok).toBe(true);
  });

  test.each([
    ['missing jti', { jti: undefined }],
    ['empty jti', { jti: '' }],
    ['too-short jti', { jti: 'abc' }],
    ['over-long jti', { jti: 'x'.repeat(129) }],
    ['non-string jti', { jti: 12345 }],
  ])('rejects %s', async (_label, override) => {
    const token = await signAdminSsoToken(SECRET, {
      ...payload(),
      ...override,
    } as unknown as AdminSsoPayload);
    expect(await reason(token)).toBe('bad_jti');
  });

  test.each([
    ['non-integer exp', { exp: NOW + 0.5 }],
    ['string exp', { exp: String(NOW + 60) }],
    ['missing iat', { iat: undefined }],
  ])('rejects %s', async (_label, override) => {
    const token = await signAdminSsoToken(SECRET, {
      ...payload(),
      ...override,
    } as unknown as AdminSsoPayload);
    expect(await reason(token)).toBe('malformed');
  });

  test('rejects an over-long sub', async () => {
    const token = await signAdminSsoToken(SECRET, payload({ sub: 'x'.repeat(201) }));
    expect(await reason(token)).toBe('bad_sub');
  });

  test('a JSON array payload is rejected', async () => {
    const encoded = btoa('[1,2,3]').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    expect(await reason(`${encoded}.${await forge(encoded)}`)).toBe('malformed');
  });
});

describe('secret handling', () => {
  test('an empty secret never verifies anything', async () => {
    const token = await signAdminSsoToken(SECRET, payload());
    const result = await verifyAdminSsoToken('', token, NOW);
    expect(result.ok).toBe(false);
  });
});
