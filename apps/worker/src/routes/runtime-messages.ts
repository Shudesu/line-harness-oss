import { Hono } from 'hono';
import { LineClient, type LineProviderReceipt, type Message } from '@line-crm/line-sdk';
import { BUNDLE_VERSION, WORKER_HASH } from '../_version.js';
import type { Env } from '../index.js';

type DispatchState =
  | 'dispatching'
  | 'provider_accepted'
  | 'failed_terminal'
  | 'reconciliation_required';

type DispatchRow = {
  client_request_id: string;
  request_hash: string;
  conversation_ref: string;
  account_scope_fingerprint: string;
  status: DispatchState;
  release_version: string;
  worker_hash: string;
  provider_http_status: number | null;
  provider_request_id: string | null;
  accepted_request_id: string | null;
  provider_message_ids: string | null;
  receipt_hash: string | null;
  dispatch_started_at: string | null;
  provider_accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

type RecipientRow = {
  chat_id: string;
  friend_id: string;
  line_user_id: string;
  line_account_id: string | null;
  account_channel_id: string | null;
  channel_access_token: string | null;
};

type RuntimeSendRequest = {
  schemaVersion: 1;
  clientRequestId: string;
  requestHash: string;
  accountScopeFingerprint: string;
  conversationRef: string;
  messages: Array<{ type: 'text'; text: string }>;
  release: {
    version: string;
    workerHash: string;
  };
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function validRequest(value: unknown): value is RuntimeSendRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Partial<RuntimeSendRequest>;
  if (
    body.schemaVersion !== 1
    || typeof body.clientRequestId !== 'string'
    || !UUID_PATTERN.test(body.clientRequestId)
    || typeof body.requestHash !== 'string'
    || !SHA256_PATTERN.test(body.requestHash)
    || typeof body.accountScopeFingerprint !== 'string'
    || !SHA256_PATTERN.test(body.accountScopeFingerprint)
    || typeof body.conversationRef !== 'string'
    || body.conversationRef.length < 1
    || body.conversationRef.length > 128
    || !body.release
    || typeof body.release.version !== 'string'
    || typeof body.release.workerHash !== 'string'
    || !Array.isArray(body.messages)
    || body.messages.length < 1
    || body.messages.length > 5
  ) return false;

  return body.messages.every((message) => (
    message
    && typeof message === 'object'
    && !Array.isArray(message)
    && message.type === 'text'
    && typeof message.text === 'string'
    && message.text.length >= 1
    && message.text.length <= 5000
    && Object.keys(message).every((key) => key === 'type' || key === 'text')
  ));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

async function canonicalRequestHash(input: RuntimeSendRequest): Promise<string> {
  return sha256(JSON.stringify({
    schemaVersion: 1,
    accountScopeFingerprint: input.accountScopeFingerprint,
    conversationRef: input.conversationRef,
    messages: input.messages,
  }));
}

function parseProviderMessageIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function receiptProjection(row: DispatchRow, replayed: boolean) {
  return {
    schemaVersion: 1,
    clientRequestId: row.client_request_id,
    requestHash: row.request_hash,
    state: row.status,
    release: {
      version: row.release_version,
      workerHash: row.worker_hash,
    },
    accountScopeFingerprint: row.account_scope_fingerprint,
    httpStatus: row.provider_http_status,
    providerRequestId: row.provider_request_id,
    acceptedRequestId: row.accepted_request_id,
    providerMessageIds: parseProviderMessageIds(row.provider_message_ids),
    receiptHash: row.receipt_hash,
    dispatchStartedAt: row.dispatch_started_at,
    providerAcceptedAt: row.provider_accepted_at,
    replayed,
  };
}

async function readDispatch(db: D1Database, clientRequestId: string) {
  return db.prepare(
    `SELECT client_request_id, request_hash, conversation_ref,
            account_scope_fingerprint, status, release_version, worker_hash,
            provider_http_status, provider_request_id, accepted_request_id,
            provider_message_ids, receipt_hash, dispatch_started_at,
            provider_accepted_at, created_at, updated_at
       FROM provider_message_dispatches
      WHERE client_request_id = ?`,
  ).bind(clientRequestId).first<DispatchRow>();
}

async function resolveRecipient(db: D1Database, conversationRef: string) {
  return db.prepare(
    `SELECT c.id AS chat_id, f.id AS friend_id, f.line_user_id,
            f.line_account_id, la.channel_id AS account_channel_id,
            la.channel_access_token
       FROM chats c
       JOIN friends f ON f.id = c.friend_id
       LEFT JOIN line_accounts la ON la.id = f.line_account_id
      WHERE c.id = ?
      LIMIT 1`,
  ).bind(conversationRef).first<RecipientRow>();
}

async function buildReceiptHash(
  input: RuntimeSendRequest,
  receipt: LineProviderReceipt,
  accountScopeFingerprint: string,
): Promise<string> {
  return sha256(JSON.stringify({
    schemaVersion: 1,
    clientRequestId: input.clientRequestId,
    requestHash: input.requestHash,
    accountScopeFingerprint,
    releaseVersion: BUNDLE_VERSION,
    workerHash: WORKER_HASH,
    httpStatus: receipt.httpStatus,
    providerRequestId: receipt.providerRequestId,
    acceptedRequestId: receipt.acceptedRequestId,
    providerMessageIds: receipt.providerMessageIds,
  }));
}

export const runtimeMessages = new Hono<Env>();

runtimeMessages.post('/api/runtime/messages:send', async (c) => {
  if (c.get('staff')?.role !== 'owner') {
    return c.json({ success: false, error: 'Owner access required' }, 403);
  }

  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    return c.json({ success: false, error: 'Request body too large' }, 413);
  }

  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }
  if (!validRequest(input)) {
    return c.json({ success: false, error: 'Invalid runtime send request' }, 400);
  }
  if (
    input.release.version !== BUNDLE_VERSION
    || input.release.workerHash !== WORKER_HASH
  ) {
    return c.json({ success: false, error: 'Release identity mismatch' }, 409);
  }
  if (input.requestHash !== await canonicalRequestHash(input)) {
    return c.json({ success: false, error: 'Request hash mismatch' }, 409);
  }

  const existing = await readDispatch(c.env.DB, input.clientRequestId);
  if (existing) {
    if (existing.request_hash !== input.requestHash) {
      return c.json({ success: false, error: 'Request hash conflict' }, 409);
    }
    if (existing.status === 'provider_accepted') {
      return c.json({ success: true, data: receiptProjection(existing, true) });
    }
    return c.json({
      success: false,
      error: 'Dispatch requires readback reconciliation',
      data: receiptProjection(existing, true),
    }, 409);
  }

  const recipient = await resolveRecipient(c.env.DB, input.conversationRef);
  if (!recipient) {
    return c.json({ success: false, error: 'Conversation not found' }, 404);
  }
  const accountScopeFingerprint = await sha256(
    recipient.account_channel_id ?? c.env.LINE_CHANNEL_ID,
  );
  if (accountScopeFingerprint !== input.accountScopeFingerprint) {
    return c.json({ success: false, error: 'Account scope mismatch' }, 409);
  }

  const now = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      `INSERT INTO provider_message_dispatches (
         id, client_request_id, request_hash, conversation_ref, friend_id,
         account_scope_fingerprint, status, release_version, worker_hash,
         dispatch_started_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'dispatching', ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.clientRequestId,
      input.requestHash,
      input.conversationRef,
      recipient.friend_id,
      accountScopeFingerprint,
      BUNDLE_VERSION,
      WORKER_HASH,
      now,
      now,
      now,
    ).run();
  } catch {
    const concurrent = await readDispatch(c.env.DB, input.clientRequestId);
    if (!concurrent || concurrent.request_hash !== input.requestHash) {
      return c.json({ success: false, error: 'Request claim conflict' }, 409);
    }
    if (concurrent.status === 'provider_accepted') {
      return c.json({ success: true, data: receiptProjection(concurrent, true) });
    }
    return c.json({
      success: false,
      error: 'Dispatch is already in progress; automatic resend is disabled',
      data: receiptProjection(concurrent, true),
    }, 409);
  }

  let receipt: LineProviderReceipt;
  let receiptHash: string;
  try {
    const accessToken = recipient.channel_access_token ?? c.env.LINE_CHANNEL_ACCESS_TOKEN;
    receipt = await new LineClient(accessToken).pushMessageWithReceipt(
      recipient.line_user_id,
      input.messages as Message[],
      input.clientRequestId,
    );
    receiptHash = await buildReceiptHash(input, receipt, accountScopeFingerprint);
    const acceptedAt = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE provider_message_dispatches
          SET status = 'provider_accepted', provider_http_status = ?,
              provider_request_id = ?, accepted_request_id = ?,
              provider_message_ids = ?, receipt_hash = ?,
              provider_accepted_at = ?, updated_at = ?
        WHERE client_request_id = ? AND status = 'dispatching'`,
    ).bind(
      receipt.httpStatus,
      receipt.providerRequestId,
      receipt.acceptedRequestId,
      JSON.stringify(receipt.providerMessageIds),
      receiptHash,
      acceptedAt,
      acceptedAt,
      input.clientRequestId,
    ).run();
  } catch {
    const failedAt = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE provider_message_dispatches
          SET status = 'reconciliation_required', updated_at = ?
        WHERE client_request_id = ? AND status = 'dispatching'`,
    ).bind(failedAt, input.clientRequestId).run();
    return c.json({
      success: false,
      error: 'Provider result is unknown; automatic resend is disabled',
    }, 502);
  }

  try {
    const loggedAt = new Date().toISOString();
    for (const message of input.messages) {
      await c.env.DB.prepare(
        `INSERT INTO messages_log (
           id, friend_id, direction, message_type, content, delivery_type,
           source, line_account_id, created_at
         ) VALUES (?, ?, 'outgoing', 'text', ?, 'push', 'runtime', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        recipient.friend_id,
        message.text,
        recipient.line_account_id,
        loggedAt,
      ).run();
    }
  } catch {
    console.error('Runtime message was accepted but chat history mirroring failed');
  }

  const stored = await readDispatch(c.env.DB, input.clientRequestId);
  if (!stored || stored.status !== 'provider_accepted') {
    return c.json({
      success: false,
      error: 'Provider receipt readback failed; automatic resend is disabled',
    }, 502);
  }
  return c.json({ success: true, data: receiptProjection(stored, false) });
});

runtimeMessages.get('/api/runtime/dispatches/:clientRequestId', async (c) => {
  if (c.get('staff')?.role !== 'owner') {
    return c.json({ success: false, error: 'Owner access required' }, 403);
  }
  const clientRequestId = c.req.param('clientRequestId');
  if (!UUID_PATTERN.test(clientRequestId)) {
    return c.json({ success: false, error: 'Invalid client request id' }, 400);
  }
  const row = await readDispatch(c.env.DB, clientRequestId);
  if (!row) return c.json({ success: false, error: 'Dispatch not found' }, 404);
  return c.json({ success: true, data: receiptProjection(row, true) });
});
