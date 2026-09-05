import { getOrCreateAutoTrackedLink, getLineAccountById } from '@line-crm/db';
import { resolveTrackedLinkBaseUrl } from '../lib/link-base-url.js';
import { renderBroadcastMessageContent } from './render-message.js';

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
  // Lookups are independent per URL, so run them concurrently — a carousel
  // can hold 10+ URIs and sequential D1 round-trips add up inside per-friend
  // delivery loops.
  const entries = await Promise.all(
    [...urls].map(async (url) => {
      // Reuses the one auto link per (url, account) — per-friend delivery
      // loops must not mint a fresh tracked_links row on every send.
      const link = await getOrCreateAutoTrackedLink(db, {
        originalUrl: url,
        lineAccountId: lineAccountId ?? null,
      });
      // /t/ URL — Worker handles LINE app detection and LIFF redirect server-side.
      // Prefer the short code (linkBase may be a branded short domain).
      const trackingUrl = `${linkBase}/t/${link.short_code ?? link.id}`;
      const hostname = new URL(url).hostname.replace('www.', '');
      const label = hostname.length > 20 ? hostname.slice(0, 20) + '…' : hostname;
      return [url, { trackingUrl, originalUrl: url, label }] as const;
    }),
  );
  return new Map(entries);
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
  // Tracked links are always built as `${base}/t/${code}` (worker base, short
  // domain, and legacy UUID form alike), so content without the literal
  // '/t/' cannot contain one. Skip the settings read — this runs in front of
  // reply-token sends where pre-send latency matters, and URL-free content
  // is the common case.
  if (!content.includes('/t/')) return content;
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
 * Text and flex messages both get their URLs replaced inline with tracked
 * links; the message type is preserved.
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

  // Flex messages → rewrite ONLY uri actions (action / defaultAction / altUri.desktop).
  // Never rewrite the `url` field of image/video/icon components: LINE's media
  // loader fetches that URL directly, and /t returns an HTML interstitial (not
  // an image), which renders hero/body images as blank space.
  let tree: unknown;
  try {
    tree = JSON.parse(content);
  } catch {
    // Not valid JSON — leave untouched rather than risk corrupting the payload
    return { messageType, content };
  }
  const skipPrefixes = linkBase !== workerBase ? [workerBase, linkBase] : [workerBase];
  const actionUris = new Set<string>();
  collectActionUris(tree, actionUris);
  // Only valid http(s) URIs are trackable (uri actions also allow tel:,
  // line://, etc., and hand-written JSON can hold malformed URLs like a bare
  // "https://" — createTrackingMap calls `new URL()`, so an invalid URI here
  // would throw and fail the whole delivery instead of one link).
  const trackableUris = new Set(
    [...actionUris].filter((u) => isTrackableHttpUrl(u) && !shouldSkip(u, skipPrefixes)),
  );
  if (trackableUris.size === 0) return { messageType, content };
  const uriMap = await createTrackingMap(db, trackableUris, linkBase, options?.lineAccountId);
  rewriteActionUris(tree, (u) => {
    const tracked = uriMap.get(u);
    if (!tracked) return u;
    return isAppLinkDomain(u)
      ? appendOpenExternalBrowser(tracked.trackingUrl)
      : tracked.trackingUrl;
  });
  return { messageType, content: JSON.stringify(tree) };
}

/** Valid, parseable http(s) URL — safe to hand to `new URL()` downstream */
function isTrackableHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Walk a Flex JSON tree and visit every action/defaultAction uri (+ altUri.desktop) */
function visitActionUris(node: unknown, visit: (holder: Record<string, unknown>, key: string) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) visitActionUris(child, visit);
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of ['action', 'defaultAction']) {
    const a = obj[key] as Record<string, unknown> | undefined;
    if (a && a.type === 'uri') {
      if (typeof a.uri === 'string') visit(a, 'uri');
      // Desktop LINE uses altUri.desktop instead of uri — track it the same way
      const alt = a.altUri as Record<string, unknown> | undefined;
      if (alt && typeof alt.desktop === 'string') visit(alt, 'desktop');
    }
  }
  for (const value of Object.values(obj)) visitActionUris(value, visit);
}

function collectActionUris(node: unknown, out: Set<string>): void {
  visitActionUris(node, (holder, key) => out.add(holder[key] as string));
}

function rewriteActionUris(node: unknown, fn: (u: string) => string): void {
  visitActionUris(node, (holder, key) => {
    holder[key] = fn(holder[key] as string);
  });
}

/**
 * Full per-friend outgoing decoration pipeline: wrap raw URLs into tracked
 * links (autoTrackContent), then bake f=<friendId> into /t links
 * (appendFriendToTrackedLinks) so clicks attribute without the LIFF
 * identification hop.
 *
 * Single implementation shared by the cron step delivery
 * (step-delivery.ts) and the instant first-step push
 * (immediate-first-step.ts) so the two pipelines cannot drift — whichever
 * side wins the delivery claim, the friend receives identically decorated
 * content.
 *
 * Per-friend sends only — never use for multicast/broadcast content (see
 * appendFriendToTrackedLinks). Returns the input unchanged when workerUrl
 * is not configured.
 */
export async function decorateForFriendPush(
  db: D1Database,
  messageType: string,
  content: string,
  workerUrl: string | undefined,
  opts: { lineAccountId: string | null; friendId: string },
): Promise<AutoTrackResult> {
  // {{liff_id}} → the delivering account's LIFF. A LIFF URL must belong to the
  // recipient's own account or LINE shows the other account's consent screen
  // and the funnel dies mid-hop. Broadcasts already substitute per account
  // (broadcast.ts / dedup-broadcast.ts); this brings scenario steps, instant
  // welcomes, and every other decorate caller in line so one shared scenario
  // can serve friends across accounts.
  let rendered = content;
  if (/\{\{\s*liff_id\s*\}\}/.test(content)) {
    let liffId: string | null = null;
    if (opts.lineAccountId) {
      const account = await getLineAccountById(db, opts.lineAccountId);
      liffId = (account as { liff_id?: string | null } | null)?.liff_id ?? null;
    }
    if (liffId) {
      rendered = renderBroadcastMessageContent(messageType, content, { liffId });
    } else {
      console.error(
        `[decorate] {{liff_id}} in content but no LIFF resolvable (account=${opts.lineAccountId ?? 'none'}) — left unresolved`,
      );
    }
  }
  if (!workerUrl) return { messageType, content: rendered };
  const tracked = await autoTrackContent(db, messageType, rendered, workerUrl, {
    lineAccountId: opts.lineAccountId,
  });
  const decorated = await appendFriendToTrackedLinks(db, tracked.content, workerUrl, opts.friendId);
  return { messageType: tracked.messageType, content: decorated };
}
