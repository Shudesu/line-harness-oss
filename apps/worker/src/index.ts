import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { LineClient } from '@line-crm/line-sdk';
import {
  getLineAccounts,
  getTrafficPoolBySlug,
  getTrafficPoolById,
  getRandomPoolAccount,
  getPoolAccounts,
  getEntryRouteByRefCode,
  getLineAccountById,
  getAffiliateLinkByRefCode,
  incrementAffiliateLinkClick,
} from '@line-crm/db';
import { processStepDeliveries } from './services/step-delivery.js';
import { processScheduledBroadcasts, processQueuedBroadcasts } from './services/broadcast.js';
import { processReminderDeliveries } from './services/reminder-delivery.js';
import { checkAccountHealth } from './services/ban-monitor.js';
import { refreshLineAccessTokens } from './services/token-refresh.js';
import { processInsightFetch } from './services/insight-fetcher.js';
import { processDueReminders } from './services/booking-reminders.js';
import { runExpirer } from './services/booking-expirer.js';
import { processDueEventReminders } from './services/event-booking-reminders.js';
import { runEventBookingExpirer } from './services/event-booking-expirer.js';
import { sendEventBookingNotification } from './services/event-booking-notifier.js';
import { sendBookingNotification } from './services/booking-notifier.js';
import { DEFAULT_ACCOUNT_SETTINGS } from './services/booking-types.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { webhook } from './routes/webhook.js';
import { friends } from './routes/friends.js';
import { tags } from './routes/tags.js';
import { scenarios } from './routes/scenarios.js';
import { broadcasts } from './routes/broadcasts.js';
import { users } from './routes/users.js';
import { lineAccounts } from './routes/line-accounts.js';
import { organizations } from './routes/organizations.js';
import { conversions } from './routes/conversions.js';
import { affiliates } from './routes/affiliates.js';
import { affiliateOffers } from './routes/affiliate-offers.js';
import { duplicates } from './routes/duplicates.js';
import { usersGrouped } from './routes/users-grouped.js';
import { inbox } from './routes/inbox.js';
import { openapi } from './routes/openapi.js';
import { liffRoutes } from './routes/liff.js';
import { affiliateSelfRoutes } from './routes/affiliate-self.js';
// Round 3 ルート
import { webhooks } from './routes/webhooks.js';
import { calendar } from './routes/calendar.js';
import { reminders } from './routes/reminders.js';
import { scoring } from './routes/scoring.js';
import { templates } from './routes/templates.js';
import { chats } from './routes/chats.js';
import { conversations } from './routes/conversations.js';
// notifications ルート (notification_rules CRUD + notifications 一覧) は
// インボックス機能 (/api/inbox/unanswered) に置き換えたため削除。
// DB テーブル notification_rules / notifications は archive 目的で残してある。
import { stripe } from './routes/stripe.js';
import { health } from './routes/health.js';
import { automations } from './routes/automations.js';
import { richMenus } from './routes/rich-menus.js';
import { trackedLinks } from './routes/tracked-links.js';
import { entryRoutes } from './routes/entry-routes.js';
import { forms } from './routes/forms.js';
import { adPlatforms } from './routes/ad-platforms.js';
import { staff } from './routes/staff.js';
import { capabilities } from './routes/capabilities.js';
import { images } from './routes/images.js';
import { accountSettings } from './routes/account-settings.js';
import { setup } from './routes/setup.js';
import { autoReplies } from './routes/auto-replies.js';
import { adminAuth } from './routes/admin-auth.js';
import { resolveCorsOrigin } from './middleware/admin-auth-config.js';
import booking from './routes/booking.js';
import events from './routes/events.js';
import { trafficPools } from './routes/traffic-pools.js';
import { meetCallback } from './routes/meet-callback.js';
import { messageTemplates } from './routes/message-templates.js';
import dedupPreview from './routes/dedup-preview.js';
import { profileRefresh } from './routes/profile-refresh.js';
import { richMenuGroups } from './routes/rich-menu-groups.js';
import adminVersion from './routes/admin-version.js';
import adminUpdate from './routes/admin-update.js';
import { isLinkPreviewBot } from './lib/og-bot.js';
import { buildOgHtml } from './lib/og-html.js';
import {
  resolveOgForEvent,
  resolveOgForForm,
  resolveOgForAccount,
} from './lib/og-resolver.js';

