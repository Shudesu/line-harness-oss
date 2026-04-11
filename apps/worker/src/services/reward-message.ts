import type { MessageTemplate } from '@line-crm/db';

/**
 * LINE Messaging API message shape we send via push.
 * Subset to keep this module decoupled from the SDK.
 */
export type RewardMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: unknown };

/**
 * Build the reward push message sent to a friend after they submit the
 * campaign form and pass verify. If a tracked-link has a reward_template_id
 * configured, that template is used (with placeholder substitution).
 *
 * Returns null if no template was provided — caller falls back to whatever
 * default behaviour applied before this feature (e.g. form.on_submit_message
 * or the default diagnostic Flex).
 *
 * Substitution: any occurrence of `{displayName}` is replaced with the
 * friend's display name. Other placeholders can be added later if needed.
 */
export function buildRewardMessage(
  template: MessageTemplate | null,
  friendDisplayName: string | null,
): RewardMessage | null {
  if (!template) return null;

  const safeDisplay = friendDisplayName ?? '';

  if (template.message_type === 'text') {
    // Plain text — direct substitution is safe.
    return {
      type: 'text',
      text: template.message_content.replaceAll('{displayName}', safeDisplay),
    };
  }

  // flex — guard against malformed JSON (same defensive pattern as intro-message)
  // Important: JSON-escape the display name BEFORE substituting into the
  // stringified flex JSON. A raw display name containing `"`, `\`, or newlines
  // would otherwise corrupt the JSON and make JSON.parse throw, dropping the
  // user's reward silently.
  // JSON.stringify yields a quoted JSON string literal — slice off the
  // surrounding quotes so we substitute just the escaped contents.
  const jsonEscaped = JSON.stringify(safeDisplay).slice(1, -1);
  const replaced = template.message_content.replaceAll('{displayName}', jsonEscaped);
  try {
    return {
      type: 'flex',
      altText: template.name,
      contents: JSON.parse(replaced),
    };
  } catch {
    return null;
  }
}
