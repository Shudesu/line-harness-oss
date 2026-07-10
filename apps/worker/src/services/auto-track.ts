import { createTrackedLink } from '@line-crm/db';
import { resolveTrackedLinkBaseUrl } from '../lib/link-base-url.js';

// Domains where Universal Links / App Links should be used
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
    if (APP_LINK_DOMAINS.has(hostname)) return true;
    // common share / mobile / regional subdomains: vm.tiktok.com, m.youtube.com,
    // mobile.x.com 等。`.<root-domain>` で末尾一致させる。
    for (const root of APP_LINK_DOMAINS) {
      if (hostname.endsWith(`.${root}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * URL に `openExternalBrowser=1` を追加する。`#fragment` がある場合は fragment の前に
 * 入れる必要がある (`...?param=1#anchor` の順序を保たないと LINE がフラグを認識しない、
 * かつ fragment 自体が変わって anchored リンク先 (GitHub コメント等) が壊れる)。
 */
function appendOpenExternalBrowser(url: string): string {
  if (url.includes('openExternalBrowser=')) return url;
  const hashIdx = url.indexOf('#');
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const fragment = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}openExternalBrowser=1${fragment}`;
}

const URL_REGEX = /https?:\/\/[^\s"'<>\])}]+/g;

// URLs that should NOT be wrapped (internal/system URLs)
const SKIP_PATTERNS = [
  /\/t\/[0-9a-f-]{36}/,       // already a tracking link (legacy UUID form)
  /liff\.line\.me/,            // LIFF URLs
  /line\.me\/R\//,             // LINE deep links
  /your-worker-name/,           // our own worker
];

function shouldSkip(url: string, skipPrefixes: string[]): boolean {
  if (SKIP_PATTERNS.some((p) => p.test(url))) return true;
  // Short-code tracking links (/t/Ab3xY9k) don't match the UUID pattern, so
  // skip anything under our own worker or the configured short domain.
  return skipPrefixes.some((prefix) => prefix && url.startsWith(`${prefix}/t/`));
}

/** Extract trackable URLs from content string */
function extractUrls(content: string, skipPrefixes: string[]): Set<string> {
  const urls = new Set<string>();
  for (const match of content.matchAll(URL_REGEX)) {
    const url = match[0].replace(/[.,;:!?)]+$/, '');
    if (!shouldSkip(url, skipPrefixes)) urls.add(url);
  }
  return urls;
}

/** Create tracking links and return a map of original → tracking URL */
async function createTrackingMap(
  db: D1Database,
  urls: Set<string>,
  linkBase: string,
  lineAccountId?: string | null,
): Promise<Map<string, { trackingUrl: string; originalUrl: string; label: string }>> {
  const urlMap = new Map<string, { trackingUrl: string; originalUrl: string; label: string }>();
  for (const url of urls) {
    const link = await createTrackedLink(db, {
      name: `auto: ${url.slice(0, 60)}`,
      originalUrl: url,
      lineAccountId: lineAccountId ?? null,
    });
    // /t/ URL — Worker handles LINE app detection and LIFF redirect server-side.
    // Prefer the short code (linkBase may be a branded short domain).
    const trackingUrl = `${linkBase}/t/${link.short_code ?? link.id}`;
    const hostname = new URL(url).hostname.replace('www.', '');
    const label = hostname.length > 20 ? hostname.slice(0, 20) + '…' : hostname;
    urlMap.set(url, { trackingUrl, originalUrl: url, label });
  }
  return urlMap;
}

/** Build a Flex bubble from text + tracked URLs */
function textToFlex(
  text: string,
  links: { trackingUrl: string; originalUrl: string; label: string }[],
): string {
  // Remove URLs from the text body
  let cleanText = text;
  for (const link of links) {
    cleanText = cleanText.split(link.originalUrl).join('').trim();
  }
  // Clean up leftover whitespace/punctuation
  cleanText = cleanText.replace(/\s{2,}/g, ' ').replace(/[👉🔗➡️]\s*$/g, '').trim();

  const bodyContents: unknown[] = [];
  if (cleanText) {
    bodyContents.push({
      type: 'text',
      text: cleanText,
      size: 'md',
      color: '#333333',
      wrap: true,
    });
  }

  const buttons = links.map((link) => {
    // Append openExternalBrowser=1 for app-link domains (opens Safari/Chrome instead of LINE browser)
    const uri = isAppLinkDomain(link.originalUrl)
      ? `${link.trackingUrl}${link.trackingUrl.includes('?') ? '&' : '?'}openExternalBrowser=1`
      : link.trackingUrl;
    return {
      type: 'button',
      action: {
        type: 'uri',
        label: `${link.label} を開く`,
        uri,
      },
      style: 'primary',
      color: '#1a1a2e',
      margin: 'sm',
    };
  });

  const bubble = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: bodyContents,
      paddingAll: '16px',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: buttons,
      paddingAll: '12px',
    },
  };

  return JSON.stringify(bubble);
}

export interface AutoTrackResult {
  messageType: string;
  content: string;
}

export interface AutoTrackOptions {
  /**
   * LINE account that owns the created tracked links. /t/:linkId uses this to
   * redirect LINE in-app clicks to the owning account's LIFF (instead of the
   * global env.LIFF_URL) so friends of that account never see another
   * account's consent screen.
   */
  lineAccountId?: string | null;
}

/**
 * Append `f=<friendId>` to every /t/ tracked-link URL in per-friend message
 * content. With f= present, /t skips the LIFF identification hop entirely
 * (no consent screen, no extra tap) and still attributes the click — the
 * friend is already known because the message was pushed 1:1.
 *
 * Only valid for per-friend sends (scenario step delivery, manual DM,
 * OAuth immediate push). NEVER use for multicast/broadcast content: the same
 * body goes to many users, so a baked f= would attribute everyone's clicks
 * to one friend.
 */
export async function appendFriendToTrackedLinks(
  db: D1Database,
  content: string,
  workerUrl: string,
  friendId: string | null | undefined,
): Promise<string> {
  if (!friendId) return content;
  const workerBase = workerUrl.replace(/\/$/, '');
  const linkBase = await resolveTrackedLinkBaseUrl(db, workerUrl);
  const bases = [...new Set([workerBase, linkBase])];
  return content.replace(URL_REGEX, (match) => {
    // URL_REGEX greedily captures trailing sentence punctuation and even
    // full-width Japanese text glued to the URL (「…/t/abc。続き」等)。
    // URL は ASCII のみなので、まず ASCII 境界で切り、さらに extractUrls と
    // 同じ末尾記号を URL の外として扱う。f= はその手前に挿す。
    const ascii = match.match(/^[\x21-\x7E]+/)?.[0] ?? '';
    const punct = ascii.match(/[.,;:!?)]+$/)?.[0] ?? '';
    const url = punct ? ascii.slice(0, -punct.length) : ascii;
    const trailing = match.slice(url.length);
    const isTrackedLink = bases.some((b) => url.startsWith(`${b}/t/`));
    if (!isTrackedLink) return match;
    if (/[?&]f=/.test(url)) return match;
    // /t links never carry fragments, so appending at the end is safe.
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}f=${encodeURIComponent(friendId)}${trailing}`;
  });
}

