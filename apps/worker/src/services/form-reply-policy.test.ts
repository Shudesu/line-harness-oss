import { describe, expect, it } from 'vitest';
import { shouldSendFormReply } from './form-reply-policy.js';

describe('shouldSendFormReply', () => {
  it('suppresses the default LINE reply when disabled', () => {
    expect(shouldSendFormReply({ send_submit_message: 0 })).toBe(false);
  });

  it('preserves the existing default for migrated forms', () => {
    expect(shouldSendFormReply({ send_submit_message: 1 })).toBe(true);
  });
});
