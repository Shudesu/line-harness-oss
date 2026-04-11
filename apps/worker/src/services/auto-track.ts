import { createTrackedLink } from '@line-crm/db';

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
    return APP_LINK_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

const URL_REGEX = /https?:\/\/[^\s"'<>\])}]+/g;

// URLs that should NOT be wrapped (internal/system URLs)
const SKIP_PATTERNS = [
  /\/t\/[0-9a-f-]{36}/,       // already a tracking link
  /liff\.line\.me/,            // LIFF URLs
  /line\.me\/R\//,             // LINE deep links
  /your-worker-name/,           // our own worker
];

function shouldSkip(url: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(url));
}

/** Extract trackable URLs from content string */
function extractUrls(content: string): Set<string> {
  const urls = new Set<string>();
  for (const match of content.matchAll(URL_REGEX)) {
    const url = match[0].replace(/[.,;:!?)]+$/, '');
    if (!shouldSkip(url)) urls.add(url);
  }
  return urls;
}

/** Create tracking links and return a map of original → tracking URL */
async function createTrackingMap(
  db: D1Database,
  urls: Set<string>,
  workerUrl: string,
): Promise<Map<string, { trackingUrl: string; originalUrl: string; label: string }>> {
  const urlMap = new Map<string, { trackingUrl: string; originalUrl: string; label: string }>();
  for (const url of urls) {
    const link = await createTrackedLink(db, {
      name: `auto: ${url.slice(0, 60)}`,
      originalUrl: url,
    });
    // Use direct /t/ URL — Worker handles LINE app detection and LIFF redirect server-side
    const trackingUrl = `${workerUrl}/t/${link.id}`;
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
): Promise<AutoTrackResult> {
  if (messageType === 'image') return { messageType, content };

  const urls = extractUrls(content);
  if (urls.size === 0) return { messageType, content };

  const urlMap = await createTrackingMap(db, urls, workerUrl);

  // Text messages → convert to Flex with buttons
  if (messageType === 'text') {
    const links = Array.from(urlMap.values());
    return {
      messageType: 'flex',
      content: textToFlex(content, links),
    };
  }

  // Flex messages → replace URLs inline in the JSON
  // For app-link domains, also inject openExternalBrowser=1 into the URI action
  let result = content;
  for (const [original, { trackingUrl, originalUrl }] of urlMap) {
    const finalUrl = isAppLinkDomain(originalUrl)
      ? `${trackingUrl}${trackingUrl.includes('?') ? '&' : '?'}openExternalBrowser=1`
      : trackingUrl;
    result = result.split(original).join(finalUrl);
  }
  return { messageType, content: result };
}
