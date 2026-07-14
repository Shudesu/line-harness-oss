import { describe, expect, test } from 'vitest';
import { parseFriendRequiredResponse, shouldUseWebhookGate } from './form-gate.js';

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

describe('parseFriendRequiredResponse', () => {
  test('returns the add-friend URL for friend_required', () => {
    expect(parseFriendRequiredResponse({
      success: false,
      error: 'friend_required',
      addFriendUrl: 'https://line.me/R/ti/p/@lineharness',
    })).toEqual({ addFriendUrl: 'https://line.me/R/ti/p/@lineharness' });
  });

  test('recognizes friend_required when the URL is unavailable', () => {
    expect(parseFriendRequiredResponse({
      success: false,
      error: 'friend_required',
    })).toEqual({});
  });

  test('ignores other error responses', () => {
    expect(parseFriendRequiredResponse({
      success: false,
      error: 'Internal server error',
    })).toBeNull();
  });
});
