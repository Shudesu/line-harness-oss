export interface StickerMessageContent {
  type: 'sticker';
  packageId?: string;
  stickerId: string;
  stickerResourceType?: string;
  stickerUrl: string;
  fallback: string;
}

type StickerSource = {
  packageId?: string | number | null;
  package_id?: string | number | null;
  stickerId?: string | number | null;
  sticker_id?: string | number | null;
  stickerResourceType?: string | number | null;
  sticker_resource_type?: string | number | null;
};

const STICKER_FALLBACK = '[スタンプ]';

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function lineStickerUrl(stickerId: string): string {
  return `https://stickershop.line-scdn.net/stickershop/v1/sticker/${encodeURIComponent(stickerId)}/iPhone/sticker@2x.png`;
}

export function createStickerMessageContent(message: StickerSource): StickerMessageContent | null {
  const stickerId = toOptionalString(message.stickerId ?? message.sticker_id);
  if (!stickerId) return null;

  const packageId = toOptionalString(message.packageId ?? message.package_id);
  const stickerResourceType = toOptionalString(message.stickerResourceType ?? message.sticker_resource_type);

  return {
    type: 'sticker',
    ...(packageId ? { packageId } : {}),
    stickerId,
    ...(stickerResourceType ? { stickerResourceType } : {}),
    stickerUrl: lineStickerUrl(stickerId),
    fallback: STICKER_FALLBACK,
  };
}

export function parseStickerMessageContent(content: string): StickerMessageContent | null {
  try {
    const parsed = JSON.parse(content) as Partial<StickerMessageContent>;
    if (
      parsed &&
      parsed.type === 'sticker' &&
      typeof parsed.stickerId === 'string' &&
      parsed.stickerId.trim() &&
      typeof parsed.stickerUrl === 'string' &&
      parsed.stickerUrl.trim()
    ) {
      return {
        type: 'sticker',
        packageId: toOptionalString(parsed.packageId),
        stickerId: parsed.stickerId,
        stickerResourceType: toOptionalString(parsed.stickerResourceType),
        stickerUrl: parsed.stickerUrl,
        fallback: typeof parsed.fallback === 'string' && parsed.fallback.trim() ? parsed.fallback : STICKER_FALLBACK,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function stickerFallback(content?: string | null): string {
  if (!content) return STICKER_FALLBACK;
  const parsed = parseStickerMessageContent(content);
  return parsed?.fallback || STICKER_FALLBACK;
}
