import { describe, expect, test } from 'vitest';
import { verifyAdminSsoToken } from './admin-sso-token.js';

// Wire-format contract test.
//
// The token format is a public interface: external issuers (portals, IdP
// bridges) implement it from docs/ADMIN-AUTH.md in whatever language they use,
// and we cannot redeploy them. This file therefore re-implements the issuer
// from that documented recipe and deliberately does NOT import
// signAdminSsoToken — so a change that keeps sign/verify self-consistent while
// breaking every external issuer fails here instead of in production.
const SECRET = 'x'.repeat(40);
const NOW = 1_800_000_000;

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

async function issue(secret: string, payload: object): Promise<string> {
  const encoded = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded)));
  return `${encoded}.${sig}`;
}

describe('documented issuer recipe', () => {
  test('a token built from the docs verifies', async () => {
    const token = await issue(SECRET, {
      aud: 'admin-sso',
      iat: NOW,
      exp: NOW + 60,
      jti: '9f1d3c22-0000-4000-8000-000000000000',
      sub: 'ops@example.com',
    });
    const result = await verifyAdminSsoToken(SECRET, token, NOW);
    expect(result.ok).toBe(true);
  });

  test('claim order does not matter (signature covers the encoded segment)', async () => {
    const token = await issue(SECRET, {
      sub: 'ops@example.com',
      jti: '9f1d3c22-0000-4000-8000-000000000001',
      exp: NOW + 60,
      iat: NOW,
      aud: 'admin-sso',
    });
    expect((await verifyAdminSsoToken(SECRET, token, NOW)).ok).toBe(true);
  });

  test('a non-ASCII sub survives the UTF-8 round trip', async () => {
    const token = await issue(SECRET, {
      aud: 'admin-sso',
      iat: NOW,
      exp: NOW + 60,
      jti: '9f1d3c22-0000-4000-8000-000000000002',
      sub: '野田 修一',
    });
    const result = await verifyAdminSsoToken(SECRET, token, NOW);
    expect(result.ok && result.payload.sub).toBe('野田 修一');
  });
});
