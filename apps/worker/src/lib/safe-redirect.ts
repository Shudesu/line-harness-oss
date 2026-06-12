/**
 * URL schemes that can execute script / load attacker content when handed to
 * `c.redirect()` (Location) or `window.location.href`. These are the only
 * schemes this guard blocks.
 */
const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:']);

/**
 * Validate a user-supplied post-OAuth redirect target.
 *
 * The `?redirect=` param on /auth/line (and the /api/links/wrap proxy) is an
 * intentional feature: businesses send users to their own marketing/LP
 * destinations — and app/deep-link schemes like `line://`, `tel:`, `mailto:` —
 * after the friend-add funnel. To avoid breaking those funnels this guard is a
 * *denylist*, not an allowlist: it accepts http(s), root-relative paths, and
 * any non-dangerous scheme, and only rejects the things that are never a
 * legitimate redirect target:
 *   - script/content schemes (javascript:, data:, vbscript:, file:) — XSS,
 *   - protocol-relative `//host` (incl. the `/\host` / `\\host` backslash
 *     variants browsers normalize to `//`) — scheme confusion,
 *   - control characters — header-splitting / bypass tricks,
 *   - and anything that is neither an absolute URL nor a root-relative path.
 *
 * Used on both redirect sinks: the server-side /auth/callback redirect and the
 * client-side LIFF navigation (apps/worker/src/client/main.ts).
 *
 * @returns the trimmed redirect string when safe, or null when the caller
 *          should fall back to the default completion screen.
 */
export function safeRedirectTarget(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  // Control characters (incl. CR/LF/TAB, code point < 0x20 or DEL 0x7f) enable
  // header-splitting / bypass tricks — never legitimate in a redirect target.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }

  // Protocol-relative forms (`//host`, and the `/\`, `\\`, `\/` backslash
  // variants browsers normalize to `//`) — reject before the relative-path
  // branch below.
  if (/^[/\\][/\\]/.test(value)) return null;

  // Root-relative path (single leading slash) — same-origin, always safe.
  if (value.startsWith('/')) return value;

  // Absolute URL: accept any scheme except the dangerous ones. A value that is
  // neither root-relative nor a parseable absolute URL (e.g. "not a url",
  // bare "evil.com") is rejected rather than guessed.
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return DANGEROUS_SCHEMES.has(url.protocol.toLowerCase()) ? null : value;
}
