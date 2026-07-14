import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  generateGroqReply,
  getGroqReplyConfig,
  ESCALATION_MARKER,
} from './groq-reply.js';

function fakeDb(settings: Array<{ value: string }> = []): D1Database {
  return {
    prepare(sql: string) {
      const isSettings = sql.includes('account_settings');
      return {
        bind(..._args: unknown[]) {
          return this;
        },
        async first<T>(): Promise<T | null> {
          if (isSettings) return (settings[0] as T) ?? null;
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: [] };
        },
        async run(): Promise<unknown> {
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;
}

describe('getGroqReplyConfig', () => {
  it('returns disabled without lineAccountId', async () => {
    const config = await getGroqReplyConfig(fakeDb(), null);
    expect(config.enabled).toBe(false);
  });

  it('returns enabled when groq_reply_enabled=true', async () => {
    const db = fakeDb([{ value: 'true' }]);
    const config = await getGroqReplyConfig(db, 'acc1');
    expect(config.enabled).toBe(true);
  });
});

describe('generateGroqReply', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns reply on success', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'STEP 3 の手順です' } }],
      }),
    });

    const result = await generateGroqReply({
      apiKey: 'gsk-test',
      systemPrompt: 'test',
      messages: [],
      incomingText: 'Google接続',
    });

    expect(result.kind).toBe('reply');
    expect(result.text).toBe('STEP 3 の手順です');
  });

  it('returns escalate and strips marker', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: `担当者確認します。${ESCALATION_MARKER}` } }],
      }),
    });

    const result = await generateGroqReply({
      apiKey: 'gsk-test',
      systemPrompt: 'test',
      messages: [],
      incomingText: '契約変更',
    });

    expect(result.kind).toBe('escalate');
    expect(result.text).toBe('担当者確認します。');
  });

  it('returns fail_closed on 429', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    });

    const result = await generateGroqReply({
      apiKey: 'gsk-test',
      systemPrompt: 'test',
      messages: [],
      incomingText: 'hello',
    });

    expect(result.kind).toBe('fail_closed');
  });

  it('returns fail_closed on network error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));

    const result = await generateGroqReply({
      apiKey: 'gsk-test',
      systemPrompt: 'test',
      messages: [],
      incomingText: 'hello',
    });

    expect(result.kind).toBe('fail_closed');
  });
});
