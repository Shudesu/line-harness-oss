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
import { conversions } from './routes/conversions.js';
import { affiliates } from './routes/affiliates.js';
import { duplicates } from './routes/duplicates.js';
import { usersGrouped } from './routes/users-grouped.js';
import { inbox } from './routes/inbox.js';
import { openapi } from './routes/openapi.js';
import { liffRoutes } from './routes/liff.js';
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
    X_HARNESS_URL?: string;  // Optional: X Harness API URL for account linking
    IG_HARNESS_URL?: string;  // Optional: IG Harness API URL for cross-platform linking
    IG_HARNESS_LINK_SECRET?: string;  // Shared secret for IG Harness link-line webhook
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    TELEGRAM_ACTION_SECRET?: string;
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

// CORS — allow all origins for MVP
app.use('*', cors({ origin: '*' }));

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
app.route('/', conversions);
app.route('/', affiliates);
app.route('/', duplicates);
app.route('/', usersGrouped);
app.route('/', inbox);
app.route('/', openapi);
app.route('/', liffRoutes);

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

  // 2 / 3. fallback to URL query or 'main'
  if (!pool) {
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

// Convenience redirect for /book path
app.get('/book', (c) => c.redirect('/?page=book'));
app.get('/event-list', async (c) => {
  const liffId = c.req.query('liffId');
  if (!liffId) return c.text('liffId is required', 400);
  c.header('Cache-Control', 'no-store');

  const account = await c.env.DB
    .prepare(`SELECT id FROM line_accounts WHERE liff_id = ? AND is_active = 1`)
    .bind(liffId)
    .first<{ id: string }>();
  if (!account) return c.text('LINE account not found', 404);

  const nowIso = new Date().toISOString();
  const { results } = await c.env.DB
    .prepare(
      `SELECT
         e.id,
         e.name,
         e.venue_name,
         e.image_url,
         e.requires_approval,
         (
           SELECT s.starts_at
             FROM event_slots s
            WHERE s.event_id = e.id
              AND s.deleted_at IS NULL
              AND s.is_active = 1
              AND s.starts_at >= ?
            ORDER BY s.starts_at ASC
            LIMIT 1
         ) AS starts_at,
         (
           SELECT s.ends_at
             FROM event_slots s
            WHERE s.event_id = e.id
              AND s.deleted_at IS NULL
              AND s.is_active = 1
              AND s.starts_at >= ?
            ORDER BY s.starts_at ASC
            LIMIT 1
         ) AS ends_at,
         (
           SELECT COUNT(*)
             FROM event_bookings b
            WHERE b.event_id = e.id
              AND b.status IN ('requested','confirmed')
         ) AS total_active
       FROM events e
       WHERE e.deleted_at IS NULL
         AND e.is_published = 1
         AND (
           (e.target_type = 'single' AND e.line_account_id = ?)
           OR (e.target_type = 'multi-account-dedup'
               AND EXISTS (SELECT 1 FROM json_each(e.account_ids) WHERE value = ?))
         )
         AND EXISTS (
           SELECT 1
             FROM event_slots s
            WHERE s.event_id = e.id
              AND s.deleted_at IS NULL
              AND s.is_active = 1
              AND s.starts_at >= ?
         )
       ORDER BY starts_at ASC, e.sort_order ASC, e.created_at DESC`,
    )
    .bind(nowIso, nowIso, account.id, account.id, nowIso)
    .all<{
      id: string;
      name: string;
      venue_name: string | null;
      image_url: string | null;
      requires_approval: number;
      starts_at: string;
      ends_at: string;
      total_active: number;
    }>();

  const esc = (value: unknown): string =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const fmtDate = (iso: string): string =>
    new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).format(new Date(iso));
  const fmtTime = (iso: string): string =>
    new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  const eventUrl = (id: string): string =>
    `https://liff.line.me/${encodeURIComponent(liffId)}?page=event&id=${encodeURIComponent(id)}&liffId=${encodeURIComponent(liffId)}`;
  const historyUrl = (): string =>
    `https://liff.line.me/${encodeURIComponent(liffId)}?page=event-me&liffId=${encodeURIComponent(liffId)}`;
  const items = (results ?? [])
    .map((event) => {
      const image = event.image_url
        ? `<img class="event-image" src="${esc(event.image_url)}" alt="">`
        : `<div class="event-image placeholder"></div>`;
      return `<article class="event-card">
        ${image}
        <div class="event-body">
          <div class="event-title-row">
            <h2>${esc(event.name)}</h2>
            ${event.requires_approval === 1 ? '<span class="badge">承認制</span>' : ''}
          </div>
          <p class="date">${esc(fmtDate(event.starts_at))}</p>
          <p class="time">${esc(fmtTime(event.starts_at))} - ${esc(fmtTime(event.ends_at))}</p>
          ${event.venue_name ? `<p class="venue">${esc(event.venue_name)}</p>` : ''}
          <p class="capacity">原則MAX16名</p>
          <a class="button" href="${esc(eventUrl(event.id))}">詳細・予約へ</a>
        </div>
      </article>`;
    })
    .join('');

  return c.html(`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>茶はいダーツバー西新宿Luuイベント予約</title>
  <style>
    :root { color-scheme: light; --green: #06c755; --ink: #111827; --muted: #6b7280; --line: #e5e7eb; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fa; color: var(--ink); }
    header { position: sticky; top: 0; z-index: 2; background: var(--green); color: #fff; padding: 16px 18px; box-shadow: 0 1px 8px rgba(0,0,0,.08); }
    header h1 { margin: 0; font-size: 18px; line-height: 1.35; }
    header p { margin: 4px 0 0; font-size: 13px; opacity: .92; }
    main { width: min(720px, 100%); margin: 0 auto; padding: 16px; }
    .event-list { display: grid; gap: 14px; }
    .event-card { background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(15,23,42,.05); }
    .event-image { display: block; width: 100%; height: 132px; object-fit: cover; background: #dcfce7; }
    .event-image.placeholder { display: block; height: 28px; }
    .event-body { padding: 14px; }
    .event-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    h2 { margin: 0; font-size: 16px; line-height: 1.45; }
    .badge { flex: 0 0 auto; background: #fef3c7; color: #92400e; border-radius: 999px; padding: 4px 8px; font-size: 11px; font-weight: 700; }
    p { margin: 0; }
    .date { margin-top: 10px; font-size: 15px; font-weight: 700; }
    .time { margin-top: 3px; font-size: 15px; }
    .venue, .capacity { margin-top: 8px; font-size: 13px; color: var(--muted); }
    .button { display: block; margin-top: 14px; width: 100%; border-radius: 8px; background: var(--green); color: #fff; text-align: center; text-decoration: none; font-weight: 800; padding: 13px 14px; }
    .guide-box { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin-bottom: 14px; box-shadow: 0 1px 4px rgba(15,23,42,.05); }
    .guide-box p { color: var(--muted); font-size: 13px; line-height: 1.65; }
    .history-link { display: block; margin-top: 10px; width: 100%; border-radius: 8px; background: #fff; color: var(--green); border: 1.5px solid var(--green); text-align: center; text-decoration: none; font-weight: 800; padding: 12px 14px; }
    .history-box { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin-bottom: 14px; box-shadow: 0 1px 4px rgba(15,23,42,.05); }
    .history-box p { color: var(--muted); font-size: 13px; line-height: 1.6; }
    .history-button { display: block; width: 100%; border: 0; margin-top: 10px; border-radius: 8px; background: #dc2626; color: #fff; text-align: center; text-decoration: none; font-weight: 800; padding: 12px 14px; font-size: 15px; }
    .history-status { margin-top: 10px; color: var(--muted); font-size: 13px; line-height: 1.6; }
    .booking-list { display: grid; gap: 10px; margin-top: 12px; }
    .booking-card { border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: #fafafa; }
    .booking-card h3 { margin: 0; font-size: 14px; line-height: 1.4; }
    .booking-card .meta { margin-top: 6px; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .cancel-button { margin-top: 10px; width: 100%; border: 1px solid #fecaca; border-radius: 8px; background: #fff1f2; color: #dc2626; font-weight: 800; padding: 10px 12px; }
    .empty { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 32px 16px; text-align: center; color: var(--muted); }
  </style>
  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
</head>
<body>
  <header>
    <h1>茶はいダーツバー西新宿Luuイベント予約</h1>
    <p>参加したい交流会を選択してください</p>
  </header>
  <main>
    <section class="guide-box">
      <p>予約内容の確認・キャンセルは予約履歴からできます。</p>
      <a class="history-link" href="${esc(historyUrl())}">予約履歴を見る</a>
    </section>
    <section class="event-list">
      ${items || '<div class="empty">現在受付中のイベントはありません。</div>'}
    </section>
  </main>
  <script>
(function(){
  var LIFF_ID = ${JSON.stringify(liffId)};
  var button = document.getElementById('loadHistoryButton');
  var status = document.getElementById('historyStatus');
  var list = document.getElementById('bookingList');
  var liffReady = false;
  var activeRun = 0;
  if (!button || !status || !list) return;

  function setStatus(text) {
    status.textContent = text || '';
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function formatJp(iso) {
    try {
      return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(new Date(iso));
    } catch (e) {
      return iso || '';
    }
  }
  function timeoutError(label) {
    var err = new Error(label + '_timeout');
    err.code = label + '_timeout';
    return err;
  }
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise(function(_, reject){
        setTimeout(function(){ reject(timeoutError(label)); }, ms);
      })
    ]);
  }
  async function fetchJsonWithTimeout(url, options, ms, label) {
    var controller = new AbortController();
    var timer = setTimeout(function(){ controller.abort(); }, ms);
    try {
      return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
    } catch (e) {
      if (e && e.name === 'AbortError') throw timeoutError(label);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  function canCancel(booking) {
    if (booking.status !== 'requested' && booking.status !== 'confirmed') return false;
    if (booking.cancel_deadline_hours_before == null) return false;
    var deadline = new Date(booking.slot_starts_at).getTime() - Number(booking.cancel_deadline_hours_before) * 3600000;
    return deadline > Date.now();
  }
  async function ensureIdToken() {
    if (!window.liff) throw new Error('LIFF SDKを読み込めませんでした。LINEアプリ内で開き直してください。');
    if (!liffReady) {
      setStatus('LINE認証を準備しています...');
      await withTimeout(window.liff.init({ liffId: LIFF_ID, withLoginOnExternalBrowser: true }), 12000, 'liff_init');
      liffReady = true;
    }
    setStatus('LINEログイン状態を確認しています...');
    if (!window.liff.isLoggedIn()) {
      try { sessionStorage.setItem('lh_event_history_after_login', '1'); } catch (e) {}
      setStatus('LINEログインへ移動します。移動しない場合はLINEアプリ内で開き直してください。');
      window.liff.login({ redirectUri: window.location.href });
      return null;
    }
    var idToken = window.liff.getIDToken();
    if (!idToken) throw new Error('LINE認証情報を取得できませんでした。LINEアプリ内で開き直してください。');
    return idToken;
  }
  async function apiGet(path, idToken) {
    var url = new URL(path, window.location.origin);
    url.searchParams.set('liffId', LIFF_ID);
    var res = await fetchJsonWithTimeout(url.toString(), { headers: { Authorization: 'Bearer ' + idToken } }, 12000, 'history_fetch');
    if (!res.ok) throw new Error('予約履歴の取得に失敗しました');
    return res.json();
  }
  async function apiPost(path, idToken) {
    var url = new URL(path, window.location.origin);
    url.searchParams.set('liffId', LIFF_ID);
    var res = await fetchJsonWithTimeout(url.toString(), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' },
      body: '{}'
    }, 12000, 'cancel_fetch');
    if (!res.ok) {
      var text = await res.text().catch(function(){ return ''; });
      throw new Error(text || 'キャンセルに失敗しました');
    }
    return res.json();
  }
  function renderBookings(items, idToken) {
    if (!items.length) {
      list.innerHTML = '<div class="empty">これからの予約はありません。</div>';
      return;
    }
    list.innerHTML = items.map(function(booking){
      var cancel = canCancel(booking)
        ? '<button class="cancel-button" data-booking-id="' + escapeHtml(booking.id) + '" data-event-name="' + escapeHtml(booking.event_name) + '">キャンセルする</button>'
        : '';
      return '<article class="booking-card">' +
        '<h3>' + escapeHtml(booking.event_name) + '</h3>' +
        '<div class="meta">' + escapeHtml(formatJp(booking.slot_starts_at)) + '<br>' + escapeHtml(booking.venue_name || '') + '</div>' +
        cancel +
      '</article>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-booking-id]'), function(cancelButton){
      cancelButton.addEventListener('click', async function(){
        var eventName = cancelButton.getAttribute('data-event-name') || 'この予約';
        if (!confirm('「' + eventName + '」をキャンセルしますか？')) return;
        cancelButton.disabled = true;
        setStatus('キャンセル処理中です...');
        try {
          await apiPost('/api/liff/events/me/' + encodeURIComponent(cancelButton.getAttribute('data-booking-id')) + '/cancel', idToken);
          setStatus('キャンセルしました。');
          await loadHistory();
        } catch (e) {
          setStatus(e instanceof Error ? e.message : String(e));
          cancelButton.disabled = false;
        }
      });
    });
  }
  async function loadHistory() {
    var runId = ++activeRun;
    list.innerHTML = '';
    setStatus('予約履歴を読み込んでいます...');
    button.disabled = true;
    var watchdog = setTimeout(function(){
      if (runId !== activeRun) return;
      setStatus('読み込みに時間がかかっています。LINEアプリ内で開き直すか、イベント名とお名前をこのLINEに送ってください。');
      button.disabled = false;
    }, 15000);
    try {
      var idToken = await ensureIdToken();
      if (!idToken) return;
      setStatus('予約履歴を取得しています...');
      var data = await apiGet('/api/liff/events/me?tab=upcoming', idToken);
      if (runId !== activeRun) return;
      renderBookings(data.items || [], idToken);
      setStatus('');
    } catch (e) {
      if (runId !== activeRun) return;
      if (e && (e.code === 'liff_init_timeout' || e.code === 'history_fetch_timeout')) {
        setStatus('読み込みに時間がかかっています。LINEアプリ内で開き直すか、イベント名とお名前をこのLINEに送ってください。');
      } else {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    } finally {
      clearTimeout(watchdog);
      if (runId === activeRun) button.disabled = false;
    }
  }
  button.addEventListener('click', function(){ void loadHistory(); });
  try {
    if (sessionStorage.getItem('lh_event_history_after_login') === '1') {
      sessionStorage.removeItem('lh_event_history_after_login');
      setTimeout(function(){ void loadHistory(); }, 300);
    }
  } catch (e) {}
})();
  </script>
</body>
</html>`);
});

