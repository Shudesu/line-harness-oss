import { Hono } from 'hono';
import {
  getFriendByLineUserId,
  createUser,
  getUserByEmail,
  linkFriendToUser,
  upsertFriend,
  getEntryRouteByRefCode,
  recordRefTracking,
  addTagToFriend,
  getLineAccountByChannelId,
  getLineAccountById,
  getLineAccounts,
  getTrafficPoolBySlug,
  getRandomPoolAccount,
  getTrackedLinkById,
  getMessageTemplateById,
  jstNow,
} from '@line-crm/db';
import { buildIntroMessage } from '../services/intro-message.js';
import type { Env } from '../index.js';

const liffRoutes = new Hono<Env>();

// ─── LINE Login OAuth (bot_prompt=aggressive) ───────────────────

/**
 * GET /auth/line — redirect to LINE Login with bot_prompt=aggressive
 *
 * This is THE friend-add URL. Put this on LPs, SNS, ads.
 * Query params:
 *   ?ref=xxx     — attribution tracking
 *   ?redirect=url — redirect after completion
 *   ?gclid=xxx   — Google Ads click ID
 *   ?fbclid=xxx  — Meta Ads click ID
 *   ?utm_source=xxx, utm_medium, utm_campaign, utm_content, utm_term — UTM params
 */
