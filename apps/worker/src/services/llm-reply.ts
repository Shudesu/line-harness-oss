import { jstNow } from '@line-crm/db';

/**
 * auto_replies にマッチしなかった自由文メッセージへの、LLM（Claude API）による
 * フォールバック応答。line_account_id ごとに account_settings（key='llm_*'）
 * で有効化・システムプロンプトをカスタマイズできる。
 *
 * 設計方針（詳細: ai-shain.link リポジトリの CODEX-HANDOFF-line-support-bot.md）:
 * - Bot は導入手順の説明・エラー診断のみを行い、外部操作は代行しない
 * - Bot が答えられない/答えるべきでない場合は ESCALATE を返し、
 *   friends.ai_reply_mode を 'human' に変更してオペレーターへ引き継ぐ
 * - friends.ai_reply_mode が 'human' の友だちには、この関数を呼び出さない
 *   （呼び出し側 webhook.ts で事前にチェックする）
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-5';
const MAX_HISTORY_MESSAGES = 20;
const ESCALATION_MARKER = '[ESCALATE]';

export interface LlmReplyConfig {
  enabled: boolean;
  systemPrompt: string;
}

export interface LlmReplyResult {
  kind: 'reply' | 'escalate' | 'disabled' | 'error';
  text?: string;
}

interface HistoryRow {
  direction: 'incoming' | 'outgoing';
  content: string;
  message_type: string;
}

const DEFAULT_SYSTEM_PROMPT = `あなたはLINE公式アカウント上のカスタマーサポートAIです。
ユーザーからの自由な質問に、丁寧な日本語で答えてください。

厳守事項:
- 分からないこと、契約条件の交渉、実装状況の技術的詳細など、あなたが自信を持って
  答えられない質問には、正直に「担当者に確認します」と答え、応答の末尾に
  ${ESCALATION_MARKER} という文字列を付けてください（ユーザーには見えません）。
- 未実装の機能を「利用可能」と案内しない。
- メール送信・本番反映・データ削除など、外部への操作をあなたが代行することはない。
- パスワード・APIキー・トークン等の秘密情報を尋ねたり、会話に含めたりしない。
- 誇張表現（即日・ワンクリック・完全自動 等）を使わない。
- 返信は簡潔に、必要な情報だけを伝える。`;

/**
 * line_account_id ごとの LLM 設定を account_settings から取得する。
 * 未設定の場合は disabled とみなす（明示的な opt-in 方式）。
 */
export async function getLlmReplyConfig(
  db: D1Database,
  lineAccountId: string | null,
): Promise<LlmReplyConfig> {
  if (!lineAccountId) return { enabled: false, systemPrompt: DEFAULT_SYSTEM_PROMPT };

  const rows = await db
    .prepare(
      `SELECT key, value FROM account_settings WHERE line_account_id = ? AND key IN ('llm_reply_enabled', 'llm_system_prompt')`,
    )
    .bind(lineAccountId)
    .all<{ key: string; value: string }>();

  let enabled = false;
  let systemPrompt = DEFAULT_SYSTEM_PROMPT;
  for (const row of rows.results) {
    if (row.key === 'llm_reply_enabled') enabled = row.value === 'true';
    if (row.key === 'llm_system_prompt' && row.value.trim()) systemPrompt = row.value;
  }
  return { enabled, systemPrompt };
}

/**
 * friend の直近のメッセージ履歴（受信・送信双方、テキストのみ）を取得し、
 * Anthropic Messages API 形式のトランスクリプトに変換する。
 */
async function buildHistory(
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
    .all<HistoryRow>();

  return rows.results
    .reverse()
    .map((row) => ({
      role: row.direction === 'incoming' ? ('user' as const) : ('assistant' as const),
      content: row.content,
    }));
}

/**
 * Claude API を呼び出し、応答を生成する。エスケープ処理・エラー処理込み。
 * ネットワークエラーや API エラーは 'error' kind として返し、呼び出し側で
 * エスカレーション扱いにする（サイレントに失敗させない）。
 */
export async function generateLlmReply(params: {
  db: D1Database;
  apiKey: string;
  lineAccountId: string | null;
  friendId: string;
  incomingText: string;
}): Promise<LlmReplyResult> {
  const { db, apiKey, lineAccountId, friendId, incomingText } = params;

  const config = await getLlmReplyConfig(db, lineAccountId);
  if (!config.enabled) return { kind: 'disabled' };

  const history = await buildHistory(db, friendId);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 512,
        system: config.systemPrompt,
        messages: history.length > 0 ? history : [{ role: 'user', content: incomingText }],
      }),
    });
  } catch (err) {
    console.error('LLM reply: fetch failed', err);
    return { kind: 'error' };
  }

  if (!response.ok) {
    console.error('LLM reply: Anthropic API error', response.status, await response.text().catch(() => ''));
    return { kind: 'error' };
  }

  const data = await response.json<{ content?: Array<{ type: string; text?: string }> }>();
  const rawText = (data.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!rawText) return { kind: 'error' };

  if (rawText.includes(ESCALATION_MARKER)) {
    const cleaned = rawText.replace(ESCALATION_MARKER, '').trim();
    return { kind: 'escalate', text: cleaned || undefined };
  }

  return { kind: 'reply', text: rawText };
}

/** friend の ai_reply_mode を 'human' に切り替える（オペレーター引き継ぎ）。 */
export async function switchToHumanMode(db: D1Database, friendId: string): Promise<void> {
  await db.prepare(`UPDATE friends SET ai_reply_mode = 'human', updated_at = ? WHERE id = ?`).bind(jstNow(), friendId).run();
}
