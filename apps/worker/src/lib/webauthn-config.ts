import { hashApiKey } from '@line-crm/db';
export function webauthnConfig(env: {
  ADMIN_ORIGIN?: string;
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_ENABLED?: string;
  SECURITY_MIGRATION_STAGE?: string;
}) {
  if (env.SECURITY_MIGRATION_STAGE === 'compat' || env.WEBAUTHN_ENABLED === 'false') return null;
  try {
    const origin = new URL(env.ADMIN_ORIGIN ?? '');
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      return null;
    const rpId = env.WEBAUTHN_RP_ID || origin.hostname;
    if (rpId !== origin.hostname) return null;
    return { origin: origin.origin, rpId };
  } catch {
    return null;
  }
}
export const webauthnContext = (
  config: { origin: string; rpId: string },
  workerOrigin: string,
) => hashApiKey(JSON.stringify(['webauthn-v1', config, workerOrigin]));
export const encodeCredential = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
export const decodeCredential = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
