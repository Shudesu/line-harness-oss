import { afterEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { broadcasts } from '../routes/broadcasts.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup(kind: 'broadcast' | 'unit', state: 'active' | 'inactive' | 'missing' | 'legacy') {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.pragma('foreign_keys = ON');
  if (state !== 'missing' && state !== 'legacy') {
    sqlite.prepare(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,is_active)
      VALUES('account-a','channel-a','A','token-a','secret',?)`).run(state === 'active' ? 1 : 0);
  }
  sqlite.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,sent_at,line_account_id,line_request_id,aggregation_unit)
    VALUES('send-a','Announcement','text','hello',?,'sent','2026-01-01T12:00:00',?,?,?)`)
    .run(kind === 'broadcast' ? 'all' : 'tag', state === 'legacy' ? null : 'account-a',
      kind === 'broadcast' ? 'accepted-send-a' : null, kind === 'unit' ? 'shared-unit' : null);
  sqlite.exec("INSERT INTO broadcast_insights(id,broadcast_id,status) VALUES('insight-a','send-a','pending')");
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    // A shared unit can exist in different LINE channels. Return distinguishable
    // fixture data so the wrong channel would visibly contaminate the ledger.
    const ownAccount = new Headers(init?.headers).get('Authorization') === 'Bearer token-a';
    const overview = { delivered: 40, uniqueImpression: ownAccount ? 30 : 99, uniqueClick: 5 };
    return new Response(JSON.stringify(kind === 'broadcast' ? { overview } : { messages: [overview] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = new Hono(); app.route('/', broadcasts);
  const row = () => sqlite.prepare('SELECT status,retry_count,unique_impression FROM broadcast_insights').get();
  return { db, sqlite, fetchMock, app, row };
}

describe.each(['broadcast', 'unit'] as const)('%s insights retain their original account', kind => {
  test.each(['active', 'inactive', 'missing', 'legacy'] as const)(
    'scheduled fetch uses only the correct channel for %s account records', async state => {
      const s = setup(kind, state);
      try {
        // Cron builds the original map from active accounts only.
        const clients = new Map<string, LineClient>();
        if (state === 'active') clients.set('account-a', new LineClient('token-a'));
        // Reset only module state to give each case an independent daily tick.
        vi.resetModules();
        const { processInsightFetch } = await import('./insight-fetcher.js');
        await processInsightFetch(s.db, clients, new LineClient('token-default'));
        if (state === 'missing') {
          expect(s.fetchMock).not.toHaveBeenCalled();
          expect(s.row()).toEqual({ status: 'pending', retry_count: 1, unique_impression: null });
        } else {
          expect(s.fetchMock).toHaveBeenCalledTimes(1);
          const token = new Headers(s.fetchMock.mock.calls[0][1]?.headers).get('Authorization');
          expect(token).toBe(state === 'legacy' ? 'Bearer token-default' : 'Bearer token-a');
          expect(s.row()).toEqual({ status: 'ready', retry_count: 0, unique_impression: state === 'legacy' ? 99 : 30 });
        }
      } finally { s.sqlite.close(); }
    },
  );

  test.each(['active', 'inactive', 'missing', 'legacy'] as const)(
    'manual fetch uses only the correct channel for %s account records', async state => {
      const s = setup(kind, state);
      try {
        const response = await s.app.request('/api/broadcasts/send-a/fetch-insight', { method: 'POST' }, {
          DB: s.db, LINE_CHANNEL_ACCESS_TOKEN: 'token-default',
        });
        if (state === 'missing') {
          expect(s.fetchMock).not.toHaveBeenCalled();
          expect(response.status).toBe(500);
          expect(s.row()).toEqual({ status: 'pending', retry_count: 0, unique_impression: null });
        } else {
          expect(response.status).toBe(200);
          const token = new Headers(s.fetchMock.mock.calls[0][1]?.headers).get('Authorization');
          expect(token).toBe(state === 'legacy' ? 'Bearer token-default' : 'Bearer token-a');
          expect(s.row()).toEqual({ status: 'ready', retry_count: 0, unique_impression: state === 'legacy' ? 99 : 30 });
        }
      } finally { s.sqlite.close(); }
    },
  );
});

test.each(['scheduled', 'manual'] as const)(
  '%s dedup insights still combine each recorded account, including inactive ones', async mode => {
    const s = setup('unit', 'inactive');
    try {
      s.sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
        VALUES('account-b','channel-b','B','token-b','secret');
        UPDATE broadcasts SET target_type='multi-account-dedup',account_ids='["account-a","account-b"]',success_count=60`);
      if (mode === 'scheduled') {
        vi.resetModules();
        const { processInsightFetch } = await import('./insight-fetcher.js');
        await processInsightFetch(s.db, new Map(), new LineClient('token-default'));
      } else {
        const response = await s.app.request('/api/broadcasts/send-a/fetch-insight', { method: 'POST' }, {
          DB: s.db, LINE_CHANNEL_ACCESS_TOKEN: 'token-default',
        });
        expect(response.status).toBe(200);
      }
      expect(s.fetchMock).toHaveBeenCalledTimes(2);
      expect(s.fetchMock.mock.calls.map(call => new Headers(call[1]?.headers).get('Authorization')))
        .toEqual(['Bearer token-a', 'Bearer token-b']);
      expect(s.row()).toEqual({ status: 'ready', retry_count: 0, unique_impression: 129 });
    } finally { s.sqlite.close(); }
  },
);

test('scheduled fetch records a missing account failure and continues to the next broadcast', async () => {
  const s = setup('broadcast', 'missing');
  try {
    s.sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
      VALUES('account-b','channel-b','B','token-a','secret');
      INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,sent_at,line_account_id,line_request_id)
      VALUES('send-b','Second','text','hello','all','sent','2026-01-01T12:00:00','account-b','accepted-send-b');
      INSERT INTO broadcast_insights(id,broadcast_id,status) VALUES('insight-b','send-b','pending')`);
    vi.resetModules();
    const { processInsightFetch } = await import('./insight-fetcher.js');
    await processInsightFetch(s.db, new Map(), new LineClient('token-default'));
    expect(s.fetchMock).toHaveBeenCalledTimes(1);
    expect(s.fetchMock.mock.calls[0][0]).toContain('requestId=accepted-send-b');
    expect(s.sqlite.prepare('SELECT id,status,retry_count,unique_impression FROM broadcast_insights ORDER BY id').all())
      .toEqual([
        { id: 'insight-a', status: 'pending', retry_count: 1, unique_impression: null },
        { id: 'insight-b', status: 'ready', retry_count: 0, unique_impression: 30 },
      ]);
  } finally { s.sqlite.close(); }
});
