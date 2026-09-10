import {
  getIncomingMedia,
  jstNow,
  markIncomingMediaFailed,
  markIncomingMediaPending,
  markIncomingMediaStored,
  reserveIncomingMedia,
} from '@line-crm/db';
import type { IncomingMediaRow, IncomingMediaSourceType } from '@line-crm/db';

const LINE_CONTENT_API_BASE = 'https://api-data.line.me/v2/bot/message';
const MAX_INCOMING_IMAGE_SIZE = 10 * 1024 * 1024;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface IncomingImageSource {
  type: IncomingMediaSourceType;
  id: string;
  senderUserId: string | null;
}

export interface FetchAndStoreOptions {
  db: D1Database;
  r2: R2Bucket;
  /** workers 環境では globalThis.fetch を使う。テスト時に注入する。 */
  fetch?: typeof fetch;
  /** 公開 URL のベース (例: https://your-worker.your-subdomain.workers.dev) */
  workerUrl: string;
  channelAccessToken: string;
  accountId: string;
  messageId: string;
  source: IncomingImageSource;
}

export interface IncomingImageRefs {
  originalContentUrl: string;
  previewImageUrl: string;
}

function privateRefs(workerUrl: string, accountId: string, messageId: string): IncomingImageRefs {
  const base = workerUrl.replace(/\/$/, '');
  const path = `/api/incoming-media/${encodeURIComponent(accountId)}/${encodeURIComponent(messageId)}/content`;
  const url = `${base}${path}`;
  return { originalContentUrl: url, previewImageUrl: url };
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

export function hasExpectedImageMagic(contentType: string, bytes: Uint8Array): boolean {
  switch (contentType) {
    case 'image/png':
      return hasPrefix(bytes, PNG_SIGNATURE);
    case 'image/jpeg':
    case 'image/jpg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/gif':
      return bytes.length >= 6 && (
        new TextDecoder().decode(bytes.subarray(0, 6)) === 'GIF87a' ||
        new TextDecoder().decode(bytes.subarray(0, 6)) === 'GIF89a'
      );
    case 'image/webp':
      return bytes.length >= 12 &&
        new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' &&
        new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP';
    default:
      return false;
  }
}

async function storedRefsIfObjectExists(
  opts: FetchAndStoreOptions,
  row: IncomingMediaRow | null,
): Promise<IncomingImageRefs | null> {
  if (row?.status !== 'stored') return null;
  try {
    if (await opts.r2.head(row.r2_key)) {
      return privateRefs(opts.workerUrl, opts.accountId, opts.messageId);
    }
  } catch {
    // Keep the last known-good D1 state when R2 itself is temporarily
    // unavailable. The authenticated content route will fail closed until R2
    // recovers, and a transient HEAD error must not regress stored -> pending.
    return privateRefs(opts.workerUrl, opts.accountId, opts.messageId);
  }
  await markIncomingMediaPending(opts.db, opts.accountId, opts.messageId, jstNow());
  return null;
}

async function finalizePendingFromR2(
  opts: FetchAndStoreOptions,
  row: IncomingMediaRow | null,
  expectedR2Key: string,
): Promise<IncomingImageRefs | null> {
  if (!row || row.status === 'stored' || row.r2_key !== expectedR2Key) return null;

  let object: R2ObjectBody | null;
  try {
    object = await opts.r2.get(expectedR2Key);
  } catch {
    return null;
  }
  if (!object || object.size > MAX_INCOMING_IMAGE_SIZE) return null;

  const contentType = object.httpMetadata?.contentType?.split(';')[0].trim().toLowerCase()
    ?? 'application/octet-stream';
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) return null;

  let data: ArrayBuffer;
  try {
    data = await object.arrayBuffer();
  } catch {
    return null;
  }
  const bytes = new Uint8Array(data);
  if (data.byteLength !== object.size || data.byteLength > MAX_INCOMING_IMAGE_SIZE) return null;
  if (!hasExpectedImageMagic(contentType, bytes)) return null;

  const sha256 = await sha256Hex(data);
  if (
    object.customMetadata?.sha256 !== sha256 ||
    object.customMetadata?.byteSize !== String(data.byteLength)
  ) {
    return null;
  }

  await markIncomingMediaStored(opts.db, opts.accountId, opts.messageId, {
    mimeType: contentType,
    byteSize: data.byteLength,
    sha256,
    now: jstNow(),
  });
  return privateRefs(opts.workerUrl, opts.accountId, opts.messageId);
}

async function markFailedQuietly(opts: FetchAndStoreOptions): Promise<void> {
  try {
    await markIncomingMediaFailed(opts.db, opts.accountId, opts.messageId, jstNow());
  } catch {
    // The pending row is intentionally retained for the next webhook retry.
  }
}

