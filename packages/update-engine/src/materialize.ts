/**
 * Install-time materialization of release-bundle artifacts.
 *
 * The release pipeline bakes a placeholder origin
 * (`https://__LH_WORKER_URL__`) into the admin bundle because the real
 * Worker URL only exists once a customer installs. Every deploy path that
 * ships bundle admin files to Pages (CLI setup, CLI update, worker-side
 * self-update) for a per-tenant / self-hosted install MUST rewrite that
 * placeholder to the install's Worker URL first — deploying the files
 * verbatim produces an admin UI that calls `https://__LH_WORKER_URL__/api/...`
 * and breaks on arrival. Shared builds are never materialized here; their
 * build pipeline explicitly selects same-origin API mode instead — see
 * admin-url-placeholder.ts.
 */

import { ADMIN_URL_PLACEHOLDER } from './admin-url-placeholder.js';
export { ADMIN_URL_PLACEHOLDER };

/**
 * Extensions we treat as text for placeholder substitution. Everything else
 * (images, fonts, wasm) is passed through byte-for-byte — running a string
 * replace over binary content would corrupt it.
 */
const TEXT_EXTENSIONS = new Set([
  'js',
  'mjs',
  'cjs',
  'css',
  'html',
  'htm',
  'json',
  'map',
  'svg',
  'txt',
  'webmanifest',
  'xml',
]);

export function isTextAssetPath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/**
 * Rewrite the admin bundle for a concrete install: replaces every
 * occurrence of {@link ADMIN_URL_PLACEHOLDER} with the install's Worker
 * origin. Returns a NEW map; input buffers are never mutated.
 *
 * `workerUrl` is normalized to a bare origin (no trailing slash) because
 * the admin client concatenates paths as `${API_URL}${path}`.
 */
export function materializeAdminFiles(
  files: Map<string, Buffer>,
  workerUrl: string,
): Map<string, Buffer> {
  const origin = workerUrl.replace(/\/+$/, '');
  const out = new Map<string, Buffer>();
  for (const [path, buf] of files) {
    if (!isTextAssetPath(path)) {
      out.set(path, buf);
      continue;
    }
    const text = buf.toString('utf8');
    if (!text.includes(ADMIN_URL_PLACEHOLDER)) {
      out.set(path, buf);
      continue;
    }
    out.set(path, Buffer.from(text.split(ADMIN_URL_PLACEHOLDER).join(origin), 'utf8'));
  }
  return out;
}

/**
 * Post-materialization safety net: list text files that still contain a
 * `__LH_` marker (an unknown placeholder this version of the tooling does
 * not know how to fill). Callers surface these as warnings — the deploy
 * still proceeds, but the operator learns which files may misbehave.
 */
export function findResidualPlaceholders(files: Map<string, Buffer>): string[] {
  const residual: string[] = [];
  for (const [path, buf] of files) {
    if (!isTextAssetPath(path)) continue;
    if (buf.toString('utf8').includes('__LH_')) {
      residual.push(path);
    }
  }
  return residual.sort();
}

/**
 * Classify a D1 / SQLite error message as "schema object already exists".
 *
 * L Harness migrations are additive-only (enforced by
 * scripts/check-migrations.ts) and use INSERT OR IGNORE for seed data, so
 * re-applying a migration against a database that already has it fails ONLY
 * with duplicate-object errors. Setup has always swallowed these
 * (`packages/create-line-harness/src/steps/database.ts`); the update and
 * adoption flows reuse the same policy via this predicate.
 *
 * Matches both wrangler CLI stderr and the D1 REST API error text.
 */
export function isBenignSchemaErrorText(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('duplicate column') ||
    t.includes('already exists') ||
    (t.includes('table') && t.includes('already'))
  );
}
