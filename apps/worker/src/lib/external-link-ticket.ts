type ExternalLinkEnv = {
  SHOPIFY_LINK_SIGNING_SECRET?: string;
  SHOPIFY_LINK_ORIGIN?: string;
};

export type ExternalLinkTicketPayload = {
  v: 1;
  aud: string;
  friendId: string;
  lineUserId: string;
  userId: string;
  nonce: string;
  exp: number;
};

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function createExternalLinkTicket(
  env: ExternalLinkEnv,
  redirectTarget: string | undefined,
  claims: Pick<ExternalLinkTicketPayload, 'friendId' | 'lineUserId' | 'userId'>,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (!env.SHOPIFY_LINK_SIGNING_SECRET || !env.SHOPIFY_LINK_ORIGIN || !redirectTarget) return null;

  let target: URL;
  let expectedOrigin: string;
  try {
    target = new URL(redirectTarget);
    expectedOrigin = new URL(env.SHOPIFY_LINK_ORIGIN).origin;
  } catch {
    return null;
  }
  if (target.origin !== expectedOrigin || target.protocol !== 'https:') return null;

  const payload: ExternalLinkTicketPayload = {
    v: 1,
    aud: expectedOrigin,
    ...claims,
    nonce: crypto.randomUUID(),
    exp: nowSeconds + 5 * 60,
  };
  const encodedPayload = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SHOPIFY_LINK_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload)),
  );
  return `${encodedPayload}.${base64Url(signature)}`;
}
