const LINE_CONTENT_API_BASE = "https://api-data.line.me/v2/bot/message";
const CONTENT_TYPE_TO_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp"
};
const MAX_INCOMING_FILE_BYTES = 15 * 1024 * 1024;
function sanitizeFileName(fileName) {
  const trimmed = fileName.trim() || "file";
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
  return (sanitized || "file").slice(0, 120);
}
async function fetchAndStoreIncomingImage(opts) {
  const fetcher = opts.fetch ?? fetch;
  let res;
  try {
    res = await fetcher(`${LINE_CONTENT_API_BASE}/${opts.messageId}/content`, {
      headers: { Authorization: `Bearer ${opts.channelAccessToken}` }
    });
  } catch (err) {
    console.error("incoming-image: fetch failed", { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }
  if (!res.ok) {
    console.error("incoming-image: non-200", { status: res.status, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }
  const contentType = res.headers.get("Content-Type")?.split(";")[0].trim() ?? "application/octet-stream";
  const ext = CONTENT_TYPE_TO_EXT[contentType];
  if (!ext) {
    console.error("incoming-image: unsupported content-type", { contentType, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }
  const safeAccountId = opts.accountId.replace(/[^a-zA-Z0-9-]/g, "_");
  const safeMessageId = opts.messageId.replace(/[^a-zA-Z0-9-]/g, "_");
  const key = `incoming-${safeAccountId}-${safeMessageId}.${ext}`;
  let data;
  try {
    data = await res.arrayBuffer();
  } catch (err) {
    console.error("incoming-image: arrayBuffer failed", { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }
  try {
    await opts.r2.put(key, data, { httpMetadata: { contentType } });
  } catch (err) {
    console.error("incoming-image: R2 put failed", { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }
  const base = opts.workerUrl.replace(/\/$/, "");
  const url = `${base}/images/${key}`;
  return { originalContentUrl: url, previewImageUrl: url };
}
async function fetchAndStoreIncomingFile(opts) {
  const fetcher = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? MAX_INCOMING_FILE_BYTES;
  if (opts.fileSize !== void 0 && opts.fileSize > maxBytes) {
    console.error("incoming-file: file too large", {
      fileSize: opts.fileSize,
      maxBytes,
      messageId: opts.messageId,
      accountId: opts.accountId
    });
    return null;
  }
  let res;
  try {
    res = await fetcher(`${LINE_CONTENT_API_BASE}/${opts.messageId}/content`, {
      headers: { Authorization: `Bearer ${opts.channelAccessToken}` }
    });
  } catch (err) {
    console.error("incoming-file: fetch failed", { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }
  if (!res.ok) {
    console.error("incoming-file: non-200", { status: res.status, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }
  const contentLength = Number.parseInt(res.headers.get("Content-Length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    console.error("incoming-file: content-length too large", {
      contentLength,
      maxBytes,
      messageId: opts.messageId,
      accountId: opts.accountId
    });
    return null;
  }
  const contentType = res.headers.get("Content-Type")?.split(";")[0].trim() ?? "application/octet-stream";
  const safeAccountId = opts.accountId.replace(/[^a-zA-Z0-9-]/g, "_");
  const safeMessageId = opts.messageId.replace(/[^a-zA-Z0-9-]/g, "_");
  const safeFileName = sanitizeFileName(opts.fileName);
  const key = `incoming-${safeAccountId}-${safeMessageId}-${safeFileName}`;
  let data;
  try {
    data = await res.arrayBuffer();
  } catch (err) {
    console.error("incoming-file: arrayBuffer failed", { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }
  if (data.byteLength > maxBytes) {
    console.error("incoming-file: body too large", {
      byteLength: data.byteLength,
      maxBytes,
      messageId: opts.messageId,
      accountId: opts.accountId
    });
    return null;
  }
  try {
    await opts.r2.put(key, data, {
      httpMetadata: { contentType },
      customMetadata: {
        originalFilename: opts.fileName,
        fileSize: String(opts.fileSize ?? data.byteLength)
      }
    });
  } catch (err) {
    console.error("incoming-file: R2 put failed", { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }
  const base = opts.workerUrl.replace(/\/$/, "");
  return {
    url: `${base}/images/${key}`,
    fileName: opts.fileName,
    contentType,
    size: opts.fileSize ?? data.byteLength
  };
}
export {
  fetchAndStoreIncomingFile,
  fetchAndStoreIncomingImage
};
