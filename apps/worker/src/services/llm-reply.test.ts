import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getLlmReplyConfig, generateLlmReply, switchToHumanMode } from './llm-reply.js';

interface CannedSettings {
  key: string;
  value: string;
}

function fakeDb(opts: {
  settings?: CannedSettings[];
  history?: Array<{ direction: 'incoming' | 'outgoing'; content: string; message_type: string }>;
}): D1Database {
  const settings = opts.settings ?? [];
  const history = opts.history ?? [];
  return {
    prepare(sql: string) {
      const isSettings = sql.includes('FROM account_settings');
      const isHistory = sql.includes('FROM messages_log');
      const isUpdateFriend = sql.includes('UPDATE friends SET ai_reply_mode');
      return {
        bind(..._args: unknown[]) {
          return this;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (isSettings) return { results: settings as unknown as T[] };
          if (isHistory) return { results: history as unknown as T[] };
          return { results: [] };
        },
        async first<T>(): Promise<T | null> {
          return null;
        },
        async run(): Promise<unknown> {
          if (isUpdateFriend) return { success: true };
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;
}

describe('getLlmReplyConfig', () => {
  it('returns disabled with no lineAccountId', async () => {
    const db = fakeDb({});
    const config = await getLlmReplyConfig(db, null);
    expect(config.enabled).toBe(false);
  });

  it('returns disabled when llm_reply_enabled is not set', async () => {
    const db = fakeDb({ settings: [] });
    const config = await getLlmReplyConfig(db, 'acc1');
    expect(config.enabled).toBe(false);
  });

  it('returns disabled when llm_reply_enabled=false', async () => {
    const db = fakeDb({ settings: [{ key: 'llm_reply_enabled', value: 'false' }] });
    const config = await getLlmReplyConfig(db, 'acc1');
    expect(config.enabled).toBe(false);
  });

  it('returns enabled with custom prompt when both settings present', async () => {
    const db = fakeDb({
      settings: [
        { key: 'llm_reply_enabled', value: 'true' },
        { key: 'llm_system_prompt', value: 'custom prompt' },
      ],
    });
    const config = await getLlmReplyConfig(db, 'acc1');
    expect(config.enabled).toBe(true);
    expect(config.systemPrompt).toBe('custom prompt');
  });

  it('falls back to default prompt when custom prompt is blank', async () => {
    const db = fakeDb({
      settings: [
        { key: 'llm_reply_enabled', value: 'true' },
        { key: 'llm_system_prompt', value: '   ' },
      ],
    });
    const config = await getLlmReplyConfig(db, 'acc1');
    expect(config.enabled).toBe(true);
    expect(config.systemPrompt).toContain('カスタマーサポートAI');
  });
});

describe('generateLlmReply', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns disabled kind without calling fetch when account has not opted in', async () => {
    const db = fakeDb({ settings: [] });
    const result = await generateLlmReply({
      db,
      apiKey: 'sk-test',
      lineAccountId: 'acc1',
      friendId: 'friend1',
      incomingText: 'hello',
    });
    expect(result.kind).toBe('disabled');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns reply kind on successful API call without escalation marker', async () => {
    const db = fakeDb({
      settings: [{ key: 'llm_reply_enabled', value: 'true' }],
      history: [{ direction: 'incoming', content: 'hello', message_type: 'text' }],
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'こんにちは、ご質問をどうぞ' }] }),
    });

    const result = await generateLlmReply({
      db,
      apiKey: 'sk-test',
      lineAccountId: 'acc1',
      friendId: 'friend1',
      incomingText: 'hello',
    });

    expect(result.kind).toBe('reply');
    expect(result.text).toBe('こんにちは、ご質問をどうぞ');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'sk-test' }),
      }),
    );
  });

  it('returns escalate kind and strips the marker when the model asks to escalate', async () => {
    const db = fakeDb({ settings: [{ key: 'llm_reply_enabled', value: 'true' }] });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '担当者に確認します。少々お待ちください。[ESCALATE]' }],
      }),
    });

    const result = await generateLlmReply({
      db,
      apiKey: 'sk-test',
      lineAccountId: 'acc1',
      friendId: 'friend1',
      incomingText: '契約条件を変更したい',
    });

    expect(result.kind).toBe('escalate');
    expect(result.text).toBe('担当者に確認します。少々お待ちください。');
  });

  it('returns escalate kind with no text when the response is only the marker', async () => {
    const db = fakeDb({ settings: [{ key: 'llm_reply_enabled', value: 'true' }] });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '[ESCALATE]' }] }),
    });

    const result = await generateLlmReply({
      db,
      apiKey: 'sk-test',
      lineAccountId: 'acc1',
      friendId: 'friend1',
      incomingText: 'weird question',
    });

    expect(result.kind).toBe('escalate');
    expect(result.text).toBeUndefined();
  });

  it('returns error kind when fetch rejects', async () => {
    const db = fakeDb({ settings: [{ key: 'llm_reply_enabled', value: 'true' }] });
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    const result = await generateLlmReply({
      db,
      apiKey: 'sk-test',
      lineAccountId: 'acc1',
      friendId: 'friend1',
      incomingText: 'hello',
    });

    expect(result.kind).toBe('error');
  });

  it('returns error kind when the API responds with non-2xx', async () => {
    const db = fakeDb({ settings: [{ key: 'llm_reply_enabled', value: 'true' }] });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    });

    const result = await generateLlmReply({
      db,
      apiKey: 'sk-bad',
      lineAccountId: 'acc1',
      friendId: 'friend1',
      incomingText: 'hello',
    });

    expect(result.kind).toBe('error');
  });

  it('returns error kind when the response has no text content', async () => {
    const db = fakeDb({ settings: [{ key: 'llm_reply_enabled', value: 'true' }] });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    });

    const result = await generateLlmReply({
      db,
      apiKey: 'sk-test',
      lineAccountId: 'acc1',
      friendId: 'friend1',
      incomingText: 'hello',
    });

    expect(result.kind).toBe('error');
  });
});

describe('switchToHumanMode', () => {
  it('issues an UPDATE against friends.ai_reply_mode', async () => {
    const runSpy = vi.fn().mockResolvedValue({ success: true });
    const db = {
      prepare(sql: string) {
        expect(sql).toContain("UPDATE friends SET ai_reply_mode = 'human'");
        return {
          bind(..._args: unknown[]) {
            return this;
          },
          run: runSpy,
        };
      },
    } as unknown as D1Database;

    await switchToHumanMode(db, 'friend1');
    expect(runSpy).toHaveBeenCalled();
  });
});
