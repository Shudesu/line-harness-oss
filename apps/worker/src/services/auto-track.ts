import { createTrackedLink, getTrackedLinks } from '@line-crm/db';

const URL_REGEX = /https?:\/\/[^\s"'<>\])}]+/g;

// URLs that should NOT be wrapped (internal/system URLs)
const SKIP_PATTERNS = [
  /\/t\/[0-9a-f-]{36}/,       // already a tracking link
  /liff\.line\.me/,            // LIFF URLs
  /line\.me\/R\//,             // LINE deep links
  /line-crm-worker/,           // our own worker
];

function shouldSkip(url: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(url));
}

/**
 * Auto-wrap URLs in message content with tracking links.
 * Works with both text and flex (JSON string) content.
 */
export async function autoTrackContent(
  db: D1Database,
  messageType: string,
  content: string,
  workerUrl: string,
  liffUrl: string,
): Promise<string> {
  if (messageType === 'image') return content;

  // Collect all unique URLs from the content
  const urls = new Set<string>();
  const raw = messageType === 'flex' ? content : content;
  for (const match of raw.matchAll(URL_REGEX)) {
    const url = match[0].replace(/[.,;:!?)]+$/, ''); // trim trailing punctuation
    if (!shouldSkip(url)) urls.add(url);
  }

  if (urls.size === 0) return content;

  // Create tracking links for each unique URL
  const urlMap = new Map<string, string>();
  for (const url of urls) {
    const link = await createTrackedLink(db, {
      name: `auto: ${url.slice(0, 60)}`,
      originalUrl: url,
    });
    const directUrl = `${workerUrl}/t/${link.id}`;
    const trackingUrl = `${liffUrl}?redirect=${encodeURIComponent(directUrl)}`;
    urlMap.set(url, trackingUrl);
  }

  // Replace URLs in content
  let result = content;
  for (const [original, tracking] of urlMap) {
    result = result.split(original).join(tracking);
  }

  return result;
}
