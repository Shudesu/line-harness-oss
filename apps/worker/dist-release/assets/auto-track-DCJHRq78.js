import { ag as createTrackedLink } from "./worker-entry-erCCD8uv.js";
import "node:events";
import "node:stream";
import "node:crypto";
import "node:zlib";
import "events";
const APP_LINK_DOMAINS = /* @__PURE__ */ new Set([
  "x.com",
  "twitter.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "facebook.com",
  "github.com"
]);
function isAppLinkDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (APP_LINK_DOMAINS.has(hostname)) return true;
    for (const root of APP_LINK_DOMAINS) {
      if (hostname.endsWith(`.${root}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
function appendOpenExternalBrowser(url) {
  if (url.includes("openExternalBrowser=")) return url;
  const hashIdx = url.indexOf("#");
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const fragment = hashIdx >= 0 ? url.slice(hashIdx) : "";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}openExternalBrowser=1${fragment}`;
}
const URL_REGEX = /https?:\/\/[^\s"'<>\])}]+/g;
const SKIP_PATTERNS = [
  /\/t\/[0-9a-f-]{36}/,
  // already a tracking link
  /liff\.line\.me/,
  // LIFF URLs
  /line\.me\/R\//,
  // LINE deep links
  /your-worker-name/
  // our own worker
];
function shouldSkip(url) {
  return SKIP_PATTERNS.some((p) => p.test(url));
}
function extractUrls(content) {
  const urls = /* @__PURE__ */ new Set();
  for (const match of content.matchAll(URL_REGEX)) {
    const url = match[0].replace(/[.,;:!?)]+$/, "");
    if (!shouldSkip(url)) urls.add(url);
  }
  return urls;
}
async function createTrackingMap(db, urls, workerUrl, lineAccountId) {
  const urlMap = /* @__PURE__ */ new Map();
  for (const url of urls) {
    const link = await createTrackedLink(db, {
      name: `auto: ${url.slice(0, 60)}`,
      originalUrl: url,
      lineAccountId: lineAccountId ?? null
    });
    const trackingUrl = `${workerUrl}/t/${link.id}`;
    const hostname = new URL(url).hostname.replace("www.", "");
    const label = hostname.length > 20 ? hostname.slice(0, 20) + "…" : hostname;
    urlMap.set(url, { trackingUrl, originalUrl: url, label });
  }
  return urlMap;
}
async function autoTrackContent(db, messageType, content, workerUrl, options) {
  if (messageType === "image") return { messageType, content };
  const urls = extractUrls(content);
  if (urls.size === 0) return { messageType, content };
  if (messageType === "text") {
    const trackable = new Set([...urls].filter((u) => !isAppLinkDomain(u)));
    const urlMap2 = trackable.size > 0 ? await createTrackingMap(db, trackable, workerUrl, options?.lineAccountId) : /* @__PURE__ */ new Map();
    let result2 = content;
    for (const url of urls) {
      let replacement;
      if (isAppLinkDomain(url)) {
        replacement = appendOpenExternalBrowser(url);
      } else {
        const tracked = urlMap2.get(url);
        replacement = tracked ? tracked.trackingUrl : url;
      }
      result2 = result2.split(url).join(replacement);
    }
    return { messageType: "text", content: result2 };
  }
  const urlMap = await createTrackingMap(db, urls, workerUrl, options?.lineAccountId);
  let result = content;
  for (const [original, { trackingUrl, originalUrl }] of urlMap) {
    const finalUrl = isAppLinkDomain(originalUrl) ? appendOpenExternalBrowser(trackingUrl) : trackingUrl;
    result = result.split(original).join(finalUrl);
  }
  return { messageType, content: result };
}
export {
  autoTrackContent
};
