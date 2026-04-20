import { extractFlexAltText } from "../utils/flex-alt-text.js";
import {
  getFriendScenariosDueForDelivery,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  getFriendById,
  jstNow,
} from "@line-crm/db";
import type { LineClient } from "@line-crm/line-sdk";
import type { Message } from "@line-crm/line-sdk";
import { jitterDeliveryTime, addJitter, sleep } from "./stealth.js";

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
  friend: {
    id: string;
    display_name: string | null;
    user_id: string | null;
    ref_code?: string | null;
    metadata?: Record<string, unknown> | string | null;
  },
  apiOrigin?: string,
): string {
  let result = content;
  result = result.replace(/\{\{name\}\}/g, friend.display_name || "");
  result = result.replace(/\{\{uid\}\}/g, friend.user_id || "");
  result = result.replace(/\{\{friend_id\}\}/g, friend.id);
  result = result.replace(/\{\{ref\}\}/g, friend.ref_code || "");
  // Conditional block: {{#if_ref}}...{{/if_ref}} — only shown if ref_code exists
  if (friend.ref_code) {
    result = result.replace(/\{\{#if_ref\}\}([\s\S]*?)\{\{\/if_ref\}\}/g, "$1");
  } else {
    result = result.replace(/\{\{#if_ref\}\}[\s\S]*?\{\{\/if_ref\}\}/g, "");
  }
  // Metadata variables: {{metadata.KEY}} → value from friend's metadata
  const meta = friend.metadata
    ? typeof friend.metadata === "string"
      ? (JSON.parse(friend.metadata) as Record<string, unknown>)
      : friend.metadata
    : {};
  // Conditional block: {{#if_metadata.KEY}}...{{/if_metadata.KEY}} — only shown if metadata key has a value
  // When inside JSON arrays, removes the element and fixes trailing/leading commas
  result = result.replace(
    /\{\{#if_metadata\.([^}]+)\}\}([\s\S]*?)\{\{\/if_metadata\.\1\}\}/g,
    (_match, key, inner) => {
      const val = meta[key];
      if (val == null || val === "") return "";
      return inner;
    },
  );
  // Clean up broken JSON commas from removed conditional blocks (e.g. ",," or "[," or ",]")
  result = result.replace(/,\s*,/g, ",");
  result = result.replace(/\[\s*,/g, "[");
  result = result.replace(/,\s*\]/g, "]");
  result = result.replace(/\{\{metadata\.([^}]+)\}\}/g, (_match, key) => {
    // ネストキー対応: metadata.ai_profile.interests → meta["ai_profile"]["interests"]
    const parts = key.split(".");
    let val: unknown = meta;
    for (const part of parts) {
      if (val == null || typeof val !== "object") {
        val = null;
        break;
      }
      val = (val as Record<string, unknown>)[part];
    }
    if (val == null) return "";
    return Array.isArray(val) ? val.join("、") : String(val);
  });
  if (apiOrigin) {
    result = result.replace(
      /\{\{auth_url:([^}]+)\}\}/g,
      (_match, channelId) => {
        const params = new URLSearchParams({
          account: channelId,
          ref: "cross-link",
        });
        if (friend.user_id) params.set("uid", friend.user_id);
        return `${apiOrigin}/auth/line?${params.toString()}`;
      },
    );
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
    const { getMergedMetadataByUserId } = await import("@line-crm/db");
    return getMergedMetadataByUserId(db, friend.user_id);
  }
  // Fallback: parse own metadata
  if (friend.metadata) {
    try {
      return JSON.parse(friend.metadata);
    } catch {
      return {};
    }
  }
  return {};
}

/** Default delivery window: 9:00-23:00 JST. If outside, push to next 9:00 AM. */
const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 23;

function enforceDeliveryWindow(date: Date, preferredHour?: number): Date {
  // date is already shifted to JST epoch (+9h)
  const hours = date.getUTCHours();
  const startHour = preferredHour ?? DEFAULT_START_HOUR;
  const endHour = DEFAULT_END_HOUR;

  if (hours >= startHour && hours < endHour) return date;

  // Outside window: push to next preferred start hour
  const result = new Date(date);
  if (hours >= endHour) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  result.setUTCHours(startHour, 0, 0, 0);
  return result;
}

export async function processStepDeliveries(
  db: D1Database,
  lineClient: LineClient,
  workerUrl?: string,
): Promise<void> {
  // Skip delivery outside 9:00-23:00 JST window
  const jstHour = new Date(Date.now() + 9 * 60 * 60_000).getUTCHours();
  if (jstHour < DEFAULT_START_HOUR || jstHour >= DEFAULT_END_HOUR) return;

  const now = jstNow();
  const dueFriendScenarios = await getFriendScenariosDueForDelivery(db, now);

  for (let i = 0; i < dueFriendScenarios.length; i++) {
    const fs = dueFriendScenarios[i];
    try {
      // Stealth: add small random delay between deliveries to avoid burst patterns
      if (i > 0) {
        await sleep(addJitter(50, 200));
      }
      await processSingleDelivery(db, lineClient, fs, workerUrl);
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
  },
  workerUrl?: string,
): Promise<void> {
  // Get friend first to read preferred delivery hour from metadata
  const friend = await getFriendById(db, fs.friend_id);
  if (!friend || !friend.is_following) {
    await completeFriendScenario(db, fs.id);
    return;
  }
  const metadata = JSON.parse(
    (friend as { metadata?: string }).metadata || "{}",
  ) as Record<string, unknown>;
  const preferredHour =
    typeof metadata.preferred_hour === "number"
      ? metadata.preferred_hour
      : undefined;

  // Get all steps for this scenario
  const steps = await getScenarioSteps(db, fs.scenario_id);
  if (steps.length === 0) {
    await completeFriendScenario(db, fs.id);
    return;
  }

  // Steps are sorted by step_order but may not be contiguous (e.g., 1, 3, 5 after deletions).
  // Find the next step whose step_order > current_step_order.
  const currentStep = steps.find((s) => s.step_order > fs.current_step_order);

  if (!currentStep) {
    await completeFriendScenario(db, fs.id);
    return;
  }

  // Check step condition before sending
  if (currentStep.condition_type) {
    const conditionMet = await evaluateCondition(db, fs.friend_id, currentStep);
    if (!conditionMet) {
      if (
        currentStep.next_step_on_false !== null &&
        currentStep.next_step_on_false !== undefined
      ) {
        const jumpStep = steps.find(
          (s) => s.step_order === currentStep.next_step_on_false,
        );
        if (jumpStep) {
          const nextDate = new Date(Date.now() + 9 * 60 * 60_000);
          nextDate.setMinutes(nextDate.getMinutes() + jumpStep.delay_minutes);
          const windowedDate = enforceDeliveryWindow(nextDate, preferredHour);
          const jitteredDate = jitterDeliveryTime(windowedDate);
          await advanceFriendScenario(
            db,
            fs.id,
            currentStep.step_order,
            jitteredDate.toISOString().slice(0, -1) + "+09:00",
          );
          return;
        }
      }
      const nextIndex = steps.indexOf(currentStep) + 1;
      if (nextIndex < steps.length) {
        const nextStep = steps[nextIndex];
        const nextDate = new Date(Date.now() + 9 * 60 * 60_000);
        nextDate.setMinutes(nextDate.getMinutes() + nextStep.delay_minutes);
        const windowedDate = enforceDeliveryWindow(nextDate, preferredHour);
        const jitteredDate = jitterDeliveryTime(windowedDate);
        await advanceFriendScenario(
          db,
          fs.id,
          currentStep.step_order,
          jitteredDate.toISOString().slice(0, -1) + "+09:00",
        );
      } else {
        await completeFriendScenario(db, fs.id);
      }
      return;
    }
  }

  // Expand template variables ({{name}}, {{uid}}, {{auth_url:CHANNEL_ID}}, {{metadata.KEY}}, etc.)
  const resolvedMeta = await resolveMetadata(db, {
    user_id: (friend as unknown as Record<string, string | null>).user_id,
    metadata: (friend as unknown as Record<string, string | null>).metadata,
  });
  const friendWithMeta = { ...friend, metadata: resolvedMeta } as Parameters<
    typeof expandVariables
  >[1];
  const expandedContent = expandVariables(
    currentStep.message_content,
    friendWithMeta,
    workerUrl,
  );
  // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
  let trackedType: string = currentStep.message_type;
  let trackedContent = expandedContent;
  if (workerUrl) {
    const { autoTrackContent } = await import("./auto-track.js");
    const tracked = await autoTrackContent(
      db,
      currentStep.message_type,
      expandedContent,
      workerUrl,
    );
    trackedType = tracked.messageType;
    trackedContent = tracked.content;
  }
  const message = buildMessage(trackedType, trackedContent);
  // Resolve the correct LINE client for this friend's account
  let deliveryClient = lineClient;
  const friendAccountId = (friend as unknown as Record<string, string | null>)
    .line_account_id;
  if (friendAccountId) {
    const { getLineAccountById } = await import("@line-crm/db");
    const account = await getLineAccountById(db, friendAccountId);
    if (account) {
      const { LineClient: LC } = await import("@line-crm/line-sdk");
      deliveryClient = new LC(account.channel_access_token);
    }
  }
  await deliveryClient.pushMessage(friend.line_user_id, [message]);

  // Log outgoing message
  const logId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
       VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, ?)`,
    )
    .bind(
      logId,
      friend.id,
      currentStep.message_type,
      currentStep.message_content,
      currentStep.id,
      jstNow(),
    )
    .run();

  // Determine next step (find the step after currentStep in the sorted list)
  const currentIndex = steps.indexOf(currentStep);
  const nextStep =
    currentIndex + 1 < steps.length ? steps[currentIndex + 1] : null;

  if (nextStep) {
    // Schedule next delivery with stealth jitter + delivery window enforcement
    const nextDeliveryDate = new Date(Date.now() + 9 * 60 * 60_000);
    nextDeliveryDate.setMinutes(
      nextDeliveryDate.getMinutes() + nextStep.delay_minutes,
    );
    const windowedDate = enforceDeliveryWindow(nextDeliveryDate, preferredHour);
    const jitteredDate = jitterDeliveryTime(windowedDate);
    await advanceFriendScenario(
      db,
      fs.id,
      currentStep.step_order,
      jitteredDate.toISOString().slice(0, -1) + "+09:00",
    );
  } else {
    // This was the last step
    await completeFriendScenario(db, fs.id);
  }
}

async function evaluateCondition(
  db: D1Database,
  friendId: string,
  step: { condition_type: string | null; condition_value: string | null },
): Promise<boolean> {
  if (!step.condition_type || !step.condition_value) return true;

  switch (step.condition_type) {
    case "tag_exists": {
      const tag = await db
        .prepare("SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ?")
        .bind(friendId, step.condition_value)
        .first();
      return !!tag;
    }
    case "tag_not_exists": {
      const tag = await db
        .prepare("SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ?")
        .bind(friendId, step.condition_value)
        .first();
      return !tag;
    }
    case "metadata_equals": {
      const { key, value } = JSON.parse(step.condition_value) as {
        key: string;
        value: unknown;
      };
      const friend = await db
        .prepare("SELECT metadata FROM friends WHERE id = ?")
        .bind(friendId)
        .first<{ metadata: string }>();
      const metadata = JSON.parse(friend?.metadata || "{}") as Record<
        string,
        unknown
      >;
      return metadata[key] === value;
    }
    case "metadata_not_equals": {
      const { key, value } = JSON.parse(step.condition_value) as {
        key: string;
        value: unknown;
      };
      const friend = await db
        .prepare("SELECT metadata FROM friends WHERE id = ?")
        .bind(friendId)
        .first<{ metadata: string }>();
      const metadata = JSON.parse(friend?.metadata || "{}") as Record<
        string,
        unknown
      >;
      return metadata[key] !== value;
    }
    default:
      return true;
  }
}

/** Remove empty text nodes and boxes with empty text from Flex JSON */
function cleanEmptyNodes(obj: unknown): void {
  if (!obj || typeof obj !== "object") return;
  const node = obj as Record<string, unknown>;
  for (const key of ["header", "body", "footer"]) {
    if (node[key]) cleanEmptyNodes(node[key]);
  }
  if (Array.isArray(node.contents)) {
    // First clean children recursively
    for (const c of node.contents as unknown[]) cleanEmptyNodes(c);
    // Then filter out empty nodes
    node.contents = (node.contents as unknown[]).filter((c) => {
      if (!c || typeof c !== "object") return true;
      const child = c as Record<string, unknown>;
      // Remove empty text nodes
      if (child.type === "text") {
        const text = child.text;
        return typeof text === "string" && text.trim().length > 0;
      }
      // Remove box nodes where any text child is empty (metadata rows with no value)
      if (child.type === "box" && Array.isArray(child.contents)) {
        const texts = (child.contents as Array<Record<string, unknown>>).filter(
          (t) => t.type === "text",
        );
        if (texts.length >= 2) {
          // horizontal box with label + value — remove if value is empty
          const hasEmptyText = texts.some(
            (t) => typeof t.text === "string" && t.text.trim() === "",
          );
          if (hasEmptyText) return false;
        }
      }
      return true;
    });
  }
}

export function buildMessage(
  messageType: string,
  messageContent: string,
  altText?: string,
): Message {
  if (messageType === "text") {
    return { type: "text", text: messageContent };
  }

  if (messageType === "image") {
    // messageContent is expected to be JSON: { originalContentUrl, previewImageUrl }
    try {
      const parsed = JSON.parse(messageContent) as {
        originalContentUrl: string;
        previewImageUrl: string;
      };
      return {
        type: "image",
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl: parsed.previewImageUrl,
      };
    } catch {
      // Fallback: treat as text if parsing fails
      return { type: "text", text: messageContent };
    }
  }

  if (messageType === "flex") {
    try {
      const contents = JSON.parse(messageContent);
      // Remove empty text nodes (from {{#if_ref}} conditional blocks)
      cleanEmptyNodes(contents);
      // Extract first text element for altText (shown in notifications)
      return {
        type: "flex",
        altText: altText || extractFlexAltText(contents),
        contents,
      };
    } catch {
      return { type: "text", text: messageContent };
    }
  }

  // Fallback
  return { type: "text", text: messageContent };
}
