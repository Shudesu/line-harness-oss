import { describe, expect, it } from 'vitest';
import { signCrossAccountToken, verifyCrossAccountToken } from './cross-account-token.js';

describe('cross-account token', () => {
  it('verifies the signed user and target account before expiry', async () => {
    const token = await signCrossAccountToken('secret', {
      userId: 'user-1',
      targetAccountId: 'account-2',
      expiresAtEpochSeconds: 200,
    });
    await expect(verifyCrossAccountToken('secret', token, 199)).resolves.toEqual({
      userId: 'user-1',
      targetAccountId: 'account-2',
    });
  });

  it('rejects expired and tampered tokens', async () => {
    const token = await signCrossAccountToken('secret', {
      userId: 'user-1',
      targetAccountId: 'account-2',
      expiresAtEpochSeconds: 200,
    });
    await expect(verifyCrossAccountToken('secret', token, 201)).resolves.toBeNull();
    await expect(verifyCrossAccountToken('wrong-secret', token, 199)).resolves.toBeNull();
    await expect(verifyCrossAccountToken('secret', token.replace('account-2', 'account-3'), 199)).resolves.toBeNull();
  });
});