liffRoutes.get('/auth/line', async (c) => {
  const ref = c.req.query('ref') || '';
  const redirect = c.req.query('redirect') || '';
  const formId = c.req.query('form') || '';
  const gclid = c.req.query('gclid') || '';
  const fbclid = c.req.query('fbclid') || '';
  const twclid = c.req.query('twclid') || '';
  const ttclid = c.req.query('ttclid') || '';
  const utmSource = c.req.query('utm_source') || '';
  const utmMedium = c.req.query('utm_medium') || '';
  const utmCampaign = c.req.query('utm_campaign') || '';
  let accountParam = c.req.query('account') || '';
  const uidParam = c.req.query('uid') || ''; // existing user UUID for cross-account linking
  const igParam = c.req.query('ig') || ''; // IG Harness IGSID for cross-platform linking
  let poolAccount = ''; // pool's channel_id — passed via state only, not accountParam
  const baseUrl = new URL(c.req.url).origin;

  // X (Twitter) iOS in-app browser since v11.42 uses custom WKWebView that
  // blocks ALL Universal Links / deep links. Same for Instagram, Facebook,
  // LINE in-app, WeChat. Redirect to /r/ which renders an explicit
  // "Safariで開く" guidance UI. This is one-way — /r/'s OAuth fallback
  // button targets /auth/oauth (not /auth/line), so no loop is possible.
  const ua = c.req.header('user-agent') || '';
  const isInAppBrowser = /twitter|twitterandroid|\b(fbav|fban|instagram|line\/|micromessenger)\b/i.test(ua);
  if (isInAppBrowser && ref) {
    const url = new URL(c.req.url);
    const passthrough = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      if (key !== 'ref') passthrough.set(key, value);
    }
    const qs = passthrough.toString();
    return c.redirect(`/r/${encodeURIComponent(ref)}${qs ? '?' + qs : ''}`);
  }

  // Multi-account: resolve LINE Login channel + LIFF
  // Priority: ?account= param > traffic pool "main" > env default
  let channelId = c.env.LINE_LOGIN_CHANNEL_ID;
  let liffUrl = c.env.LIFF_URL;
  if (accountParam) {
    const account = await getLineAccountByChannelId(c.env.DB, accountParam);
    if (account?.login_channel_id) {
      channelId = account.login_channel_id;
    }
    if (account?.liff_id) {
      liffUrl = `https://liff.line.me/${account.liff_id}`;
    }
  } else {
    // Traffic pool: pick random account from pool for distribution
    // NOTE: accountParam is NOT set here — setting it triggers the cross-account
    // OAuth guard (L123) which skips LIFF on mobile. Pool is not cross-account.
    // Instead, pool's channel_id goes into state only for callback to resolve.
    const poolSlug = c.req.query('pool') || 'main';
    const pool = await getTrafficPoolBySlug(c.env.DB, poolSlug);
    if (pool) {
      const account = await getRandomPoolAccount(c.env.DB, pool.id);
      if (account) {
        if (account.login_channel_id) channelId = account.login_channel_id;
        if (account.liff_id) liffUrl = `https://liff.line.me/${account.liff_id}`;
        if (account.channel_id) poolAccount = account.channel_id;
      } else {
        // Check if pool_accounts exist at all (vs all disabled)
        const { getPoolAccounts } = await import('@line-crm/db');
        const allAccounts = await getPoolAccounts(c.env.DB, pool.id);
        if (allAccounts.length === 0) {
          // No pool_accounts yet — fallback to active_account_id (migration period)
          if (pool.login_channel_id) channelId = pool.login_channel_id;
          if (pool.liff_id) liffUrl = `https://liff.line.me/${pool.liff_id}`;
          if (pool.channel_id) poolAccount = pool.channel_id;
        } else {
          // All pool_accounts disabled — fail closed, don't leak to default account
          return c.text('このリンクは現在利用できません。しばらくしてからお試しください。', 503);
        }
      }
    }
  }
  const callbackUrl = `${baseUrl}/auth/callback`;

  // xh: refs are X Harness one-time tokens — never forward to third-party URLs (liff.line.me / QR)
  // The token must reach /auth/callback, so it IS included in the OAuth state (handled by this worker).
  // It must NOT appear in LIFF URLs or QR codes that escape to external domains.
  const externalRef = ref.startsWith('xh:') ? '' : ref;

  // Build LIFF URL with ref + ad params (for mobile → LINE app)
  // Extract LIFF ID from URL and pass as query param so the app can init correctly
  const liffIdMatch = liffUrl.match(/liff\.line\.me\/([0-9]+-[A-Za-z0-9]+)/);
  const liffParams = new URLSearchParams();
  if (liffIdMatch) liffParams.set('liffId', liffIdMatch[1]);
  if (externalRef) liffParams.set('ref', externalRef);
  if (formId) liffParams.set('form', formId);
  const gateParam = c.req.query('gate') || '';
  if (gateParam) liffParams.set('gate', gateParam);
  const xhParam2 = c.req.query('xh') || '';
  if (xhParam2) liffParams.set('xh', xhParam2);
  if (igParam) liffParams.set('ig', igParam);
  if (redirect) liffParams.set('redirect', redirect);
  if (gclid) liffParams.set('gclid', gclid);
  if (fbclid) liffParams.set('fbclid', fbclid);
  if (twclid) liffParams.set('twclid', twclid);
  if (ttclid) liffParams.set('ttclid', ttclid);
  if (utmSource) liffParams.set('utm_source', utmSource);
  const liffTarget = liffParams.toString()
    ? `${liffUrl}?${liffParams.toString()}`
    : liffUrl;

  // Build OAuth URL (for desktop fallback)
  // Pack all tracking params into state so they survive the OAuth redirect.
  // The full ref (including xh: tokens) is stored in state — it is opaque to access.line.me
  // and only decoded by this worker's /auth/callback handler.
  // gate / xh: campaign metadata that must reach the form push so the form
  // can verify against the correct gate via the correct X Harness instance.
  // Without these, the form falls back to the gateId baked into the form's
  // onSubmitWebhookUrl (which is stale when a form is reused across campaigns).
  const state = JSON.stringify({ ref, redirect, form: formId, gate: gateParam, xh: xhParam2, gclid, fbclid, twclid, ttclid, utmSource, utmMedium, utmCampaign, account: accountParam || poolAccount, uid: uidParam, ig: igParam });
  const encodedState = btoa(state);
  const loginUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  loginUrl.searchParams.set('response_type', 'code');
  loginUrl.searchParams.set('client_id', channelId);
  loginUrl.searchParams.set('redirect_uri', callbackUrl);
  loginUrl.searchParams.set('scope', 'profile openid email');
  loginUrl.searchParams.set('bot_prompt', 'aggressive');
  loginUrl.searchParams.set('state', encodedState);

  // Build LIFF URL with params (opens LINE app directly on mobile + QR on PC)
  // externalRef used — xh: tokens must not appear in QR codes or LIFF URLs
  // gate/xh: campaign metadata that the LIFF page must see so it can verify
  // against the correct gate (otherwise the form falls back to the stale gate
  // baked into the form's webhook URL when forms are reused across campaigns).
  const qrParams = new URLSearchParams();
  if (liffIdMatch) qrParams.set('liffId', liffIdMatch[1]);
  if (externalRef) qrParams.set('ref', externalRef);
  if (formId) qrParams.set('form', formId);
  if (gateParam) qrParams.set('gate', gateParam);
  if (xhParam2) qrParams.set('xh', xhParam2);
  if (uidParam) qrParams.set('uid', uidParam);
  if (accountParam) qrParams.set('account', accountParam);
  if (igParam) qrParams.set('ig', igParam);
  const qrUrl = qrParams.toString() ? `${liffUrl}?${qrParams.toString()}` : liffUrl;

  // Mobile: redirect to LIFF URL (opens LINE app directly)
  // Exception: cross-account links (account param) use OAuth directly
  // because Account A's LIFF can't open from Account B's LINE chat
  const isMobile = /iphone|ipad|android|mobile/.test(ua.toLowerCase());
  if (isMobile) {
    if (accountParam) {
      // Cross-account link: use OAuth so callback handles push
      return c.redirect(loginUrl.toString());
    }
    return c.redirect(qrUrl);
  }

  // PC: show QR code page
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
      <img src="/api/qr?size=240x240&data=${encodeURIComponent(qrUrl)}" alt="QR Code">
    </div>
    <p class="hint">LINE アプリのカメラまたは<br>スマートフォンのカメラで読み取れます</p>
    <p class="footer">友だち追加で全機能を無料体験できます</p>
  </div>
</body>
</html>`);
});

/**
 * GET /auth/oauth — force OAuth flow (skips LIFF, skips X detection)
 *
 * This endpoint always 302's to access.line.me OAuth, regardless of UA.
 * Used by /r/'s X-warning-page "このまま LINE を開く" button so the user
 * can complete friend-add in-place when LINE Universal Link is broken
 * (e.g. inside X's custom WKWebView since v11.42).
 *
 * Same query params as /auth/line. No HTML rendering, no smart logic.
 */
liffRoutes.get('/auth/oauth', async (c) => {
  const ref = c.req.query('ref') || '';
  const redirect = c.req.query('redirect') || '';
  const formId = c.req.query('form') || '';
  const gateParam = c.req.query('gate') || '';
  const xhParam = c.req.query('xh') || '';
  const gclid = c.req.query('gclid') || '';
  const fbclid = c.req.query('fbclid') || '';
  const twclid = c.req.query('twclid') || '';
  const ttclid = c.req.query('ttclid') || '';
  const utmSource = c.req.query('utm_source') || '';
  const utmMedium = c.req.query('utm_medium') || '';
  const utmCampaign = c.req.query('utm_campaign') || '';
  const accountParam = c.req.query('account') || '';
  const uidParam = c.req.query('uid') || '';
  const igParam = c.req.query('ig') || '';
  let poolAccount = '';
  const baseUrl = new URL(c.req.url).origin;

  // Pool / account resolution — same logic as /auth/line
  let channelId = c.env.LINE_LOGIN_CHANNEL_ID;
  if (accountParam) {
    const account = await getLineAccountByChannelId(c.env.DB, accountParam);
    if (account?.login_channel_id) channelId = account.login_channel_id;
  } else {
    const poolSlug = c.req.query('pool') || 'main';
    const pool = await getTrafficPoolBySlug(c.env.DB, poolSlug);
    if (pool) {
      const account = await getRandomPoolAccount(c.env.DB, pool.id);
      if (account) {
        if (account.login_channel_id) channelId = account.login_channel_id;
        if (account.channel_id) poolAccount = account.channel_id;
      } else {
        const { getPoolAccounts } = await import('@line-crm/db');
        const allAccounts = await getPoolAccounts(c.env.DB, pool.id);
        if (allAccounts.length === 0) {
          if (pool.login_channel_id) channelId = pool.login_channel_id;
          if (pool.channel_id) poolAccount = pool.channel_id;
        } else {
          return c.text('このリンクは現在利用できません。しばらくしてからお試しください。', 503);
        }
      }
    }
  }

  // Build OAuth URL with full state
  const callbackUrl = `${baseUrl}/auth/callback`;
  const state = JSON.stringify({
    ref, redirect, form: formId, gate: gateParam, xh: xhParam,
    gclid, fbclid, twclid, ttclid,
    utmSource, utmMedium, utmCampaign,
    account: accountParam || poolAccount, uid: uidParam, ig: igParam,
  });
  const encodedState = btoa(state);
  const loginUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  loginUrl.searchParams.set('response_type', 'code');
  loginUrl.searchParams.set('client_id', channelId);
  loginUrl.searchParams.set('redirect_uri', callbackUrl);
  loginUrl.searchParams.set('scope', 'profile openid email');
  loginUrl.searchParams.set('bot_prompt', 'aggressive');
  loginUrl.searchParams.set('state', encodedState);

  return c.redirect(loginUrl.toString());
});

/**
 * GET /auth/callback — LINE Login callback
 *
 * Exchanges code for tokens, extracts sub (UUID), links friend.
 */
liffRoutes.get('/auth/callback', async (c) => {
  const code = c.req.query('code');
  const stateParam = c.req.query('state') || '';
  const error = c.req.query('error');

  // Parse state (contains ref, redirect, and ad click IDs)
  let ref = '';
  let redirect = '';
  let formId = '';
  let gateParam = '';
  let xhParam = '';
  let gclid = '';
  let fbclid = '';
  let twclid = '';
  let ttclid = '';
  let utmSource = '';
  let utmMedium = '';
  let utmCampaign = '';
  let accountParam = '';
  let uidParam = '';
  let igParam = '';
  try {
    const parsed = JSON.parse(atob(stateParam));
    ref = parsed.ref || '';
    redirect = parsed.redirect || '';
    formId = parsed.form || '';
    gateParam = parsed.gate || '';
    xhParam = parsed.xh || '';
    gclid = parsed.gclid || '';
    fbclid = parsed.fbclid || '';
    twclid = parsed.twclid || '';
    ttclid = parsed.ttclid || '';
    utmSource = parsed.utmSource || '';
    utmMedium = parsed.utmMedium || '';
    utmCampaign = parsed.utmCampaign || '';
    accountParam = parsed.account || '';
    uidParam = parsed.uid || '';
    igParam = parsed.ig || '';
  } catch {
    // ignore
  }

  if (error || !code) {
    return c.html(errorPage(error || 'Authorization failed'));
  }

  try {
    const baseUrl = new URL(c.req.url).origin;
    const callbackUrl = `${baseUrl}/auth/callback`;

    // Multi-account: resolve LINE Login credentials from DB
    let loginChannelId = c.env.LINE_LOGIN_CHANNEL_ID;
    let loginChannelSecret = c.env.LINE_LOGIN_CHANNEL_SECRET;
    if (accountParam) {
      const account = await getLineAccountByChannelId(c.env.DB, accountParam);
      if (account?.login_channel_id && account?.login_channel_secret) {
        loginChannelId = account.login_channel_id;
        loginChannelSecret = account.login_channel_secret;
      }
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: loginChannelId,
        client_secret: loginChannelSecret,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Token exchange failed:', errText);
      return c.html(errorPage('Token exchange failed'));
    }

    const tokens = await tokenRes.json<{
      access_token: string;
      id_token: string;
      token_type: string;
    }>();

    // Verify ID token to get sub (use resolved login channel ID, not env default)
    const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: tokens.id_token,
        client_id: loginChannelId,
      }),
    });

    if (!verifyRes.ok) {
      return c.html(errorPage('ID token verification failed'));
    }

    const verified = await verifyRes.json<{
      sub: string;
      name?: string;
      email?: string;
      picture?: string;
    }>();

    // Get profile via access token
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    let displayName = verified.name || 'Unknown';
    let pictureUrl: string | null = null;
    if (profileRes.ok) {
      const profile = await profileRes.json<{
        userId: string;
        displayName: string;
        pictureUrl?: string;
      }>();
      displayName = profile.displayName;
      pictureUrl = profile.pictureUrl || null;
    }

    const db = c.env.DB;
    const lineUserId = verified.sub;

    // Upsert friend (may not exist yet if webhook hasn't fired)
    const friend = await upsertFriend(db, {
      lineUserId,
      displayName,
      pictureUrl,
      statusMessage: null,
    });

    // IG cross-platform UUID linkage
    // If the tracked link carried ?ig=<IGSID>, persist it on our side and
    // notify IG Harness so both DBs hold a bidirectional reference.
    if (igParam) {
      try {
        await db
          .prepare('UPDATE friends SET ig_igsid = ? WHERE id = ? AND (ig_igsid IS NULL OR ig_igsid = ?)')
          .bind(igParam, friend.id, igParam)
          .run();
      } catch (err) {
        console.error('Failed to write friends.ig_igsid:', err);
      }
      // Best-effort notify IG Harness (don't block the user)
      if (c.env.IG_HARNESS_URL && c.env.IG_HARNESS_LINK_SECRET) {
        c.executionCtx.waitUntil(
          fetch(`${c.env.IG_HARNESS_URL}/api/followers/link-line`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-LINE-HARNESS-LINK-SECRET': c.env.IG_HARNESS_LINK_SECRET,
            },
            body: JSON.stringify({ igsid: igParam, line_friend_uuid: friend.id }),
          }).then(async (res) => {
            if (!res.ok) {
              console.error('IG Harness link-line failed:', res.status, await res.text().catch(() => ''));
            }
          }).catch((err) => console.error('IG Harness link-line error:', err))
        );
      }
    }

    // Create or find user → link
    let userId: string | null = null;

    // Check if already linked
    const existingUserId = (friend as unknown as Record<string, unknown>).user_id as string | null;
    if (existingUserId) {
      userId = existingUserId;
    } else {
      // Cross-account linking: if uid is provided, use that existing UUID
      if (uidParam) {
        userId = uidParam;
      }

      // Try to find by email
      if (!userId && verified.email) {
        const existingUser = await getUserByEmail(db, verified.email);
        if (existingUser) userId = existingUser.id;
      }

      // Create new user only if no existing UUID found
      if (!userId) {
        const newUser = await createUser(db, {
          email: verified.email || null,
          displayName,
        });
        userId = newUser.id;
      }

      // Link friend to user
      await linkFriendToUser(db, friend.id, userId);
    }

    // Attribution tracking
    // xh: refs are X Harness one-time tokens (the token IS the secret) — never persist as ref_code
    if (ref && !ref.startsWith('xh:')) {
      // Save ref_code on the friend record (first touch wins — only set if not already set)
      await db
        .prepare(`UPDATE friends SET ref_code = ? WHERE id = ? AND ref_code IS NULL`)
        .bind(ref, friend.id)
        .run();

      // Look up entry route config
      const route = await getEntryRouteByRefCode(db, ref);

      // Persist tracking event with ad click IDs
      await recordRefTracking(db, {
        refCode: ref,
        friendId: friend.id,
        entryRouteId: route?.id ?? null,
        sourceUrl: null,
        fbclid: fbclid || null,
        gclid: gclid || null,
        twclid: twclid || null,
        ttclid: ttclid || null,
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        userAgent: c.req.header('User-Agent') || null,
        ipAddress: c.req.header('CF-Connecting-IP') || null,
      });

      if (route) {
        // Auto-tag the friend
        if (route.tag_id) {
          await addTagToFriend(db, friend.id, route.tag_id);
        }
        // Auto-enroll in scenario (scenario_id stored; enrollment handled by scenario engine)
        // Future: call enrollFriendInScenario(db, friend.id, route.scenario_id) here
      }
    }

    // Save ad click IDs + UTM to friend metadata (for future ad API postback)
    const adMeta: Record<string, string> = {};
    if (gclid) adMeta.gclid = gclid;
    if (fbclid) adMeta.fbclid = fbclid;
    if (twclid) adMeta.twclid = twclid;
    if (ttclid) adMeta.ttclid = ttclid;
    if (utmSource) adMeta.utm_source = utmSource;
    if (utmMedium) adMeta.utm_medium = utmMedium;
    if (utmCampaign) adMeta.utm_campaign = utmCampaign;

    if (Object.keys(adMeta).length > 0) {
      const existingMeta = await db
        .prepare('SELECT metadata FROM friends WHERE id = ?')
        .bind(friend.id)
        .first<{ metadata: string }>();
      const merged = { ...JSON.parse(existingMeta?.metadata || '{}'), ...adMeta };
      await db
        .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(merged), jstNow(), friend.id)
        .run();
    }

    // X Harness token resolution: ref starting with "xh:" links X account to LINE friend
    if (ref && ref.startsWith('xh:')) {
      try {
        const xhToken = ref.slice(3);
        const xhResult = await resolveXHarnessToken(xhToken, c.env);
        if (xhResult?.xUsername) {
          const existingMeta = await db
            .prepare('SELECT metadata FROM friends WHERE id = ?')
            .bind(friend.id)
            .first<{ metadata: string }>();
          const meta = JSON.parse(existingMeta?.metadata || '{}');
          meta.x_username = xhResult.xUsername;
          await db
            .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
            .bind(JSON.stringify(meta), jstNow(), friend.id)
            .run();
          console.log(`X Harness: linked @${xhResult.xUsername} to friend ${friend.id}`);
        }
        // Apply gate actions (tag + scenario) from X Harness
        if (xhResult) {
          await applyXHarnessActions(db, friend.id, xhResult);
        }
      } catch (err) {
        console.error('X Harness token resolution error (non-blocking):', err);
      }
    }

    // Auto-enroll in friend_add scenarios + immediate delivery (skip delivery window)
    try {
      const { getScenarios, enrollFriendInScenario: enroll, getScenarioSteps } = await import('@line-crm/db');
      const { LineClient } = await import('@line-crm/line-sdk');
      const { buildMessage, expandVariables } = await import('../services/step-delivery.js');

      // Resolve which account this friend belongs to
      const matchedAccountId = accountParam
        ? (await getLineAccountByChannelId(db, accountParam))?.id ?? null
        : null;

      // Get access token for this account
      let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (accountParam) {
        const acct = await getLineAccountByChannelId(db, accountParam);
        if (acct) accessToken = acct.channel_access_token;
      }
      const lineClient = new LineClient(accessToken);

      const scenarios = await getScenarios(db);
      for (const scenario of scenarios) {
        const scenarioAccountMatch = !scenario.line_account_id || !matchedAccountId || scenario.line_account_id === matchedAccountId;
        if (scenario.trigger_type === 'friend_add' && scenario.is_active && scenarioAccountMatch) {
          const existing = await db
            .prepare('SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?')
            .bind(friend.id, scenario.id)
            .first<{ id: string }>();
          if (!existing) {
            await enroll(db, friend.id, scenario.id);

            // Immediate delivery of first step (skip delivery window)
            const steps = await getScenarioSteps(db, scenario.id);
            const firstStep = steps[0];
            if (firstStep && firstStep.delay_minutes === 0) {
              const { resolveMetadata: resolveMetaLiff } = await import('../services/step-delivery.js');
              const resolvedMetaLiff = await resolveMetaLiff(db, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
              const expandedContent = expandVariables(
                firstStep.message_content,
                { ...friend, metadata: resolvedMetaLiff } as Parameters<typeof expandVariables>[1],
                c.env.WORKER_URL,
              );
              await lineClient.pushMessage(lineUserId, [buildMessage(firstStep.message_type, expandedContent)]);
            }
          }
        }
      }
    } catch (err) {
      console.error('OAuth scenario enrollment error:', err);
    }

    // Redirect or show completion
    if (redirect) {
      return c.redirect(redirect);
    }

    // Send form link as LINE message if form param was passed
    if (formId && friend?.line_user_id) {
      try {
        // Build form LIFF URL using the friend's account liff_id (multi-account aware)
        // Append gate/xh so the form can verify against the correct campaign gate
        // (form definitions can be reused across campaigns, so the form's webhook
        // URL is unreliable as a source of gate id).
        // xh: refs are X Harness one-time secret tokens — never put them on
        // liff.line.me URLs (third-party host). The same filter is applied
        // elsewhere in this file for QR codes / external LIFF URLs.
        const externalRefForForm = ref && !ref.startsWith('xh:') ? ref : '';
        const formQuery = new URLSearchParams();
        formQuery.set('page', 'form');
        formQuery.set('id', formId);
        if (externalRefForForm) formQuery.set('ref', externalRefForForm);
        if (gateParam) formQuery.set('gate', gateParam);
        if (xhParam) formQuery.set('xh', xhParam);
        let formLiffUrl = `${new URL(c.req.url).origin}?${formQuery.toString()}`;
        const { LineClient } = await import('@line-crm/line-sdk');
        const { getLineAccountById: getAcctById } = await import('@line-crm/db');
        let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
        if (friend.line_account_id) {
          const account = await getAcctById(db, friend.line_account_id);
          if (account?.channel_access_token) accessToken = account.channel_access_token;
          if (account?.liff_id) {
            formLiffUrl = `https://liff.line.me/${account.liff_id}?${formQuery.toString()}`;
          }
        }
        if (formLiffUrl.startsWith(`${new URL(c.req.url).origin}`)) {
          const envLiffUrl = c.env.LIFF_URL || '';
          const envLiffIdMatch = envLiffUrl.match(/liff\.line\.me\/([0-9]+-[A-Za-z0-9]+)/);
          if (envLiffIdMatch) {
            formLiffUrl = `https://liff.line.me/${envLiffIdMatch[1]}?${formQuery.toString()}`;
          }
        }
        // Resolve intro template via tracked link (if ref points to one).
        // Also pin the friend to this tracked_link via setFriendFirstTrackedLinkIfNull,
        // so the form-submit handler can authoritatively look up the reward
        // template without trusting client-provided ref. The "if null" guard
        // means existing friends cannot tamper with their attribution by
        // re-running this flow with a different ref.
        let introTemplate = null;
        if (ref) {
          const trackedLink = await getTrackedLinkById(db, ref);
          if (trackedLink) {
            try {
              const { setFriendFirstTrackedLinkIfNull } = await import('@line-crm/db');
              await setFriendFirstTrackedLinkIfNull(db, friend.id, trackedLink.id);
            } catch (e) {
              console.error('setFriendFirstTrackedLinkIfNull failed (non-blocking):', e);
            }
            if (trackedLink.intro_template_id) {
              introTemplate = await getMessageTemplateById(db, trackedLink.intro_template_id);
            }
          }
        }
        const introMessage = buildIntroMessage(introTemplate, formLiffUrl);

        const lineClient = new LineClient(accessToken);
        await lineClient.pushMessage(friend.line_user_id, [introMessage as any]);
      } catch (err) {
        console.error('Form link push error (non-blocking):', err);
      }
    }

    // Redirect to the correct bot's chat after auth
    // Find the LINE account by: account param, friend's account, or login channel ID
    let redirectAccount: Record<string, string> | null = null;
    if (accountParam) {
      redirectAccount = await getLineAccountByChannelId(db, accountParam) as Record<string, string> | null;
    }
    if (!redirectAccount) {
      // Find account by login_channel_id used in this OAuth flow
      redirectAccount = await db
        .prepare('SELECT * FROM line_accounts WHERE login_channel_id = ?')
        .bind(loginChannelId)
        .first<Record<string, string>>();
    }
    if (!redirectAccount) {
      // Fallback: first active account
      redirectAccount = await db
        .prepare('SELECT * FROM line_accounts WHERE is_active = 1 LIMIT 1')
        .first<Record<string, string>>();
    }
    if (redirectAccount?.channel_access_token) {
      try {
        const botInfo = await fetch('https://api.line.me/v2/bot/info', {
          headers: { Authorization: `Bearer ${redirectAccount.channel_access_token}` },
        });
        if (botInfo.ok) {
          const bot = await botInfo.json() as { basicId?: string };
          if (bot.basicId) {
            return c.redirect(`https://line.me/R/ti/p/${bot.basicId}`);
          }
        }
      } catch {
        // Fall through to completion page
      }
    }

    return c.html(completionPage(displayName, pictureUrl, ref));

  } catch (err) {
    console.error('Auth callback error:', err);
    return c.html(errorPage('Internal error'));
  }
});

