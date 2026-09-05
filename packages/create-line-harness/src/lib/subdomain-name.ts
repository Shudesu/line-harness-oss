/**
 * workers.dev subdomain name rules — the same pattern wrangler validates
 * against before PUTting to the API (cloudflare/workers-sdk,
 * packages/deploy-helpers/src/triggers/subdomain.ts): 1–63 chars, lowercase
 * alphanumeric + hyphens, no leading/trailing hyphen.
 */
export const WORKERS_SUBDOMAIN_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidSubdomainName(name: string): boolean {
  return WORKERS_SUBDOMAIN_NAME_RE.test(name);
}

/**
 * Derive a valid workers.dev subdomain candidate from an arbitrary string
 * (typically the project name). Returns null when nothing usable remains —
 * callers then prompt without a default.
 */
export function sanitizeSubdomainCandidate(source: string): string | null {
  const candidate = source
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");
  return isValidSubdomainName(candidate) ? candidate : null;
}

/**
 * Extract the account subdomain from a `https://<worker>.<subdomain>.workers.dev`
 * URL. Used by the update flow to suggest re-registering the same name the
 * install originally had. Returns null for custom domains / unparsable URLs.
 */
export function subdomainFromWorkersDevUrl(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  const match = hostname.match(/^[^.]+\.([^.]+)\.workers\.dev$/);
  return match ? match[1] : null;
}
