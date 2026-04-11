import { describe, it, expect } from 'vitest';
import { buildIntroMessage, DEFAULT_FORM_LINK_FLEX } from './intro-message.js';
import type { MessageTemplate } from '@line-crm/db';

describe('buildIntroMessage', () => {
  const formUrl = 'https://liff.line.me/1234-AbCd?page=form&id=form-xyz';

  it('テンプレート未指定の場合はデフォルト Flex を返す', () => {
    const result = buildIntroMessage(null, formUrl);
    expect(result).toEqual(DEFAULT_FORM_LINK_FLEX(formUrl));
  });

  it('text テンプレートの {formUrl} を実 URL に置換する', () => {
    const tpl: MessageTemplate = {
      id: 't1',
      name: 'intro text',
      message_type: 'text',
      message_content: '🎁 特典が届きました！\n受け取りはこちら👉 {formUrl}',
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    const result = buildIntroMessage(tpl, formUrl);
    expect(result).toEqual({
      type: 'text',
      text: `🎁 特典が届きました！\n受け取りはこちら👉 ${formUrl}`,
    });
  });

  it('flex テンプレートのボタン URL の {formUrl} を実 URL に置換する', () => {
    const flexJson = JSON.stringify({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: 'タップして受け取る' }],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: '受け取る', uri: '{formUrl}' },
            style: 'primary',
          },
        ],
      },
    });
    const tpl: MessageTemplate = {
      id: 't2',
      name: 'intro flex',
      message_type: 'flex',
      message_content: flexJson,
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    const result = buildIntroMessage(tpl, formUrl);
    expect(result.type).toBe('flex');
    if (result.type !== 'flex') throw new Error('unreachable');
    expect(result.altText).toBe('intro flex');
    const contents = result.contents as { footer: { contents: Array<{ action: { uri: string } }> } };
    expect(contents.footer.contents[0].action.uri).toBe(formUrl);
  });

  it('複数の {formUrl} 出現を全て置換する', () => {
    const tpl: MessageTemplate = {
      id: 't3',
      name: 'multi',
      message_type: 'text',
      message_content: '一回目 {formUrl} 二回目 {formUrl}',
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    const result = buildIntroMessage(tpl, formUrl);
    expect(result).toEqual({
      type: 'text',
      text: `一回目 ${formUrl} 二回目 ${formUrl}`,
    });
  });

  it('テンプレに {formUrl} が含まれない場合はデフォルト Flex にフォールバック', () => {
    const tpl: MessageTemplate = {
      id: 't4',
      name: 'no placeholder',
      message_type: 'text',
      message_content: '🎉 ようこそ！',
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    const result = buildIntroMessage(tpl, formUrl);
    expect(result).toEqual(DEFAULT_FORM_LINK_FLEX(formUrl));
  });

  it('flex テンプレが不正な JSON の場合はデフォルト Flex にフォールバック', () => {
    const tpl: MessageTemplate = {
      id: 't5',
      name: 'broken flex',
      message_type: 'flex',
      message_content: '{ this is not valid json {formUrl}',
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    const result = buildIntroMessage(tpl, formUrl);
    expect(result).toEqual(DEFAULT_FORM_LINK_FLEX(formUrl));
  });
});

describe('DEFAULT_FORM_LINK_FLEX', () => {
  it('formUrl がボタンの uri にセットされる', () => {
    const url = 'https://liff.line.me/abc?page=form&id=xyz';
    const flex = DEFAULT_FORM_LINK_FLEX(url);
    expect(flex.type).toBe('flex');
    expect(flex.altText).toBe('🎁 特典を受け取る');
    const contents = flex.contents as { footer: { contents: Array<{ action: { uri: string } }> } };
    expect(contents.footer.contents[0].action.uri).toBe(url);
  });
});
