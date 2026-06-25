import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const lineClientMock = vi.hoisted(() => ({
  getProfile: vi.fn(),
  replyMessage: vi.fn(),
}));

// Stub the DB graph — these tests only exercise the size guard and
// signature-verify-before-parse path; webhook event handling is out of scope.
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
  getTemplateById: vi.fn(),
}));

vi.mock('@line-crm/line-sdk', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/line-sdk')>('@line-crm/line-sdk');
  return {
    ...actual,
    verifySignature: vi.fn(),
    LineClient: vi.fn().mockImplementation(() => lineClientMock),
  };
});

vi.mock('../services/event-bus.js', () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/step-delivery.js', () => ({
  buildMessage: vi.fn(),
  expandVariables: vi.fn(),
  resolveMetadata: vi.fn(),
  messageToLogPayload: vi.fn(),
}));

import { verifySignature } from '@line-crm/line-sdk';
import {
  getFriendByLineUserId,
  getLineAccounts,
  jstNow,
  upsertFriend,
} from '@line-crm/db';
import {
  buildMessage,
  expandVariables,
  messageToLogPayload,
  resolveMetadata,
} from '../services/step-delivery.js';
import { webhook } from './webhook.js';

function setupApp() {
  const app = new Hono();
  app.route('/', webhook);
  return app;
}

const baseEnv = {
  DB: {} as D1Database,
  LINE_CHANNEL_SECRET: 'env-default-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-default-token',
} as Record<string, unknown>;

const baseExecutionCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;

beforeEach(() => {
  vi.clearAllMocks();
  lineClientMock.getProfile.mockResolvedValue({
    userId: 'Uunknown',
    displayName: '未登録ユーザー',
    pictureUrl: 'https://example.com/p.png',
    statusMessage: null,
  });
  lineClientMock.replyMessage.mockResolvedValue(undefined);
  vi.mocked(jstNow).mockReturnValue('2026-06-03T18:00:00.000+09:00');
  vi.mocked(buildMessage).mockImplementation((messageType: string, content: string) => ({
    type: messageType,
    text: content,
  }));
  vi.mocked(expandVariables).mockImplementation((content: string) => content);
  vi.mocked(resolveMetadata).mockResolvedValue({});
  vi.mocked(messageToLogPayload).mockImplementation((message: unknown) => {
    const msg = message as { type?: string; text?: string };
    return { messageType: msg.type ?? 'text', content: msg.text ?? '' };
  });
});

describe('POST /webhook — DoS defenses (#104)', () => {
  test('rejects with 413 when Content-Length declares an oversized body', async () => {
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(2 * 1024 * 1024), // 2 MiB > 1 MiB cap
          'X-Line-Signature': 'whatever',
        },
        body: JSON.stringify({ events: [] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(413);
    // Signature verification must not even be attempted on an oversized body.
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('rejects with 413 when actual body exceeds the cap even if Content-Length is absent', async () => {
    const app = setupApp();
    const oversizedBody = 'x'.repeat(1024 * 1024 + 1);
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': 'whatever',
        },
        body: oversizedBody,
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(413);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('verifies signature before parsing JSON — malformed body with invalid signature never reaches the parser', async () => {
    vi.mocked(verifySignature).mockResolvedValue(false);

    const app = setupApp();
    // 44-char signature (valid HMAC-SHA256 base64 length) so it clears the
    // length pre-check and reaches verifySignature. Malformed JSON body: if
    // signature were verified *after* parse (old behavior), we'd hit the
    // parser-failure branch first. With signature-first, we get the invalid-
    // signature branch and never attempt to parse.
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: '{not valid json',
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    // verifySignature must run; rejection happens before any parse attempt.
    expect(verifySignature).toHaveBeenCalled();
    expect(verifySignature).toHaveBeenCalledWith('env-default-secret', '{not valid json', validShapedSignature);
  });

  test('rejects unsigned or malformed-signature requests without hitting verifySignature or D1', async () => {
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Missing X-Line-Signature header entirely.
        },
        body: JSON.stringify({ events: [] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    // Fast-rejected before any crypto / DB work.
    expect(verifySignature).not.toHaveBeenCalled();
  });
});

describe('POST /webhook — unknown friend auto registration', () => {
  test('auto-registers an unknown message sender and continues to auto-reply', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getLineAccounts).mockResolvedValue([
      {
        id: 'account-luu',
        name: 'Darts＆Bar Luu',
        channel_id: '2009755907',
        channel_secret: 'env-default-secret',
        channel_access_token: 'account-token',
        liff_id: null,
        is_active: 1,
        created_at: '2026-06-03T18:00:00.000+09:00',
        updated_at: '2026-06-03T18:00:00.000+09:00',
      } as never,
    ]);
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-new',
      line_user_id: 'Uunknown',
      display_name: '未登録ユーザー',
      picture_url: 'https://example.com/p.png',
      status_message: null,
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-06-03T18:00:00.000+09:00',
      updated_at: '2026-06-03T18:00:00.000+09:00',
    });

    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: vi.fn(async () => {
            if (sql.includes('SELECT liff_id FROM line_accounts')) return { liff_id: null };
            return null;
          }),
          all: vi.fn(async () => {
            if (sql.includes('FROM auto_replies')) {
              return {
                results: [
                  {
                    id: 'reply-event',
                    keyword: 'イベント',
                    match_type: 'exact',
                    response_type: 'text',
                    response_content: 'イベント予約はこちら',
                    template_id: null,
                    is_active: 1,
                    created_at: '2026-06-03T18:00:00.000+09:00',
                  },
                ],
              };
            }
            return { results: [] };
          }),
          run: vi.fn(async () => {
            writes.push({ sql, args });
            return { success: true };
          }),
        }),
      })),
    } as unknown as D1Database;

    const pending: Promise<unknown>[] = [];
    const executionCtx = {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        pending.push(promise);
      }),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': 'A'.repeat(43) + '=',
        },
        body: JSON.stringify({
          events: [
            {
              type: 'message',
              replyToken: 'reply-token',
              source: { type: 'user', userId: 'Uunknown' },
              message: { id: 'msg-1', type: 'text', text: 'イベント' },
            },
          ],
        }),
      },
      { ...baseEnv, DB: db },
      executionCtx,
    );
    await Promise.all(pending);

    expect(res.status).toBe(200);
    expect(lineClientMock.getProfile).toHaveBeenCalledWith('Uunknown');
    expect(upsertFriend).toHaveBeenCalledWith(db, {
      lineUserId: 'Uunknown',
      displayName: '未登録ユーザー',
      pictureUrl: 'https://example.com/p.png',
      statusMessage: null,
    });
    expect(lineClientMock.replyMessage).toHaveBeenCalledWith('reply-token', [
      { type: 'text', text: 'イベント予約はこちら' },
    ]);
    expect(writes.some((w) => w.sql.includes('UPDATE friends SET line_account_id'))).toBe(true);
    expect(writes.some((w) => w.sql.includes('INSERT INTO messages_log') && w.sql.includes("'incoming'"))).toBe(true);
    expect(writes.some((w) => w.sql.includes('INSERT INTO messages_log') && w.sql.includes("'auto_reply'"))).toBe(true);
  });
});
