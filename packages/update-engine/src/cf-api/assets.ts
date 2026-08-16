import { extname } from 'node:path';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { CfApiCreds } from '../types.js';
import { authHeader, throwHttpError, workersApiBase } from './_shared.js';

interface AssetManifestEntry {
  hash: string;
  size: number;
}

interface AssetsUploadSession {
  buckets?: string[][];
  jwt?: string;
}

/**
 * Upload a complete Workers Assets tree and return the completion JWT that
 * must be attached to the Worker script PUT. Uploading does not change live
 * traffic; the asset tree becomes active atomically with the script PUT.
 */
export async function uploadWorkerAssets(opts: {
  creds: CfApiCreds;
  scriptName: string;
  files: Map<string, Buffer>;
}): Promise<string> {
  if (opts.files.size === 0) {
    throw new Error('cannot deploy an empty Workers Assets tree');
  }

  const manifest: Record<string, AssetManifestEntry> = {};
  const fileByHash = new Map<string, { path: string; content: Buffer }>();
  for (const [rawPath, content] of opts.files) {
    const path = normalizeAssetPath(rawPath);
    const hash = hashWorkerAsset(path, content);
    manifest[path] = { hash, size: content.byteLength };
    if (!fileByHash.has(hash)) fileByHash.set(hash, { path, content });
  }

  const sessionResponse = await fetch(
    `${workersApiBase(opts.creds.accountId)}/${opts.scriptName}/assets-upload-session`,
    {
      method: 'POST',
      headers: {
        ...authHeader(opts.creds.apiToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ manifest }),
    },
  );
  if (!sessionResponse.ok) {
    await throwHttpError('CREATE worker assets upload session failed', sessionResponse);
  }
  const sessionEnvelope = (await sessionResponse.json()) as {
    result?: AssetsUploadSession;
  };
  const session = sessionEnvelope.result;
  if (!session?.jwt) throw new Error('worker assets upload session returned no JWT');

  const buckets = session.buckets ?? [];
  if (buckets.flat().length === 0) return session.jwt;

  let completionJwt = '';
  for (const bucket of buckets) {
    const form = new FormData();
    for (const hash of bucket) {
      const file = fileByHash.get(hash);
      if (!file) {
        throw new Error(`worker assets API requested unknown hash ${hash}`);
      }
      const base64 = file.content.toString('base64');
      form.append(
        hash,
        new Blob([base64], { type: contentTypeFor(file.path) }),
        hash,
      );
    }

    const uploadResponse = await fetchWithAssetRetry(
      `https://api.cloudflare.com/client/v4/accounts/${opts.creds.accountId}/workers/assets/upload?base64=true`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.jwt}` },
        body: form,
      },
    );
    if (!uploadResponse.ok) {
      await throwHttpError('UPLOAD worker assets failed', uploadResponse);
    }
    const uploadEnvelope = (await uploadResponse.json()) as {
      result?: { jwt?: string };
    };
    completionJwt = uploadEnvelope.result?.jwt ?? completionJwt;
  }

  if (!completionJwt) throw new Error('worker assets upload returned no completion JWT');
  return completionJwt;
}

/** Cloudflare/Wrangler Workers Assets hash: BLAKE3(base64(bytes)+extension). */
export function hashWorkerAsset(path: string, content: Buffer): string {
  const extension = extname(path).slice(1);
  const input = new TextEncoder().encode(content.toString('base64') + extension);
  return bytesToHex(blake3(input)).slice(0, 32);
}

function normalizeAssetPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').includes('..')) {
    throw new Error(`invalid Workers Asset path: ${path}`);
  }
  // Cloudflare's Workers Assets upload-session API requires every manifest
  // key to be an absolute URL path. Bundle entries are stored relative to
  // worker-assets/, so add the leading slash only at the API boundary.
  return `/${normalized}`;
}

function contentTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html':
      return 'text/html';
    case '.js':
    case '.mjs':
      return 'application/javascript';
    case '.css':
      return 'text/css';
    case '.json':
      return 'application/json';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.woff2':
      return 'font/woff2';
    default:
      // Wrangler uses application/null to tell the API to omit the response
      // Content-Type for unknown extensions (for example `_redirects`).
      return 'application/null';
  }
}

async function fetchWithAssetRetry(url: string, init: RequestInit): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, init);
    last = response;
    if (response.ok || (response.status !== 429 && response.status < 500)) return response;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  return last as Response;
}
