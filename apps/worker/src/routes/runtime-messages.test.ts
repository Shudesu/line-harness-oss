import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { runtimeMessages } from './runtime-messages.js';

const pushMessageWithReceipt = vi.fn();

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({ pushMessageWithReceipt })),
}));

type DispatchRow = {
  id: string;
  client_request_id: string;
  request_hash: string;
  conversation_ref: string;
  friend_id: string;
  account_scope_fingerprint: string;
  status: string;
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

class FakeStatement {
  private values: unknown[] = [];

  constructor(private readonly db: FakeDb, private readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes('FROM provider_message_dispatches')) {
      return (this.db.dispatches.get(String(this.values[0])) ?? null) as T | null;
    }
    if (this.sql.includes('FROM chats c')) {
      return this.values[0] === this.db.recipient.chat_id
        ? this.db.recipient as T
        : null;
    }
    return null;
  }

  async run(): Promise<D1Result<unknown>> {
    if (this.sql.includes('INSERT INTO provider_message_dispatches')) {
      const [
        id,
        clientRequestId,
        requestHash,
        conversationRef,
        friendId,
        accountScopeFingerprint,
        releaseVersion,
        workerHash,
        now,
      ] = this.values.map(String);
      this.db.dispatches.set(clientRequestId, {
        id,
        client_request_id: clientRequestId,
        request_hash: requestHash,
        conversation_ref: conversationRef,
        friend_id: friendId,
        account_scope_fingerprint: accountScopeFingerprint,
        status: 'dispatching',
        release_version: releaseVersion,
        worker_hash: workerHash,
        provider_http_status: null,
        provider_request_id: null,
        accepted_request_id: null,
        provider_message_ids: null,
        receipt_hash: null,
        dispatch_started_at: now,
        provider_accepted_at: null,
        created_at: now,
        updated_at: now,
      });
    } else if (this.sql.includes("status = 'provider_accepted'")) {
      const [
        httpStatus,
        providerRequestId,
        acceptedRequestId,
        providerMessageIds,
        receiptHash,
        now,
        _updatedAt,
        clientRequestId,
      ] = this.values;
      const row = this.db.dispatches.get(String(clientRequestId));
      if (row) {
        Object.assign(row, {
          status: 'provider_accepted',
          provider_http_status: Number(httpStatus),
          provider_request_id: String(providerRequestId),
          accepted_request_id: acceptedRequestId === null ? null : String(acceptedRequestId),
          provider_message_ids: String(providerMessageIds),
          receipt_hash: String(receiptHash),
          provider_accepted_at: String(now),
          updated_at: String(now),
        });
      }
    } else if (this.sql.includes("status = 'reconciliation_required'")) {
      const [now, clientRequestId] = this.values;
      const row = this.db.dispatches.get(String(clientRequestId));
      if (row) Object.assign(row, { status: 'reconciliation_required', updated_at: String(now) });
    } else if (this.sql.includes('INSERT INTO messages_log')) {
      this.db.messageLogCount += 1;
    }
    return { success: true } as D1Result<unknown>;
  }
}

class FakeDb {
  readonly dispatches = new Map<string, DispatchRow>();
  readonly recipient = {
    chat_id: 'chat-1',
    friend_id: 'friend-1',
    line_user_id: 'Urecipient',
    line_account_id: null,
    account_channel_id: null,
    channel_access_token: null,
  };
  messageLogCount = 0;

  prepare(sql: string) {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement;
  }
}

const requestBase = {
  schemaVersion: 1,
  clientRequestId: '123e4567-e89b-12d3-a456-426614174000',
  conversationRef: 'chat-1',
  messages: [{ type: 'text', text: 'hello' }],
  release: {
    version: '0.0.0-dev',
    workerHash: `sha256:${'0'.repeat(64)}`,
  },
};

function setup(db: FakeDb, role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<{
    Bindings: {
      DB: D1Database;
      LINE_CHANNEL_ACCESS_TOKEN: string;
      LINE_CHANNEL_ID: string;
    };
    Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
  }>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'service-owner', role });
    await next();
  });
  app.route('/', runtimeMessages);
  const env = {
    DB: db as unknown as D1Database,
    LINE_CHANNEL_ACCESS_TOKEN: 'channel-token',
    LINE_CHANNEL_ID: 'line-channel',
  };
  return { app, env };
}