/**
 * Auto-wrap URLs in message content with tracking links.
 * For text messages with URLs, converts to Flex with button.
 * For flex messages, replaces URLs inline.
 */
export async function autoTrackContent(
  db: D1Database,
  messageType: string,
  content: string,
  workerUrl: string,
  options?: AutoTrackOptions,
): Promise<AutoTrackResult> {
  if (messageType === 'image') return { messageType, content };

  // Extract first so URL-free messages (the common case in per-friend
  // delivery loops) skip the settings lookup entirely.
  const workerBase = workerUrl.replace(/\/$/, '');
  let urls = extractUrls(content, [workerBase]);
  if (urls.size === 0) return { messageType, content };

  // Branded short domain (tracked_link_base_url) when configured, else workerUrl.
  // Re-filter: short-domain /t links are already tracked — never re-wrap them.
  const linkBase = await resolveTrackedLinkBaseUrl(db, workerUrl);
  if (linkBase !== workerBase) {
    urls = new Set([...urls].filter((u) => !u.startsWith(`${linkBase}/t/`)));
    if (urls.size === 0) return { messageType, content };
  }

  // Text messages: app-link domain (YouTube / X / TikTok 等) は raw URL を残して
  //   `?openExternalBrowser=1` だけ付ける。LINE 上で rich preview (YT サムネ等) が
  //   描画されるので「短い URL + プレビュー」というユーザー体験になる。クリックは
  //   ファーストパーティ計測できないが、それらのプラットフォームが自社で計測する。
  // Flex messages: trackingUrl + openExternalBrowser=1 (button 化されてプレビュー
  //   は不要なため、tracking 優先する従来通り)。
  if (messageType === 'text') {
    // app-link domain は tracking 不要なので createTrackedLink 自体スキップする
    // (無駄な link_clicks レコード防止)。
    const trackable = new Set([...urls].filter((u) => !isAppLinkDomain(u)));
    const urlMap = trackable.size > 0
      ? await createTrackingMap(db, trackable, linkBase, options?.lineAccountId)
      : new Map<string, { trackingUrl: string; originalUrl: string; label: string }>();

    let result = content;
    for (const url of urls) {
      let replacement: string;
      if (isAppLinkDomain(url)) {
        replacement = appendOpenExternalBrowser(url);
      } else {
        const tracked = urlMap.get(url);
        replacement = tracked ? tracked.trackingUrl : url;
      }
      result = result.split(url).join(replacement);
    }
    return { messageType: 'text', content: result };
  }

  // Flex messages → replace URLs inline in the JSON
  // For app-link domains, also inject openExternalBrowser=1 into the URI action
  const urlMap = await createTrackingMap(db, urls, linkBase, options?.lineAccountId);
  let result = content;
  for (const [original, { trackingUrl, originalUrl }] of urlMap) {
    const finalUrl = isAppLinkDomain(originalUrl)
      ? appendOpenExternalBrowser(trackingUrl)
      : trackingUrl;
    result = result.split(original).join(finalUrl);
  }
  return { messageType, content: result };
}
