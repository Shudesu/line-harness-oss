import { describe, expect, test } from 'vitest';

import { buildMessage } from './broadcast.js';

describe('buildMessage', () => {
  test('text は素通し', () => {
    expect(buildMessage('text', 'こんにちは')).toEqual({ type: 'text', text: 'こんにちは' });
  });

  test('image payload は従来どおり image message になる', () => {
    const content = JSON.stringify({
      originalContentUrl: 'https://example.com/a.jpg',
      previewImageUrl: 'https://example.com/a-preview.jpg',
    });
    expect(buildMessage('image', content)).toEqual({
      type: 'image',
      originalContentUrl: 'https://example.com/a.jpg',
      previewImageUrl: 'https://example.com/a-preview.jpg',
    });
  });

  test('baseUrl + baseSize を持つ image payload は imagemap になる', () => {
    const content = JSON.stringify({
      baseUrl: 'https://example.com/img/campaign',
      baseSize: { width: 1040, height: 1040 },
      actions: [
        {
          type: 'uri',
          linkUri: 'https://example.com/lp',
          area: { x: 0, y: 0, width: 1040, height: 1040 },
        },
      ],
    });

    expect(buildMessage('image', content, 'キャンペーンのお知らせ')).toEqual({
      type: 'imagemap',
      baseUrl: 'https://example.com/img/campaign',
      altText: 'キャンペーンのお知らせ',
      baseSize: { width: 1040, height: 1040 },
      actions: [
        {
          type: 'uri',
          linkUri: 'https://example.com/lp',
          area: { x: 0, y: 0, width: 1040, height: 1040 },
        },
      ],
    });
  });

  test('imagemap の altText は 引数 → payload → 既定値 の順に決まる', () => {
    const base = { baseUrl: 'https://example.com/img/x', baseSize: { width: 1040, height: 520 } };

    expect(buildMessage('image', JSON.stringify({ ...base, altText: 'payload 側' }))).toMatchObject({
      altText: 'payload 側',
    });
    expect(
      buildMessage('image', JSON.stringify({ ...base, altText: 'payload 側' }), '引数側'),
    ).toMatchObject({ altText: '引数側' });
    expect(buildMessage('image', JSON.stringify(base))).toMatchObject({ altText: 'お知らせ' });
  });

  test('actions 未指定の imagemap は空配列になる', () => {
    const content = JSON.stringify({
      baseUrl: 'https://example.com/img/x',
      baseSize: { width: 1040, height: 1040 },
    });
    expect(buildMessage('image', content)).toMatchObject({ type: 'imagemap', actions: [] });
  });

  test('baseSize が欠けていれば imagemap 扱いしない', () => {
    // baseUrl だけの payload を imagemap にすると LINE 側で 400 になるため、
    // 従来の image 分岐に落とす (後方互換)。
    const content = JSON.stringify({
      baseUrl: 'https://example.com/img/x',
      originalContentUrl: 'https://example.com/a.jpg',
      previewImageUrl: 'https://example.com/a.jpg',
    });
    expect(buildMessage('image', content)).toMatchObject({ type: 'image' });
  });

  test('baseSize の width/height が数値でなければ imagemap 扱いしない', () => {
    const content = JSON.stringify({
      baseUrl: 'https://example.com/img/x',
      baseSize: { width: '1040', height: '1040' },
      originalContentUrl: 'https://example.com/a.jpg',
      previewImageUrl: 'https://example.com/a.jpg',
    });
    expect(buildMessage('image', content)).toMatchObject({ type: 'image' });
  });

  test('壊れた JSON は text にフォールバックする', () => {
    expect(buildMessage('image', 'not json')).toEqual({ type: 'text', text: 'not json' });
  });

  test('flex の altText は本文の先頭テキストから拾う', () => {
    const content = JSON.stringify({
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '本文の先頭' }] },
    });
    expect(buildMessage('flex', content)).toMatchObject({ type: 'flex', altText: '本文の先頭' });
  });
});
