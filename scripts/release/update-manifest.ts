#!/usr/bin/env tsx
/**
 * Release manifest updater.
 *
 * Maintains `release-manifest.json` — the single source of truth that the
 * upgrade flow consults to decide which version to roll out and what to
 * download. Adding a release means: prepend a `ReleaseEntry` (newest first)
 * and bump `latest` to that version. Duplicate versions are rejected so
 * pipeline reruns don't silently corrupt history.
 *
 * Library API:
 *   updateManifest({ manifestPath, release })
 *
 * CLI:
 *   tsx scripts/release/update-manifest.ts \
 *     --manifest release-manifest.json \
 *     --release release-entry.json
 *
 * `release-entry.json` is a JSON file containing a single ReleaseEntry.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { argv, exit, stderr } from 'node:process';

export interface ReleaseEntry {
  version: string;
  released_at: string;
  worker_hash: string;
  admin_hash: string;
  liff_hash: string;
  worker_assets_hash?: string;
  /** Byte hash of the final bundled worker/index.js. */
  worker_bundle_hash?: string;
  bundle_url: string;
  bundle_size_bytes: number;
  required_secrets: string[];
  new_required_secrets: string[];
  migrations: string[];
  changelog_url: string;
  min_from_version: string;
}

export interface Manifest {
  schema_version: 1;
  latest: string;
  releases: ReleaseEntry[];
}

export function updateManifest(opts: { manifestPath: string; release: ReleaseEntry }): void {
  const { manifestPath, release } = opts;

  const manifest: Manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest)
    : { schema_version: 1, latest: release.version, releases: [] };

  if (manifest.schema_version !== 1) {
    throw new Error(`unsupported manifest schema_version: ${manifest.schema_version}`);
  }

  if (manifest.releases.some((r) => r.version === release.version)) {
    throw new Error(`release ${release.version} already exists in manifest`);
  }

  manifest.releases = [release, ...manifest.releases];
  manifest.latest = release.version;

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

interface CliArgs {
  manifest?: string;
  release?: string;
}

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      stderr.write(`update-manifest: missing value for --${key}\n`);
      exit(2);
    }
    i += 1;
    switch (key) {
      case 'manifest':
        out.manifest = value;
        break;
      case 'release':
        out.release = value;
        break;
      default:
        stderr.write(`update-manifest: unknown flag --${key}\n`);
        exit(2);
    }
  }
  return out;
}

function requireArg<T extends keyof CliArgs>(args: CliArgs, key: T): NonNullable<CliArgs[T]> {
  const v = args[key];
  if (v === undefined) {
    stderr.write(`update-manifest: --${String(key)} is required\n`);
    stderr.write(
      'Usage: tsx scripts/release/update-manifest.ts --manifest <file> --release <file>\n',
    );
    exit(2);
  }
  return v as NonNullable<CliArgs[T]>;
}

function main(rawArgs: string[]): void {
  const args = parseArgs(rawArgs);
  const manifestPath = requireArg(args, 'manifest');
  const releasePath = requireArg(args, 'release');

  const release = JSON.parse(readFileSync(releasePath, 'utf8')) as ReleaseEntry;
  updateManifest({ manifestPath, release });
}

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === argv[1];
  } catch {
    return false;
  }
})();

if (isCliEntry) {
  try {
    main(argv.slice(2));
  } catch (err) {
    stderr.write(`update-manifest: ${(err as Error).message}\n`);
    exit(1);
  }
}
