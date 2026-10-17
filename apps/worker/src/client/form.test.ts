import { describe, expect, it } from 'vitest';
import { shouldUseXEngagementGate } from './form.js';

describe('shouldUseXEngagementGate', () => {
  it('does not turn a generic submit webhook into an X gate', () => {
    expect(shouldUseXEngagementGate({
      webhookGateId: null,
      fields: [{ name: 'customer_name', label: 'お名前', type: 'text' }],
    })).toBe(false);
  });

  it('uses the X gate only when the form asks for x_username', () => {
    expect(shouldUseXEngagementGate({
      webhookGateId: 'gate-1',
      fields: [{ name: 'x_username', label: 'Xユーザー名', type: 'text' }],
    })).toBe(true);
  });
});
