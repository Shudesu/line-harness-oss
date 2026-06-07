import { Hono } from 'hono';
import {
  getTrackedLinks,
  getTrackedLinkById,
  createTrackedLink,
  updateTrackedLink,
  deleteTrackedLink,
  recordLinkClick,
  recordLinkClickExtended,
  getLinkClicks,
  getFriendByLineUserId,
} from '@line-crm/db';
import { addTagToFriend, enrollFriendInScenario } from '@line-crm/db';
import type { TrackedLink } from '@line-crm/db';
import type { Env } from '../index.js';
import { generateUaFingerprint } from '../utils/fingerprint.js';
import { requireRole } from '../middleware/role-guard.js';

const trackedLinks = new Hono<Env>();

function serializeTrackedLink(row: TrackedLink, baseUrl: string) {
  const trackingUrl = `${baseUrl}/t/${row.id}`;
  return {
    id: row.id,
    name: row.name,
    originalUrl: row.original_url,
    trackingUrl,
    tagId: row.tag_id,
    scenarioId: row.scenario_id,
    introTemplateId: row.intro_template_id,
    rewardTemplateId: row.reward_template_id,
    isActive: Boolean(row.is_active),
    clickCount: row.click_count,
    // L-TRACK 互換フィールド
    skipLiff: Boolean(row.skip_liff),
    mediaName: row.media_name,
    afAmount: row.af_amount,
    afConfirmType: row.af_confirm_type,
    lineAccountId: row.line_account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getBaseUrl(c: { req: { url: string } }): string {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

// Codex指摘 High: multi-account 境界の判定ヘルパ。
// tracked_link が「他アカ専属」のとき選択中アカからは触れないようガード。
function inAccountScope(
  link: { line_account_id: string | null },
  lineAccountId: string | null,
): boolean {
  if (!lineAccountId) return true; // 未指定リクエストは従来挙動（管理ツール用）
  return link.line_account_id === null || link.line_account_id === lineAccountId;
}

// GET /api/tracked-links — list all
// Codex指摘 High: lineAccountId が来たらサーバ側で境界を絞る。
trackedLinks.get('/api/tracked-links', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId') ?? null;
    const items = await getTrackedLinks(c.env.DB, { lineAccountId });
    const base = getBaseUrl(c);
    return c.json({ success: true, data: items.map((item) => serializeTrackedLink(item, base)) });
  } catch (err) {
    console.error('GET /api/tracked-links error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/tracked-links/:id — get single with click details
trackedLinks.get('/api/tracked-links/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId') ?? null;
    const link = await getTrackedLinkById(c.env.DB, id);
    if (!link || !inAccountScope(link, lineAccountId)) {
      return c.json({ success: false, error: 'Tracked link not found' }, 404);
    }
    const clicks = await getLinkClicks(c.env.DB, id);
    const base = getBaseUrl(c);
    return c.json({
      success: true,
      data: {
        ...serializeTrackedLink(link, base),
        clicks: clicks.map((click) => ({
          id: click.id,
          friendId: click.friend_id,
          friendDisplayName: click.friend_display_name,
          clickedAt: click.clicked_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/tracked-links/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tracked-links — create
trackedLinks.post('/api/tracked-links', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      originalUrl: string;
      tagId?: string | null;
      scenarioId?: string | null;
      introTemplateId?: string | null;
      rewardTemplateId?: string | null;
      // L-TRACK 互換
      skipLiff?: boolean;
      mediaName?: string | null;
      afAmount?: number | null;
      afConfirmType?: 'immediate' | '1h' | '3h' | '24h';
      lineAccountId?: string | null;
    }>();

    if (!body.name || !body.originalUrl) {
      return c.json({ success: false, error: 'name and originalUrl are required' }, 400);
    }

    // Medium fix: af_confirm_type runtime validation
    if (body.afConfirmType !== undefined && !['immediate', '1h', '3h', '24h'].includes(body.afConfirmType)) {
      return c.json({ success: false, error: 'afConfirmType must be one of: immediate, 1h, 3h, 24h' }, 400);
    }

    const link = await createTrackedLink(c.env.DB, {
      name: body.name,
      originalUrl: body.originalUrl,
      tagId: body.tagId ?? null,
      scenarioId: body.scenarioId ?? null,
      introTemplateId: body.introTemplateId ?? null,
      rewardTemplateId: body.rewardTemplateId ?? null,
      skipLiff: body.skipLiff,
      mediaName: body.mediaName,
      afAmount: body.afAmount,
      afConfirmType: body.afConfirmType,
      lineAccountId: body.lineAccountId,
    });

    const base = getBaseUrl(c);
    return c.json({ success: true, data: serializeTrackedLink(link, base) }, 201);
  } catch (err) {
    console.error('POST /api/tracked-links error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tracked-links/:id — update mutable fields
trackedLinks.patch('/api/tracked-links/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId') ?? null;
    const body = await c.req.json<{
      name?: string;
      tagId?: string | null;
      scenarioId?: string | null;
      introTemplateId?: string | null;
      rewardTemplateId?: string | null;
      isActive?: boolean;
      // L-TRACK 互換
      skipLiff?: boolean;
      mediaName?: string | null;
      afAmount?: number | null;
      afConfirmType?: 'immediate' | '1h' | '3h' | '24h';
      lineAccountId?: string | null;
    }>();

    // Medium fix: af_confirm_type runtime validation
    if (body.afConfirmType !== undefined && !['immediate', '1h', '3h', '24h'].includes(body.afConfirmType)) {
      return c.json({ success: false, error: 'afConfirmType must be one of: immediate, 1h, 3h, 24h' }, 400);
    }

    // Codex指摘 High: multi-account 境界。所有アカ外からは触れない。
    const existing = await getTrackedLinkById(c.env.DB, id);
    if (!existing || !inAccountScope(existing, lineAccountId)) {
      return c.json({ success: false, error: 'Tracked link not found' }, 404);
    }

    const link = await updateTrackedLink(c.env.DB, id, body);
    if (!link) {
      return c.json({ success: false, error: 'Tracked link not found' }, 404);
    }
    const base = getBaseUrl(c);
    return c.json({ success: true, data: serializeTrackedLink(link, base) });
  } catch (err) {
    console.error('PATCH /api/tracked-links/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tracked-links/:id
trackedLinks.delete('/api/tracked-links/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId') ?? null;
    const link = await getTrackedLinkById(c.env.DB, id);
    // Codex指摘 High: 所有アカ外からは触れない。
    if (!link || !inAccountScope(link, lineAccountId)) {
      return c.json({ success: false, error: 'Tracked link not found' }, 404);
    }
    await deleteTrackedLink(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/tracked-links/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// Domains where Universal Links should be used (JS redirect instead of 302)
const APP_LINK_DOMAINS = new Set([
  'x.com',
  'twitter.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'facebook.com',
  'github.com',
]);

function isAppLinkDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return APP_LINK_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

// Android app package names for intent:// deep links
const ANDROID_PACKAGES: Record<string, string> = {
  'x.com': 'com.twitter.android',
  'twitter.com': 'com.twitter.android',
  'instagram.com': 'com.instagram.android',
  'youtube.com': 'com.google.android.youtube',
  'youtu.be': 'com.google.android.youtube',
  'tiktok.com': 'com.zhiliaoapp.musically',
  'facebook.com': 'com.facebook.katana',
  'github.com': 'com.github.android',
};

function getAndroidPackage(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return ANDROID_PACKAGES[hostname] ?? null;
  } catch {
    return null;
  }
}

function buildAppRedirectHtml(destinationUrl: string): string {
  const escaped = destinationUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const androidPackage = getAndroidPackage(destinationUrl);
  // intent://path#Intent;scheme=https;package=com.xxx;S.browser_fallback_url=https://...;end
  const intentUrl = androidPackage
    ? `intent://${destinationUrl.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=${androidPackage};S.browser_fallback_url=${encodeURIComponent(destinationUrl)};end`
    : null;
  const intentEscaped = intentUrl ? intentUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;') : '';

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Redirecting...</title>
<style>body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui;color:#64748b;background:#f8fafc}p{font-size:14px}</style>
</head><body>
<p>Opening app...</p>
<script>
(function(){
  var isAndroid = /Android/i.test(navigator.userAgent);
  if(isAndroid && "${intentEscaped}"){
    window.location.href="${intentEscaped}";
  } else {
    window.location.href="${escaped}";
  }
})();
</script>
<noscript><meta http-equiv="refresh" content="0;url=${escaped}"></noscript>
</body></html>`;
}

// Low fix: アトリビューション値の長さ制限。攻撃者がURL長上限まで詰めて
// DB保存・リダイレクト引継ぎする攻撃を防ぐ。
const LTP_MAX_LEN = 32; // L-TRACK 仕様は10文字。harness は柔軟性のため32文字まで許可。
const CLICK_ID_MAX_LEN = 256; // fbclid/gclid 等の実値は通常50-150文字
const UTM_MAX_LEN = 128;

function truncate(value: string | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

// クエリパラメータからアトリビューション情報を抽出
function extractAttribution(c: { req: { query: (key: string) => string | undefined } }) {
  return {
    ltp: truncate(c.req.query('ltp'), LTP_MAX_LEN),
    fbclid: truncate(c.req.query('fbclid'), CLICK_ID_MAX_LEN),
    gclid: truncate(c.req.query('gclid'), CLICK_ID_MAX_LEN),
    ttclid: truncate(c.req.query('ttclid'), CLICK_ID_MAX_LEN),
    twclid: truncate(c.req.query('twclid'), CLICK_ID_MAX_LEN),
    utmSource: truncate(c.req.query('utm_source'), UTM_MAX_LEN),
    utmMedium: truncate(c.req.query('utm_medium'), UTM_MAX_LEN),
    utmCampaign: truncate(c.req.query('utm_campaign'), UTM_MAX_LEN),
    utmContent: truncate(c.req.query('utm_content'), UTM_MAX_LEN),
    utmTerm: truncate(c.req.query('utm_term'), UTM_MAX_LEN),
  };
}

// アトリビューション情報を次URLのクエリに引継ぐ
function appendAttributionToUrl(url: string, attr: ReturnType<typeof extractAttribution>): string {
  try {
    const u = new URL(url);
    for (const [key, value] of Object.entries(attr)) {
      if (!value) continue;
      // utmCampaign → utm_campaign に戻す
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!u.searchParams.has(dbKey)) {
        u.searchParams.set(dbKey, value);
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}

// GET /t/:linkId — click tracking redirect (no auth, fast redirect)
trackedLinks.get('/t/:linkId', async (c) => {
  const linkId = c.req.param('linkId');
  const lineUserId = c.req.query('lu') ?? null;
  let friendId = c.req.query('f') ?? null;

  // Look up the link first
  const link = await getTrackedLinkById(c.env.DB, linkId);

  if (!link || !link.is_active) {
    return c.json({ success: false, error: 'Link not found' }, 404);
  }

  const useAppRedirect = isAppLinkDomain(link.original_url);

  // L-TRACK 互換: 認証スキップモード
  // skip_liff=1 のとき、LIFF経由を完全にスキップして、original_url（line.me/R/ti/p/@xxx 等）に
  // 直接302リダイレクト。クエリパラメータ（ltp/fbclid/utm_*）は引継ぐ。
  // friend 紐付けは webhook follow イベント受信時に時間窓+IP+UA で行う。
  const skipLiff = Boolean(link.skip_liff);

  // If no user ID yet, check if this is LINE's in-app browser → redirect to LIFF for identification
  // Skip LIFF redirect for app-link domains (they'll come from Safari via externalBrowser)
  // Skip LIFF redirect for L-TRACK compat (skip_liff=1)
  const ua = c.req.header('user-agent') || '';
  const isLineApp = /\bLine\b/i.test(ua);
  if (!skipLiff && !useAppRedirect && !lineUserId && !friendId && isLineApp && c.env.LIFF_URL) {
    const directUrl = `${c.env.WORKER_URL || new URL(c.req.url).origin}/t/${linkId}`;
    const liffRedirect = `${c.env.LIFF_URL}?redirect=${encodeURIComponent(directUrl)}`;
    return c.redirect(liffRedirect, 302);
  }

  // Resolve friendId from LINE user ID if provided
  if (!friendId && lineUserId) {
    const friend = await getFriendByLineUserId(c.env.DB, lineUserId);
    if (friend) {
      friendId = friend.id;
    }
  }

  // L-TRACK 互換: アトリビューション情報取得
  const attr = extractAttribution(c);
  const ipAddress = c.req.header('cf-connecting-ip') ?? null;
  // L-TRACK 互換: cf.country は Cloudflare がレイヤー1で付与する2文字国コード
  // (IP geo lookup)。L-TRACK CSV の「国」カラム互換。値が無い/UN/T1 は null として保存。
  const cfRaw = (c.req.raw as { cf?: { country?: string } }).cf?.country;
  const country = cfRaw && cfRaw !== 'XX' && cfRaw !== 'T1' ? cfRaw : null;

  // Run side-effects async (click recording, tag/scenario actions)
  const ctx = c.executionCtx as ExecutionContext;
  ctx.waitUntil(
    (async () => {
      try {
        // Phase 1-H: fingerprint 同意チェック
        // account_settings (line_account_id='global', key='fingerprint_consent') が '0' なら
        // user_agent / ip_address / ua_fingerprint を保存しない。
        // クリック自体は記録するので、CV 集計や ltp/fbclid マッチングには影響しない。
        const consentRow = await c.env.DB
          .prepare(`SELECT value FROM account_settings WHERE line_account_id = '__system__' AND key = 'fingerprint_consent'`)
          .first<{ value: string }>();
        const fingerprintConsent = consentRow?.value !== '0'; // 未設定は同意あり扱い (デフォルト)

        // L-TRACK 互換: UA fingerprint を生成して拡張版で記録
        const uaFingerprint = fingerprintConsent && ua ? await generateUaFingerprint(ua) : null;

        await recordLinkClickExtended(c.env.DB, {
          trackedLinkId: linkId,
          friendId,
          ltp: attr.ltp,
          fbclid: attr.fbclid,
          gclid: attr.gclid,
          ttclid: attr.ttclid,
          twclid: attr.twclid,
          utmSource: attr.utmSource,
          utmMedium: attr.utmMedium,
          utmCampaign: attr.utmCampaign,
          utmContent: attr.utmContent,
          utmTerm: attr.utmTerm,
          userAgent: fingerprintConsent ? (ua || null) : null,
          ipAddress: fingerprintConsent ? ipAddress : null,
          uaFingerprint,
          country,
        });

        // Run automatic actions if a friend is identified
        if (friendId) {
          const actions: Promise<unknown>[] = [];

          if (link.tag_id) {
            actions.push(addTagToFriend(c.env.DB, friendId, link.tag_id));
          }

          if (link.scenario_id) {
            actions.push(enrollFriendInScenario(c.env.DB, friendId, link.scenario_id));
          }

          if (actions.length > 0) {
            await Promise.allSettled(actions);
          }
        }
      } catch (err) {
        console.error(`/t/${linkId} async tracking error:`, err);
      }
    })(),
  );

  // L-TRACK 互換: アトリビューション情報を次URLのクエリに引継ぐ
  const redirectUrl = appendAttributionToUrl(link.original_url, attr);

  // App-link domains: return HTML with JS redirect for Universal Link support
  if (useAppRedirect) {
    return c.html(buildAppRedirectHtml(redirectUrl));
  }

  return c.redirect(redirectUrl, 302);
});

export { trackedLinks };
