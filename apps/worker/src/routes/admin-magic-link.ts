import { bodyLimit } from 'hono/body-limit';
import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { publicBurstLimit, checkNamedBurst } from '../middleware/rate-limit.js';
import { magicLinkEnabled, validLoginEmail } from '../lib/magic-link-config.js';
import {
  getStaffByNormalizedEmail,
  staffCredentialFingerprint,
  parseStaffApiScopes,
  createMagicLink,
  consumeMagicLink,
  hashApiKey,
} from '@line-crm/db';
import {
  issueVerifiedAdminSession,
  csrfCookie,
  publicStaffProfile,
} from '../middleware/auth.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';
import { timingSafeEqualString } from '@line-crm/shared';
import type { Env } from '../index.js';
const app = createAuthorizedRouter<Env>();
app.use('/api/auth/magic-link*', bodyLimit({ maxSize: 4096 }));
const accepted = {
  success: true,
  message: '登録されたメールアドレスの場合、ログイン用リンクを送信します。',
};
app.post(
  '/api/auth/magic-link',
  publicBurstLimit('magic-request', 20, 3600000),
  async (c) => {
    if (!magicLinkEnabled(c.env)) return c.json({ error: 'Not found' }, 404);
    c.header('Cache-Control', 'no-store');
    const body = await c.req
      .json<{ email?: unknown }>()
      .catch(() => ({ email: null }));
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!validLoginEmail(email)) return c.json(accepted);
    if (
      !checkNamedBurst(
        'magic-email:' +
          new URL(c.req.url).origin +
          ':' +
          (await hashApiKey(email)),
        5,
        3600000,
      )
    )
      return c.json(accepted);
    const matches = await getStaffByNormalizedEmail(c.env.DB, email);
    const staff = matches[0];
    if (
      matches.length !== 1 ||
      staff.is_active !== 1 ||
      !['owner', 'admin', 'staff'].includes(staff.role) ||
      parseStaffApiScopes(staff.api_scopes) != null
    )
      return c.json(accepted);
    const fp = await staffCredentialFingerprint(staff);
    if (!fp) return c.json(accepted);
    const token = await createMagicLink(c.env.DB, {
      staffId: staff.id,
      email,
      credentialFp: fp,
    });
    const link = new URL('/login/magic', c.env.ADMIN_ORIGIN);
    link.hash = 't=' + token;
    const ip = c.req.header('cf-connecting-ip') ?? '';
    const coarse = /^\d+\.\d+\.\d+\.\d+$/.test(ip)
      ? ip.split('.').slice(0, 3).join('.') + '.x'
      : ip.includes(':')
        ? 'IPv6'
        : '不明';
    const text = `L Harness ログイン\n\n${link.toString()}\n\n15分以内に一度だけ利用できます。\n要求日時: ${new Date().toISOString()}\n要求元: ${coarse}\n心当たりがなければ無視してください。`;
    try {
      if (c.env.MAGIC_LINK_EMAIL_PROVIDER === 'resend') {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: 'Bearer ' + c.env.RESEND_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: c.env.MAGIC_LINK_FROM,
            to: [email],
            subject: 'L Harness login',
            text,
          }),
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error('mail failed');
      } else {
        const { EmailMessage } = await import('cloudflare:email');
        const raw = `From: ${c.env.MAGIC_LINK_FROM}\r\nTo: ${email}\r\nSubject: L Harness login\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}`;
        await c.env.MAGIC_LINK_EMAIL!.send(
          new EmailMessage(c.env.MAGIC_LINK_FROM!, email, raw),
        );
      }
    } catch {
      await consumeMagicLink(c.env.DB, token);
      console.warn('[magic-link] delivery_failed');
    }
    return c.json(accepted);
  },
);
app.post(
  '/api/auth/magic-link/consume',
  publicBurstLimit('magic-consume', 20, 3600000),
  async (c) => {
    if (!magicLinkEnabled(c.env)) return c.json({ error: 'Not found' }, 404);
    c.header('Cache-Control', 'no-store');
    const body = await c.req
      .json<{ token?: unknown }>()
      .catch(() => ({ token: null }));
    const link = await consumeMagicLink(c.env.DB, body.token);
    if (!link) return c.json({ error: 'Invalid or expired login link' }, 401);
    const matches = await getStaffByNormalizedEmail(c.env.DB, link.email);
    const staff = matches[0];
    if (
      matches.length !== 1 ||
      staff.id !== link.staff_id ||
      staff.is_active !== 1 ||
      !['owner', 'admin', 'staff'].includes(staff.role) ||
      parseStaffApiScopes(staff.api_scopes) != null ||
      !(await timingSafeEqualString(
        link.credential_fp,
        await staffCredentialFingerprint(staff),
      ))
    )
      return c.json({ error: 'Identity unavailable' }, 403);
    const session = await issueVerifiedAdminSession(
      c,
      { id: staff.id, name: staff.name, role: staff.role },
      link.credential_fp,
      'magic_link',
      { subject: link.email },
    );
    const csrfToken = crypto.randomUUID();
    c.header(
      'Set-Cookie',
      csrfCookie(csrfToken, resolveAdminAuthConfig(c.env).sameSite),
      { append: true },
    );
    return c.json({
      success: true,
      data: publicStaffProfile(session, c.env),
      csrfToken,
    });
  },
);
export default app;
