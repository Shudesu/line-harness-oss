// =============================================================================
// AI Auto-Reply Service — Generate AI responses and process delayed delivery
// =============================================================================

import {
  getAiReplyConfig,
  cancelPendingAiReplies,
  createAiReplyQueueEntry,
  getDueAiReplies,
  markAiReplySent,
  markAiReplyFailed,
  jstNow,
} from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import { sleep } from './stealth.js';

// --- Claude API ---

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function callClaudeApi(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ClaudeMessage[],
  maxTokens: number,
): Promise<string> {
  // Map config model names to actual API model IDs
  const modelMap: Record<string, string> = {
    'claude-haiku': 'claude-haiku-4-5-20251001',
    'claude-sonnet': 'claude-sonnet-4-5-20241022',
    'claude-opus': 'claude-opus-4-20250514',
  };
  const modelId = modelMap[model] || model;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errBody}`);
  }

  const data = (await res.json()) as {
    content: { type: string; text: string }[];
  };
  const textBlock = data.content.find((b) => b.type === 'text');
  return textBlock?.text ?? '';
}

// --- Conversation Context ---

async function buildConversationContext(
  db: D1Database,
  friendId: string,
  maxMessages: number,
): Promise<ClaudeMessage[]> {
  const rows = await db
    .prepare(
      `SELECT direction, message_type, content, created_at
       FROM messages_log
       WHERE friend_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(friendId, maxMessages)
    .all<{
      direction: string;
      message_type: string;
      content: string;
      created_at: string;
    }>();

  // Reverse to chronological order
  const logs = rows.results.reverse();

  const messages: ClaudeMessage[] = [];
  for (const log of logs) {
    const role: 'user' | 'assistant' =
      log.direction === 'incoming' ? 'user' : 'assistant';

    // Convert non-text messages to readable placeholders
    let text = log.content;
    if (log.message_type === 'image') {
      text = '[画像]';
    } else if (log.message_type === 'flex') {
      text = '[メッセージカード]';
    } else if (log.message_type === 'sticker') {
      text = '[スタンプ]';
    } else if (log.message_type === 'video') {
      text = '[動画]';
    } else if (log.message_type === 'audio') {
      text = '[音声]';
    } else if (log.message_type === 'location') {
      text = '[位置情報]';
    }

    // Claude API requires alternating roles — merge consecutive same-role messages
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      last.content += '\n' + text;
    } else {
      messages.push({ role, content: text });
    }
  }

  // Claude API requires the first message to be 'user'
  while (messages.length > 0 && messages[0].role !== 'user') {
    messages.shift();
  }

  return messages;
}

// --- Main: Generate and Queue ---

export async function generateAndQueueAiReply(
  db: D1Database,
  friendId: string,
  incomingText: string,
  lineAccountId: string | null,
  anthropicApiKey: string,
): Promise<void> {
  // 1. Check if AI reply is enabled
  const config = await getAiReplyConfig(db, lineAccountId);
  if (!config || !config.is_enabled) return;

  // 2. Cancel any existing pending replies for this friend (consecutive message handling)
  await cancelPendingAiReplies(db, friendId);

  // 3. Build conversation context from messages_log
  const context = await buildConversationContext(
    db,
    friendId,
    config.max_context_messages,
  );

  // If context is empty (shouldn't happen since we just logged the incoming message),
  // use the incoming text directly
  if (context.length === 0) {
    context.push({ role: 'user', content: incomingText });
  }

  // 4. Call Claude API
  let aiResponse: string;
  try {
    aiResponse = await callClaudeApi(
      anthropicApiKey,
      config.ai_model,
      config.system_prompt,
      context,
      config.max_tokens,
    );
  } catch (err) {
    console.error('AI reply generation failed:', err);
    return;
  }

  if (!aiResponse.trim()) {
    console.error('AI returned empty response');
    return;
  }

  // 5. Calculate random delay (delay_min_minutes to delay_max_minutes)
  const delayMinutes =
    config.delay_min_minutes +
    Math.random() * (config.delay_max_minutes - config.delay_min_minutes);

  const sendAt = new Date(Date.now() + 9 * 60 * 60_000); // JST now
  sendAt.setMinutes(sendAt.getMinutes() + delayMinutes);

  // Enforce delivery window: 9:00-23:00 JST
  const jstHour = sendAt.getUTCHours();
  if (jstHour >= 23 || jstHour < 9) {
    if (jstHour >= 23) {
      sendAt.setUTCDate(sendAt.getUTCDate() + 1);
    }
    sendAt.setUTCHours(9, 0, 0, 0);
  }

  const scheduledSendAt = sendAt.toISOString().replace('Z', '');

  // 6. Insert into queue
  await createAiReplyQueueEntry(db, {
    friendId,
    lineAccountId,
    incomingMessage: incomingText,
    aiResponse,
    scheduledSendAt,
  });

  console.log(
    `AI reply queued for friend ${friendId}, scheduled at ${scheduledSendAt} (delay: ${Math.round(delayMinutes)}min)`,
  );
}

// --- Cron: Process Due Replies ---

export async function processAiReplyQueue(
  db: D1Database,
  lineClient: LineClient,
  lineAccessToken: string,
): Promise<void> {
  // Skip outside delivery window: 9:00-23:00 JST
  const jstHour = new Date(Date.now() + 9 * 60 * 60_000).getUTCHours();
  if (jstHour < 9 || jstHour >= 23) return;

  const now = jstNow();
  const dueReplies = await getDueAiReplies(db, now);

  for (const entry of dueReplies) {
    try {
      // Show typing indicator (LINE Chat Loading API)
      try {
        await fetch('https://api.line.me/v2/bot/chat/loading', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${lineAccessToken}`,
          },
          body: JSON.stringify({
            chatId: entry.line_user_id,
            loadingSeconds: 10,
          }),
        });
      } catch {
        // Loading indicator is best-effort
      }

      // Wait 2-5 seconds for realistic typing feel
      await sleep(2000 + Math.random() * 3000);

      // Send the message
      await lineClient.pushMessage(entry.line_user_id, [
        { type: 'text', text: entry.ai_response },
      ]);

      // Log to messages_log
      const logId = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, delivery_type, created_at)
           VALUES (?, ?, 'outgoing', 'text', ?, 'push', ?)`,
        )
        .bind(logId, entry.friend_id, entry.ai_response, jstNow())
        .run();

      // Mark as sent
      await markAiReplySent(db, entry.id);
      console.log(`AI reply sent to ${entry.line_user_id} (queue ${entry.id})`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`AI reply failed for queue ${entry.id}:`, errorMsg);
      await markAiReplyFailed(db, entry.id, errorMsg);
    }
  }
}
