import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const lineClientMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  replyMessage: vi.fn(),
  pushMessage: vi.fn(),
}));

// 質問カードの「その他」の自由入力の扱い（自動返信との優先順・未読に残すか）だけを見るテスト。
vi.mock('@line-crm/db', () => ({
  upsertFriend: vi.fn(),
  updateFriendFollowStatus: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getScenarios: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getScenarioSteps: vi.fn(),
  advanceFriendScenario: vi.fn(),
  completeFriendScenario: vi.fn(),
  upsertChatOnMessage: vi.fn(),
  getLineAccounts: vi.fn().mockResolvedValue([]),
  jstNow: vi.fn(),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
  addTagToFriend: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  getMessageTemplateById: vi.fn(),
}));

vi.mock('@line-crm/line-sdk', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/line-sdk')>('@line-crm/line-sdk');
  return {
    ...actual,
    verifySignature: vi.fn(),
    LineClient: vi.fn().mockImplementation(() => lineClientMocks),
  };
});

vi.mock('../services/event-bus.js', () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/step-delivery.js', () => ({
  buildMessage: vi.fn().mockReturnValue({ type: 'text', text: 'reply' }),
  expandVariables: vi.fn().mockReturnValue('reply'),
  resolveMetadata: vi.fn().mockResolvedValue({}),
  messageToLogPayload: vi.fn().mockReturnValue({ messageType: 'text', content: 'reply' }),
}));

vi.mock('../services/free-text-answer.js', () => ({
  findFreeTextAnswer: vi.fn(),
  isRepeatedAnswer: vi.fn().mockResolvedValue(false),
}));

vi.mock('../services/postback-tag.js', () => ({
  applyPostbackTags: vi.fn().mockResolvedValue(3),
  parsePostbackTags: vi.fn().mockReturnValue(null),
}));

import { verifySignature } from '@line-crm/line-sdk';
import { getFriendByLineUserId, jstNow, upsertChatOnMessage } from '@line-crm/db';
import { findFreeTextAnswer } from '../services/free-text-answer.js';
import { applyPostbackTags } from '../services/postback-tag.js';
import { webhook } from './webhook.js';

const ANSWER = { tagIds: ['t-other', 't-answered', 't-start'], replyKeyword: 'asa_q1' };

const rule = (keyword: string, match_type: 'exact' | 'contains') => ({
  id: 'ar-' + keyword,
  keyword,
  match_type,
  response_type: 'text',
  response_content: 'reply ' + keyword,
  template_id: null,
  is_active: 1,
  created_at: '2026-11-01T00:00:00.000+09:00',
});

async function sendText(text: string, autoReplies: ReturnType<typeof rule>[]) {
  vi.mocked(verifySignature).mockResolvedValue(true);
  vi.mocked(jstNow).mockReturnValue('2026-11-13T18:00:00.000+09:00');
  vi.mocked(getFriendByLineUserId).mockResolvedValue({
    id: 'friend-1',
    line_user_id: 'U-1',
    display_name: 'A',
    picture_url: null,
    status_message: null,
    is_following: 1,
    user_id: null,
    line_account_id: null,
    metadata: '{}',
    first_tracked_link_id: null,
    created_at: '2026-11-13T17:00:00.000+09:00',
    updated_at: '2026-11-13T17:00:00.000+09:00',
  } as never);
  const stmt = {
    bind: vi.fn(),
    run: vi.fn().mockResolvedValue({}),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: autoReplies }),
  };
  stmt.bind.mockReturnValue(stmt);
  const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;
  const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext;
  const app = new Hono();
  app.route('/', webhook);
  const res = await app.request(
    '/webhook',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'A'.repeat(43) + '=' },
      body: JSON.stringify({
        destination: 'bot',
        events: [
          {
            type: 'message',
            replyToken: 'reply-token',
            message: { type: 'text', id: 'm-1', text },
            timestamp: Date.now(),
            source: { type: 'user', userId: 'U-1' },
            webhookEventId: 'event-' + text,
            deliveryContext: { isRedelivery: false },
            mode: 'active',
          },
        ],
      }),
    },
    { DB: db, LINE_CHANNEL_SECRET: 's', LINE_CHANNEL_ACCESS_TOKEN: 't' },
    executionCtx,
  );
  expect(res.status).toBe(200);
  await (vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('質問カードの「その他」の自由入力', () => {
  test('答えの文に「含まれていたら」の言葉が入っていても、答えとして受け取り未読に残す', async () => {
    vi.mocked(findFreeTextAnswer).mockResolvedValue(ANSWER);
    await sendText('朝活で習慣化したい', [rule('朝活', 'contains')]);
    expect(applyPostbackTags).toHaveBeenCalledWith(expect.anything(), 'friend-1', ANSWER.tagIds);
    expect(lineClientMocks.replyMessage).not.toHaveBeenCalled();
    expect(upsertChatOnMessage).toHaveBeenCalledWith(expect.anything(), 'friend-1');
  });

  test('文がそのまま一致する決まり（メニューの Q&A など）は従来どおり優先する', async () => {
    vi.mocked(findFreeTextAnswer).mockResolvedValue(ANSWER);
    await sendText('Q. 料金はいくら？', [rule('Q. 料金はいくら？', 'exact')]);
    expect(findFreeTextAnswer).not.toHaveBeenCalled();
    expect(applyPostbackTags).not.toHaveBeenCalled();
    expect(lineClientMocks.replyMessage).toHaveBeenCalledTimes(1);
    expect(upsertChatOnMessage).not.toHaveBeenCalled();
  });

  test('返事待ちでない人は、今までどおり「含まれていたら」の決まりで返信する', async () => {
    vi.mocked(findFreeTextAnswer).mockResolvedValue(null);
    await sendText('朝活で習慣化したい', [rule('朝活', 'contains')]);
    expect(applyPostbackTags).not.toHaveBeenCalled();
    expect(lineClientMocks.replyMessage).toHaveBeenCalledTimes(1);
    expect(upsertChatOnMessage).not.toHaveBeenCalled();
  });
});
