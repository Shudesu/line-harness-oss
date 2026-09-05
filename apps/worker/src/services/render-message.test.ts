import { describe, expect, test } from 'vitest';
import {
  assertNoUnresolvedBroadcastVariables,
  getUnsupportedBroadcastVariables,
  hasRecipientVariables,
  renderBroadcastMessageContent,
  renderMessageContent,
} from './render-message.js';

describe('renderMessageContent', () => {
  test('replaces {{liff_id}} with given liffId', () => {
    expect(renderMessageContent('hello https://liff.line.me/{{liff_id}}/x', '12345-AAA'))
      .toBe('hello https://liff.line.me/12345-AAA/x');
  });

  test('replaces all occurrences', () => {
    expect(renderMessageContent('a={{liff_id}} b={{liff_id}}', 'X'))
      .toBe('a=X b=X');
  });

  test('returns input unchanged when no placeholder', () => {
    expect(renderMessageContent('no placeholder', 'X')).toBe('no placeholder');
  });

  test('returns input unchanged when liffId is null', () => {
    expect(renderMessageContent('a {{liff_id}} b', null)).toBe('a {{liff_id}} b');
  });

  test('returns input unchanged when liffId is empty string', () => {
    expect(renderMessageContent('a {{liff_id}} b', '')).toBe('a {{liff_id}} b');
  });

  test('handles event path embedded in URL template', () => {
    const tpl = 'イベント詳細→ https://liff.line.me/{{liff_id}}/?page=event&id=evt-1';
    expect(renderMessageContent(tpl, 'LIFF-9999')).toBe(
      'イベント詳細→ https://liff.line.me/LIFF-9999/?page=event&id=evt-1',
    );
  });

  test('replaces recipient display name when supplied', () => {
    expect(renderMessageContent('{{name}}さん、こんにちは', { displayName: 'Michi' }))
      .toBe('Michiさん、こんにちは');
    expect(renderMessageContent('{{ name }}さん', { displayName: 'Michi' }))
      .toBe('Michiさん');
  });

  test('keeps {{name}} unresolved when display name is unavailable', () => {
    expect(renderMessageContent('{{name}}さん', { displayName: null })).toBe('{{name}}さん');
  });

  test('safely escapes quotes, backslashes, and newlines in Flex JSON names', () => {
    const template = JSON.stringify({
      type: 'bubble',
      body: { type: 'box', contents: [{ type: 'text', text: '{{name}}さん' }] },
    });
    const rendered = renderBroadcastMessageContent('flex', template, {
      displayName: 'A "quoted" \\ name\nnext',
    });

    expect(JSON.parse(rendered)).toMatchObject({
      body: { contents: [{ text: 'A "quoted" \\ name\nnextさん' }] },
    });
  });

  test('does not JSON-normalize ordinary text messages', () => {
    expect(renderBroadcastMessageContent('text', '  {{name}}  ', { displayName: 'Michi' }))
      .toBe('  Michi  ');
  });

  test('detects recipient and unsupported variables', () => {
    expect(hasRecipientVariables('{{name}} {{liff_id}}')).toBe(true);
    expect(getUnsupportedBroadcastVariables('{{name}} {{coupon}}')).toEqual(['coupon']);
  });

  test('fails closed when any variable remains unresolved', () => {
    expect(() => assertNoUnresolvedBroadcastVariables('hello {{name}}'))
      .toThrow('Unresolved broadcast variables: {{name}}');
    expect(() => assertNoUnresolvedBroadcastVariables('hello Michi')).not.toThrow();
  });
});
