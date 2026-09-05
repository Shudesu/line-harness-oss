import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  getGoogleServiceAccountToken,
  resetGoogleServiceAccountTokenCacheForTest,
} from './google-service-account.js';

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeJwtPart(part: string): Record<string, unknown> {
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return JSON.parse(atob(padded));
}

afterEach(() => {
  resetGoogleServiceAccountTokenCacheForTest();
  vi.unstubAllGlobals();
});

describe('getGoogleServiceAccountToken', () => {
  test('PKCS#8秘密鍵でJWTを署名し、Calendar scopeのOAuth tokenを取得する', async () => {
    const keys = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    ) as CryptoKeyPair;
    const exported = await crypto.subtle.exportKey('pkcs8', keys.privateKey) as ArrayBuffer;
    const pkcs8 = new Uint8Array(exported);
    const privateKey = `-----BEGIN PRIVATE KEY-----\n${base64(pkcs8)}\n-----END PRIVATE KEY-----`;

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body));
      const assertion = params.get('assertion') ?? '';
      const [header, payload, signature] = assertion.split('.');
      expect(decodeJwtPart(header)).toMatchObject({ alg: 'RS256', typ: 'JWT' });
      expect(decodeJwtPart(payload)).toMatchObject({
        iss: 'calendar@example.iam.gserviceaccount.com',
        aud: 'https://oauth2.googleapis.com/token',
        scope: 'https://www.googleapis.com/auth/calendar',
      });
      expect(signature.length).toBeGreaterThan(100);
      return new Response(JSON.stringify({ access_token: 'access-123', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = await getGoogleServiceAccountToken({
      email: 'calendar@example.iam.gserviceaccount.com',
      privateKey,
    });
    expect(token).toBe('access-123');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test('設定がない場合は外部通信せず明示的なエラーにする', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getGoogleServiceAccountToken({})).rejects.toThrow('google_service_account_not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
