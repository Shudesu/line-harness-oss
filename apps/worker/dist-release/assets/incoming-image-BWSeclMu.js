const LINE_CONTENT_API_BASE = "https://api-data.line.me/v2/bot/message";
const CONTENT_TYPE_TO_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp"
};
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
export {
  fetchAndStoreIncomingImage
};
