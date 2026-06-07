import { describe, expect, it } from 'vitest';
import {
  createStickerMessageContent,
  lineStickerUrl,
  parseStickerMessageContent,
  stickerFallback,
} from '@line-crm/shared';

describe('sticker message helpers', () => {
  it('serializes LINE sticker fields with string ids and image URL', () => {
    const content = createStickerMessageContent({
      packageId: 11537,
      stickerId: 52002734,
      stickerResourceType: 'STATIC',
    });

    expect(content).toEqual({
      type: 'sticker',
      packageId: '11537',
      stickerId: '52002734',
      stickerResourceType: 'STATIC',
      stickerUrl: lineStickerUrl('52002734'),
      fallback: '[スタンプ]',
    });
  });

  it('accepts snake_case sticker fields', () => {
    const content = createStickerMessageContent({
      package_id: '11537',
      sticker_id: '52002734',
      sticker_resource_type: 'ANIMATION',
    });

    expect(content?.packageId).toBe('11537');
    expect(content?.stickerId).toBe('52002734');
    expect(content?.stickerResourceType).toBe('ANIMATION');
  });

  it('parses only valid sticker JSON and falls back safely', () => {
    const raw = JSON.stringify({
      type: 'sticker',
      stickerId: '52002734',
      stickerUrl: lineStickerUrl('52002734'),
      fallback: 'custom fallback',
    });

    expect(parseStickerMessageContent(raw)?.stickerUrl).toBe(lineStickerUrl('52002734'));
    expect(stickerFallback(raw)).toBe('custom fallback');
    expect(parseStickerMessageContent('[スタンプ]')).toBeNull();
    expect(stickerFallback('[スタンプ]')).toBe('[スタンプ]');
  });
});
