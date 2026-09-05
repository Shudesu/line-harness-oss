import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getStaffByApiKey: vi.fn().mockResolvedValue(null),
  getFriendById: vi.fn(),
  getFriendTags: vi.fn(),
  jstNow: vi.fn(() => '2026-08-21T00:00:00.000+09:00'),
};
vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn() }));
vi.mock('../services/step-delivery.js', () => ({ buildMessage: vi.fn() }));

const { authMiddleware } = await import('../middleware/auth.js');
const { friends } = await import('./friends.js');
type Env = import('../index.js').Env;

const API_KEY = 'test-owner-key';

// Capture the metadata JSON the route binds to its UPDATE — that string is the
// actual persisted state, and the merge/delete behaviour is what we assert on.
let boundMetadata = '';
const db = {
  prepare: vi.fn(() => ({
    bind: vi.fn((metadata: string) => {
      boundMetadata = metadata;
      return { run: vi.fn().mockResolvedValue({}) };
    }),
  })),
} as unknown as D1Database;

const env = { DB: db, API_KEY } as unknown as Env['Bindings'];

function putMetadata(body: unknown) {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', friends);
  return instance.request(
    '/api/friends/f-1/metadata',
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  boundMetadata = '';
  dbMocks.getStaffByApiKey.mockResolvedValue(null);
  dbMocks.getFriendTags.mockResolvedValue([]);
  dbMocks.getFriendById.mockResolvedValue({
    id: 'f-1',
    metadata: JSON.stringify({ plan: 'free', source: 'ad' }),
  });
});

describe('PUT /api/friends/:id/metadata', () => {
  test('merges new keys without dropping existing ones', async () => {
    const res = await putMetadata({ plan: 'paid', city: 'Tokyo' });

    expect(res.status).toBe(200);
    expect(JSON.parse(boundMetadata)).toEqual({ plan: 'paid', source: 'ad', city: 'Tokyo' });
  });

  // Merge-only had no way to remove a field, so a typo'd or one-off key was
  // stuck on the friend forever.
  test('deletes a key when its value is explicitly null', async () => {
    const res = await putMetadata({ source: null });

    expect(res.status).toBe(200);
    const stored = JSON.parse(boundMetadata);
    expect(stored).toEqual({ plan: 'free' });
    expect('source' in stored).toBe(false);
  });

  test('deletes only the nulled keys in a mixed update', async () => {
    const res = await putMetadata({ plan: null, city: 'Osaka' });

    expect(res.status).toBe(200);
    expect(JSON.parse(boundMetadata)).toEqual({ source: 'ad', city: 'Osaka' });
  });

  // Distinguishes "remove this" from "store an empty value".
  test('keeps falsy-but-present values such as empty string and 0', async () => {
    const res = await putMetadata({ plan: '', source: 0 });

    expect(res.status).toBe(200);
    expect(JSON.parse(boundMetadata)).toEqual({ plan: '', source: 0 });
  });
});
