import { describe, it, expect } from 'vitest';
import { addTestBannerToFlex } from '../src/tools/test-banner.js';

/**
 * isTest:true の Flex に「テスト配信」バナーを付ける処理の回帰テスト。
 *
 * 過去にここで2つ壊れていた:
 *   1. バナーの色が 3桁 hex (#333) で、LINE が必ず 400 を返していた
 *      （Flex は 6桁/8桁 hex しか受け付けない）
 *   2. carousel を丸ごと「テスト配信」プレースホルダ bubble に差し替えていた。
 *      エラーは出ないので、送った本人は本物を送ったつもりで別物が届く。
 *
 * どちらも「テスト送信だから」で見逃せる壊れ方ではないので、
 * 元の中身が保存されることを構造で固定する。
 */

const HEX6 = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

/** オブジェクトツリー内の color 値をすべて集める */
function collectColors(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectColors(child, acc);
    return acc;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string' && /color$/i.test(key)) acc.push(value);
      else collectColors(value, acc);
    }
  }
  return acc;
}

/** ツリー内に指定 text を持つ text コンポーネントがあるか */
function hasText(node: unknown, text: string): boolean {
  if (Array.isArray(node)) return node.some((child) => hasText(child, text));
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.type === 'text' && obj.text === text) return true;
    return Object.values(obj).some((value) => hasText(value, text));
  }
  return false;
}

const BANNER_TEXT = '⚠️ テスト配信';

describe('addTestBannerToFlex: 色指定', () => {
  it('バナーの色は 6桁 hex（3桁だと LINE が 400 を返す）', () => {
    const out = JSON.parse(
      addTestBannerToFlex(JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } })),
    );
    const colors = collectColors(out);
    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) expect(color).toMatch(HEX6);
  });
});

describe('addTestBannerToFlex: bubble', () => {
  const bubble = {
    type: 'bubble',
    size: 'giga',
    hero: { type: 'image', url: 'https://example.com/a.png' },
    body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '本文' }] },
    footer: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'フッター' }] },
    styles: { body: { backgroundColor: '#FFFFFF' } },
  };

  it('body / footer 以外（hero, styles, size）も捨てない', () => {
    const out = JSON.parse(addTestBannerToFlex(JSON.stringify(bubble)));
    expect(out.hero).toEqual(bubble.hero);
    expect(out.styles).toEqual(bubble.styles);
    expect(out.size).toBe('giga');
    expect(out.body).toEqual(bubble.body);
    expect(out.footer).toEqual(bubble.footer);
  });

  it('バナーが header に入る', () => {
    const out = JSON.parse(addTestBannerToFlex(JSON.stringify(bubble)));
    expect(out.header).toBeDefined();
    expect(hasText(out.header, BANNER_TEXT)).toBe(true);
  });

  it('元の header がある場合も中身を残したままバナーを足す', () => {
    const withHeader = {
      ...bubble,
      header: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '元ヘッダー' }] },
    };
    const out = JSON.parse(addTestBannerToFlex(JSON.stringify(withHeader)));
    expect(hasText(out.header, BANNER_TEXT)).toBe(true);
    expect(hasText(out.header, '元ヘッダー')).toBe(true);
    expect(out.header.type).toBe('box');
  });
});

describe('addTestBannerToFlex: carousel', () => {
  const carousel = {
    type: 'carousel',
    contents: [
      { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '1枚目' }] } },
      { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '2枚目' }] } },
      { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '3枚目' }] } },
    ],
  };

  it('bubble の枚数と中身をそのまま保つ（プレースホルダに差し替えない）', () => {
    const out = JSON.parse(addTestBannerToFlex(JSON.stringify(carousel)));
    expect(out.type).toBe('carousel');
    expect(out.contents).toHaveLength(3);
    for (const [i, original] of carousel.contents.entries()) {
      expect(out.contents[i].body).toEqual(original.body);
    }
    expect(hasText(out, BANNER_TEXT)).toBe(true);
    expect(hasText(out, '1枚目')).toBe(true);
    expect(hasText(out, '3枚目')).toBe(true);
  });

  it('どの bubble を見てもテスト送信だと分かる', () => {
    const out = JSON.parse(addTestBannerToFlex(JSON.stringify(carousel)));
    for (const bubble of out.contents) {
      expect(hasText(bubble.header, BANNER_TEXT)).toBe(true);
    }
  });

  it('carousel でも色は 6桁 hex', () => {
    const out = JSON.parse(addTestBannerToFlex(JSON.stringify(carousel)));
    for (const color of collectColors(out)) expect(color).toMatch(HEX6);
  });
});

describe('addTestBannerToFlex: 壊れた入力', () => {
  it('JSON として読めなければそのまま返す（送信前に握りつぶさない）', () => {
    expect(addTestBannerToFlex('not json')).toBe('not json');
  });

  it('bubble でも carousel でもない形はそのまま返す', () => {
    const unknown = JSON.stringify({ type: 'flex', altText: 'a', contents: { type: 'bubble' } });
    expect(addTestBannerToFlex(unknown)).toBe(unknown);
  });

  it('contents が配列でない carousel はそのまま返す', () => {
    const broken = JSON.stringify({ type: 'carousel', contents: 'oops' });
    expect(addTestBannerToFlex(broken)).toBe(broken);
  });
});
