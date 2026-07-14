import { getBotConfig } from './groq-config.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const ESCALATION_MARKER = '[ESCALATE]';

export type GroqReplyKind = 'reply' | 'escalate' | 'fail_closed';

export interface GroqReplyResult {
  kind: GroqReplyKind;
  text?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroqGenerateParams {
  apiKey: string;
  systemPrompt: string;
  messages: ChatMessage[];
  incomingText: string;
}

/**
 * Call Groq chat completions API with timeout and fail-closed error handling.
 * Never throws — returns fail_closed on network/API/timeout errors.
 */
export async function generateGroqReply(params: GroqGenerateParams): Promise<GroqReplyResult> {
  const { apiKey, systemPrompt, messages, incomingText } = params;
  const { model, maxOutputTokens, timeoutMs } = getBotConfig().llm;

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...(messages.length > 0 ? messages : [{ role: 'user' as const, content: incomingText }]),
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        temperature: 0.3,
        messages: chatMessages,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.error('[groq-reply] fetch failed', err);
    return { kind: 'fail_closed' };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    console.warn('[groq-reply] rate limited (429)');
    return { kind: 'fail_closed' };
  }

  if (!response.ok) {
    console.error('[groq-reply] API error', response.status, await response.text().catch(() => ''));
    return { kind: 'fail_closed' };
  }

  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = await response.json();
  } catch {
    return { kind: 'fail_closed' };
  }

  const rawText = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!rawText) return { kind: 'fail_closed' };

  if (rawText.includes(ESCALATION_MARKER)) {
    const cleaned = rawText.replace(ESCALATION_MARKER, '').trim();
    return { kind: 'escalate', text: cleaned || undefined };
  }

  return { kind: 'reply', text: rawText };
}

export interface GroqReplyConfig {
  enabled: boolean;
}

/** Per-account Groq opt-in via account_settings (mirrors llm-reply pattern). */
export async function getGroqReplyConfig(
  db: D1Database,
  lineAccountId: string | null,
): Promise<GroqReplyConfig> {
  if (!lineAccountId) return { enabled: false };

  const row = await db
    .prepare(
      `SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'groq_reply_enabled'`,
    )
    .bind(lineAccountId)
    .first<{ value: string }>();

  return { enabled: row?.value === 'true' };
}

const MAX_HISTORY_MESSAGES = 6;

export async function buildGroqHistory(
  db: D1Database,
  friendId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const rows = await db
    .prepare(
      `SELECT direction, content, message_type FROM messages_log
       WHERE friend_id = ? AND message_type = 'text'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(friendId, MAX_HISTORY_MESSAGES)
    .all<{ direction: string; content: string; message_type: string }>();

  return rows.results
    .reverse()
    .map((row) => ({
      role: row.direction === 'incoming' ? ('user' as const) : ('assistant' as const),
      content: row.content,
    }));
}
