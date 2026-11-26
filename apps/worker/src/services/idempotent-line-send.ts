import { claimLineSend, completeLineSend, failLineSend, LINE_RETRY_WINDOW_MS } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';

export class LineSendPendingError extends Error {
  constructor(public readonly code: 'line_send_in_progress' | 'line_delivery_requires_review') {
    super(code === 'line_delivery_requires_review'
      ? 'LINE delivery requires manual review: the result is unknown and the 24-hour retry window has expired'
      : 'The LINE send is still in progress; it cannot be reclaimed by an API lease');
  }
}

interface StoredSend {
  accountId: string | null;
  to: string;
  messages: Message[];
}

/** Keyed pushes only. Persisted state serializes overlapping API lease owners. */
export async function runIdempotentLineSend(
  db: D1Database,
  input: StoredSend & { id: string; retryKey: string; accessToken: string },
  log: (messages: Message[]) => Promise<void>,
): Promise<void> {
  const claim = await claimLineSend(db, input.id, JSON.stringify({
    accountId: input.accountId, to: input.to, messages: input.messages,
  }), Date.now());
  if (claim.state === 'completed') return;
  if (claim.state !== 'claimed') {
    throw new LineSendPendingError(claim.state === 'requires_review'
      ? 'line_delivery_requires_review' : 'line_send_in_progress');
  }
  try {
    const stored = JSON.parse(claim.requestBody) as StoredSend;
    // Never send a frozen request using a different account's credentials.
    if (stored.accountId !== input.accountId || stored.to !== input.to) {
      throw new Error('The recipient or LINE account changed; manual review is required');
    }
    // A slow durable claim must not let a retry start outside LINE's window.
    if (Date.now() - claim.firstStartedAt >= LINE_RETRY_WINDOW_MS) {
      throw new LineSendPendingError('line_delivery_requires_review');
    }
    await new LineClient(input.accessToken).pushMessage(stored.to, stored.messages, input.retryKey);
    await log(stored.messages);
    await completeLineSend(db, input.id, claim.token);
  } catch (err) {
    await failLineSend(db, input.id, claim.token);
    throw err;
  }
}
