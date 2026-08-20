const encoder = new TextEncoder();

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

export async function signCrossAccountToken(
  secret: string,
  input: { userId: string; targetAccountId: string; expiresAtEpochSeconds?: number },
): Promise<string> {
  const expiresAt = input.expiresAtEpochSeconds ?? Math.floor(Date.now() / 1000) + 15 * 60;
  const payload = `v1.${expiresAt}.${input.userId}.${input.targetAccountId}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifyCrossAccountToken(
  secret: string,
  token: string,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): Promise<{ userId: string; targetAccountId: string } | null> {
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const [version, expiresRaw, userId, targetAccountId, suppliedSignature] = parts;
  const expiresAt = Number.parseInt(expiresRaw, 10);
  if (!Number.isFinite(expiresAt) || expiresAt < nowEpochSeconds || !userId || !targetAccountId) {
    return null;
  }
  const payload = `${version}.${expiresRaw}.${userId}.${targetAccountId}`;
  const expectedSignature = await hmac(secret, payload);
  if (expectedSignature.length !== suppliedSignature.length) return null;
  let difference = 0;
  for (let index = 0; index < expectedSignature.length; index += 1) {
    difference |= expectedSignature.charCodeAt(index) ^ suppliedSignature.charCodeAt(index);
  }
  if (difference !== 0) return null;
  return { userId, targetAccountId };
}
