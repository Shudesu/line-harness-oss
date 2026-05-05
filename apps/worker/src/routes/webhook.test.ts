import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { webhook } from './webhook.js';

function recordingDb() {
  let accessed = false;
  const statement: Record<string, unknown> = {};
  Object.assign(statement, {
    bind: () => statement,
    all: async () => ({ results: [] }),
    first: async () => null,
    run: async () => ({ meta: { changes: 0 } }),
  });
  return {
    db: {
      prepare: () => {
        accessed = true;
        return statement;
      },
    },
    accessed: () => accessed,
  };
}

const baseEnv = (db: unknown) => ({
  LINE_CHANNEL_SECRET: 'test-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'test-access-token',
  DB: db,
});

describe('POST /webhook — DoS protection', () => {
  test('rejects bodies larger than 512KB with 413 before reaching DB', async () => {
    const app = new Hono();
    app.route('/', webhook);
    const { db, accessed } = recordingDb();

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
    expect(accessed()).toBe(false);
  });

  test('returns 200 without DB access when X-Line-Signature is missing', async () => {
    const app = new Hono();
    app.route('/', webhook);
    const { db, accessed } = recordingDb();

    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        body: '{"events":[]}',
      },
      baseEnv(db),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
    expect(accessed()).toBe(false);
  });

  test('returns 200 on invalid signature without crashing on malformed JSON', async () => {
    const app = new Hono();
    app.route('/', webhook);
    const { db } = recordingDb();

    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'X-Line-Signature': 'aW52YWxpZA==' },
        body: 'this is { not valid json',
      },
      baseEnv(db),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});
