import {
  describe,
  expect,
  test,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';
import { Hono } from 'hono';
import { webhook } from './webhook.js';

async function signBody(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const bytes = new Uint8Array(sig);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function recordingDb() {
  const calls: { sql: string; binds: unknown[] }[] = [];
  let prepareCount = 0;
  const db = {
    prepare(sql: string) {
      prepareCount += 1;
      let bindArgs: unknown[] = [];
      const stmt: Record<string, unknown> = {};
      Object.assign(stmt, {
        bind: (...args: unknown[]) => {
          bindArgs = args;
          return stmt;
        },
        all: async () => {
          calls.push({ sql, binds: bindArgs });
          return { results: [] };
        },
        first: async () => {
          calls.push({ sql, binds: bindArgs });
          return null;
        },
        run: async () => {
          calls.push({ sql, binds: bindArgs });
          return { meta: { changes: 0 } };
        },
      });
      return stmt;
    },
  };
  return {
    db,
    calls: () => calls,
    prepareCount: () => prepareCount,
  };
}

const baseEnv = (db: unknown) => ({
  LINE_CHANNEL_SECRET: 'env-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-access-token',
  DB: db,
});

describe('POST /webhook — payload size limits', () => {
  let consoleErrorSpy: MockInstance;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('rejects bodies larger than 512KB via Content-Length pre-check (413, no DB access)', async () => {
    const app = new Hono();
    app.route('/', webhook);
    const { db, prepareCount } = recordingDb();

    const oversized = 'x'.repeat(513 * 1024);
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'X-Line-Signature': 'dummy' },
        body: oversized,
      },
      baseEnv(db),
    );

    expect(res.status).toBe(413);
    expect(prepareCount()).toBe(0);
  });

  test('uses UTF-8 byte length, not UTF-16 code units, for size check', async () => {
    // 'あ' is 1 UTF-16 code unit but 3 UTF-8 bytes.
    // 200K chars: String.length 200K (under 512KB if mistakenly counted as
    // code units) vs byteLength ~600KB (must be rejected).
    const body = 'あ'.repeat(200 * 1024);
    expect(body.length).toBeLessThan(512 * 1024);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(512 * 1024);

    const app = new Hono();
    app.route('/', webhook);
    const { db } = recordingDb();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'X-Line-Signature': 'dummy' },
        body,
      },
      baseEnv(db),
    );

    expect(res.status).toBe(413);
  });

  test('post-read fallback rejects oversized body when Content-Length is absent', async () => {
    // ReadableStream bodies do not get an automatic Content-Length, so the
    // pre-check is bypassed and only the post-read fallback can reject.
    const oversized = 'x'.repeat(600 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(oversized));
        controller.close();
      },
    });

    const req = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'X-Line-Signature': 'dummy' },
      body: stream,
      // @ts-expect-error duplex is required for streaming bodies in Node fetch
      duplex: 'half',
    });
    expect(req.headers.get('Content-Length')).toBeNull();

    const app = new Hono();
    app.route('/', webhook);
    const { db } = recordingDb();
    const res = await app.fetch(req, baseEnv(db));
    expect(res.status).toBe(413);
  });
});

describe('POST /webhook — signature gates JSON.parse', () => {
  let consoleErrorSpy: MockInstance;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('valid signature with malformed JSON reaches parser (logs parse failure)', async () => {
    const app = new Hono();
    app.route('/', webhook);
    const { db } = recordingDb();

    const body = 'this is { not valid json';
    const sig = await signBody('env-secret', body);

    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'X-Line-Signature': sig },
        body,
      },
      baseEnv(db),
    );

    expect(res.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to parse verified webhook body');
    expect(consoleErrorSpy).not.toHaveBeenCalledWith('Invalid LINE signature');
  });

  test('invalid signature with malformed JSON stops before the parser', async () => {
    const app = new Hono();
    app.route('/', webhook);
    const { db } = recordingDb();

    const body = 'this is { not valid json';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'X-Line-Signature': 'aW52YWxpZA==' },
        body,
      },
      baseEnv(db),
    );

    expect(res.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid LINE signature');
    expect(consoleErrorSpy).not.toHaveBeenCalledWith('Failed to parse verified webhook body');
  });

  test('missing X-Line-Signature returns 200 without DB access', async () => {
    const app = new Hono();
    app.route('/', webhook);
    const { db, prepareCount } = recordingDb();

    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        body: '{"events":[]}',
      },
      baseEnv(db),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('ok');
    expect(prepareCount()).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid LINE signature');
  });
});
