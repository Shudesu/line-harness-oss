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

  test.each([
    {
      messageType: 'text',
      content: 'hello',
      expected: { type: 'text', text: 'hello' },
    },
    {
      messageType: 'image',
      content: 'https://worker.example.com/images/sender.png',
      expected: {
        type: 'image',
        originalContentUrl: 'https://worker.example.com/images/sender.png',
        previewImageUrl: 'https://worker.example.com/images/sender.png',
      },
    },
    {
      messageType: 'flex',
      content: '{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"text","text":"hi"}]}}',
      expected: {
        type: 'flex',
        altText: 'hi',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [{ type: 'text', text: 'hi' }],
          },
        },
      },
    },
  ])('attaches sender to $messageType messages', async ({ messageType, content, expected }) => {
    const app = new Hono();
    app.route('/', friends);
    const sender = { name: '採用担当', iconUrl: 'https://example.com/operator.png' };

    const response = await app.request('/api/friends/friend-1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageType, content, sender, trackLinks: false }),
    }, {
      DB: makeDb(),
      LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
      WORKER_URL: 'https://worker.example.com',
    });

    expect(response.status).toBe(200);
    expect(pushMessage).toHaveBeenCalledWith('U123', [{ ...expected, sender }]);
  });

  test.each([
    { sender: { name: '', iconUrl: 'https://example.com/icon.png' } },
    { sender: { name: '123456789012345678901', iconUrl: 'https://example.com/icon.png' } },
    { sender: { name: '採用担当', iconUrl: 'http://example.com/icon.png' } },
  ])('returns 400 for invalid sender: $sender', async ({ sender }) => {
    const app = new Hono();
    app.route('/', friends);

    const response = await app.request('/api/friends/friend-1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello', sender }),
    }, {
      DB: makeDb(),
      LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
    });

    expect(response.status).toBe(400);
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('keeps the existing message shape when sender is omitted', async () => {
    const app = new Hono();
    app.route('/', friends);

    const response = await app.request('/api/friends/friend-1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello', trackLinks: false }),
    }, {
      DB: makeDb(),
      LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
    });

    expect(response.status).toBe(200);
    expect(pushMessage).toHaveBeenCalledWith('U123', [{ type: 'text', text: 'hello' }]);
  });
});
