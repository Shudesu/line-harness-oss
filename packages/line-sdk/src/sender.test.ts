import { describe, expect, test } from 'vitest';
import {
  SENDER_ICON_URL_MAX_LENGTH,
  SENDER_NAME_MAX_LENGTH,
  validateSender,
  withSender,
  withSenderAll,
} from './messages.js';
import type { Message } from './types.js';

describe('validateSender', () => {
  test('accepts a name and an https icon within the limits', () => {
    expect(
      validateSender({
        name: '大槻 伸夫',
        iconUrl: 'https://example.com/icon.png',
      }),
    ).toEqual([]);
  });

  test('accepts a partial sender (name only / icon only)', () => {
    expect(validateSender({ name: 'サポート窓口' })).toEqual([]);
    expect(validateSender({ iconUrl: 'https://example.com/i.jpg' })).toEqual([]);
    expect(validateSender({})).toEqual([]);
  });

  test('rejects a name longer than the API limit', () => {
    const tooLong = 'あ'.repeat(SENDER_NAME_MAX_LENGTH + 1);
    expect(validateSender({ name: tooLong })).toEqual([
      `sender.name must be ${SENDER_NAME_MAX_LENGTH} characters or fewer (got ${SENDER_NAME_MAX_LENGTH + 1})`,
    ]);
    // exactly at the limit is fine
    expect(validateSender({ name: 'あ'.repeat(SENDER_NAME_MAX_LENGTH) })).toEqual([]);
  });

  test('rejects an empty name', () => {
    expect(validateSender({ name: '' })).toContain('sender.name must not be empty');
  });

  test('rejects a name containing "LINE" in any case', () => {
    for (const name of ['LINE公式', 'line sales', 'MyLineDesk']) {
      expect(validateSender({ name })).toContain('sender.name must not contain "LINE"');
    }
  });

  test('rejects a non-https icon url', () => {
    expect(validateSender({ iconUrl: 'http://example.com/icon.png' })).toContain(
      'sender.iconUrl must be an https URL',
    );
  });

  test('rejects an icon url longer than the API limit', () => {
    const url = `https://example.com/${'a'.repeat(SENDER_ICON_URL_MAX_LENGTH)}`;
    expect(validateSender({ iconUrl: url })).toContain(
      `sender.iconUrl must be ${SENDER_ICON_URL_MAX_LENGTH} characters or fewer (got ${url.length})`,
    );
  });

  test('reports every problem at once', () => {
    expect(validateSender({ name: 'LINE', iconUrl: 'ftp://x' })).toHaveLength(2);
  });
});

describe('withSender', () => {
  test('attaches the sender without mutating the original message', () => {
    const message: Message = { type: 'text', text: 'hello' };
    const sent = withSender(message, { name: '天野 琢斗' });

    expect(sent).toEqual({ type: 'text', text: 'hello', sender: { name: '天野 琢斗' } });
    expect(message).not.toHaveProperty('sender');
  });
});

describe('withSenderAll', () => {
  const sender = { name: '日和 玲美', iconUrl: 'https://example.com/hiwa.jpg' };

  test('stamps every message in the batch', () => {
    const messages: Message[] = [
      { type: 'text', text: 'one' },
      { type: 'image', originalContentUrl: 'https://x/a.png', previewImageUrl: 'https://x/b.png' },
    ];

    expect(withSenderAll(messages, sender).every((m) => 'sender' in m)).toBe(true);
    // originals untouched
    expect(messages.some((m) => 'sender' in m)).toBe(false);
  });

  test('keeps a sender that a message already carries', () => {
    const own = { name: '大槻 伸夫' };
    const messages: Message[] = [
      { type: 'text', text: 'from the CEO', sender: own },
      { type: 'text', text: 'from the desk' },
    ];

    const [first, second] = withSenderAll(messages, sender);
    expect((first as { sender?: unknown }).sender).toBe(own);
    expect((second as { sender?: unknown }).sender).toEqual(sender);
  });

  test('is a no-op when there is nothing to override with', () => {
    const messages: Message[] = [{ type: 'text', text: 'plain' }];

    // Sending `sender: {}` would make LINE fall back to the account profile
    // anyway, so an empty/absent sender must leave the batch alone.
    expect(withSenderAll(messages, null)).toBe(messages);
    expect(withSenderAll(messages, undefined)).toBe(messages);
    expect(withSenderAll(messages, {})).toBe(messages);
  });
});
