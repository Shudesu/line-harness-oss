import { describe, it, expect } from 'vitest';
import { buildRewardMessage } from './reward-message.js';
import type { MessageTemplate } from '@line-crm/db';

describe('buildRewardMessage', () => {
  it('テンプレート未指定は null を返す', () => {
    expect(buildRewardMessage(null, 'Alice')).toBeNull();
  });

  it('text テンプレートをそのまま返す', () => {
    const tpl: MessageTemplate = {
      id: 'r1',
      name: 'reward text',
      message_type: 'text',
      message_content: '🎁 ありがとうございます！',
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    expect(buildRewardMessage(tpl, 'Alice')).toEqual({
      type: 'text',
      text: '🎁 ありがとうございます！',
    });
  });

  it('text テンプレートの {displayName} を置換する', () => {
    const tpl: MessageTemplate = {
      id: 'r2',
      name: 'reward greet',
      message_type: 'text',
      message_content: '{displayName}さん、おめでとう！',
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    expect(buildRewardMessage(tpl, 'Alice')).toEqual({
      type: 'text',
      text: 'Aliceさん、おめでとう！',
    });
  });

  it('flex テンプレートをパースして返す', () => {
    const tpl: MessageTemplate = {
      id: 'r3',
      name: 'reward flex',
      message_type: 'flex',
      message_content: JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'やった！' }] } }),
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    const result = buildRewardMessage(tpl, null);
    expect(result?.type).toBe('flex');
    expect(result?.type === 'flex' && result.altText).toBe('reward flex');
  });

  it('flex テンプレが不正な JSON の場合は null を返す', () => {
    const tpl: MessageTemplate = {
      id: 'r4',
      name: 'broken',
      message_type: 'flex',
      message_content: '{ broken json',
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    expect(buildRewardMessage(tpl, null)).toBeNull();
  });

  it('flex テンプレ内の {displayName} は JSON-escape されてから埋め込まれる', () => {
    const flexJson = JSON.stringify({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: 'こんにちは {displayName} さん' }],
      },
    });
    const tpl: MessageTemplate = {
      id: 'r5',
      name: 'flex with name',
      message_type: 'flex',
      message_content: flexJson,
      created_at: '2026-04-07 00:00:00',
      updated_at: '2026-04-07 00:00:00',
    };
    // ダブルクオート・バックスラッシュ・改行を含む name でも JSON.parse が壊れない
    const tricky = '田中"\\\n太郎';
    const result = buildRewardMessage(tpl, tricky);
    expect(result?.type).toBe('flex');
    if (result?.type !== 'flex') throw new Error('unreachable');
    const contents = result.contents as { body: { contents: Array<{ text: string }> } };
    expect(contents.body.contents[0].text).toBe(`こんにちは ${tricky} さん`);
  });
});
