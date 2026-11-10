import type { Context } from 'hono';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  releaseIdempotencyKey,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { createBroadcastRetryKey } from './broadcast-retry-key.js';
import { bodyDigest } from './harness-gate-protocol.js';

// Optional Idempotency-Key support for API routes that external integrations
// (payment webhooks, plugins) retry. Requests WITHOUT the header run the
// handler directly: no table is read and nothing changes.
//
// The key and a hash of the request are claimed BEFORE the handler runs
// (same approach as Stripe's idempotent requests).
//
//   stored row \ incoming request | same request                | different request
//   ------------------------------+-----------------------------+------------------
//   none                          | claim, run handler          | claim, run handler
//   processing, lease live        | 409 (in progress)           | 422
//   processing, lease expired     | re-claim, run handler again | 422
//   completed                     | replay the stored response  | 422
//
//   handler result             | row afterwards
//   ---------------------------+--------------------------------------------
//   2xx                        | completed, response stored
//   4xx on the first attempt   | deleted (rejected before side effects; the
//                              | key is not consumed)
//   4xx on a re-claimed attempt| processing, lease ended (an earlier attempt
//                              | may have had side effects: stay bound)
//   5xx / throw                | processing, lease ended (same request may
//                              | retry at once)
//
// Each claim has its own token; an attempt that outlived its lease cannot
// complete, fail or release the claim of the attempt that replaced it.
//
// Limits (by design, stated in the API docs):
//   - A retry after a 5xx / crash runs the handler again, so the handler's
//     own side effects must tolerate a re-run (at-least-once on failure).
//   - "completed" means the handler returned 2xx. Failures that the event bus
//     handles internally (a failed automation action, a webhook non-2xx) are
//     logged as before and are not retried by resending the request.

/** Longer than any request can run; a crashed attempt becomes retryable after this. */
const IDEMPOTENCY_LEASE_MS = 5 * 60_000;

/** One claimed (scope, key): what a handler needs to make its own writes repeat-safe. */
export interface IdempotentOperation {
  /** Stable name of this operation (`<scope>:<key>`), e.g. for the event bus. */
  operationId: string;
  /** Stable UUID for a row this operation writes, so a re-run cannot insert it twice. */
  deriveId(...parts: string[]): Promise<string>;
}

/** Stable UUID for one effect of an idempotent operation. */
export function deriveIdempotentId(operationId: string, ...parts: string[]): Promise<string> {
  return createBroadcastRetryKey('idempotent', operationId, ...parts);
}

/**
 * @param scope   namespace of the key (e.g. `friend-tag:<friendId>`)
 * @param request every input that changes what the handler does, with
 *                defaults already applied (compared across retries)
 * @param run     the handler; receives the operation when a key was sent
 * @param options keyRequired: reject the request (400, with this message)
 *                when no key was sent, instead of running it unkeyed
 */
export async function runIdempotent(
  c: Context<Env>,
  scope: string,
  request: unknown,
  run: (operation: IdempotentOperation | undefined) => Promise<Response>,
  options?: { keyRequired?: string },
): Promise<Response> {
  const key = c.req.header('Idempotency-Key');
  if (key === undefined) {
    if (options?.keyRequired) return c.json({ success: false, error: options.keyRequired }, 400);
    return run(undefined);
  }
  if (key.length === 0 || key.length > 255) {
    return c.json({ success: false, error: 'Idempotency-Key must be 1-255 characters' }, 400);
  }

  const db = c.env.DB;
  const claim = await claimIdempotencyKey(db, {
    scope,
    key,
    requestHash: await bodyDigest(JSON.stringify(request)),
    now: Date.now(),
    leaseMs: IDEMPOTENCY_LEASE_MS,
  });
  if (claim.state === 'mismatch') {
    return c.json({ success: false, error: 'Idempotency-Key was already used for a different request' }, 422);
  }
  if (claim.state === 'in_progress') {
    c.header('Retry-After', '5');
    return c.json({ success: false, error: 'A request with this Idempotency-Key is still in progress' }, 409);
  }
  if (claim.state === 'completed') {
    return new Response(claim.body, {
      status: claim.status,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Replayed': 'true' },
    });
  }

  let response: Response;
  try {
    const operationId = `${scope}:${key}`;
    response = await run({ operationId, deriveId: (...parts) => deriveIdempotentId(operationId, ...parts) });
  } catch (err) {
    await failIdempotencyKey(db, scope, key, claim.token);
    throw err;
  }
  if (response.status >= 500 || (response.status >= 400 && !claim.fresh)) {
    await failIdempotencyKey(db, scope, key, claim.token);
  } else if (response.status >= 400) {
    await releaseIdempotencyKey(db, scope, key, claim.token);
  } else {
    await completeIdempotencyKey(db, scope, key, claim.token, {
      status: response.status, body: await response.clone().text(),
    });
  }
  return response;
}
