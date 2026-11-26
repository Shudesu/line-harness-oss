import { bodyLimit } from 'hono/body-limit';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { publicBurstLimit } from '../middleware/rate-limit.js';
import {
  createWebauthnChallenge,
  getWebauthnChallenge,
  consumeWebauthnChallenge,
  listPasskeys,
  getPasskey,
  insertPasskey,
  advancePasskeyCounter,
  hashApiKey,
  getStaffById,
  staffCredentialFingerprint,
  parseStaffApiScopes,
} from '@line-crm/db';
import {
  issueVerifiedAdminSession,
  csrfCookie,
  publicStaffProfile,
  cookieToken,
  type AuthenticatedStaff,
} from '../middleware/auth.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';
import {
  webauthnConfig,
  webauthnContext,
  encodeCredential,
  decodeCredential,
} from '../lib/webauthn-config.js';
import type { Env } from '../index.js';
const app = createAuthorizedRouter<Env>();
app.use('/api/auth/passkeys/*', bodyLimit({ maxSize: 65536 }));
function fresh(staff: AuthenticatedStaff) {
  return (
    !!staff.sessionId &&
    !!staff.sessionCreatedAt &&
    staff.authMethod !== 'legacy_cookie' &&
    Date.now() / 1000 - staff.sessionCreatedAt <= 600
  );
}
app.post('/api/auth/passkeys/register/options', async (c) => {
  const staff = c.get('staff');
  if (!cookieToken(c) || !fresh(staff) || staff.machine)
    return c.json({ error: 'reauth_required' }, 403);
  const config = webauthnConfig(c.env);
  if (!config) return c.json({ error: 'Not found' }, 404);
  const keys = await listPasskeys(c.env.DB, staff.id);
  if (keys.length >= 20) return c.json({ error: 'Passkey limit reached' }, 409);
  const context = await webauthnContext(config, new URL(c.req.url).origin);
  const handle = await hashApiKey(context + ':' + staff.id);
  const options = await generateRegistrationOptions({
    rpName: 'L Harness',
    rpID: config.rpId,
    userName: staff.name,
    userDisplayName: staff.name,
    userID: new Uint8Array(new TextEncoder().encode(handle)),
    attestationType: 'none',
    supportedAlgorithmIDs: [-7, -257],
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    excludeCredentials: keys.map((k) => ({ id: k.credential_id })),
    timeout: 300000,
  });
  const challengeId = await createWebauthnChallenge(
    c.env.DB,
    options.challenge,
    'register',
    staff.id,
    context,
  );
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data: { options, challengeId } });
});
app.post('/api/auth/passkeys/register/verify', async (c) => {
  const staff = c.get('staff');
  if (!cookieToken(c) || !fresh(staff) || staff.machine)
    return c.json({ error: 'reauth_required' }, 403);
  const config = webauthnConfig(c.env);
  if (!config) return c.json({ error: 'Not found' }, 404);
  const body = await c.req
    .json<{
      challengeId: string;
      response: RegistrationResponseJSON;
      name?: string;
    }>()
    .catch(() => null);
  if (!body?.response || typeof body.challengeId !== 'string')
    return c.json({ error: 'Invalid registration' }, 400);
  const context = await webauthnContext(config, new URL(c.req.url).origin);
  const challenge = await getWebauthnChallenge(
    c.env.DB,
    body.challengeId,
    'register',
    context,
  );
  if (!challenge || challenge.staff_id !== staff.id)
    return c.json({ error: 'Invalid challenge' }, 400);
  try {
    const result = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: async (value) =>
        (await hashApiKey(value)) === challenge.challenge_hash,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257],
    });
    if (
      !result.verified ||
      !result.registrationInfo ||
      !(await consumeWebauthnChallenge(c.env.DB, challenge.id))
    )
      return c.json({ error: 'Invalid registration' }, 400);
    if ((await listPasskeys(c.env.DB, staff.id)).length >= 20)
      return c.json({ error: 'Passkey limit reached' }, 409);
    const info = result.registrationInfo;
    await insertPasskey(c.env.DB, {
      staff_id: staff.id,
      credential_id: info.credential.id,
      public_key: encodeCredential(info.credential.publicKey),
      sign_count: info.credential.counter,
      transports: JSON.stringify(info.credential.transports ?? []),
      aaguid: info.aaguid,
      name:
        typeof body.name === 'string'
          ? body.name.trim().slice(0, 100) || 'Passkey'
          : 'Passkey',
      user_handle: encodeCredential(
        new TextEncoder().encode(await hashApiKey(context + ':' + staff.id)),
      ),
      context_hash: context,
    });
    return c.json({ success: true });
  } catch {
    return c.json({ error: 'Passkey registration failed' }, 400);
  }
});
app.post(
  '/api/auth/passkeys/login/options',
  publicBurstLimit('passkey-options', 10),
  async (c) => {
    const config = webauthnConfig(c.env);
    if (!config) return c.json({ error: 'Not found' }, 404);
    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      userVerification: 'required',
      timeout: 300000,
    });
    const challengeId = await createWebauthnChallenge(
      c.env.DB,
      options.challenge,
      'login',
      null,
      await webauthnContext(config, new URL(c.req.url).origin),
    );
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, data: { options, challengeId } });
  },
);
app.post(
  '/api/auth/passkeys/login/verify',
  publicBurstLimit('passkey-verify', 10),
  async (c) => {
    const config = webauthnConfig(c.env);
    if (!config) return c.json({ error: 'Not found' }, 404);
    const body = await c.req
      .json<{ challengeId: string; response: AuthenticationResponseJSON }>()
      .catch(() => null);
    if (
      !body?.response?.response ||
      typeof body.challengeId !== 'string' ||
      typeof body.response.id !== 'string'
    )
      return c.json({ error: 'Invalid assertion' }, 400);
    const context = await webauthnContext(config, new URL(c.req.url).origin);
    const challenge = await getWebauthnChallenge(
      c.env.DB,
      body.challengeId,
      'login',
      context,
    );
    const key = await getPasskey(c.env.DB, body.response.id);
    if (
      !challenge ||
      !key ||
      key.context_hash !== context ||
      body.response.response.userHandle !== key.user_handle
    )
      return c.json({ error: 'Invalid assertion' }, 401);
    try {
      const result = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: async (value) =>
          (await hashApiKey(value)) === challenge.challenge_hash,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
        credential: {
          id: key.credential_id,
          publicKey: decodeCredential(key.public_key),
          counter: key.sign_count,
        },
      });
      if (
        !result.verified ||
        !(await consumeWebauthnChallenge(c.env.DB, challenge.id)) ||
        !(await advancePasskeyCounter(
          c.env.DB,
          key.id,
          key.sign_count,
          result.authenticationInfo.newCounter,
        ))
      )
        return c.json({ error: 'Invalid assertion' }, 401);
      let staff: AuthenticatedStaff;
      let fingerprint: string | null;
      if (key.staff_id === 'env-owner') {
        if (!c.env.API_KEY)
          return c.json({ error: 'Owner recovery not configured' }, 403);
        staff = { id: 'env-owner', name: 'Owner', role: 'owner' };
        fingerprint = await hashApiKey(c.env.API_KEY);
      } else {
        const current = await getStaffById(c.env.DB, key.staff_id);
        if (
          !current ||
          current.is_active !== 1 ||
          !['owner', 'admin', 'staff'].includes(current.role) ||
          parseStaffApiScopes(current.api_scopes) != null
        )
          return c.json({ error: 'Identity unavailable' }, 403);
        staff = { id: current.id, name: current.name, role: current.role };
        fingerprint = await staffCredentialFingerprint(current);
      }
      if (!fingerprint) return c.json({ error: 'Identity unavailable' }, 403);
      const session = await issueVerifiedAdminSession(
        c,
        staff,
        fingerprint,
        'passkey',
      );
      const csrfToken = crypto.randomUUID();
      c.header(
        'Set-Cookie',
        csrfCookie(csrfToken, resolveAdminAuthConfig(c.env).sameSite),
        { append: true },
      );
      c.header('Cache-Control', 'no-store');
      return c.json({
        success: true,
        data: publicStaffProfile(session, c.env),
        csrfToken,
      });
    } catch {
      return c.json({ error: 'Passkey authentication failed' }, 401);
    }
  },
);
app.get('/api/auth/passkeys', async (c) => {
  const keys = await listPasskeys(c.env.DB, c.get('staff').id);
  return c.json({
    success: true,
    data: keys.map((k) => ({
      id: k.id,
      name: k.name,
      createdAt: k.created_at,
      lastUsedAt: k.last_used_at,
    })),
  });
});
app.patch('/api/auth/passkeys/:id', async (c) => {
  const body = await c.req.json<{ name?: string }>();
  if (
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    body.name.length > 100
  )
    return c.json({ error: 'Invalid name' }, 400);
  await c.env.DB.prepare(
    'UPDATE admin_passkeys SET name=? WHERE id=? AND staff_id=?',
  )
    .bind(body.name.trim(), c.req.param('id'), c.get('staff').id)
    .run();
  return c.json({ success: true });
});
app.delete('/api/auth/passkeys/:id', async (c) => {
  const staff = c.get('staff');
  if (staff.role === 'owner')
    await c.env.DB.prepare('DELETE FROM admin_passkeys WHERE id=?')
      .bind(c.req.param('id'))
      .run();
  else
    await c.env.DB.prepare(
      'DELETE FROM admin_passkeys WHERE id=? AND staff_id=?',
    )
      .bind(c.req.param('id'), staff.id)
      .run();
  return c.json({ success: true });
});
export default app;
