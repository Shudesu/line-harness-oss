import { describe, expect, it } from 'vitest';
import { createExternalLinkTicket } from './external-link-ticket.js';

describe('createExternalLinkTicket', () => {
  const env = {
    SHOPIFY_LINK_SIGNING_SECRET: 'test-signing-secret',
    SHOPIFY_LINK_ORIGIN: 'https://bridge.example.com',
  };
  const claims = { friendId: 'friend-1', lineUserId: 'U123', userId: 'user-1' };

  it('issues a short-lived ticket only for the configured origin', async () => {
    const ticket = await createExternalLinkTicket(env, 'https://bridge.example.com/t/link', claims, 1000);
    expect(ticket?.split('.')).toHaveLength(2);
  });

  it('does not issue tickets to untrusted redirects', async () => {
    await expect(createExternalLinkTicket(env, 'https://evil.example/t/link', claims, 1000)).resolves.toBeNull();
    await expect(createExternalLinkTicket(env, 'javascript:alert(1)', claims, 1000)).resolves.toBeNull();
  });
});
