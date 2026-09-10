import type { Manifest, ReleaseEntry } from './types.js';

/**
 * Fetch the release manifest from the given URL.
 *
 * Uses `cache: 'no-store'` so that the update engine never serves a stale
 * manifest from a CDN/edge cache. Throws if the response is non-2xx or if the
 * manifest's `schema_version` is not supported by this engine.
 */
export async function fetchManifest(url: string): Promise<Manifest> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(
      `failed to fetch manifest from ${url}: HTTP ${res.status}`,
    );
  }

  const body = (await res.json()) as Manifest;
  if (body.schema_version !== 1 && body.schema_version !== 2) {
    throw new Error(
      `unsupported manifest schema_version ${body.schema_version}`,
    );
  }
  if (body.schema_version === 1 && body.releases.some(
    release => release.legacy_mileage_projection_version !== undefined,
  )) {
    throw new Error('historical mileage handoff requires manifest schema_version 2');
  }
  return body;
}

/** Find a release entry by exact version match. */
export function findRelease(
  manifest: Manifest,
  version: string,
): ReleaseEntry | undefined {
  return manifest.releases.find((r) => r.version === version);
}

/**
 * Return the latest release entry if it is strictly newer than `current`,
 * otherwise `null` (i.e. nothing to upgrade to).
 */
export function findLatestUpgrade(
  manifest: Manifest,
  current: string,
): ReleaseEntry | null {
  if (compareSemver(manifest.latest, current) <= 0) {
    return null;
  }
  return findRelease(manifest, manifest.latest) ?? null;
}

/**
 * Compare two `X.Y.Z` semver strings.
 *
 * Returns a negative number if `a < b`, `0` if equal, positive if `a > b`.
 * Pre-release suffixes are not supported in v1 of the manifest schema; any
 * non-numeric segment will be parsed as `NaN` and treated as `0`.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    const diff = pa[i] - pb[i];
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseSemver(v: string): [number, number, number] {
  const parts = v.split('.').map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}