export type Env = {
  Bindings: {
    DB: D1Database;
    IMAGES: R2Bucket;
    ASSETS: Fetcher;
    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    API_KEY: string;
    LEGACY_API_KEY?: string;
    LIFF_URL: string;
    LINE_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_SECRET: string;
    WORKER_URL: string;
    // Admin auth topology (see middleware/admin-auth-config.ts):
    ADMIN_ORIGIN?: string;          // Comma-separated admin web origin allowlist for credentialed CORS
    ADMIN_COOKIE_SAMESITE?: string; // Optional override: 'Strict' | 'Lax' | 'None'
    ADMIN_ALLOW_CROSS_SITE?: string; // 'true' opts into SameSite=None cross-site cookies
    X_HARNESS_URL?: string;  // Optional: X Harness API URL for account linking
    IG_HARNESS_URL?: string;  // Optional: IG Harness API URL for cross-platform linking
    IG_HARNESS_LINK_SECRET?: string;  // Shared secret for IG Harness link-line webhook
    // Optional: enables LLM fallback replies (services/llm-reply.ts) for
    // free-text messages that don't match any auto_replies rule. Per-account
    // opt-in/prompt lives in account_settings (key='llm_reply_enabled' /
    // 'llm_system_prompt'); this secret just supplies the API credential.
    ANTHROPIC_API_KEY?: string;
    // Optional: Groq-based free-text support (services/groq-pipeline.ts).
    // Per-account opt-in via account_settings key='groq_reply_enabled'.
    // When set, takes priority over ANTHROPIC_API_KEY; fail-closed does NOT
    // fall back to Claude (cost guard).
    GROQ_API_KEY?: string;
    // Phase 5 self-update — consumed by /admin/update/*. Defaults live in
    // wrangler.toml [vars]; secrets (CF_API_TOKEN, ADMIN_API_KEY) come from
    // `wrangler secret put`. All are optional at the type level so the rest
    // of the worker still type-checks in test environments that don't set
    // them; the /admin/update/* route guards on their presence at runtime.
    ADMIN_API_KEY?: string;
    CF_API_TOKEN?: string;
    CF_ACCOUNT_ID?: string;
    WORKER_NAME?: string;
    ADMIN_PAGES_PROJECT?: string;
    LIFF_PAGES_PROJECT?: string;
    D1_DATABASE_ID?: string;
    MANIFEST_URL?: string;
    WORKER_PUBLIC_URL?: string;
    ADMIN_PUBLIC_URL?: string;
    LIFF_PUBLIC_URL?: string;
  };
  Variables: {
    staff: { id: string; name: string; role: 'owner' | 'admin' | 'staff' };
  };
};

const app = new Hono<Env>();

// CORS — credentialed cookie auth cannot use a wildcard origin. Reflect only
// same-origin requests and origins on the ADMIN_ORIGIN allowlist; everything
// else gets no Access-Control-Allow-Origin header (browser blocks it). Bearer
// SDK/MCP callers send no Origin header and are unaffected.
app.use('*', cors({
  origin: (origin, c) => resolveCorsOrigin(c.env, origin, c.req.url),
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'x-admin-api-key'],
  maxAge: 600,
}));

// Rate limiting — runs before auth to block abuse early
app.use('*', rateLimitMiddleware);

// Auth middleware — skips /webhook and /docs automatically
app.use('*', authMiddleware);

// Mount route groups — MVP & Round 2
app.route('/', webhook);
app.route('/', friends);
app.route('/', tags);
app.route('/', scenarios);
app.route('/', broadcasts);
app.route('/', users);
app.route('/', lineAccounts);
app.route('/', organizations);
app.route('/', conversions);
app.route('/', affiliates);
app.route('/', affiliateOffers);
app.route('/', duplicates);
app.route('/', usersGrouped);
app.route('/', inbox);
app.route('/', openapi);
app.route('/', liffRoutes);
app.route('/', affiliateSelfRoutes);

// Mount route groups — Round 3
app.route('/', webhooks);
app.route('/', calendar);
app.route('/', reminders);
app.route('/', scoring);
app.route('/', templates);
app.route('/', chats);
app.route('/', conversations);
app.route('/', stripe);
app.route('/', health);
app.route('/', automations);
app.route('/', richMenus);
app.route('/', trackedLinks);
app.route('/', entryRoutes);
app.route('/', forms);
app.route('/', adPlatforms);
app.route('/', staff);
app.route('/', capabilities);
app.route('/', images);
app.route('/', setup);
app.route('/', autoReplies);
app.route('/', adminAuth);
app.route('/', trafficPools);
app.route('/', booking);
app.route('/', events);
app.route('/', accountSettings);
app.route('/', meetCallback);
app.route('/', messageTemplates);
app.route('/', dedupPreview);
app.route('/', profileRefresh);
app.route('/', richMenuGroups);

// Phase 5 (upgrade flow) — public build metadata endpoint. Mounted under
// /admin/ but intentionally unauthenticated: the dashboard fetches /admin/version
// before login to render the upgrade banner, and the returned hashes are
// derivable from the deployed bundle. /admin/update/* (Task 18) layers
// ADMIN_API_KEY middleware on subpaths.
app.route('/admin', adminVersion);
// Phase 5 Task 18 — self-update endpoints guarded by x-admin-api-key.
// authMiddleware skips non-/api/ paths so this router owns its own auth gate.
app.route('/admin/update', adminUpdate);

