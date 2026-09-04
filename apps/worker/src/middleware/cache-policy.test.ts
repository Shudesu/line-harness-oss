import { describe, expect, it } from 'vitest';
import { applyDefaultCachePolicy } from './cache-policy.js';

describe('applyDefaultCachePolicy', () => {
  it('keeps authenticated API responses private by default', () => {
    const response = applyDefaultCachePolicy(new Response('{}'), '/api/friends');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('does not cache an unmarked public response', () => {
    const response = applyDefaultCachePolicy(new Response('html'), '/events/example');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('preserves an explicit public cache policy', () => {
    const response = applyDefaultCachePolicy(
      new Response('image', { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }),
      '/images/example.png',
    );
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });
});
