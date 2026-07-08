import { describe, expect, test } from 'vitest';
import { shouldUseWebhookGate } from './form-gate.js';

describe('shouldUseWebhookGate', () => {
  test('webhook URL only does not enable the X gate without x_username field', () => {
    expect(
      shouldUseWebhookGate({
        fields: [{ name: 'email' }],
        onSubmitWebhookUrl: 'https://example.com/notify',
      }),
    ).toBe(false);
  });

  test('webhook URL and x_username field enable the X gate', () => {
    expect(
      shouldUseWebhookGate({
        fields: [{ name: 'email' }, { name: 'x_username' }],
        onSubmitWebhookUrl: 'https://example.com/engagement-gates/gate-1/verify',
      }),
    ).toBe(true);
  });
});