// Self-hosted QR code proxy — prevents leaking ref tokens to third-party services
app.get('/api/qr', async (c) => {
  const data = c.req.query('data');
  if (!data) return c.text('Missing data param', 400);
  const size = c.req.query('size') || '240x240';
  const upstream = `https://api.qrserver.com/v1/create-qr-code/?size=${encodeURIComponent(size)}&data=${encodeURIComponent(data)}`;
  const res = await fetch(upstream);
  if (!res.ok) return c.text('QR generation failed', 502);
  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

// Short link: /r/:ref → universal landing page with LINE open button
// Supports query params: ?form=FORM_ID (auto-push form after friend add)
// Mobile: single CTA → LIFF URL (Universal Link). No UA detection.
// Desktop: QR code encodes LIFF URL.
// Stuck users opt into /r/:ref/help for Safari escape instructions.
app.get('/r/:ref', async (c) => {
  const ref = c.req.param('ref');
  const formId = c.req.query('form') || '';

  // Resolve LIFF URL — priority:
  //   1. entry_route.pool_id (if ref maps to a referral link)
  //   2. URL query ?pool=
  //   3. 'main' fallback
  let liffUrl = c.env.LIFF_URL;
  let pool: Awaited<ReturnType<typeof getTrafficPoolBySlug>> | null = null;

  // 1. entry_route lookup. getTrafficPoolById (unlike getTrafficPoolBySlug)
  // does not filter on is_active, so we ignore disabled pools explicitly to
  // honor the operator's pause action.
  //
  // NOTE: we intentionally do NOT record a ref_tracking row here. The
  // /auth/callback + /api/liff/link path already writes a tracking row when
  // OAuth/LIFF completes, and writing a second landing-page row would
  // double-count every successful click in getEntryRouteFunnel. Landing-page
  // drop-off (clicks that never reach OAuth) is therefore not visible in the
  // funnel; that limitation is intentional pending a dedicated click table.
  const route = await getEntryRouteByRefCode(c.env.DB, ref);
  if (route?.pool_id) {
    const candidate = await getTrafficPoolById(c.env.DB, route.pool_id);
    if (candidate?.is_active) pool = candidate;
  }

  // 1b. affiliate_links fallback (ASP). Only when the ref is NOT a known
  // entry_route: entry_routes owns the ref namespace, so an existing route
  // (even one whose pool is paused) keeps its behavior unchanged. An affiliate
  // ref resolves its LINE account directly (no pool) and lands on that
  // account's LIFF. is_active=0 links still redirect (spec §8) — pausing an
  // affiliate link only stops NEW attribution, never breaks existing links.
  // The click is counted here (the landing page hit), and `ref` still rides
  // through to LIFF state below so the existing ref_tracking flow attributes
  // the eventual friend-add via /auth/callback + /api/liff/link.
  let affiliateResolved = false;
  if (!route) {
    const affiliateLink = await getAffiliateLinkByRefCode(c.env.DB, ref);
    if (affiliateLink) {
      await incrementAffiliateLinkClick(c.env.DB, ref);
      affiliateResolved = true;
      if (affiliateLink.line_account_id) {
        const account = await getLineAccountById(c.env.DB, affiliateLink.line_account_id);
        if (account?.liff_id) liffUrl = `https://liff.line.me/${account.liff_id}`;
      }
      // line_account_id === null → keep the default LIFF_URL (既定アカウント).
    }
  }

  // 2 / 3. fallback to URL query or 'main'. Skipped for affiliate refs, whose
  // account is already resolved above; falling through to the 'main' pool would
  // override the affiliate's chosen account.
  if (!pool && !affiliateResolved) {
    const poolSlug = c.req.query('pool') || 'main';
    pool = await getTrafficPoolBySlug(c.env.DB, poolSlug);
  }

  if (pool) {
    const account = await getRandomPoolAccount(c.env.DB, pool.id);
    if (account) {
      if (account.liff_id) liffUrl = `https://liff.line.me/${account.liff_id}`;
    } else {
      const allAccounts = await getPoolAccounts(c.env.DB, pool.id);
      if (allAccounts.length === 0) {
        if (pool.liff_id) liffUrl = `https://liff.line.me/${pool.liff_id}`;
      }
    }
  }

  // Build LIFF URL with params (direct link for Universal Link)
  const liffIdMatch = liffUrl.match(/liff\.line\.me\/([0-9]+-[A-Za-z0-9]+)/);
  const liffParams = new URLSearchParams();
  if (liffIdMatch) liffParams.set('liffId', liffIdMatch[1]);
  if (ref) liffParams.set('ref', ref);
  if (formId) liffParams.set('form', formId);
  const gate = c.req.query('gate');
  if (gate) liffParams.set('gate', gate);
  const xh = c.req.query('xh');
  if (xh) liffParams.set('xh', xh);
  const ig = c.req.query('ig');
  if (ig) liffParams.set('ig', ig);
  const iga = c.req.query('iga');
  if (iga) liffParams.set('iga', iga);
  const igan = c.req.query('igan');
  if (igan) liffParams.set('igan', igan);
  // LIFF in-app navigation passthrough — OpenChat strips raw liff.line.me
  // URLs, so we accept `page` / `id` here and forward them to the resolved
  // LIFF target. Limited to pages whose client initializer enforces the
  // friend-add gate (initSalonBooking, initEventBooking); page=book/form
  // would bypass that gate and bypass ref-based attribution, so they are
  // intentionally excluded until those initializers are unified.
  const PAGE_PASSTHROUGH_ALLOWED = new Set(['salon-book', 'event', 'event-me']);
  const page = c.req.query('page');
  if (page && PAGE_PASSTHROUGH_ALLOWED.has(page)) liffParams.set('page', page);
  const id = c.req.query('id');
  if (id) liffParams.set('id', id);
  const liffTarget = liffParams.toString() ? `${liffUrl}?${liffParams.toString()}` : liffUrl;

  // Help link carries the *resolved* liff target as `t=` so the help page
  // displays the exact URL the user should paste into a real browser. Without
  // this, pooled refs would re-roll the random pool account on each /r/:ref
  // visit and the help-page paste URL could end up at a different LINE
  // account than the one originally chosen for this user.
  const helpUrl = `/r/${encodeURIComponent(ref)}/help?t=${encodeURIComponent(liffTarget)}`;

  const ua = (c.req.header('user-agent') || '').toLowerCase();
  const isMobile = /iphone|ipad|android|mobile/.test(ua);
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);

  if (isMobile) {
    // OS-aware mobile UI. Per-browser detection (X / IG / FB) intentionally avoided —
    // we only branch on iOS vs Android because the recovery primitives differ:
    //   iOS: long-press the link → iOS context menu shows "LINEで開く" even inside
    //        WKWebView in-app browsers that block tap-driven Universal Links.
    //   Android: intent:// URL launches LINE directly via Android's intent system,
    //        which works even when in-app browsers swallow https links.
    // The same liff.line.me URL still drives Universal Link on the iOS button —
    // long-press is a recovery hint, not a replacement.

    // Build Android intent URL — strips the https:// prefix and appends the intent
    // metadata so Chrome / in-app browsers hand off to the LINE app package.
    // L-Step uses the same shape: jp.naver.line.android with browsable category.
    // S.browser_fallback_url makes Chrome fall back to plain HTTPS when LINE
    // isn't installed or the WebView refuses the intent, so Android users
    // never hit a dead end (they at least land on liff.line.me web).
    const liffPath = liffTarget.replace(/^https:\/\//, '');
    const intentFallback = encodeURIComponent(liffTarget);
    const androidIntent = `intent://${liffPath}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=jp.naver.line.android;S.browser_fallback_url=${intentFallback};end`;
    const buttonHref = isAndroid ? androidIntent : liffTarget;
    // iOS shows long-press hint; Android relies on intent URL alone (long-press
    // on Android opens "Open with…" which is noisier than the intent route).
    const longPressHint = isIOS
      ? '<p class="hint">※開かない場合はボタンを<strong>長押し</strong>して「LINEで開く」を選択</p>'
      : '';

    return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE で開く</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,0.06);text-align:center;max-width:360px;width:90%;padding:40px 28px 32px;border:1px solid rgba(0,0,0,0.04)}
.line-icon{width:48px;height:48px;margin:0 auto 20px}
.line-icon svg{width:48px;height:48px}
.msg{font-size:15px;color:#444;font-weight:500;margin-bottom:28px;line-height:1.6}
.btn{display:block;width:100%;padding:16px;border:none;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;text-align:center;color:#fff;background:#06C755;box-shadow:0 2px 12px rgba(6,199,85,0.2);transition:all .15s}
.btn:active{transform:scale(0.98);opacity:.9}
.hint{font-size:11px;color:#888;margin-top:10px;line-height:1.6}
.hint strong{color:#06C755;font-weight:700}
.help{font-size:12px;color:#999;margin-top:18px;line-height:1.5}
.help a{color:#999;text-decoration:underline}
</style>
</head>
<body>
<div class="card">
<div class="line-icon">
<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#06C755"/><path d="M24 12C17.37 12 12 16.58 12 22.2c0 3.54 2.35 6.65 5.86 8.47-.2.74-.76 2.75-.87 3.17-.14.55.2.54.42.39.18-.12 2.84-1.88 4-2.65.84.13 1.7.22 2.59.22 6.63 0 12-4.58 12-10.2S30.63 12 24 12z" fill="#fff"/></svg>
</div>
<p class="msg">友達追加して始める</p>
<a href="${buttonHref}" class="btn">LINEで開く</a>
${longPressHint}
<p class="help">うまく開けない方は <a href="${helpUrl}">こちら</a></p>
</div>
</body>
</html>`);
  }

  // PC: show QR code page — QR encodes LIFF URL directly
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE で開く</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,0.06);text-align:center;max-width:480px;width:90%;padding:48px;border:1px solid rgba(0,0,0,0.04)}
.line-icon{width:48px;height:48px;margin:0 auto 20px}
.line-icon svg{width:48px;height:48px}
.msg{font-size:15px;color:#444;font-weight:500;margin-bottom:32px;line-height:1.6}
.qr{background:#f9f9f9;border-radius:16px;padding:24px;display:inline-block;margin-bottom:24px;border:1px solid rgba(0,0,0,0.04)}
.qr img{display:block;width:240px;height:240px}
.hint{font-size:13px;color:#999;line-height:1.6}
.footer{font-size:11px;color:#bbb;margin-top:24px;line-height:1.5}
</style>
</head>
<body>
<div class="card">
<div class="line-icon">
<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#06C755"/><path d="M24 12C17.37 12 12 16.58 12 22.2c0 3.54 2.35 6.65 5.86 8.47-.2.74-.76 2.75-.87 3.17-.14.55.2.54.42.39.18-.12 2.84-1.88 4-2.65.84.13 1.7.22 2.59.22 6.63 0 12-4.58 12-10.2S30.63 12 24 12z" fill="#fff"/></svg>
</div>
<p class="msg">スマートフォンで QR コードを読み取ってください</p>
<div class="qr">
<img src="/api/qr?size=240x240&data=${encodeURIComponent(liffTarget)}" alt="QR Code">
</div>
<p class="hint">LINE アプリのカメラまたは<br>スマートフォンのカメラで読み取れます</p>
<p class="footer">友だち追加で全機能を無料体験できます</p>
</div>
</body>
</html>`);
});

// /r/:ref/help — opt-in recovery page when "LINEで開く" didn't launch the app.
// Method 1 (long-press) is iOS's escape hatch — works inside X / IG / FB
// in-app browsers because iOS's context menu is system-level UI floating
// above the WKWebView, so it surfaces "LINEで開く" even when tap-driven
// Universal Links are blocked. This is the L-Step approach.
// Method 2 (URL copy → external browser) is the universal fallback.
// No LINE-Login-web fallback exposed — friction kills conversion.
app.get('/r/:ref/help', (c) => {
  const ref = c.req.param('ref');
  const reqUrl = new URL(c.req.url);
  // Prefer the resolved liff target passed by /r/:ref via ?t= so pooled refs
  // do not re-roll on retry. Fall back to the short /r/:ref URL only when
  // ?t= is missing (e.g. direct navigation to /help without coming from /r/).
  // Reject anything that is not an https://liff.line.me/* URL — never trust
  // user-supplied open redirects.
  const tParam = c.req.query('t') || '';
  let displayUrl: string;
  if (tParam && /^https:\/\/liff\.line\.me\//.test(tParam)) {
    displayUrl = tParam;
  } else {
    // Strip ?t= if it sneaks in unvalidated, but keep other query params
    // (form, gate, xh, ig, pool) for the /r/:ref re-entry.
    const safeParams = new URLSearchParams(reqUrl.search);
    safeParams.delete('t');
    const qs = safeParams.toString();
    displayUrl = `${reqUrl.origin}/r/${encodeURIComponent(ref)}${qs ? '?' + qs : ''}`;
  }
  // Escape URL for safe embedding in HTML attributes and a visible <code>-style block.
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const urlForHtml = escapeHtml(displayUrl);

  const ua = (c.req.header('user-agent') || '').toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  const browserName = isIOS ? 'Safari' : isAndroid ? 'Chrome' : 'ブラウザ（iPhoneは Safari／Androidは Chrome）';

  // Long-press recovery is iOS-only. On Android the intent:// URL on the
  // main page already handles the equivalent recovery without help-page UI.
  const longPressBlock = isIOS ? `<div class="method">
<div class="method-num">1</div>
<div class="method-body">
<div class="method-title">長押しで開く（最も簡単）</div>
<div class="method-desc">前のページに戻り、緑の「LINEで開く」ボタンを<strong>長押し</strong>。表示されたメニューから「<strong>LINEで開く</strong>」を選択してください。</div>
</div>
</div>` : '';
  const copyMethodNum = isIOS ? '2' : '1';

  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINEを開く方法</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:16px}
.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,0.06);max-width:400px;width:100%;padding:28px 24px;border:1px solid rgba(0,0,0,0.04)}
.title{font-size:17px;color:#333;font-weight:700;margin-bottom:20px;text-align:center;line-height:1.5}
.method{display:flex;gap:12px;margin-bottom:20px;align-items:flex-start}
.method-num{flex-shrink:0;width:28px;height:28px;border-radius:50%;background:#06C755;color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;margin-top:1px}
.method-body{flex:1}
.method-title{font-size:14px;font-weight:700;color:#333;margin-bottom:6px}
.method-desc{font-size:13px;color:#666;line-height:1.7}
.method-desc strong{color:#06C755;font-weight:700}
.copy-section{background:#f9f9f9;border-radius:12px;padding:16px;margin-top:8px}
.url-box{background:#fff;border:1px solid #e5e7e5;border-radius:8px;padding:10px 12px;margin-bottom:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#333;word-break:break-all;line-height:1.5;user-select:all;-webkit-user-select:all}
.copy-btn{display:block;width:100%;padding:12px;border:none;border-radius:10px;font-size:13px;font-weight:600;text-align:center;color:#fff;background:#06C755;cursor:pointer;margin-bottom:10px;transition:all .15s;font-family:inherit}
.copy-btn:active{transform:scale(0.98);opacity:.9}
.copy-btn.copied{background:#999}
.copy-hint{font-size:11px;color:#aaa;text-align:center;margin-bottom:8px;line-height:1.5}
.steps{font-size:12px;color:#666;line-height:1.8;padding-left:18px;margin-top:6px}
.steps li::marker{color:#06C755;font-weight:700}
</style>
</head>
<body>
<div class="card">
<p class="title">LINEを開く方法</p>
${longPressBlock}
<div class="method">
<div class="method-num">${copyMethodNum}</div>
<div class="method-body">
<div class="method-title">${browserName}で開く</div>
<div class="method-desc">URLをコピーして${browserName}のアドレスバーに貼り付け</div>
<div class="copy-section">
<div class="url-box" id="urlBox">${urlForHtml}</div>
<button class="copy-btn" id="copyBtn" type="button" data-url="${urlForHtml}">URLをコピー</button>
<p class="copy-hint">うまくコピーできない場合は上のURLを長押しで選択</p>
<ol class="steps">
<li>ホームに戻る</li>
<li>${browserName}を開く</li>
<li>アドレスバーに貼り付け</li>
<li>「LINEで開く」をタップ</li>
</ol>
</div>
</div>
</div>
</div>
<script>
(function(){
  var btn = document.getElementById('copyBtn');
  var url = btn.getAttribute('data-url');
  function showCopied(){
    btn.textContent = '✓ コピーしました';
    btn.classList.add('copied');
    setTimeout(function(){
      btn.textContent = 'URLをコピー';
      btn.classList.remove('copied');
    }, 2000);
  }
  function showFailed(){
    btn.textContent = '上のURLを長押しでコピー';
    btn.classList.add('copied');
    setTimeout(function(){
      btn.textContent = 'URLをコピー';
      btn.classList.remove('copied');
    }, 3000);
  }
  function execFallback(text){
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }
  btn.addEventListener('click', function(){
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(showCopied, function(){
        if (execFallback(url)) { showCopied(); } else { showFailed(); }
      });
    } else if (execFallback(url)) {
      showCopied();
    } else {
      showFailed();
    }
  });
})();
</script>
</body>
</html>`);
});

// /o — `/r/:ref` の ref 解決・追跡を一切行わない明示 liffId 版の open page。
// admin UI が OpenChat / IG DM 等で `liff.line.me` を弾かれるチャネル向けに
// 配布するラップ URL のためのルート。`/r/main` を使うと (a) traffic_pool の
// ランダム pool account に再解決されて選択中アカウントから外れる、
// (b) `ref=main` として ref_tracking / friends.ref_code に書き込まれて
// attribution を汚染する、という 2 つの問題があるため別ルートに分けている。
// 仕様:
// - クエリ: liffId (必須, `<digits>-<id>` 形式) / page / id
// - page は `/r/:ref` と同じ allowlist (salon-book / event / event-me)
// - mobile UA は「LINEで開く」ボタン、desktop は QR を返す (`/r/:ref` 同等)
app.get('/o', async (c) => {
  if (isLinkPreviewBot(c.req.header('user-agent') || '')) {
    return c.html(await buildOgForLiffPath(c.env.DB, new URL(c.req.url)));
  }

  const liffId = c.req.query('liffId') || '';
  if (!/^[0-9]+-[A-Za-z0-9]+$/.test(liffId)) {
    return c.text('Invalid liffId', 400);
  }

  const liffParams = new URLSearchParams();
  liffParams.set('liffId', liffId);
  const PAGE_PASSTHROUGH_ALLOWED = new Set(['salon-book', 'event', 'event-me']);
  const page = c.req.query('page');
  if (page && PAGE_PASSTHROUGH_ALLOWED.has(page)) liffParams.set('page', page);
  const id = c.req.query('id');
  if (id) liffParams.set('id', id);
  const liffTarget = `https://liff.line.me/${liffId}?${liffParams.toString()}`;

  const ua = (c.req.header('user-agent') || '').toLowerCase();
  const isMobile = /iphone|ipad|android|mobile/.test(ua);
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);

  if (isMobile) {
    const liffPath = liffTarget.replace(/^https:\/\//, '');
    const intentFallback = encodeURIComponent(liffTarget);
    const androidIntent = `intent://${liffPath}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=jp.naver.line.android;S.browser_fallback_url=${intentFallback};end`;
    const buttonHref = isAndroid ? androidIntent : liffTarget;
    const longPressHint = isIOS
      ? '<p class="hint">※開かない場合はボタンを<strong>長押し</strong>して「LINEで開く」を選択</p>'
      : '';
    return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE で開く</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,0.06);text-align:center;max-width:360px;width:90%;padding:40px 28px 32px;border:1px solid rgba(0,0,0,0.04)}
.line-icon{width:48px;height:48px;margin:0 auto 20px}
.line-icon svg{width:48px;height:48px}
.msg{font-size:15px;color:#444;font-weight:500;margin-bottom:28px;line-height:1.6}
.btn{display:block;width:100%;padding:16px;border:none;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;text-align:center;color:#fff;background:#06C755;box-shadow:0 2px 12px rgba(6,199,85,0.2);transition:all .15s}
.btn:active{transform:scale(0.98);opacity:.9}
.hint{font-size:11px;color:#888;margin-top:10px;line-height:1.6}
.hint strong{color:#06C755;font-weight:700}
</style>
</head>
<body>
<div class="card">
<div class="line-icon">
<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#06C755"/><path d="M24 12C17.37 12 12 16.58 12 22.2c0 3.54 2.35 6.65 5.86 8.47-.2.74-.76 2.75-.87 3.17-.14.55.2.54.42.39.18-.12 2.84-1.88 4-2.65.84.13 1.7.22 2.59.22 6.63 0 12-4.58 12-10.2S30.63 12 24 12z" fill="#fff"/></svg>
</div>
<p class="msg">LINE で開く</p>
<a href="${buttonHref}" class="btn">LINEで開く</a>
${longPressHint}
</div>
</body>
</html>`);
  }

  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE で開く</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,0.06);text-align:center;max-width:480px;width:90%;padding:48px;border:1px solid rgba(0,0,0,0.04)}
.line-icon{width:48px;height:48px;margin:0 auto 20px}
.line-icon svg{width:48px;height:48px}
.msg{font-size:15px;color:#444;font-weight:500;margin-bottom:32px;line-height:1.6}
.qr{background:#f9f9f9;border-radius:16px;padding:24px;display:inline-block;margin-bottom:24px;border:1px solid rgba(0,0,0,0.04)}
.qr img{display:block;width:240px;height:240px}
.hint{font-size:13px;color:#999;line-height:1.6}
</style>
</head>
<body>
<div class="card">
<div class="line-icon">
<svg viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="12" fill="#06C755"/><path d="M24 12C17.37 12 12 16.58 12 22.2c0 3.54 2.35 6.65 5.86 8.47-.2.74-.76 2.75-.87 3.17-.14.55.2.54.42.39.18-.12 2.84-1.88 4-2.65.84.13 1.7.22 2.59.22 6.63 0 12-4.58 12-10.2S30.63 12 24 12z" fill="#fff"/></svg>
</div>
<p class="msg">スマートフォンで QR コードを読み取ってください</p>
<div class="qr">
<img src="/api/qr?size=240x240&data=${encodeURIComponent(liffTarget)}" alt="QR Code">
</div>
<p class="hint">LINE アプリのカメラまたは<br>スマートフォンのカメラで読み取れます</p>
</div>
</body>
</html>`);
});

// Convenience redirect for /book path
app.get('/book', (c) => c.redirect('/?page=book'));

// URL（パス or クエリ）からイベント/フォーム等のレコードを引いて OGP HTML を組み立てる。
// LIFF アプリの共有 URL は実際には `https://liff.line.me/<LIFF_ID>/?page=event&id=<id>`
// 形式で、Worker に届くときは pathname が `/`、クエリに `page` `id` `liffId` が乗る。
// 旧形式の `/events/:id` パスも残しているのでパスマッチも合わせて見る。
async function buildOgForLiffPath(db: D1Database, url: URL): Promise<string> {
  const pathname = url.pathname;
  const liffIdFromQuery = url.searchParams.get('liffId');
  const pageFromQuery = url.searchParams.get('page');
  const idFromQuery = url.searchParams.get('id');
  const absoluteUrl = url.toString();

  const lookupAccountByLiff = async (liffId: string | null): Promise<any> => {
    if (!liffId) return null;
    return db
      .prepare(`SELECT * FROM line_accounts WHERE liff_id = ?`)
      .bind(liffId)
      .first<any>();
  };
  const lookupAccountById = async (id: string | null): Promise<any> => {
    if (!id) return null;
    return db.prepare(`SELECT * FROM line_accounts WHERE id = ?`).bind(id).first<any>();
  };

  // event: パス `/events/:id` または クエリ `?page=event&id=`
  let eventId: string | null = null;
  const eventPathMatch = pathname.match(/^\/events\/([^/]+)(?:\/(?:confirm|done))?\/?$/);
  if (eventPathMatch) eventId = eventPathMatch[1];
  else if (pageFromQuery === 'event' && idFromQuery) eventId = idFromQuery;

  if (eventId) {
    // liffId クエリでアカウントが特定できる場合は /api/liff/events/:id と
    // 同じ可視性条件（deleted_at IS NULL, is_published=1, target アカウント所属）
    // で event を取得する。未公開・削除済みのイベント情報を bot プレビューに
    // 漏らさない。liffId が無いか不一致なら、最低限の公開条件のみ適用。
    let event: any = null;
    let account: any = null;

    if (liffIdFromQuery) {
      account = await lookupAccountByLiff(liffIdFromQuery);
      if (account) {
        event = await db
          .prepare(
            `SELECT * FROM events
              WHERE id = ? AND deleted_at IS NULL AND is_published = 1 AND (
                (target_type = 'single' AND line_account_id = ?)
                OR (target_type = 'multi-account-dedup'
                    AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
              )`,
          )
          .bind(eventId, account.id, account.id)
          .first<any>();
      }
    }

    if (!event && !liffIdFromQuery) {
      // liffId 指定が URL に無い場合（旧 /events/:id パス等）のみ、event 単独
      // lookup と event 所属 account からの branding を許可する。
      //
      // liffId 指定があるのに strict query が空ということは「URL の liffId
      // アカウントに属さない event」なので、ここで event 単独 lookup に落とすと
      // 他アカの event 詳細・branding が bot プレビューに漏れる。event=null の
      // まま外側のアカウントデフォルト OG（liffId 由来 account）にフォールバック
      // させて漏洩を防ぐ。
      account = null;
      event = await db
        .prepare(
          `SELECT * FROM events WHERE id = ? AND deleted_at IS NULL AND is_published = 1`,
        )
        .bind(eventId)
        .first<any>();
      if (event && event.target_type === 'single' && event.line_account_id) {
        // multi-account-dedup のときは line_account_id が sentinel なので
        // branding に使わない（og:site_name は 'LINE' フォールバック）。
        account = await lookupAccountById(event.line_account_id);
      }
    }

    if (event) {
      const og = resolveOgForEvent(event, account, absoluteUrl);
      return buildOgHtml(og);
    }
  }

  // form: クエリ `?page=form&id=`
  if (pageFromQuery === 'form' && idFromQuery) {
    const form = await db
      .prepare(`SELECT * FROM forms WHERE id = ?`)
      .bind(idFromQuery)
      .first<any>();
    if (form) {
      const account = await lookupAccountByLiff(liffIdFromQuery);
      const og = resolveOgForForm(form, account, absoluteUrl);
      return buildOgHtml(og);
    }
  }

  // フォールバック: アカウントデフォルトのみ
  const account = await lookupAccountByLiff(liffIdFromQuery);
  const og = resolveOgForAccount(account, absoluteUrl);
  return buildOgHtml(og);
}

// 404 fallback — API paths return JSON 404, everything else serves from static assets (LIFF/admin)
export async function notFoundHandler(
  c: import('hono').Context<Env>,
): Promise<Response> {
  const url = new URL(c.req.url);
  const path = url.pathname;
  if (path.startsWith('/api/') || path === '/webhook' || path === '/docs' || path === '/openapi.json') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  // Bot UA (LINE/X/Facebook 等のリンクプレビュー) → OGP HTML を返す
  const ua = c.req.header('user-agent') || '';
  if (isLinkPreviewBot(ua)) {
    const html = await buildOgForLiffPath(c.env.DB, url);
    return c.html(html);
  }

  // Serve static assets (admin dashboard, LIFF pages).
  // ASSETS binding is missing when wrangler runs without a built `dist/client`
  // (fresh clone, vitest, or a deploy where the assets directive was stripped).
  // Without this guard every GET / surfaces as
  // "TypeError: Cannot read properties of undefined (reading 'fetch')".
  if (!c.env.ASSETS || typeof c.env.ASSETS.fetch !== 'function') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
}
app.notFound(notFoundHandler);

// Scheduled handler for cron triggers — runs for all active LINE accounts
async function scheduled(
  event: ScheduledEvent,
  env: Env['Bindings'],
  _ctx: ExecutionContext,
): Promise<void> {
  // Get all active accounts from DB
  const dbAccounts = await getLineAccounts(env.DB);

  // Build LineClient map for insight fetching (keyed by account id)
  const lineClients = new Map<string, LineClient>();
  for (const account of dbAccounts) {
    if (account.is_active) {
      lineClients.set(account.id, new LineClient(account.channel_access_token));
    }
  }
  const defaultLineClient = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);

  // 配信系は1回だけ実行（内部でfriendのline_account_idから正しいlineClientを動的解決）
  // 以前はアカウントごとにループしていたが、アカウントフィルタなしのDBクエリで
  // 全アカウントの配信が各ループで重複実行されていたバグを修正
  // Phase 1: 復旧処理 (batch_offset=-1 → 0 にする軽量な UPDATE のみ) を queue 処理より
  // 先に await 完了させる。これで stalled/stuck から復旧した配信が同じ cron tick の
  // processQueuedBroadcasts に拾われ、復旧レイテンシが 1 tick 縮む。recover は inline 送信を
  // 含まない高速処理なので、先に await しても他ジョブを starve させない。
  const { recoverStalledBroadcasts, recoverStuckDeliveries } = await import('@line-crm/db');
  await Promise.allSettled([
    recoverStalledBroadcasts(env.DB),
    recoverStuckDeliveries(env.DB),
  ]);

  // Booking / event-booking リマインドは時刻厳守 + 軽量 (数件/tick、上限100件) なので、
  // 重い配信・insight ジョブより先に実行する。以前は最後に置かれていたため、
  // 手前のジョブが invocation を止めると数時間分のリマインドが未送信のまま
  // starts_at を過ぎ、「開始後は送らない」ガードで永久 pending になる事故が
  // 発生した (2026-06-01 / 2026-06-15、計 10 件送り漏れ)。
  // token refresh はリマインドより先に済ませる (失効直後トークンでの 401 送信を防ぐ。
  // 旧順序では refresh が先だった invariant の維持)。
  try {
    await refreshLineAccessTokens(env.DB);
  } catch (e) {
    console.error('token refresh error:', e);
  }

  try {
    const result = await processDueReminders(env.DB, {
      now: new Date(),
      sender: sendBookingNotification,
      reminderHoursBefore: DEFAULT_ACCOUNT_SETTINGS.reminder_hours_before,
    });
    if (result.sent + result.failed > 0) {
      console.log(`[booking-reminders] sent=${result.sent} failed=${result.failed}`);
    }
  } catch (e) {
    console.error('booking-reminders error:', e);
  }

  try {
    const result = await processDueEventReminders(env.DB, {
      now: new Date(),
      sender: sendEventBookingNotification,
    });
    if (result.sent + result.failed > 0) {
      console.log(`[event-booking-reminders] sent=${result.sent} failed=${result.failed}`);
    }
  } catch (e) {
    console.error('event-booking-reminders error:', e);
  }

  // Phase 2: 配信系と定期ジョブを並列実行する。processScheduledBroadcasts は tag/all の
  // inline 送信を含み時間がかかり得るため、queue 処理と並列にして互いを block しない
  // (barrier 化すると長い scheduled 送信が queue 処理を待たせる)。scheduled dedup は
  // status='sending', batch_offset=0 に enqueue され、同 tick もしくは次 tick (最大5分、
  // 5分 cron の粒度内) で processQueuedBroadcasts に拾われて分割送信される。
  const jobs = [];
  jobs.push(
    processStepDeliveries(env.DB, defaultLineClient, env.WORKER_URL),
    processScheduledBroadcasts(env.DB, defaultLineClient, env.WORKER_URL),
    processReminderDeliveries(env.DB, defaultLineClient),
  );
  jobs.push(processQueuedBroadcasts(env.DB, defaultLineClient, env.WORKER_URL));
  jobs.push(checkAccountHealth(env.DB));

  await Promise.allSettled(jobs);

  // Fetch broadcast insights (runs daily, self-throttled)
  try {
    await processInsightFetch(env.DB, lineClients, defaultLineClient);
  } catch (e) {
    console.error('Insight fetch error:', e);
  }

  // Booking expirer — runs only on the 6h cron tick.
  if (event.cron === '0 */6 * * *') {
    try {
      const result = await runExpirer(env.DB, {
        now: new Date(),
        sender: sendBookingNotification,
      });
      console.log(
        `[booking-expirer] expired=${result.expired} idempotency_purged=${result.idempotencyPurged}`,
      );
    } catch (e) {
      console.error('booking-expirer error:', e);
    }
  }

  // Event-booking expirer — 6h cron tick.
  if (event.cron === '0 */6 * * *') {
    try {
      const result = await runEventBookingExpirer(env.DB, { now: new Date() });
      console.log(
        `[event-booking-expirer] expired=${result.expired} idempotency_purged=${result.idempotencyPurged}`,
      );
    } catch (e) {
      console.error('event-booking-expirer error:', e);
    }
  }

  // Cross-account duplicate detection — disabled.
  // The cron used to materialize duplicates into the tag system but the 1k-subrequest
  // budget can't drain a 1k+ candidate backlog, and a live SELECT against
  // friends.picture_url / display_name / status_message gives the same answer
  // on demand. Replacement: a /api/duplicates endpoint plus a dashboard view
  // (planned alongside the multi-provider UI work). Keeping the service file
  // (apps/worker/src/services/duplicate-detect.ts) and the existing
  // `重複:` tag rows untouched until that replacement lands.
}

export default {
  fetch: app.fetch,
  scheduled,
};
// redeploy trigger
