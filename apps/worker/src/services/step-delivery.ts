import {
  getFriendScenariosDueForDelivery,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  getFriendById,
  jstNow,
} from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { jitterDeliveryTime, addJitter, sleep } from './stealth.js';

export async function processStepDeliveries(
  db: D1Database,
  lineClient: LineClient,
): Promise<void> {
  const now = jstNow();
  const dueFriendScenarios = await getFriendScenariosDueForDelivery(db, now);

  for (let i = 0; i < dueFriendScenarios.length; i++) {
    const fs = dueFriendScenarios[i];
    try {
      // Stealth: add small random delay between deliveries to avoid burst patterns
      if (i > 0) {
        await sleep(addJitter(50, 200));
      }
      await processSingleDelivery(db, lineClient, fs);
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
): Promise<void> {
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
    // No more steps — scenario is complete
    await completeFriendScenario(db, fs.id);
    return;
  }

  // Check step condition before sending
  if (currentStep.condition_type) {
    const conditionMet = await evaluateCondition(db, fs.friend_id, currentStep);
    if (!conditionMet) {
      if (currentStep.next_step_on_false !== null && currentStep.next_step_on_false !== undefined) {
        // Jump to the specified step_order on failure
        const jumpStep = steps.find((s) => s.step_order === currentStep.next_step_on_false);
        if (jumpStep) {
          const nextDate = new Date(Date.now() + 9 * 60 * 60_000);
          nextDate.setMinutes(nextDate.getMinutes() + jumpStep.delay_minutes);
          const jitteredDate = jitterDeliveryTime(nextDate);
          await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
          return;
        }
      }
      // No jump target — skip this step and advance to next sequential
      const nextIndex = steps.indexOf(currentStep) + 1;
      if (nextIndex < steps.length) {
        const nextStep = steps[nextIndex];
        const nextDate = new Date(Date.now() + 9 * 60 * 60_000);
        nextDate.setMinutes(nextDate.getMinutes() + nextStep.delay_minutes);
        const jitteredDate = jitterDeliveryTime(nextDate);
        await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
      } else {
        await completeFriendScenario(db, fs.id);
      }
      return;
    }
  }

  // Get friend's LINE user ID
  const friend = await getFriendById(db, fs.friend_id);
  if (!friend || !friend.is_following) {
    // Friend unfollowed or not found — complete the scenario
    await completeFriendScenario(db, fs.id);
    return;
  }

  // Build and send the message
  const message = buildMessage(currentStep.message_type, currentStep.message_content);
  await lineClient.pushMessage(friend.line_user_id, [message]);

  // Log outgoing message
  const logId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
       VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, ?)`,
    )
    .bind(logId, friend.id, currentStep.message_type, currentStep.message_content, currentStep.id, jstNow())
    .run();

  // Determine next step (find the step after currentStep in the sorted list)
  const currentIndex = steps.indexOf(currentStep);
  const nextStep = currentIndex + 1 < steps.length ? steps[currentIndex + 1] : null;

  if (nextStep) {
    // Schedule next delivery with stealth jitter
    const nextDeliveryDate = new Date(Date.now() + 9 * 60 * 60_000);
    nextDeliveryDate.setMinutes(nextDeliveryDate.getMinutes() + nextStep.delay_minutes);
    const jitteredDate = jitterDeliveryTime(nextDeliveryDate);
    await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
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
    case 'metadata_equals': {
      const { key, value } = JSON.parse(step.condition_value) as { key: string; value: unknown };
      const friend = await db
        .prepare('SELECT metadata FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ metadata: string }>();
      const metadata = JSON.parse(friend?.metadata || '{}') as Record<string, unknown>;
      return metadata[key] === value;
    }
    case 'metadata_not_equals': {
      const { key, value } = JSON.parse(step.condition_value) as { key: string; value: unknown };
      const friend = await db
        .prepare('SELECT metadata FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ metadata: string }>();
      const metadata = JSON.parse(friend?.metadata || '{}') as Record<string, unknown>;
      return metadata[key] !== value;
    }
    default:
      return true;
  }
}

export function buildMessage(messageType: string, messageContent: string): Message {
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
      return { type: 'flex', altText: 'Message', contents };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  // Fallback
  return { type: 'text', text: messageContent };
}