// ─── LIFF config endpoint ──────────────────────────────────────

// GET /api/liff/config - resolve account info from LIFF ID (public, no auth)
liffRoutes.get('/api/liff/config', async (c) => {
  try {
    const liffId = c.req.query('liffId');
    if (!liffId) {
      return c.json({ success: false, error: 'liffId is required' }, 400);
    }

    const account = await c.env.DB
      .prepare('SELECT id, name, channel_access_token FROM line_accounts WHERE liff_id = ? AND is_active = 1')
      .bind(liffId)
      .first<{ id: string; name: string; channel_access_token: string }>();

    // Fallback to default env account if liff_id not found in DB
    const accessToken = account?.channel_access_token || c.env.LINE_CHANNEL_ACCESS_TOKEN;
    const accountName = account?.name || 'Default';
    const accountId = account?.id || 'default';

    // Fetch bot basic ID from LINE API
    let botBasicId = '';
    try {
      const botRes = await fetch('https://api.line.me/v2/bot/info', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (botRes.ok) {
        const bot = await botRes.json() as { basicId?: string };
        botBasicId = bot.basicId || '';
      }
    } catch {
      // non-blocking
    }

    return c.json({
      success: true,
      data: { botBasicId, accountName, accountId },
    });
  } catch (err) {
    console.error('GET /api/liff/config error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ─── Existing LIFF endpoints ────────────────────────────────────

// POST /api/liff/profile - get friend by LINE userId (public, no auth)
liffRoutes.post('/api/liff/profile', async (c) => {
  try {
    const body = await c.req.json<{ lineUserId: string }>();
    if (!body.lineUserId) {
      return c.json({ success: false, error: 'lineUserId is required' }, 400);
    }

    const friend = await getFriendByLineUserId(c.env.DB, body.lineUserId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        id: friend.id,
        displayName: friend.display_name,
        isFollowing: Boolean(friend.is_following),
        userId: (friend as unknown as Record<string, unknown>).user_id ?? null,
      },
    });
  } catch (err) {
    console.error('POST /api/liff/profile error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/liff/link - link friend to user UUID (public, verified via LINE ID token)
liffRoutes.post('/api/liff/link', async (c) => {
  try {
    const body = await c.req.json<{
      idToken: string;
      displayName?: string | null;
      ref?: string;
      existingUuid?: string;
    }>();

    if (!body.idToken) {
      return c.json({ success: false, error: 'idToken is required' }, 400);
    }

    // Try verifying with default Login channel, then DB accounts
    const loginChannelIds = [c.env.LINE_LOGIN_CHANNEL_ID];
    const dbAccounts = await getLineAccounts(c.env.DB);
    for (const acct of dbAccounts) {
      if (acct.login_channel_id && !loginChannelIds.includes(acct.login_channel_id)) {
        loginChannelIds.push(acct.login_channel_id);
      }
    }

    let verifyRes: Response | null = null;
    for (const channelId of loginChannelIds) {
      verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: body.idToken, client_id: channelId }),
      });
      if (verifyRes.ok) break;
    }

    if (!verifyRes?.ok) {
      return c.json({ success: false, error: 'Invalid ID token' }, 401);
    }

    const verified = await verifyRes.json<{ sub: string; email?: string; name?: string }>();
    const lineUserId = verified.sub;
    const email = verified.email || null;

    const db = c.env.DB;
    const friend = await getFriendByLineUserId(db, lineUserId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    if ((friend as unknown as Record<string, unknown>).user_id) {
      // Still save ref even if already linked (but never persist xh: tokens as ref_code)
      if (body.ref && !body.ref.startsWith('xh:')) {
        await db.prepare('UPDATE friends SET ref_code = ? WHERE id = ? AND ref_code IS NULL')
          .bind(body.ref, friend.id).run();
      }
      // X Harness token resolution for already-linked friends
      if (body.ref && body.ref.startsWith('xh:')) {
        try {
          const xhToken = body.ref.slice(3);
          const xhResult = await resolveXHarnessToken(xhToken, c.env);
          if (xhResult?.xUsername) {
            const existingMeta = await db
              .prepare('SELECT metadata FROM friends WHERE id = ?')
              .bind(friend.id)
              .first<{ metadata: string }>();
            const meta = JSON.parse(existingMeta?.metadata || '{}');
            meta.x_username = xhResult.xUsername;
            await db
              .prepare('UPDATE friends SET metadata = ? WHERE id = ?')
              .bind(JSON.stringify(meta), friend.id)
              .run();
            console.log(`X Harness: linked @${xhResult.xUsername} to friend ${friend.id}`);
          }
          if (xhResult) {
            await applyXHarnessActions(db, friend.id, xhResult);
          }
        } catch (err) {
          console.error('X Harness token resolution error (non-blocking):', err);
        }
      }
      return c.json({
        success: true,
        data: { userId: (friend as unknown as Record<string, unknown>).user_id, alreadyLinked: true },
      });
    }

    let userId: string | null = null;
    if (email) {
      const existingUser = await getUserByEmail(db, email);
      if (existingUser) userId = existingUser.id;
    }

    if (!userId) {
      const newUser = await createUser(db, {
        email,
        displayName: body.displayName || verified.name,
      });
      userId = newUser.id;
    }

    await linkFriendToUser(db, friend.id, userId);

    // Save ref_code from LIFF (first touch wins)
    // xh: refs are X Harness one-time tokens — never persist as ref_code
    if (body.ref && !body.ref.startsWith('xh:')) {
      await db.prepare('UPDATE friends SET ref_code = ? WHERE id = ? AND ref_code IS NULL')
        .bind(body.ref, friend.id).run();

      // Record ref tracking
      try {
        const route = await getEntryRouteByRefCode(db, body.ref);
        await recordRefTracking(db, {
          refCode: body.ref,
          friendId: friend.id,
          entryRouteId: route?.id ?? null,
          sourceUrl: null,
        });
      } catch { /* silent */ }
    }

    // X Harness token resolution: ref starting with "xh:" links X account to LINE friend
    if (body.ref && body.ref.startsWith('xh:')) {
      try {
        const xhToken = body.ref.slice(3);
        const xhResult = await resolveXHarnessToken(xhToken, c.env);
        if (xhResult?.xUsername) {
          const existingMeta = await db
            .prepare('SELECT metadata FROM friends WHERE id = ?')
            .bind(friend.id)
            .first<{ metadata: string }>();
          const meta = JSON.parse(existingMeta?.metadata || '{}');
          meta.x_username = xhResult.xUsername;
          await db
            .prepare('UPDATE friends SET metadata = ? WHERE id = ?')
            .bind(JSON.stringify(meta), friend.id)
            .run();
          console.log(`X Harness: linked @${xhResult.xUsername} to friend ${friend.id}`);
        }
        if (xhResult) {
          await applyXHarnessActions(db, friend.id, xhResult);
        }
      } catch (err) {
        console.error('X Harness token resolution error (non-blocking):', err);
      }
    }

    return c.json({
      success: true,
      data: { userId, alreadyLinked: false },
    });
  } catch (err) {
    console.error('POST /api/liff/link error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ─── Attribution Analytics ──────────────────────────────────────

/**
 * GET /api/analytics/ref-summary — ref code analytics summary
 */
liffRoutes.get('/api/analytics/ref-summary', async (c) => {
  try {
    const db = c.env.DB;
    const lineAccountId = c.req.query('lineAccountId');
    const accountFilter = lineAccountId ? 'AND f.line_account_id = ?' : '';
    const accountBinds = lineAccountId ? [lineAccountId] : [];

    const rows = await db
      .prepare(
        `SELECT
          er.ref_code,
          er.name,
          COUNT(DISTINCT rt.friend_id) as friend_count,
          COUNT(rt.id) as click_count,
          MAX(rt.created_at) as latest_at
        FROM entry_routes er
        LEFT JOIN ref_tracking rt ON er.ref_code = rt.ref_code
        LEFT JOIN friends f ON f.id = rt.friend_id ${accountFilter ? `${accountFilter}` : ''}
        GROUP BY er.ref_code, er.name
        ORDER BY friend_count DESC`,
      )
      .bind(...accountBinds)
      .all<{
        ref_code: string;
        name: string;
        friend_count: number;
        click_count: number;
        latest_at: string | null;
      }>();

    const totalStmt = lineAccountId
      ? db.prepare(`SELECT COUNT(*) as count FROM friends WHERE line_account_id = ?`).bind(lineAccountId)
      : db.prepare(`SELECT COUNT(*) as count FROM friends`);
    const totalFriendsRes = await totalStmt.first<{ count: number }>();

    const refStmt = lineAccountId
      ? db.prepare(`SELECT COUNT(*) as count FROM friends WHERE ref_code IS NOT NULL AND ref_code != '' AND line_account_id = ?`).bind(lineAccountId)
      : db.prepare(`SELECT COUNT(*) as count FROM friends WHERE ref_code IS NOT NULL AND ref_code != ''`);
    const friendsWithRefRes = await refStmt.first<{ count: number }>();

    const totalFriends = totalFriendsRes?.count ?? 0;
    const friendsWithRef = friendsWithRefRes?.count ?? 0;

    return c.json({
      success: true,
      data: {
        routes: (rows.results ?? []).map((r) => ({
          refCode: r.ref_code,
          name: r.name,
          friendCount: r.friend_count,
          clickCount: r.click_count,
          latestAt: r.latest_at,
        })),
        totalFriends,
        friendsWithRef,
        friendsWithoutRef: totalFriends - friendsWithRef,
      },
    });
  } catch (err) {
    console.error('GET /api/analytics/ref-summary error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/analytics/ref/:refCode — detailed friend list for a single ref code
 */
liffRoutes.get('/api/analytics/ref/:refCode', async (c) => {
  try {
    const db = c.env.DB;
    const refCode = c.req.param('refCode');

    const routeRow = await db
      .prepare(`SELECT ref_code, name FROM entry_routes WHERE ref_code = ?`)
      .bind(refCode)
      .first<{ ref_code: string; name: string }>();

    if (!routeRow) {
      return c.json({ success: false, error: 'Entry route not found' }, 404);
    }

    const lineAccountId = c.req.query('lineAccountId');
    const accountFilter = lineAccountId ? 'AND f.line_account_id = ?' : '';
    const binds = lineAccountId ? [refCode, refCode, lineAccountId] : [refCode, refCode];

    const friends = await db
      .prepare(
        `SELECT
          f.id,
          f.display_name,
          f.ref_code,
          rt.created_at as tracked_at
        FROM friends f
        LEFT JOIN ref_tracking rt ON f.id = rt.friend_id AND rt.ref_code = ?
        WHERE f.ref_code = ? ${accountFilter}
        ORDER BY rt.created_at DESC`,
      )
      .bind(...binds)
      .all<{
        id: string;
        display_name: string;
        ref_code: string | null;
        tracked_at: string | null;
      }>();

    return c.json({
      success: true,
      data: {
        refCode: routeRow.ref_code,
        name: routeRow.name,
        friends: (friends.results ?? []).map((f) => ({
          id: f.id,
          displayName: f.display_name,
          trackedAt: f.tracked_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/analytics/ref/:refCode error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/links/wrap - wrap a URL with LIFF redirect proxy
liffRoutes.post('/api/links/wrap', async (c) => {
  try {
    const body = await c.req.json<{ url: string; ref?: string }>();
    if (!body.url) {
      return c.json({ success: false, error: 'url is required' }, 400);
    }

    const liffUrl = c.env.LIFF_URL;
    if (!liffUrl) {
      return c.json({ success: false, error: 'LIFF_URL not configured' }, 500);
    }

    const params = new URLSearchParams({ redirect: body.url });
    if (body.ref) {
      params.set('ref', body.ref);
    }

    const wrappedUrl = `${liffUrl}?${params.toString()}`;
    return c.json({ success: true, data: { url: wrappedUrl } });
  } catch (err) {
    console.error('POST /api/links/wrap error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ─── HTML Templates ─────────────────────────────────────────────

function authLandingPage(liffUrl: string, oauthUrl: string): string {
  // Extract LIFF ID from URL like https://liff.line.me/{LIFF_ID}?ref=test
  const liffIdMatch = liffUrl.match(/liff\.line\.me\/([^?]+)/);
  const liffId = liffIdMatch ? liffIdMatch[1] : '';
  // Query string part (e.g., ?ref=test)
  const qsIndex = liffUrl.indexOf('?');
  const liffQs = qsIndex >= 0 ? liffUrl.slice(qsIndex) : '';

  // line:// scheme to force open LINE app with LIFF
  const lineSchemeUrl = `https://line.me/R/app/${liffId}${liffQs}`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LINE で開く</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', system-ui, sans-serif; background: #06C755; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 40px 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); text-align: center; max-width: 400px; width: 90%; }
    .line-icon { font-size: 48px; margin-bottom: 16px; }
    h2 { font-size: 20px; color: #333; margin-bottom: 8px; }
    .sub { font-size: 14px; color: #999; margin-bottom: 24px; }
    .btn { display: block; width: 100%; padding: 16px; border: none; border-radius: 8px; font-size: 16px; font-weight: 700; text-decoration: none; text-align: center; cursor: pointer; transition: opacity 0.15s; font-family: inherit; }
    .btn:active { opacity: 0.85; }
    .btn-line { background: #06C755; color: #fff; margin-bottom: 12px; }
    .btn-web { background: #f5f5f5; color: #666; font-size: 13px; padding: 12px; }
    .loading { margin-top: 16px; font-size: 13px; color: #999; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card" id="card">
    <div class="line-icon">💬</div>
    <h2>LINEで開く</h2>
    <p class="sub">LINEアプリが起動します</p>
    <a href="${escapeHtml(lineSchemeUrl)}" class="btn btn-line" id="openBtn">LINEアプリで開く</a>
    <a href="${escapeHtml(oauthUrl)}" class="btn btn-web" id="pcBtn">PCの方・LINEが開かない方</a>
    <p class="loading hidden" id="loading">LINEアプリを起動中...</p>
  </div>
  <script>
    var lineUrl = '${escapeHtml(lineSchemeUrl)}';
    var ua = navigator.userAgent.toLowerCase();
    var isMobile = /iphone|ipad|android/.test(ua);
    var isLine = /line\\//.test(ua);
    var isIOS = /iphone|ipad/.test(ua);
    var isAndroid = /android/.test(ua);

    if (isLine) {
      // Already in LINE — go to LIFF directly
      window.location.href = '${escapeHtml(liffUrl)}';
    } else if (isMobile) {
      // Mobile browser — try to open LINE app
      document.getElementById('loading').classList.remove('hidden');
      document.getElementById('openBtn').classList.add('hidden');

      // Use line.me/R/app/ which is a Universal Link (iOS) / App Link (Android)
      // This opens LINE app directly without showing browser login
      setTimeout(function() {
        window.location.href = lineUrl;
      }, 100);

      // Fallback: if LINE app doesn't open within 2s, show the button
      setTimeout(function() {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('openBtn').classList.remove('hidden');
        document.getElementById('openBtn').textContent = 'もう一度試す';
      }, 2500);
    }
  </script>
</body>
</html>`;
}

function completionPage(displayName: string, pictureUrl: string | null, ref: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登録完了</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', system-ui, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 40px 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; max-width: 400px; width: 90%; }
    .check { width: 64px; height: 64px; border-radius: 50%; background: #06C755; color: #fff; font-size: 32px; line-height: 64px; margin: 0 auto 16px; }
    h2 { font-size: 20px; color: #06C755; margin-bottom: 16px; }
    .profile { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 16px 0; }
    .profile img { width: 48px; height: 48px; border-radius: 50%; }
    .profile .name { font-size: 16px; font-weight: 600; }
    .message { font-size: 14px; color: #666; line-height: 1.6; margin-top: 12px; }
    .ref { display: inline-block; margin-top: 12px; padding: 4px 12px; background: #f0f0f0; border-radius: 12px; font-size: 11px; color: #999; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h2>登録完了！</h2>
    <div class="profile">
      ${pictureUrl ? `<img src="${pictureUrl}" alt="">` : ''}
      <p class="name">${escapeHtml(displayName)} さん</p>
    </div>
    <p class="message">ありがとうございます！<br>これからお役立ち情報をお届けします。<br>このページは閉じて大丈夫です。</p>
    ${ref ? `<p class="ref">${escapeHtml(ref)}</p>` : ''}
  </div>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>エラー</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', system-ui, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 40px 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; max-width: 400px; width: 90%; }
    h2 { font-size: 18px; color: #e53e3e; margin-bottom: 12px; }
    p { font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <h2>エラー</h2>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── X Harness Token Resolution ─────────────────────────────────

/**
 * Apply X Harness gate actions (tag + scenario) to a LINE friend.
 * Non-blocking — failures are logged but don't interrupt the flow.
 */
async function applyXHarnessActions(
  db: D1Database,
  friendId: string,
  result: XHarnessTokenResult,
): Promise<void> {
  // Add tag if specified
  if (result.tag) {
    try {
      // Find or create the tag by name
      let tagRow = await db
        .prepare('SELECT id FROM tags WHERE name = ?')
        .bind(result.tag)
        .first<{ id: string }>();
      if (!tagRow) {
        const tagId = crypto.randomUUID();
        const { jstNow } = await import('@line-crm/db');
        tagRow = await db
          .prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?) RETURNING id')
          .bind(tagId, result.tag, jstNow())
          .first<{ id: string }>();
      }
      if (tagRow) {
        const { addTagToFriend } = await import('@line-crm/db');
        await addTagToFriend(db, friendId, tagRow.id);
        console.log(`X Harness: added tag "${result.tag}" to friend ${friendId}`);
      }
    } catch (err) {
      console.error(`X Harness: failed to add tag "${result.tag}":`, err);
    }
  }

  // Start scenario if specified
  if (result.scenarioId) {
    try {
      const { enrollFriendInScenario } = await import('@line-crm/db');
      await enrollFriendInScenario(db, friendId, result.scenarioId);
      console.log(`X Harness: enrolled friend ${friendId} in scenario ${result.scenarioId}`);
    } catch (err) {
      console.error(`X Harness: failed to enroll in scenario:`, err);
    }
  }
}

interface XHarnessTokenResult {
  xUsername: string | null;
  tag: string | null;
  scenarioId: string | null;
}

/**
 * Resolve an X Harness token to get the linked X username + gate config (tag, scenario).
 * The token IS the secret — no Bearer auth needed on the resolve endpoint.
 */
async function resolveXHarnessToken(
  token: string,
  env: { X_HARNESS_URL?: string },
): Promise<XHarnessTokenResult | null> {
  if (!env.X_HARNESS_URL) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout — must not block login flow
    try {
      const res = await fetch(`${env.X_HARNESS_URL}/api/tokens/${token}/resolve`, {
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body = await res.json() as { success: boolean; data?: XHarnessTokenResult };
      if (!body.success || !body.data) return null;
      return { xUsername: body.data.xUsername, tag: body.data.tag ?? null, scenarioId: body.data.scenarioId ?? null };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return null;
  }
}

// POST /api/liff/send-form-link — send form URL as push message (public, used by LIFF)
// Security: requires idToken to verify the caller is the actual LINE user
liffRoutes.post('/api/liff/send-form-link', async (c) => {
  try {
    const { lineUserId, formId, idToken, ref, gate, xh } = await c.req.json<{
      lineUserId: string;
      formId: string;
      idToken?: string;
      ref?: string;
      gate?: string;
      xh?: string;
    }>();
    if (!lineUserId || !formId) {
      return c.json({ success: false, error: 'lineUserId and formId required' }, 400);
    }
    // idToken is required: this endpoint pins friend.first_tracked_link_id and
    // pushes a campaign-specific message, so we must verify the caller IS the
    // claimed LINE user before trusting lineUserId. Without this, an attacker
    // who knows another user's lineUserId could lock that user into an
    // attacker-chosen tracked_link_id (and thus an attacker-chosen reward).
    if (!idToken) {
      return c.json({ success: false, error: 'idToken required' }, 401);
    }

    // Verify idToken — ensures caller is the actual user
    {
      const loginChannelIds = [c.env.LINE_LOGIN_CHANNEL_ID];
      const dbAccounts = await getLineAccounts(c.env.DB);
      for (const acct of dbAccounts) {
        if (acct.login_channel_id) loginChannelIds.push(acct.login_channel_id);
      }
      let verified = false;
      for (const channelId of loginChannelIds) {
        const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
        });
        if (verifyRes.ok) {
          const data = await verifyRes.json() as { sub: string };
          if (data.sub !== lineUserId) {
            return c.json({ success: false, error: 'Token mismatch' }, 403);
          }
          verified = true;
          break;
        }
      }
      if (!verified) {
        return c.json({ success: false, error: 'Invalid idToken' }, 401);
      }
    }

    const db = c.env.DB;
    const friend = await getFriendByLineUserId(db, lineUserId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    // Build form LIFF URL using the friend's account liff_id (multi-account aware)
    // Append gate/xh so the form can verify against the correct campaign gate
    // (form definitions can be reused across campaigns, so the form's webhook
    // URL is unreliable as a source of gate id).
    // xh: refs are X Harness one-time secret tokens — never put them on
    // liff.line.me URLs (third-party host).
    const externalRefForForm = ref && !ref.startsWith('xh:') ? ref : '';
    const formQuery = new URLSearchParams();
    formQuery.set('page', 'form');
    formQuery.set('id', formId);
    if (externalRefForForm) formQuery.set('ref', externalRefForForm);
    if (gate) formQuery.set('gate', gate);
    if (xh) formQuery.set('xh', xh);
    let formLiffUrl = `${new URL(c.req.url).origin}?${formQuery.toString()}`;
    const { LineClient } = await import('@line-crm/line-sdk');
    let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
    if ((friend as any).line_account_id) {
      const account = await getLineAccountById(db, (friend as any).line_account_id);
      if (account?.channel_access_token) accessToken = account.channel_access_token;
      if (account?.liff_id) {
        formLiffUrl = `https://liff.line.me/${account.liff_id}?${formQuery.toString()}`;
      }
    }
    if (formLiffUrl.startsWith(`${new URL(c.req.url).origin}`)) {
      // Fallback: use env LIFF_URL if no account-specific liff_id
      const liffUrl = c.env.LIFF_URL || '';
      const liffIdMatch = liffUrl.match(/liff\.line\.me\/([0-9]+-[A-Za-z0-9]+)/);
      if (liffIdMatch) {
        formLiffUrl = `https://liff.line.me/${liffIdMatch[1]}?${formQuery.toString()}`;
      }
    }
    // Resolve intro template via tracked link (if ref provided).
    // Also pin the friend's first_tracked_link_id (idempotent — never overwrites).
    let introTemplate = null;
    if (ref) {
      const trackedLink = await getTrackedLinkById(c.env.DB, ref);
      if (trackedLink) {
        try {
          const { setFriendFirstTrackedLinkIfNull } = await import('@line-crm/db');
          await setFriendFirstTrackedLinkIfNull(c.env.DB, friend.id, trackedLink.id);
        } catch (e) {
          console.error('setFriendFirstTrackedLinkIfNull failed (non-blocking):', e);
        }
      }
      if (trackedLink?.intro_template_id) {
        introTemplate = await getMessageTemplateById(c.env.DB, trackedLink.intro_template_id);
      }
    }
    const introMessage = buildIntroMessage(introTemplate, formLiffUrl);

    const lineClient = new LineClient(accessToken);
    await lineClient.pushMessage(lineUserId, [introMessage as any]);

    return c.json({ success: true });
  } catch (err) {
    console.error('POST /api/liff/send-form-link error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { liffRoutes };
