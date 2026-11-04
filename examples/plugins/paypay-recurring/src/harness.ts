import type { Env } from './index.js';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
type ObjectData = Record<string, any>;
export function origin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Configure HTTPS origins without paths');
  return url.origin;
}
export async function harness(env: Env, path: string, body?: unknown): Promise<ObjectData> {
  if (!env.LINE_HARNESS_API_KEY) throw new Error('L Harness API key is required');
  const res = await fetch(`${origin(env.LINE_HARNESS_URL)}${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${env.LINE_HARNESS_API_KEY}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error('L Harness API unavailable');
  const result = await res.json() as ObjectData;
  if (!result.success) throw new Error('L Harness operation failed');
  return result;
}
export async function verifyBuyer(env: Env, input: ObjectData): Promise<string> {
  if (typeof input.idToken !== 'string' || !input.idToken || typeof input.friendId !== 'string' || !input.friendId || input.friendId.length > 255) throw new HttpError(401, 'LINE login required');
  const verified = await fetch('https://api.line.me/oauth2/v2.1/verify', { method: 'POST', body: new URLSearchParams({ id_token: input.idToken, client_id: env.LINE_LOGIN_CHANNEL_ID }) });
  if (!verified.ok) throw new HttpError(401, 'LINE login expired');
  const claims = await verified.json() as ObjectData;
  if (typeof claims.sub !== 'string' || claims.aud !== env.LINE_LOGIN_CHANNEL_ID || claims.iss !== 'https://access.line.me' || typeof claims.exp !== 'number' || claims.exp <= Date.now()/1000) throw new HttpError(401, 'Invalid LINE identity');
  const { data: friend } = await harness(env, `/api/friends/${encodeURIComponent(input.friendId)}`);
  if (friend?.lineUserId !== claims.sub || friend?.lineAccountId !== env.LINE_ACCOUNT_ID) throw new HttpError(403, 'Friend or LINE account does not match');
  return input.friendId;
}
export async function admin(req: Request, env: Env): Promise<boolean> {
  if (!env.PLUGIN_ADMIN_TOKEN || env.PLUGIN_ADMIN_TOKEN.length < 32) return false;
  const digest = (s: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const a = new Uint8Array(await digest(req.headers.get('Authorization') ?? '')), b = new Uint8Array(await digest(`Bearer ${env.PLUGIN_ADMIN_TOKEN}`));
  return a.every((v,i) => v === b[i]);
}