async function expectedFingerprint() {
  const bytes = new TextEncoder().encode('line-channel');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function buildRequestBody() {
  const accountScopeFingerprint = await expectedFingerprint();
  const requestHash = await hash(JSON.stringify({
    schemaVersion: 1,
    accountScopeFingerprint,
    conversationRef: requestBase.conversationRef,
    messages: requestBase.messages,
  }));
  return { ...requestBase, requestHash, accountScopeFingerprint };
}

beforeEach(() => {
  pushMessageWithReceipt.mockReset();
  pushMessageWithReceipt.mockResolvedValue({
    httpStatus: 200,
    providerRequestId: 'provider-request-1',
    acceptedRequestId: null,
    providerMessageIds: ['provider-message-1'],
  });
});

describe('runtime message dispatch receipt contract', () => {
  test('returns the opaque conversation account scope without provider identity', async () => {
    const db = new FakeDb();
    const { app, env } = setup(db);

    const response = await app.request(
      '/api/runtime/conversations/chat-1/account-scope',
      undefined,
      env,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: Record<string, unknown>;
    };
    expect(body.data.accountScopeFingerprint).toBe(await expectedFingerprint());
    expect(body.data.conversationRef).toBe('chat-1');
    expect(body.data).not.toHaveProperty('lineUserId');
    expect(body.data).not.toHaveProperty('channelId');
  });

  test('persists a provider receipt and returns it through readback', async () => {
    const db = new FakeDb();
    const { app, env } = setup(db);
    const body = await buildRequestBody();

    const send = await app.request('/api/runtime/messages:send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, env);
    expect(send.status).toBe(200);
    const sendJson = await send.json() as { data: { state: string; providerMessageIds: string[] } };
    expect(sendJson.data.state).toBe('provider_accepted');
    expect(sendJson.data.providerMessageIds).toEqual(['provider-message-1']);
    expect(db.messageLogCount).toBe(1);

    const readback = await app.request(
      `/api/runtime/dispatches/${requestBase.clientRequestId}`,
      undefined,
      env,
    );
    expect(readback.status).toBe(200);
    const readbackJson = await readback.json() as { data: { state: string; receiptHash: string } };
    expect(readbackJson.data.state).toBe('provider_accepted');
    expect(readbackJson.data.receiptHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('replays the persisted receipt without sending twice', async () => {
    const db = new FakeDb();
    const { app, env } = setup(db);
    const body = await buildRequestBody();
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };

    expect((await app.request('/api/runtime/messages:send', init, env)).status).toBe(200);
    const replay = await app.request('/api/runtime/messages:send', init, env);
    expect(replay.status).toBe(200);
    expect((await replay.json() as { data: { replayed: boolean } }).data.replayed).toBe(true);
    expect(pushMessageWithReceipt).toHaveBeenCalledTimes(1);
  });

  test('rejects the same request id with a different request hash', async () => {
    const db = new FakeDb();
    const { app, env } = setup(db);
    const first = await buildRequestBody();
    const second = { ...first, requestHash: `sha256:${'c'.repeat(64)}` };

    await app.request('/api/runtime/messages:send', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(first),
    }, env);
    const conflict = await app.request('/api/runtime/messages:send', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(second),
    }, env);

    expect(conflict.status).toBe(409);
    expect(pushMessageWithReceipt).toHaveBeenCalledTimes(1);
  });

  test('moves an unknown provider result to reconciliation without automatic resend', async () => {
    const db = new FakeDb();
    const { app, env } = setup(db);
    const body = await buildRequestBody();
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
    pushMessageWithReceipt.mockRejectedValueOnce(new Error('network timeout'));

    const first = await app.request('/api/runtime/messages:send', init, env);
    expect(first.status).toBe(502);
    const second = await app.request('/api/runtime/messages:send', init, env);
    expect(second.status).toBe(409);
    expect(pushMessageWithReceipt).toHaveBeenCalledTimes(1);
    expect(db.dispatches.get(requestBase.clientRequestId)?.status)
      .toBe('reconciliation_required');
  });

  test('rejects message tampering when the canonical request hash is stale', async () => {
    const db = new FakeDb();
    const { app, env } = setup(db);
    const body = await buildRequestBody();
    const tampered = { ...body, messages: [{ type: 'text', text: 'changed' }] };

    const response = await app.request('/api/runtime/messages:send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tampered),
    }, env);

    expect(response.status).toBe(409);
    expect(pushMessageWithReceipt).not.toHaveBeenCalled();
  });

  test('rejects a correctly hashed request for a different account scope', async () => {
    const db = new FakeDb();
    const { app, env } = setup(db);
    const base = await buildRequestBody();
    const accountScopeFingerprint = `sha256:${'d'.repeat(64)}`;
    const requestHash = await hash(JSON.stringify({
      schemaVersion: 1,
      accountScopeFingerprint,
      conversationRef: base.conversationRef,
      messages: base.messages,
    }));

    const response = await app.request('/api/runtime/messages:send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...base, accountScopeFingerprint, requestHash }),
    }, env);

    expect(response.status).toBe(409);
    expect(pushMessageWithReceipt).not.toHaveBeenCalled();
  });

  test('allows only the owner service credential to dispatch', async () => {
    const db = new FakeDb();
    const { app, env } = setup(db, 'staff');
    const response = await app.request('/api/runtime/messages:send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(await buildRequestBody()),
    }, env);

    expect(response.status).toBe(403);
    expect(pushMessageWithReceipt).not.toHaveBeenCalled();
  });
});
