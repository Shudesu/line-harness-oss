const LINE_CONTENT_API_BASE = 'https://api-data.line.me/v2/bot/message';

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const MAX_INCOMING_FILE_BYTES = 15 * 1024 * 1024;

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

export interface FetchAndStoreFileOptions extends FetchAndStoreOptions {
  fileName: string;
  fileSize?: number;
  /** テスト・将来設定用。未指定時は運用保護のため 15MB でフォールバックする。 */
  maxBytes?: number;
}

export interface IncomingFileRefs {
  url: string;
  fileName: string;
  contentType: string;
  size: number;
}

function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim() || 'file';
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  return (sanitized || 'file').slice(0, 120);
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
  // accountId / messageId は実質 UUID / LINE 数字 ID で安全だが、念のため
  // R2 キーに不正な文字（スラッシュ等）が混入しないよう sanitize する。
  const safeAccountId = opts.accountId.replace(/[^a-zA-Z0-9-]/g, '_');
  const safeMessageId = opts.messageId.replace(/[^a-zA-Z0-9-]/g, '_');
  const key = `incoming-${safeAccountId}-${safeMessageId}.${ext}`;

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
  const url = `${base}/images/${key}`;
  return { originalContentUrl: url, previewImageUrl: url };
}

/**
 * LINE Content API から incoming ファイルを取得し R2 に保存して URL とメタ情報を返す。
 * 失敗・サイズ超過時は null を返し、呼び出し元は `[ファイル]` ラベルフォールバックを使う。
 */
export async function fetchAndStoreIncomingFile(
  opts: FetchAndStoreFileOptions,
): Promise<IncomingFileRefs | null> {
  const fetcher = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? MAX_INCOMING_FILE_BYTES;

  if (opts.fileSize !== undefined && opts.fileSize > maxBytes) {
    console.error('incoming-file: file too large', {
      fileSize: opts.fileSize,
      maxBytes,
      messageId: opts.messageId,
      accountId: opts.accountId,
    });
    return null;
  }

  let res: Response;
  try {
    res = await fetcher(`${LINE_CONTENT_API_BASE}/${opts.messageId}/content`, {
      headers: { Authorization: `Bearer ${opts.channelAccessToken}` },
    });
  } catch (err) {
    console.error('incoming-file: fetch failed', { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }

  if (!res.ok) {
    console.error('incoming-file: non-200', { status: res.status, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }

  const contentLength = Number.parseInt(res.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    console.error('incoming-file: content-length too large', {
      contentLength,
      maxBytes,
      messageId: opts.messageId,
      accountId: opts.accountId,
    });
    return null;
  }

  const contentType = res.headers.get('Content-Type')?.split(';')[0].trim() ?? 'application/octet-stream';
  const safeAccountId = opts.accountId.replace(/[^a-zA-Z0-9-]/g, '_');
  const safeMessageId = opts.messageId.replace(/[^a-zA-Z0-9-]/g, '_');
  const safeFileName = sanitizeFileName(opts.fileName);
  const key = `incoming-${safeAccountId}-${safeMessageId}-${safeFileName}`;

  let data: ArrayBuffer;
  try {
    data = await res.arrayBuffer();
  } catch (err) {
    console.error('incoming-file: arrayBuffer failed', { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }

  if (data.byteLength > maxBytes) {
    console.error('incoming-file: body too large', {
      byteLength: data.byteLength,
      maxBytes,
      messageId: opts.messageId,
      accountId: opts.accountId,
    });
    return null;
  }

  try {
    await opts.r2.put(key, data, {
      httpMetadata: { contentType },
      customMetadata: {
        originalFilename: opts.fileName,
        fileSize: String(opts.fileSize ?? data.byteLength),
      },
    });
  } catch (err) {
    console.error('incoming-file: R2 put failed', { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }

  const base = opts.workerUrl.replace(/\/$/, '');
  return {
    url: `${base}/images/${key}`,
    fileName: opts.fileName,
    contentType,
    size: opts.fileSize ?? data.byteLength,
  };
}
