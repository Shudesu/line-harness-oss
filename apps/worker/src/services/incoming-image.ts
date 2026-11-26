const LINE_CONTENT_API_BASE = 'https://api-data.line.me/v2/bot/message';

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export interface FetchAndStoreOptions {
  r2: R2Bucket;
  /** workers 環境では globalThis.fetch を使う。テスト時に注入する。 */
  fetch?: typeof fetch;
  /** 公開 URL のベース (例: https://your-worker.your-subdomain.workers.dev) */
  workerUrl: string;
  channelAccessToken: string;
  accountId: string;
  messageId: string;
}

export interface IncomingImageRefs {
  originalContentUrl: string;
  previewImageUrl: string;
}

/**
 * LINE Content API から incoming 画像バイナリを取得し R2 に保存して URL を返す。
 * 失敗時は null を返し、呼び出し元は `[画像]` ラベルフォールバックを使う。
 */
export async function fetchAndStoreIncomingImage(
  opts: FetchAndStoreOptions,
): Promise<IncomingImageRefs | null> {
  const fetcher = opts.fetch ?? fetch;

  let res: Response;
  try {
    res = await fetcher(`${LINE_CONTENT_API_BASE}/${opts.messageId}/content`, {
      headers: { Authorization: `Bearer ${opts.channelAccessToken}` },
    });
  } catch (err) {
    console.error('incoming-image: fetch failed', { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }

  if (!res.ok) {
    console.error('incoming-image: non-200', { status: res.status, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }

  const contentType = res.headers.get('Content-Type')?.split(';')[0].trim() ?? 'application/octet-stream';
  const ext = CONTENT_TYPE_TO_EXT[contentType];
  if (!ext) {
    console.error('incoming-image: unsupported content-type', { contentType, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }
  // Deterministic opaque object name; authorization is enforced on reads.
  const identity = new TextEncoder().encode(JSON.stringify([opts.accountId, opts.messageId]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', identity));
  const key = `incoming-${Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')}.${ext}`;

  let data: ArrayBuffer;
  try {
    data = await res.arrayBuffer();
  } catch (err) {
    console.error('incoming-image: arrayBuffer failed', { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }

  try {
    await opts.r2.put(key, data, { httpMetadata: { contentType } });
  } catch (err) {
    console.error('incoming-image: R2 put failed', { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }

  const base = opts.workerUrl.replace(/\/$/, '');
  const url = `${base}/api/incoming-images/${key}`;
  return { originalContentUrl: url, previewImageUrl: url };
}
