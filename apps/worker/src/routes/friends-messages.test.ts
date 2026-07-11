import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getFriends: vi.fn(),
  getFriendById: vi.fn(),
  getFriendCount: vi.fn(),
  addTagToFriend: vi.fn(),
  removeTagFromFriend: vi.fn(),
  getFriendTags: vi.fn(),
  getScenarios: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getLineAccountById: vi.fn(),
  jstNow: vi.fn(() => '2026-07-11T12:00:00.000+09:00'),
};
vi.mock('@line-crm/db', () => dbMocks);

const pushMessage = vi.fn().mockResolvedValue(undefined);
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({ pushMessage })),
}));

vi.mock('../services/auto-track.js', () => ({
  autoTrackContent: vi.fn((_: unknown, messageType: string, content: string) =>
    Promise.resolve({ messageType, content })),
}));

const { friends } = await import('./friends.js');

function makeDb(): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ run: vi.fn().mockResolvedValue({ success: true }) })),
    })),
  } as unknown as D1Database;
}

beforeEach(() => {
  pushMessage.mockClear();
  dbMocks.getFriendById.mockReset();
  dbMocks.getFriendById.mockResolvedValue({
    id: 'friend-1',
    line_user_id: 'U123',
    line_account_id: null,
  });
});

describe('POST /api/friends/:id/messages', () => {
  test('sends an image URL as a LINE image message and logs the URL', async () => {
    const db = makeDb();
    const app = new Hono();
    app.route('/', friends);
    const imageUrl = 'https://worker.example.com/images/outgoing-id.png';

    const response = await app.request('/api/friends/friend-1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageType: 'image', content: imageUrl }),
    }, {
      DB: db,
      LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
      WORKER_URL: 'https://worker.example.com',
    });

    expect(response.status).toBe(200);
    expect(pushMessage).toHaveBeenCalledWith('U123', [{
      type: 'image',
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    }]);
    const bind = vi.mocked(db.prepare).mock.results[0].value.bind;
    expect(bind).toHaveBeenCalledWith(
      expect.any(String),
      'friend-1',
      'image',
      imageUrl,
      '2026-07-11T12:00:00.000+09:00',
    );
  });
});