/** Store one LINE image in private R2 and its account-scoped D1 ledger row. */
export async function fetchAndStoreIncomingImage(
  opts: FetchAndStoreOptions,
): Promise<IncomingImageRefs | null> {
  if (
    !SAFE_IDENTIFIER.test(opts.accountId) ||
    !SAFE_IDENTIFIER.test(opts.messageId) ||
    !SAFE_IDENTIFIER.test(opts.source.id) ||
    (opts.source.senderUserId !== null && !SAFE_IDENTIFIER.test(opts.source.senderUserId))
  ) {
    return null;
  }

  const identityDigest = await sha256Hex(
    new TextEncoder().encode(`${opts.accountId}\0${opts.messageId}`),
  );
  const r2Key = `incoming-${identityDigest}`;

  try {
    const existing = await getIncomingMedia(opts.db, opts.accountId, opts.messageId);
    const existingRefs = await storedRefsIfObjectExists(opts, existing);
    if (existingRefs) return existingRefs;
    const recoveredRefs = await finalizePendingFromR2(opts, existing, r2Key);
    if (recoveredRefs) return recoveredRefs;

    const now = jstNow();
    const reservationId = crypto.randomUUID();
    const reserved = await reserveIncomingMedia(opts.db, {
      id: reservationId,
      lineAccountId: opts.accountId,
      lineMessageId: opts.messageId,
      sourceType: opts.source.type,
      sourceId: opts.source.id,
      senderUserId: opts.source.senderUserId,
      r2Key,
      now,
    });
    if (!reserved) throw new Error('Incoming media reservation missing');
    const racedRefs = await storedRefsIfObjectExists(opts, reserved);
    if (racedRefs) return racedRefs;
    if (reserved.id !== reservationId) {
      const racedRecovery = await finalizePendingFromR2(opts, reserved, r2Key);
      if (racedRecovery) return racedRecovery;
    }
  } catch (err) {
    console.error('incoming-image: D1 reservation failed', { error: err instanceof Error ? err.name : 'unknown' });
    return null;
  }

  const fetcher = opts.fetch ?? fetch;

  let res: Response;
  try {
    res = await fetcher(`${LINE_CONTENT_API_BASE}/${encodeURIComponent(opts.messageId)}/content`, {
      headers: { Authorization: `Bearer ${opts.channelAccessToken}` },
    });
  } catch (err) {
    console.error('incoming-image: content fetch failed', { error: err instanceof Error ? err.name : 'unknown' });
    await markFailedQuietly(opts);
    return null;
  }

  if (!res.ok) {
    console.error('incoming-image: content fetch returned non-success', { status: res.status });
    await markFailedQuietly(opts);
    return null;
  }

  const contentType = res.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
    ?? 'application/octet-stream';
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    console.error('incoming-image: unsupported content type');
    await markFailedQuietly(opts);
    return null;
  }

  const declaredSize = Number.parseInt(res.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_INCOMING_IMAGE_SIZE) {
    console.error('incoming-image: content too large');
    await markFailedQuietly(opts);
    return null;
  }

  let data: ArrayBuffer;
  try {
    data = await res.arrayBuffer();
  } catch (err) {
    console.error('incoming-image: content read failed', { error: err instanceof Error ? err.name : 'unknown' });
    await markFailedQuietly(opts);
    return null;
  }
  if (data.byteLength > MAX_INCOMING_IMAGE_SIZE) {
    console.error('incoming-image: content too large');
    await markFailedQuietly(opts);
    return null;
  }

  const bytes = new Uint8Array(data);
  if (!hasExpectedImageMagic(contentType, bytes)) {
    console.error('incoming-image: content magic does not match MIME');
    await markFailedQuietly(opts);
    return null;
  }

  const sha256 = await sha256Hex(data);

  try {
    await opts.r2.put(r2Key, data, {
      httpMetadata: { contentType },
      customMetadata: { sha256, byteSize: String(data.byteLength) },
    });
  } catch (err) {
    console.error('incoming-image: R2 write failed', { error: err instanceof Error ? err.name : 'unknown' });
    await markFailedQuietly(opts);
    return null;
  }

  try {
    await markIncomingMediaStored(opts.db, opts.accountId, opts.messageId, {
      mimeType: contentType,
      byteSize: data.byteLength,
      sha256,
      now: jstNow(),
    });
  } catch (err) {
    // Keep the object. A duplicate webhook overwrites the same deterministic
    // key and completes the D1 transition without creating another object.
    console.error('incoming-image: D1 finalize failed', { error: err instanceof Error ? err.name : 'unknown' });
    return null;
  }

  return privateRefs(opts.workerUrl, opts.accountId, opts.messageId);
}
