import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { LineClient } from '@line-crm/line-sdk';
import { getLineAccounts, getTrafficPoolBySlug, getRandomPoolAccount, getPoolAccounts } from '@line-crm/db';
import { processStepDeliveries } from './services/step-delivery.js';
import { processScheduledBroadcasts, processQueuedBroadcasts } from './services/broadcast.js';
import { processReminderDeliveries } from './services/reminder-delivery.js';
import { checkAccountHealth } from './services/ban-monitor.js';
import { refreshLineAccessTokens } from './services/token-refresh.js';
import { processInsightFetch } from './services/insight-fetcher.js';
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
import { notifications } from './routes/notifications.js';
import { stripe } from './routes/stripe.js';
import { health } from './routes/health.js';
import { automations } from './routes/automations.js';
import { richMenus } from './routes/rich-menus.js';
import { trackedLinks } from './routes/tracked-links.js';
import { forms } from './routes/forms.js';
import { adPlatforms } from './routes/ad-platforms.js';
import { staff } from './routes/staff.js';
import { capabilities } from './routes/capabilities.js';
import { images } from './routes/images.js';
import { accountSettings } from './routes/account-settings.js';
import { setup } from './routes/setup.js';
import { autoReplies } from './routes/auto-replies.js';
import { trafficPools } from './routes/traffic-pools.js';
import { meetCallback } from './routes/meet-callback.js';
import { messageTemplates } from './routes/message-templates.js';

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
app.route('/', notifications);
app.route('/', stripe);
app.route('/', health);
app.route('/', automations);
app.route('/', richMenus);
app.route('/', trackedLinks);
app.route('/', forms);
app.route('/', adPlatforms);
app.route('/', staff);
app.route('/', capabilities);
app.route('/', images);
app.route('/', setup);
app.route('/', autoReplies);
app.route('/', trafficPools);
app.route('/', accountSettings);
app.route('/', meetCallback);
app.route('/', messageTemplates);

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

  // Resolve LIFF URL from pool (same logic as /auth/line)
  let liffUrl = c.env.LIFF_URL;
  const poolSlug = c.req.query('pool') || 'main';
  const pool = await getTrafficPoolBySlug(c.env.DB, poolSlug);
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

// 404 fallback — API paths return JSON 404, everything else serves from static assets (LIFF/admin)
app.notFound(async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/') || path === '/webhook' || path === '/docs' || path === '/openapi.json') {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  // Serve static assets (admin dashboard, LIFF pages)
  return c.env.ASSETS.fetch(c.req.raw);
});

// Scheduled handler for cron triggers — runs for all active LINE accounts
async function scheduled(
  _event: ScheduledEvent,
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

  // Cross-account duplicate detection & auto-tagging
  try {
    const { processDuplicateDetection } = await import('./services/duplicate-detect.js');
    await processDuplicateDetection(env.DB);
  } catch (e) {
    console.error('Duplicate detection error:', e);
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
// redeploy trigger
