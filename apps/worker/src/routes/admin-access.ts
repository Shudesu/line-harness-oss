import { magicLinkEnabled } from '../lib/magic-link-config.js';
import { webauthnConfig } from '../lib/webauthn-config.js';
import { apiKeyLoginMode } from '../middleware/login-policy.js';
import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import {
  accessConfig,
  verifyAccessJwt,
  accessOwnerAllowed,
} from '../lib/access-jwt.js';
import {
  getStaffByNormalizedEmail,
  staffCredentialFingerprint,
  parseStaffApiScopes,
} from '@line-crm/db';
import {
  issueVerifiedAdminSession,
  accessCredentialFingerprint,
  csrfCookie,
} from '../middleware/auth.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';
import type { Env } from '../index.js';
const app = createAuthorizedRouter<Env>();
app.get('/api/auth/methods', (c) => {
  const enabled = c.env.SECURITY_MIGRATION_STAGE!=='compat' && !!accessConfig(c.env);
  c.header('Cache-Control', 'no-store');
  return c.json({
    migrationStage: c.env.SECURITY_MIGRATION_STAGE === 'compat' ? 'compat' : 'active',
    magicLink: { enabled: magicLinkEnabled(c.env) },
    passkey: { enabled: !!webauthnConfig(c.env) },
    apiKey: apiKeyLoginMode(c.env) !== 'disabled',
    apiKeyMode: apiKeyLoginMode(c.env),
    access: { enabled, ...(enabled ? { loginUrl: '/auth/access/login' } : {}) },
    sso: { enabled: !!c.env.ADMIN_SSO_SECRET },
  });
});
app.get('/auth/access/login', async (c) => {
  if (c.env.SECURITY_MIGRATION_STAGE==='compat' || !accessConfig(c.env)) return c.json({ error: 'Not found' }, 404);
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  const identity = await verifyAccessJwt(
    c.req.header('Cf-Access-Jwt-Assertion'),
    c.env,
  );
  if (!identity)
    return c.json({ error: 'Access identity could not be verified' }, 403);
  const matches = await getStaffByNormalizedEmail(c.env.DB, identity.email);
  let staff: { id: string; name: string; role: 'owner' | 'admin' | 'staff' };
  let fingerprint: string;
  if (matches.length) {
    const member = matches[0];
    if (
      matches.length !== 1 ||
      member.is_active !== 1 ||
      !['owner', 'admin', 'staff'].includes(member.role) ||
      parseStaffApiScopes(member.api_scopes) != null
    )
      return c.json({ error: 'Staff identity is disabled or ambiguous' }, 403);
    const currentFingerprint = await staffCredentialFingerprint(member);
    if (!currentFingerprint)
      return c.json({ error: 'Staff credential unavailable' }, 403);
    staff = { id: member.id, name: member.name, role: member.role };
    fingerprint = await accessCredentialFingerprint(
      c.env,
      identity.email,
      currentFingerprint,
    );
  } else {
    if (!accessOwnerAllowed(c.env, identity.email))
      return c.json(
        {
          error:
            'このメールアドレスはスタッフとして登録されていません。管理者に追加を依頼してください。',
        },
        403,
      );
    staff = { id: 'env-owner', name: 'Owner', role: 'owner' };
    fingerprint = await accessCredentialFingerprint(c.env, identity.email);
  }
  const config = resolveAdminAuthConfig(c.env, {
    requestOrigin: new URL(c.req.url).origin,
  });
  if (config.misconfigured || config.allowedOrigins.length !== 1)
    return c.json(
      { error: 'Admin origin must be configured unambiguously' },
      503,
    );
  const target = new URL('/', config.allowedOrigins[0]);
  const next = c.req.query('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    const candidate = new URL(next, target);
    if (candidate.origin === target.origin) {
      target.pathname = candidate.pathname;
      target.search = candidate.search;
      target.hash = candidate.hash;
    }
  }
  await issueVerifiedAdminSession(c, staff, fingerprint, 'access', {
    subject: identity.email,
    maxTtl: identity.exp - Math.floor(Date.now() / 1000),
  });
  c.header('Set-Cookie', csrfCookie(crypto.randomUUID(), config.sameSite), {
    append: true,
  });
  return c.redirect(target.toString(), 302);
});
export default app;
