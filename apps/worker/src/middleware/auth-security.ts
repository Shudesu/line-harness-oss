import type { Context } from 'hono';
import { consumeAuthRateLimit, writeAuthAudit, type AuditAction, type AuditOutcome } from '@line-crm/db';
import type { Env } from '../index.js';

export function authClientIp(c: Context<Env>): string {
  // CF overwrites this header in production. Do not trust forwarded-for.
  const ip = c.req.header('cf-connecting-ip') ?? '';
  return ip.length <= 45 && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^[a-fA-F0-9:]+$/.test(ip) ? ip : 'unknown';
}
export async function audit(c: Context<Env>, action: AuditAction, outcome: AuditOutcome, actorId = 'anonymous') {
  await writeAuthAudit(c.env.DB, { actorId, action, outcome, ip: authClientIp(c) });
}
export async function limitAuth(c: Context<Env>, kind: 'login' | 'key', credential?: string): Promise<Response | null> {
  if (c.get('authRateChecked')) return null;
  c.set('authRateChecked', true);
  const max = kind === 'login' ? 10 : 1000;
  const window = kind === 'login' ? 300 : 60;
  try {
    const identities = [{ scope: `${kind}:ip`, value: authClientIp(c) }];
    if (kind === 'key' && credential) identities.push({ scope: 'key:credential', value: credential });
    for (const identity of identities) {
      const result = await consumeAuthRateLimit(c.env.DB, identity.scope, identity.value, max, window);
      if (!result.allowed) return c.json({success:false,error:'Too many authentication attempts'},
        {status:429,headers:{'Retry-After':String(result.retryAfter)}});
    }
    return null;
  } catch {
    return c.json({success:false,error:'Authentication storage unavailable'},503);
  }
}
