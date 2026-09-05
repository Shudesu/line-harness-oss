/**
 * Resolve the admin UI's API base origin.
 *
 * Both variables below are read at build time and inlined by Next.js:
 *
 *   - Per-tenant builds and self-hosted installs: the release pipeline
 *     builds with `NEXT_PUBLIC_API_URL=https://__LH_WORKER_URL__` and the
 *     deploy step (`materializeAdminFiles`, see
 *     `@line-harness/update-engine`'s materialize.ts) rewrites that
 *     placeholder to the real Worker origin before the files are served.
 *   - Shared same-origin builds: the build pipeline explicitly sets
 *     `NEXT_PUBLIC_API_MODE=same-origin`; the browser origin is the API.
 *
 * The explicit mode is load-bearing. v0.23.0 inferred same-origin mode by
 * comparing `NEXT_PUBLIC_API_URL` with an imported placeholder constant.
 * `materializeAdminFiles()` replaced BOTH copies with the tenant Worker URL,
 * so the comparison stayed true and a normal Pages admin posted login to
 * itself (`pages.dev/api/auth/login` → 405). Never infer deployment topology
 * from a value that the normal deployment pipeline rewrites.
 *
 * A standard build that somehow reaches the browser with the placeholder
 * still present returns `undefined` instead of silently becoming same-origin.
 * Callers then surface their existing configuration error. The lowercase
 * hostname check deliberately does not contain the full replaceable
 * `https://__LH_WORKER_URL__` literal, so materialization cannot rewrite the
 * detector itself.
 *
 * During the Node-side static prerender pass `window` does not exist. A
 * same-origin build returns the configured value for that one-time render;
 * browser effects/handlers call this again after hydration and receive the
 * real browser origin.
 */
export function getApiBase(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_API_URL
  if (!configured) return undefined

  if (process.env.NEXT_PUBLIC_API_MODE === 'same-origin') {
    return typeof window !== 'undefined' ? window.location.origin : configured
  }

  if (isUnmaterializedWorkerPlaceholder(configured)) return undefined
  return configured
}

function isUnmaterializedWorkerPlaceholder(value: string): boolean {
  try {
    return new URL(value).hostname === '__lh_worker_url__'
  } catch {
    return false
  }
}
