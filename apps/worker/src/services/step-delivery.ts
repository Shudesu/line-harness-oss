import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getFriendScenariosDueForDelivery,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  claimFriendScenarioForDelivery,
  getFriendById,
  jstNow,
  computeNextDeliveryAt,
  resolveStepContent,
  addTagToFriend,
  getMergedMetadataByUserId,
  getLineAccountById,
  type DeliveryMode,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { jitterDeliveryTime, addJitter, sleep } from './stealth.js';
// P1 修正 (hot path): cron 配信ループの dynamic import を static 化。
// auto-track / account-token は配信1回ごとに必ず通る確実な依存。
import { autoTrackContent } from './auto-track.js';
import { resolveAccessToken } from '../lib/account-token.js';

/**
 * Replace template variables in message content.
 *
 * Supported variables:
 * - {{name}}                → friend's display name
 * - {{uid}}                 → friend's user UUID
 * - {{friend_id}}           → friend's internal ID
 * - {{auth_url:CHANNEL_ID}} → full /auth/line URL with uid for cross-account linking
 * - {{metadata.KEY}}       → friend's metadata value (from form responses etc.)
 */
export function expandVariables(
  content: string,
  friend: { id: string; display_name: string | null; user_id: string | null; ref_code?: string | null; metadata?: Record<string, unknown> | string | null },
  apiOrigin?: string,
): string {
  let result = content;
  result = result.replace(/\{\{name\}\}/g, friend.display_name || '');
  result = result.replace(/\{\{uid\}\}/g, friend.user_id || '');
  result = result.replace(/\{\{friend_id\}\}/g, friend.id);
  result = result.replace(/\{\{ref\}\}/g, friend.ref_code || '');
  // Conditional block: {{#if_ref}}...{{/if_ref}} — only shown if ref_code exists
  if (friend.ref_code) {
    result = result.replace(/\{\{#if_ref\}\}([\s\S]*?)\{\{\/if_ref\}\}/g, '$1');
  } else {
    result = result.replace(/\{\{#if_ref\}\}[\s\S]*?\{\{\/if_ref\}\}/g, '');
  }
  // Metadata variables: {{metadata.KEY}} → value from friend's metadata
  const meta = friend.metadata
    ? (typeof friend.metadata === 'string' ? JSON.parse(friend.metadata) as Record<string, unknown> : friend.metadata)
    : {};
  // Conditional block: {{#if_metadata.KEY}}...{{/if_metadata.KEY}} — only shown if metadata key has a value
  // When inside JSON arrays, removes the element and fixes trailing/leading commas
  result = result.replace(/\{\{#if_metadata\.([^}]+)\}\}([\s\S]*?)\{\{\/if_metadata\.\1\}\}/g, (_match, key, inner) => {
    const val = meta[key];
    if (val == null || val === '') return '';
    return inner;
  });
  // Clean up broken JSON commas from removed conditional blocks (e.g. ",," or "[," or ",]")
  result = result.replace(/,\s*,/g, ',');
  result = result.replace(/\[\s*,/g, '[');
  result = result.replace(/,\s*\]/g, ']');
  result = result.replace(/\{\{metadata\.([^}]+)\}\}/g, (_match, key) => {
    const val = meta[key];
    if (val == null) return '';
    return Array.isArray(val) ? val.join(', ') : String(val);
  });
  if (apiOrigin) {
    result = result.replace(/\{\{auth_url:([^}]+)\}\}/g, (_match, channelId) => {
      const params = new URLSearchParams({ account: channelId, ref: 'cross-link' });
      if (friend.user_id) params.set('uid', friend.user_id);
      return `${apiOrigin}/auth/line?${params.toString()}`;
    });
  }
  return result;
}

/**
 * Resolve metadata for a friend, merging across all UUID-linked records.
 * Falls back to the friend's own metadata if no user_id.
 */
export async function resolveMetadata(
  db: D1Database,
  friend: { user_id?: string | null; metadata?: string | null },
): Promise<Record<string, unknown>> {
  // If friend has a UUID, merge metadata from all linked records
  if (friend.user_id) {
    return getMergedMetadataByUserId(db, friend.user_id);
  }
  // Fallback: parse own metadata
  if (friend.metadata) {
    try { return JSON.parse(friend.metadata); } catch { return {}; }
  }
  return {};
}

const MAX_SENDS_PER_CRON = 40; // CF Free plan: 50 subrequests limit (margin for other jobs)

export async function processStepDeliveries(
  db: D1Database,
  lineClient: LineClient,
  workerUrl?: string,
  /** Phase 1-G: 暗号化 token を復号するためのキー (LINE_TOKEN_ENC_KEY) を含む env */
  env?: { LINE_TOKEN_ENC_KEY?: string },
): Promise<void> {
  const now = jstNow();
  const dueFriendScenarios = await getFriendScenariosDueForDelivery(db, now);

  let sendCount = 0;
  for (let i = 0; i < dueFriendScenarios.length; i++) {
    if (sendCount >= MAX_SENDS_PER_CRON) break;
    const fs = dueFriendScenarios[i];
    try {
      // Stealth: add small random delay between deliveries to avoid burst patterns
      if (i > 0) {
        await sleep(addJitter(50, 200));
      }
      const sent = await processSingleDelivery(db, lineClient, fs, workerUrl, env);
      if (sent) sendCount++;
    } catch (err) {
      console.error(`Error processing friend_scenario ${fs.id}:`, err);
      // Continue with next one
    }
  }
}

async function processSingleDelivery(
  db: D1Database,
  lineClient: LineClient,
  fs: {
    id: string;
    friend_id: string;
    scenario_id: string;
    current_step_order: number;
    status: string;
    next_delivery_at: string | null;
    started_at: string;
  },
  workerUrl?: string,
  /** Phase 1-G: 暗号化 token を復号するためのキー (LINE_TOKEN_ENC_KEY) を含む env */
  env?: { LINE_TOKEN_ENC_KEY?: string },
): Promise<boolean> {
  // Optimistic lock: claim this delivery (prevents duplicate sends from parallel workers)
  const claimed = await claimFriendScenarioForDelivery(db, fs.id, fs.current_step_order);
  if (!claimed) return false;

  const friend = await getFriendById(db, fs.friend_id);
  if (!friend || !friend.is_following) {
    await completeFriendScenario(db, fs.id);
    return false;
  }

  // Fetch scenario row for delivery_mode (needed by computeNextDeliveryAt below)
  const scenarioRow = await db
    .prepare(`SELECT delivery_mode FROM scenarios WHERE id = ?`)
    .bind(fs.scenario_id)
    .first<{ delivery_mode: DeliveryMode }>();
  if (!scenarioRow) {
    await completeFriendScenario(db, fs.id);
    return false;
  }

  // Get all steps for this scenario
  const steps = await getScenarioSteps(db, fs.scenario_id);
  if (steps.length === 0) {
    await completeFriendScenario(db, fs.id);
    return false;
  }

  // computeNextDeliveryAt は「JST clock-time を UTC として表現する Date」前提
  // (setHours/getDate が JST clock 通りに動くようにオフセット済みの Date)。
  // fs.started_at は "+09:00" 付き ISO で本物の UTC instant として parse されるため、
  // +9h ずらして JST clock-time 表現に揃える必要がある。
  const enrolledAtDate = new Date(new Date(fs.started_at).getTime() + 9 * 60 * 60_000);
  const nowJstDate = new Date(Date.now() + 9 * 60 * 60_000);
  const nextDeliveryFor = (step: { delay_minutes: number; offset_days: number | null; offset_minutes: number | null; delivery_time: string | null }): Date =>
    computeNextDeliveryAt(
      { delivery_mode: scenarioRow.delivery_mode },
      step,
      { enrolledAt: enrolledAtDate, previousDeliveredAt: nowJstDate, now: nowJstDate },
    );

  // Steps are sorted by step_order but may not be contiguous (e.g., 1, 3, 5 after deletions).
  // Find the next step whose step_order > current_step_order.
  const currentStep = steps.find((s) => s.step_order > fs.current_step_order);

  if (!currentStep) {
    await completeFriendScenario(db, fs.id);
    return false;
  }

  // Check step condition before sending
  if (currentStep.condition_type) {
    const conditionMet = await evaluateCondition(db, fs.friend_id, currentStep);
    if (!conditionMet) {
      if (currentStep.next_step_on_false !== null && currentStep.next_step_on_false !== undefined) {
        const jumpStep = steps.find((s) => s.step_order === currentStep.next_step_on_false);
        if (jumpStep) {
          const jitteredDate = jitterDeliveryTime(nextDeliveryFor(jumpStep));
          await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
          return false;
        }
      }
      const nextIndex = steps.indexOf(currentStep) + 1;
      if (nextIndex < steps.length) {
        const nextStep = steps[nextIndex];
        const jitteredDate = jitterDeliveryTime(nextDeliveryFor(nextStep));
        await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
      } else {
        await completeFriendScenario(db, fs.id);
      }
      return false;
    }
  }

  // Resolve template_id → templates table (参照型). template_id 未設定なら step 値そのまま。
  const resolved = await resolveStepContent(db, currentStep);

  // Expand template variables ({{name}}, {{uid}}, {{auth_url:CHANNEL_ID}}, {{metadata.KEY}}, etc.)
  const resolvedMeta = await resolveMetadata(db, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
  const friendWithMeta = { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1];
  const expandedContent = expandVariables(resolved.messageContent, friendWithMeta, workerUrl);
  // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
  let trackedType: string = resolved.messageType;
  let trackedContent = expandedContent;
  if (workerUrl) {
    const tracked = await autoTrackContent(db, resolved.messageType, expandedContent, workerUrl);
    trackedType = tracked.messageType;
    trackedContent = tracked.content;
  }
  const message = buildMessage(trackedType, trackedContent);
  // Resolve the correct LINE client for this friend's account
  let deliveryClient = lineClient;
  const friendAccountId = (friend as unknown as Record<string, string | null>).line_account_id;
  if (friendAccountId) {
    const account = await getLineAccountById(db, friendAccountId);
    if (account) {
      // Phase 1-G: 透過復号
      const token = env ? await resolveAccessToken(env, account.channel_access_token) : account.channel_access_token;
      deliveryClient = new LineClient(token);
    }
  }
  await deliveryClient.pushMessage(friend.line_user_id, [message]);

  // Log what we actually pushed: variables expanded, URLs auto-tracked, AND
  // any cleanEmptyNodes() mutation or parse-failure text fallback applied by
  // buildMessage(). Use scenario_step_id to recover the original template.
  const logId = crypto.randomUUID();
  const logPayload = messageToLogPayload(message);
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, template_id_at_send, created_at)
       VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, 'scenario', ?, ?)`,
    )
    .bind(logId, friend.id, logPayload.messageType, logPayload.content, currentStep.id, resolved.templateIdAtSend, jstNow())
    .run();

  // Determine next step (find the step after currentStep in the sorted list)
  const currentIndex = steps.indexOf(currentStep);
  const nextStep = currentIndex + 1 < steps.length ? steps[currentIndex + 1] : null;

  if (nextStep) {
    const jitteredDate = jitterDeliveryTime(nextDeliveryFor(nextStep));
    await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
  } else {
    // This was the last step
    await completeFriendScenario(db, fs.id);
  }

  // 到達タグ付与 (advance / complete の後 = 再送が起きてもタグ付与は影響しない順序)
  // 失敗してもログに残すだけで配信フローは止めない。
  if (currentStep.on_reach_tag_id) {
    try {
      await addTagToFriend(db, friend.id, currentStep.on_reach_tag_id);
    } catch (err) {
      console.error(`[scenario] tag attach failed step=${currentStep.id}:`, err);
    }
  }
  return true;
}

export const SUPPORTED_CONDITION_TYPES = [
  'tag_exists',
  'tag_not_exists',
  'metadata_equals',
  'metadata_not_equals',
] as const;

export function isSupportedConditionType(value: unknown): value is (typeof SUPPORTED_CONDITION_TYPES)[number] {
  return typeof value === 'string' && (SUPPORTED_CONDITION_TYPES as readonly string[]).includes(value);
}

export async function evaluateCondition(
  db: D1Database,
  friendId: string,
  step: { condition_type: string | null; condition_value: string | null },
): Promise<boolean> {
  if (!step.condition_type) return true;
  if (!isSupportedConditionType(step.condition_type)) {
    console.error(`[scenario] unsupported condition_type: ${step.condition_type}`);
    return false;
  }
  if (!step.condition_value) {
    console.error(`[scenario] missing condition_value for condition_type: ${step.condition_type}`);
    return false;
  }

  try {
    switch (step.condition_type) {
      case 'tag_exists': {
        const tag = await db
          .prepare('SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ?')
          .bind(friendId, step.condition_value)
          .first();
        return !!tag;
      }
      case 'tag_not_exists': {
        const tag = await db
          .prepare('SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ?')
          .bind(friendId, step.condition_value)
          .first();
        return !tag;
      }
      case 'metadata_equals':
      case 'metadata_not_equals': {
        const parsed = JSON.parse(step.condition_value) as { key?: unknown; value?: unknown };
        if (typeof parsed.key !== 'string' || !Object.prototype.hasOwnProperty.call(parsed, 'value')) {
          console.error('[scenario] malformed metadata condition_value');
          return false;
        }
        const friend = await db
          .prepare('SELECT metadata FROM friends WHERE id = ?')
          .bind(friendId)
          .first<{ metadata: string }>();
        let metadata: Record<string, unknown> = {};
        try {
          metadata = JSON.parse(friend?.metadata || '{}') as Record<string, unknown>;
        } catch {
          metadata = {};
        }
        const matches = metadata[parsed.key] === parsed.value;
        return step.condition_type === 'metadata_equals' ? matches : !matches;
      }
    }
  } catch (err) {
    console.error('[scenario] condition evaluation failed', err);
    return false;
  }
}


/** Remove empty text nodes and boxes with empty text from Flex JSON */
function cleanEmptyNodes(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const node = obj as Record<string, unknown>;
  for (const key of ['header', 'body', 'footer']) {
    if (node[key]) cleanEmptyNodes(node[key]);
  }
  if (Array.isArray(node.contents)) {
    // First clean children recursively
    for (const c of node.contents as unknown[]) cleanEmptyNodes(c);
    // Then filter out empty nodes
    node.contents = (node.contents as unknown[]).filter((c) => {
      if (!c || typeof c !== 'object') return true;
      const child = c as Record<string, unknown>;
      // Remove empty text nodes
      if (child.type === 'text') {
        const text = child.text;
        return typeof text === 'string' && text.trim().length > 0;
      }
      // Remove box nodes where any text child is empty (metadata rows with no value)
      if (child.type === 'box' && Array.isArray(child.contents)) {
        const texts = (child.contents as Array<Record<string, unknown>>).filter(t => t.type === 'text');
        if (texts.length >= 2) {
          // horizontal box with label + value — remove if value is empty
          const hasEmptyText = texts.some(t => typeof t.text === 'string' && t.text.trim() === '');
          if (hasEmptyText) return false;
        }
      }
      return true;
    });
  }
}

/**
 * Derive (messageType, content) from a built `Message` object so that what
 * lands in messages_log mirrors what was actually pushed to LINE — including
 * cleanEmptyNodes() mutations and any parse-failure text fallback inside
 * buildMessage(). Use this whenever you log a message you just pushed.
 */
export function messageToLogPayload(message: Message): { messageType: string; content: string } {
  if (message.type === 'text') return { messageType: 'text', content: message.text };
  if (message.type === 'flex') return { messageType: 'flex', content: JSON.stringify(message.contents) };
  if (message.type === 'image') {
    return {
      messageType: 'image',
      content: JSON.stringify({
        originalContentUrl: message.originalContentUrl,
        previewImageUrl: message.previewImageUrl,
      }),
    };
  }
  return { messageType: message.type, content: JSON.stringify(message) };
}

export function buildMessage(messageType: string, messageContent: string, altText?: string): Message {
  if (messageType === 'text') {
    return { type: 'text', text: messageContent };
  }

  if (messageType === 'image') {
    // messageContent is expected to be JSON: { originalContentUrl, previewImageUrl }
    try {
      const parsed = JSON.parse(messageContent) as {
        originalContentUrl: string;
        previewImageUrl: string;
      };
      return {
        type: 'image',
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl: parsed.previewImageUrl,
      };
    } catch {
      // Fallback: treat as text if parsing fails
      return { type: 'text', text: messageContent };
    }
  }

  if (messageType === 'flex') {
    try {
      const contents = JSON.parse(messageContent);
      // Remove empty text nodes (from {{#if_ref}} conditional blocks)
      cleanEmptyNodes(contents);
      // Extract first text element for altText (shown in notifications)
      return { type: 'flex', altText: altText || extractFlexAltText(contents), contents };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  // Fallback
  return { type: 'text', text: messageContent };
}
