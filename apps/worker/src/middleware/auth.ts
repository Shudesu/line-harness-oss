import type { Context, Next } from 'hono';
import { getStaffByApiKey } from '@line-crm/db';
import type { Env } from '../index.js';

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  // LIFF / admin の SPA アセットは Authorization ヘッダなしで HTML を取りに
  // くる。Worker は API 以外のパスを ASSETS バインディングから配信するので、
  // /api/ で始まらないパスは認証 skip して static asset として返す。
  // (admin は別ホスト、Worker の non-API path はすべて LIFF/SPA 経由)
  if (!path.startsWith('/api/')) {
    // ただし内部用エンドポイント (/webhook, /auth, /setup) は元の skip 判定に任せる
    if (
      path !== '/webhook' &&
      !path.startsWith('/auth/') &&
      path !== '/setup' &&
      !path.startsWith('/t/') &&
      !path.startsWith('/r/') &&
      !path.startsWith('/pool/') &&
      !path.startsWith('/images/')
    ) {
      return next();
    }
  }
  if (
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/pool/') ||
    path.startsWith('/images/') ||
    // 画像 src として <img> 経由でブラウザが取得するため (Authorization ヘッダ不可)。
    // R2 key 内に group_id / page_id (UUID) が含まれるので推測困難。draft 画像も
    // 最終的に LINE 上で公開されるため機密性は低い。
    path.startsWith('/api/rich-menu-images/') ||
    // LINE 上 rich menu 画像 proxy (Authorization ヘッダなしで <img src> 経由表示)
    path.match(/^\/api\/rich-menu-groups\/external\/[^/]+\/image$/) ||
    path.startsWith('/api/liff/') ||
    path.startsWith('/auth/') ||
    path === '/setup' ||
    path === '/api/integrations/stripe/webhook' ||
    // L-TRACK 互換: EC 等の外部システムから成果受信。内部で HMAC 署名検証 + replay 抑止。
    path.match(/^\/api\/external-events\/[^/]+\/receive$/) ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    // /api/forms/:id/submit and /api/forms/:id/partial must skip the
    // global Authorization-header gate because the LIFF client cannot
    // attach a Bearer API_KEY (the key would have to be embedded in the
    // page = trivially exfiltrated). The routes themselves enforce
    // fail-closed `idToken` authentication in the body: missing / invalid
    // id_token returns 401, mismatching line_account_id returns 403, and
    // the friend is always resolved from the verified `sub` — client-supplied
    // friendId / lineUserId are explicitly ignored. See routes/forms.ts
    // (the POST handlers for /submit and /partial).
    //
    // /opened stays public — it is a non-mutating telemetry write
    // (form_opens table only) used by LIFF's first-paint beacon.
    path.match(/^\/api\/forms\/[^/]+\/opened$/) ||
    path.match(/^\/api\/forms\/[^/]+\/submit$/) ||
    path.match(/^\/api\/forms\/[^/]+\/partial$/) ||
    path.match(/^\/api\/forms\/[^/]+$/) || // GET form definition (public for LIFF)
    path === '/api/meet-callback' || // Meet Harness completion callback
    path === '/api/qr' // Public QR proxy — used by desktop landing pages
  ) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);

  // Check staff_members table first
  const staff = await getStaffByApiKey(c.env.DB, token);
  if (staff) {
    c.set('staff', { id: staff.id, name: staff.name, role: staff.role });
    return next();
  }

  // Fallback: env API_KEY acts as owner (current rotation slot)
  if (token === c.env.API_KEY) {
    c.set('staff', { id: 'env-owner', name: 'Owner', role: 'owner' as const });
    return next();
  }

  // Legacy fallback: LEGACY_API_KEY accepted during rotation grace period.
  // Uses the same staff.id as primary so /api/staff/me's special-case keeps
  // working. Logs accept_via=LEGACY_API_KEY so operators can confirm zero
  // legacy usage before deleting the secret to revoke the old key.
  // Same-value guard: if both env vars are set to the same secret, the
  // primary check above already accepts it; this branch must skip to avoid
  // false LEGACY counters.
  if (
    c.env.LEGACY_API_KEY &&
    c.env.LEGACY_API_KEY !== c.env.API_KEY &&
    token === c.env.LEGACY_API_KEY
  ) {
    c.set('staff', { id: 'env-owner', name: 'Owner', role: 'owner' as const });
    console.log('[auth] accept_via=LEGACY_API_KEY');
    return next();
  }

  return c.json({ success: false, error: 'Unauthorized' }, 401);
}
