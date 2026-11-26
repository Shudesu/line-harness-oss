import { describe, expect, test } from 'vitest';
import { createBroadcastRetryKey } from './broadcast-retry-key.js';

describe('createBroadcastRetryKey', () => {
  test('is stable, UUID-shaped, and changes with delivery content', async () => {
    const first = await createBroadcastRetryKey('broadcast-1', 'friend-1', 'hello');
    const retry = await createBroadcastRetryKey('broadcast-1', 'friend-1', 'hello');
    const edited = await createBroadcastRetryKey('broadcast-1', 'friend-1', 'hello again');

    expect(first).toBe(retry);
    expect(first).not.toBe(edited);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
