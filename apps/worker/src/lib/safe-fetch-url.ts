/**
 * SSRF guard for outbound webhook URLs the admin can register
 * (currently only `forms.on_submit_webhook_url`).
 *
 * The form-submit handler dereferences these URLs server-side, so an
 * admin (or an attacker who reaches the admin surface) could otherwise
 * point them at cloud metadata IPs (169.254.169.254), localhost, or
 * private RFC1918 ranges to exfiltrate Worker-internal data or pivot
 * into the customer network from Cloudflare's egress.
 *
 * This module returns a typed reason on rejection so the caller can
 * surface it in error responses / logs. Schemes are restricted to
 * http/https; private-IP detection covers the well-known IPv4 ranges
 * plus IPv6 loopback / unique-local / link-local.
 *
 * NOTE: this is a *literal* host check. It does NOT resolve DNS, so a
 * DNS name that resolves to a private IP is still allowed through.
 * Workers does not expose a DNS resolver primitive; pinning egress
 * lives at the network layer (Cloudflare's egress already blocks
 * RFC1918 by default for Workers, but we still want a defense-in-depth
 * literal check so the metadata IP / explicit loopback URLs cannot be
 * fetched even by accident).
 *
 * LIMITATION (documented for future maintainers): because we cannot
 * resolve DNS inside a Worker, a hostname like `evil.example.com` whose
 * A record points at 127.0.0.1 will pass this literal check. The only
 * line of defense for that vector is Cloudflare's egress RFC1918 block
 * + customer-network firewalling. What we *can* do here is harden the
 * literal-string parser against every known bypass form (IPv4-mapped
 * IPv6, alternate IPv6 loopback notations, zero-padded octets, etc.)
 * so that an admin cannot register a metadata / loopback URL in any
 * spelling.
 */

export type SafeFetchUrlError =
  | 'invalid_url'
  | 'scheme_not_allowed'
  | 'host_blocked';

export interface SafeFetchUrlOk {
  ok: true;
  url: URL;
}

export interface SafeFetchUrlFail {
  ok: false;
  reason: SafeFetchUrlError;
  detail?: string;
}

export type SafeFetchUrlResult = SafeFetchUrlOk | SafeFetchUrlFail;

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Inspect a webhook URL and reject anything that could be an SSRF
 * target. Returns the parsed URL on success so the caller does not
 * re-parse.
 */
export function validateOutboundWebhookUrl(raw: string): SafeFetchUrlResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { ok: false, reason: 'scheme_not_allowed', detail: url.protocol };
  }

  const host = url.hostname.toLowerCase();
  if (isBlockedHost(host)) {
    return { ok: false, reason: 'host_blocked', detail: host };
  }

  return { ok: true, url };
}

/**
 * True if `host` is a literal loopback / private / link-local
 * address (IPv4 or IPv6). Domain names other than `localhost` are
 * always allowed because we do not resolve DNS here.
 */
export function isBlockedHost(host: string): boolean {
  // Reject anything that names the loopback by symbolic name.
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  // IPv6 literals come wrapped in `[]` from the WHATWG URL parser's
  // `hostname` only when the input was malformed; `URL.hostname`
  // already strips the brackets. Treat both forms defensively.
  const v6 = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  // IPv4-mapped IPv6 bypass guard: ::ffff:127.0.0.1 and ::ffff:7f00:1
  // both decode to 127.0.0.1 but slip past a naive `looksLikeIpv6`
  // check that only feeds them to isPrivateIpv6 (which doesn't know
  // about the embedded IPv4). Extract the embedded IPv4 and apply the
  // IPv4 private-range check.
  const mappedIpv4 = extractIPv4MappedIPv6(v6);
  if (mappedIpv4 !== null && isPrivateIpv4(mappedIpv4)) return true;

  if (looksLikeIpv6(v6) && isPrivateIpv6(v6)) return true;

  if (looksLikeIpv4(host) && isPrivateIpv4(host)) return true;

  return false;
}

/**
 * If `host` is an IPv4-mapped IPv6 literal (`::ffff:a.b.c.d` text form
 * or `::ffff:hhhh:hhhh` hex form), return the embedded IPv4 dotted-quad.
 * Otherwise return null.
 *
 * Both forms are valid per RFC 4291 §2.5.5.2 and are commonly used to
 * smuggle 127.0.0.1 / 169.254.169.254 past hostname-string SSRF guards.
 */
function extractIPv4MappedIPv6(host: string): string | null {
  // Text form: ::ffff:127.0.0.1
  const textMatch = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(host);
  if (textMatch) return textMatch[1] ?? null;

  // Hex form: ::ffff:7f00:1 (=127.0.0.1), ::ffff:a9fe:a9fe (=169.254.169.254)
  const hexMatch = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (hexMatch) {
    const hiStr = hexMatch[1];
    const loStr = hexMatch[2];
    if (!hiStr || !loStr) return null;
    const hi = Number.parseInt(hiStr, 16);
    const lo = Number.parseInt(loStr, 16);
    if (!Number.isInteger(hi) || !Number.isInteger(lo)) return null;
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }

  return null;
}

function looksLikeIpv4(host: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Malformed — treat as blocked so we fail closed.
    return true;
  }
  const [a, b] = parts;
  // 0.0.0.0/8 — unspecified
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (covers AWS / GCP metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  return false;
}

function looksLikeIpv6(host: string): boolean {
  // Cheap shape check — contains `:` and only hex / `:`.
  return host.includes(':') && /^[0-9a-f:]+$/i.test(host);
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  // ::1 loopback (also the bare form after parsing). Also cover alternate
  // notations like `0::1`, `0:0::1`, `0:0:0:0:0:0:0:1` that decode to ::1.
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (/^0(?::0)*::1$/.test(normalized)) return true;
  // :: unspecified
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
  // fc00::/7 — unique local (includes fd00::/8)
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true;
  // fe80::/10 — link-local
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true;
  return false;
}
