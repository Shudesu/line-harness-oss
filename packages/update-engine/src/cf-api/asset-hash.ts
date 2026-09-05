import { extname } from 'node:path';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Pure Workers Assets hashing/path-normalization, split out of `assets.ts` so
 * it can be imported without pulling in the fetch-based upload flow.
 *
 * This is the CANONICAL implementation — every caller that needs a Workers
 * Assets manifest hash (the CF upload flow here, the WfP release-bundle
 * builder in `scripts/release/build-wfp-bundle.ts`) must import from this
 * file rather than reimplementing the algorithm. A second implementation is
 * exactly how the manifest silently drifts from what Cloudflare actually
 * computes — see the WfP bundle spec
 * (lharness-cloud `docs/superpowers/specs/2026-08-21-the-harness-cloud-platform-design.md`
 * §18.2) for what breaks when that happens.
 */

/** Cloudflare/Wrangler Workers Assets hash: BLAKE3(base64(bytes)+extension). */
export function hashWorkerAsset(path: string, content: Buffer): string {
  const extension = extname(path).slice(1);
  const input = new TextEncoder().encode(content.toString('base64') + extension);
  return bytesToHex(blake3(input)).slice(0, 32);
}

/**
 * Normalize a local file path into the absolute URL path Cloudflare's
 * assets-upload-session API expects as a manifest key: forward slashes, no
 * leading `./`, exactly one leading `/`.
 */
export function normalizeAssetPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').includes('..')) {
    throw new Error(`invalid Workers Asset path: ${path}`);
  }
  // Cloudflare's Workers Assets upload-session API requires every manifest
  // key to be an absolute URL path. Bundle entries are stored relative to
  // worker-assets/, so add the leading slash only at the API boundary.
  return `/${normalized}`;
}
