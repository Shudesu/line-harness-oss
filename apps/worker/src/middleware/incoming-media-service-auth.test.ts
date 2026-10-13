import { beforeEach, describe, expect, test, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getIncomingMediaServiceCredentialById: vi.fn(),
}));

vi.mock('@line-crm/db', () => dbMocks);

import { authenticateIncomingMediaServiceToken } from './incoming-media-service-auth.js';

const ID = 'a'.repeat(32);
const SECRET = 'b'.repeat(64);
const TOKEN = `lhim_v1.${ID}.${SECRET}`;

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    line_account_id: 'acc-1',
    scope: 'incoming_media_read',
    token_sha256: await digest(TOKEN),
    label: 'accounting recovery',
    not_before: '2026-08-31T00:00:00.000Z',
    expires_at: '2026-11-29T00:00:00.000Z',
    revoked_at: null,
    created_at: '2026-08-31T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('incoming-media service token', () => {
  test('authenticates a valid active account-bound digest', async () => {
    dbMocks.getIncomingMediaServiceCredentialById.mockResolvedValue(await row());
    await expect(authenticateIncomingMediaServiceToken(
      {} as D1Database,
      TOKEN,
      new Date('2026-08-31T01:00:00.000Z'),
    )).resolves.toEqual({
      credentialId: ID,
      lineAccountId: 'acc-1',
      scope: 'incoming_media_read',
    });
    expect(dbMocks.getIncomingMediaServiceCredentialById).toHaveBeenCalledWith(
      expect.anything(),
      ID,
    );
  });

  test.each([
    ['malformed', 'not-a-service-token', {}],
    ['unknown', TOKEN, { missing: true }],
    ['wrong secret', `lhim_v1.${ID}.${'c'.repeat(64)}`, {}],
    ['revoked', TOKEN, { revoked_at: '2026-08-31T00:30:00.000Z' }],
    ['not yet valid', TOKEN, { not_before: '2026-09-01T00:00:00.000Z' }],
    ['expired', TOKEN, { expires_at: '2026-08-31T01:00:00.000Z' }],
    ['wrong scope', TOKEN, { scope: 'other' }],
  ])('rejects %s without exposing a distinct principal', async (_label, token, options) => {
    dbMocks.getIncomingMediaServiceCredentialById.mockResolvedValue(
      'missing' in options ? null : await row(options),
    );
    await expect(authenticateIncomingMediaServiceToken(
      {} as D1Database,
      token,
      new Date('2026-08-31T01:00:00.000Z'),
    )).resolves.toBeNull();
  });
});
