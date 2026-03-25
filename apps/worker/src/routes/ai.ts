import { Hono } from 'hono';
import type { Env } from '../index.js';

const ai = new Hono<Env>();

// ─── POST /api/ai/analyze ─────────────────────────────────
// CRM コンテキストを D1 から取得し、Claude API でストリーミング回答を返す
ai.post('/api/ai/analyze', async (c) => {
  const apiKey = (c.env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'AI 機能は設定されていません（ANTHROPIC_API_KEY 未設定）' }, 503);
  }

  let prompt: string;
  try {
    const body = await c.req.json<{ prompt: string }>();
    prompt = (body.prompt ?? '').trim();
    if (!prompt) return c.json({ success: false, error: 'prompt は必須です' }, 400);
  } catch {
    return c.json({ success: false, error: 'リクエスト形式が不正です' }, 400);
  }

  // ─── D1 からコンテキスト収集 ───────────────────────────
  const db = c.env.DB;
  const [friendsRow, tagsRow, scenariosRow, broadcastsRow] = await Promise.allSettled([
    db.prepare('SELECT COUNT(*) as cnt FROM friends').first<{ cnt: number }>(),
    db.prepare('SELECT id, name FROM tags ORDER BY created_at DESC LIMIT 20').all<{ id: string; name: string }>(),
    db
      .prepare("SELECT id, name, status FROM scenarios WHERE status = 'active' ORDER BY created_at DESC LIMIT 10")
      .all<{ id: string; name: string; status: string }>(),
    db
      .prepare(
        "SELECT COUNT(*) as cnt, SUM(sent_count) as total_sent FROM broadcasts WHERE status = 'sent' AND sent_at > datetime('now', '-30 days')",
      )
      .first<{ cnt: number; total_sent: number }>(),
  ]);

  const friendsCount =
    friendsRow.status === 'fulfilled' ? (friendsRow.value?.cnt ?? 0) : 0;
  const tags =
    tagsRow.status === 'fulfilled'
      ? tagsRow.value.results.map((t) => t.name).join(', ')
      : '取得失敗';
  const scenarios =
    scenariosRow.status === 'fulfilled'
      ? scenariosRow.value.results.map((s) => s.name).join(', ')
      : '取得失敗';
  const broadcastStats =
    broadcastsRow.status === 'fulfilled'
      ? `過去30日: ${broadcastsRow.value?.cnt ?? 0}回配信, 合計${broadcastsRow.value?.total_sent ?? 0}通送信`
      : '取得失敗';

  // ─── システムプロンプト構築 ────────────────────────────
  const systemPrompt = `あなたは LINE CRM (みやびライン) のアシスタントです。
以下がこのアカウントの現在のデータです:

- 友だち数: ${friendsCount}人
- タグ一覧: ${tags || 'なし'}
- アクティブシナリオ: ${scenarios || 'なし'}
- 配信実績: ${broadcastStats}

このデータをもとに、ユーザーの質問に日本語で回答してください。
具体的な数値や洞察を提供し、LINE マーケティングの改善提案も行ってください。
回答は300文字以内で簡潔にまとめてください。`;

  // ─── Anthropic API ストリーミング呼び出し ─────────────
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      stream: true,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    console.error('Anthropic API error:', anthropicRes.status, errText);
    return c.json({ success: false, error: 'AI APIエラーが発生しました' }, 502);
  }

  // Anthropic の SSE をそのままクライアントにパイプする
  return new Response(anthropicRes.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
      'x-accel-buffering': 'no',
    },
  });
});

export { ai };
