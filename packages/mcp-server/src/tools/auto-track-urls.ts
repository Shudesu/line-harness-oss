import type { LineHarness } from "@line-harness/sdk";

/**
 * Recursively find all URI action URLs in a Flex Message object,
 * create tracked links for each, and replace with tracking URLs.
 */
export async function autoTrackUrls(
  client: LineHarness,
  messageContent: string,
  messageType: string,
  title: string,
): Promise<{ content: string; trackedUrls: { original: string; tracking: string }[] }> {
  if (messageType !== "flex") {
    return { content: messageContent, trackedUrls: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(messageContent);
  } catch {
    return { content: messageContent, trackedUrls: [] };
  }

  const urlMap = new Map<string, string>();

  // Collect all unique URIs from the flex message
  collectUris(parsed, urlMap);

  if (urlMap.size === 0) {
    return { content: messageContent, trackedUrls: [] };
  }

  // Create tracked links for each unique URL
  const trackedUrls: { original: string; tracking: string }[] = [];
  for (const originalUrl of urlMap.keys()) {
    try {
      const link = await client.trackedLinks.create({
        name: `${title} — ${truncate(originalUrl, 50)}`,
        originalUrl,
      });
      urlMap.set(originalUrl, link.trackingUrl);
      trackedUrls.push({ original: originalUrl, tracking: link.trackingUrl });
    } catch {
      // If tracked link creation fails, keep original URL
    }
  }

  // Replace URLs in the parsed object
  replaceUris(parsed, urlMap);

  return {
    content: JSON.stringify(parsed),
    trackedUrls,
  };
}

function collectUris(obj: unknown, urlMap: Map<string, string>): void {
  if (obj === null || obj === undefined || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectUris(item, urlMap);
    }
    return;
  }

  const record = obj as Record<string, unknown>;

  // Check if this is a URI action
  if (record.type === "uri" && typeof record.uri === "string") {
    const uri = record.uri;
    // Only track http/https URLs, skip LINE-specific URIs
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      if (!urlMap.has(uri)) {
        urlMap.set(uri, uri); // placeholder, replaced after creation
      }
    }
  }

  // Recurse into all values
  for (const value of Object.values(record)) {
    collectUris(value, urlMap);
  }
}

function replaceUris(obj: unknown, urlMap: Map<string, string>): void {
  if (obj === null || obj === undefined || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      replaceUris(item, urlMap);
    }
    return;
  }

  const record = obj as Record<string, unknown>;

  if (record.type === "uri" && typeof record.uri === "string") {
    const tracked = urlMap.get(record.uri);
    if (tracked && tracked !== record.uri) {
      record.uri = tracked;
    }
  }

  for (const value of Object.values(record)) {
    replaceUris(value, urlMap);
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "…" : str;
}