// 404 fallback — API paths return JSON 404, everything else serves from static assets (LIFF/admin)
export const notFoundHandler = async (c: Parameters<typeof app.notFound>[0] extends (ctx: infer C) => unknown ? C : never) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/') || path === '/webhook' || path === '/docs' || path === '/openapi.json') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  // Serve static assets (admin dashboard, LIFF pages)
  if (c.env.ASSETS && typeof c.env.ASSETS.fetch === 'function') {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ success: false, error: 'Not found' }, 404);
};

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
  const jobs = [];
  jobs.push(
    processStepDeliveries(env.DB, defaultLineClient, env.WORKER_URL),
    processScheduledBroadcasts(env.DB, defaultLineClient, env.WORKER_URL),
    processReminderDeliveries(env.DB, defaultLineClient),
  );
  // キュー処理は1回だけ実行（内部でアカウント別lineClientを解決する）
  // ロック解除: タイムアウトでstuckした配信を復旧
  const { recoverStalledBroadcasts, recoverStuckDeliveries } = await import('@line-crm/db');
  jobs.push(recoverStuckDeliveries(env.DB));
  jobs.push(recoverStalledBroadcasts(env.DB));
  jobs.push(processQueuedBroadcasts(env.DB, defaultLineClient, env.WORKER_URL));
  jobs.push(checkAccountHealth(env.DB));
  jobs.push(refreshLineAccessTokens(env.DB));

  await Promise.allSettled(jobs);

  // Fetch broadcast insights (runs daily, self-throttled)
  try {
    await processInsightFetch(env.DB, lineClients, defaultLineClient);
  } catch (e) {
    console.error('Insight fetch error:', e);
  }

  // Booking reminders — every 5-minute tick scans due reminders.
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

  // Event-booking reminders — every 5-minute tick scans due reminders.
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
