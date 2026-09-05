import { Hono } from 'hono';
import { consumeAdminSsoJti } from '@line-crm/db';
import type { Env } from '../index.js';
import { adminSessionCookie, csrfCookie } from '../middleware/auth.js';
import {
  parseAllowedOrigins,
  resolveAdminAuthConfig,
} from '../middleware/admin-auth-config.js';
import {
  ADMIN_SSO_MIN_SECRET_LENGTH,
  verifyAdminSsoToken,
} from '../lib/admin-sso-token.js';

// ---------------------------------------------------------------------------
// External SSO into the admin session.
//
// Opt-in and off by default: without an `ADMIN_SSO_SECRET` secret the route
// answers exactly like any unregistered path, so existing deployments are
// untouched.
//
// When enabled, an operator-controlled issuer (a self-hosted portal, an IdP
// bridge, an internal ops tool) mints a short-lived HMAC token and sends the
// browser to `/admin/sso?token=…`. The Worker verifies it and establishes the
// *same* session `POST /api/auth/login` would have issued for the env API key,
// then redirects to the admin dashboard.
//
// Trust model: whoever holds ADMIN_SSO_SECRET can mint an owner session. The
// secret is therefore exactly as sensitive as API_KEY, and the issuer is
// responsible for authenticating the human before minting. See
// docs/ADMIN-AUTH.md.
// ---------------------------------------------------------------------------

export const adminSso = new Hono<Env>();

const LOG = '[admin-sso]';

/** Keep issuer-supplied text out of log-forging range and bounded in length. */
function sanitizeForLog(value: string | undefined): string {
  if (!value) return '-';
  return value.replace(/[^\x20-\x7E]/gu, '?').slice(0, 100);
}

/**
 * Where to send the browser once the session exists. Derived from operator
 * configuration only — never from the request — so this can never become an
 * open redirect.
 */
function adminHomeUrl(env: Env['Bindings']): string {
  const [firstAllowedOrigin] = parseAllowedOrigins(env);
  const adminPublicUrl = normalizeAdminPublicUrl(env.ADMIN_PUBLIC_URL);
  if (firstAllowedOrigin) {
    // ADMIN_ORIGIN allowlist を明示設定している運用（旧経路: admin が別オリジンの
    // CF Pages プロジェクト）でも、ADMIN_PUBLIC_URL がたまたま同じオリジンを指す場合
    // （admin が同一オリジンのサブパスに載る構成で、この allowlist を同一オリジンに向けて
    // 明示設定するケース）は、origin だけの firstAllowedOrigin ではなく basePath 込みの
    // ADMIN_PUBLIC_URL を優先する — でないと admin ではなく root（LIFF アプリ）へ
    // リダイレクトしてしまう。オリジンが違う（本来の想定である別 Pages オリジン）なら
    // 従来どおり allowlist の origin をそのまま使う。
    if (adminPublicUrl && new URL(adminPublicUrl).origin === firstAllowedOrigin) {
      return adminPublicUrl;
    }
    return firstAllowedOrigin;
  }
  return adminPublicUrl ?? '/';
}

/**
 * `ADMIN_PUBLIC_URL` をリダイレクト先として正規化する。`normalizeOrigin`（CORS の
 * Origin ヘッダ比較用、admin-auth-config.ts）とはあえて別関数にしてある —
 * ブラウザが送る Origin ヘッダは常にスキーム+ホストのみなので CORS 判定は origin だけで
 * 正しいが、こちらは「実際にどこへ飛ばすか」なので、パスまで保持しないと three-surfaces
 * 統合後の admin basePath（例: `/console` — 配布ビルドが宣言した値）に戻れなくなる。
 * ルートパス（`/`）は従来どおり origin だけに畳む — 末尾スラッシュの有無で別の文字列になる事故を防ぐ。
 */
function normalizeAdminPublicUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
    return `${u.origin}${path}`;
  } catch {
    return null;
  }
}

function page(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', 'Helvetica Neue', system-ui, sans-serif; background: #f5f7f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 20px; box-shadow: 0 2px 20px rgba(0,0,0,0.06); text-align: center; max-width: 440px; width: 90%; padding: 48px 32px; border: 1px solid rgba(0,0,0,0.04); }
    h1 { font-size: 18px; color: #333; margin-bottom: 16px; }
    p { font-size: 14px; color: #666; line-height: 1.8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

/**
 * Deliberately uniform for every rejection reason. The precise cause goes to
 * the audit log; telling the client whether the signature, the expiry or the
 * replay check failed only helps an attacker.
 */
const DENIED_PAGE = page(
  'ログインできませんでした',
  'このリンクは無効か、既に使用されています。<br>発行元からもう一度アクセスし直してください。',
);

adminSso.get('/admin/sso', async (c) => {
  const secret = c.env.ADMIN_SSO_SECRET?.trim();

  // Feature disabled → indistinguishable from a route that does not exist.
  if (!secret) return c.notFound();

  const noStore = (response: Response): Response => {
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Robots-Tag', 'noindex');
    return response;
  };

  // Misconfiguration is loud, not silent — a too-short shared secret or a
  // topology whose cookie the browser will drop would otherwise surface as a
  // mysterious "SSO does nothing".
  if (secret.length < ADMIN_SSO_MIN_SECRET_LENGTH) {
    console.error(
      `${LOG} refused — ADMIN_SSO_SECRET must be at least ${ADMIN_SSO_MIN_SECRET_LENGTH} characters`,
    );
    return noStore(
      c.html(
        page(
          '設定エラー',
          `ADMIN_SSO_SECRET は ${ADMIN_SSO_MIN_SECRET_LENGTH} 文字以上で設定してください。`,
        ),
        500,
      ),
    );
  }

  if (!c.env.API_KEY) {
    console.error(`${LOG} refused — API_KEY is not configured`);
    return noStore(
      c.html(page('設定エラー', 'API_KEY が設定されていません。'), 500),
    );
  }

  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) {
    console.error(`${LOG} refused — misconfigured topology: ${config.misconfigured}`);
    return noStore(c.html(page('設定エラー', config.misconfigured), 500));
  }

  const token = c.req.query('token') ?? '';
  if (!token) {
    console.warn(`${LOG} rejected reason=missing_token`);
    return noStore(c.html(DENIED_PAGE, 403));
  }

  const now = Math.floor(Date.now() / 1000);
  const verified = await verifyAdminSsoToken(secret, token, now);
  if (!verified.ok) {
    console.warn(`${LOG} rejected reason=${verified.reason}`);
    return noStore(c.html(DENIED_PAGE, 403));
  }

  const { jti, exp, sub } = verified.payload;
  const subject = sanitizeForLog(sub);

  // Burn the jti. Any failure here (most likely migration 070 not applied) must
  // fail closed — granting a session we cannot make single-use would silently
  // turn every SSO link into a reusable credential.
  let ledger: Awaited<ReturnType<typeof consumeAdminSsoJti>>;
  try {
    ledger = await consumeAdminSsoJti(c.env.DB, jti, exp, now);
  } catch (error) {
    console.error(
      `${LOG} refused — replay ledger unavailable (is migration 070_admin_sso_jti applied?)`,
      error,
    );
    return noStore(
      c.html(
        page('設定エラー', 'SSO のリプレイ防止テーブルを利用できません。'),
        500,
      ),
    );
  }

  if (!ledger.consumed) {
    console.warn(`${LOG} rejected reason=replay jti=${jti} sub=${subject}`);
    return noStore(c.html(DENIED_PAGE, 403));
  }

  console.log(`${LOG} accepted jti=${jti} sub=${subject} exp=${exp} purged=${ledger.purged}`);

  const csrfToken = crypto.randomUUID();
  c.header('Set-Cookie', adminSessionCookie(c.env.API_KEY, config.sameSite), { append: true });
  c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite), { append: true });
  return noStore(c.redirect(adminHomeUrl(c.env), 302));
});
