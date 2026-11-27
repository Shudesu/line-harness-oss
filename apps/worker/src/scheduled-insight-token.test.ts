import { afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { sqliteD1 } from './test-support/sqlite-d1.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('insight fetching uses the token refreshed earlier in the same cron tick', async () => {
  const { db, sqlite } = sqliteD1();
  try {
    sqlite.exec(readFileSync(new URL('../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
    sqlite.pragma('foreign_keys = ON');
    db.batch = async <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(s => s.run<T>()));
    sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
      VALUES('account-a','channel-a','A','expired-token','fixture-secret');
      INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,sent_at,line_account_id,line_request_id)
      VALUES('send-a','Announcement','text','hello','all','sent','2026-01-01T12:00:00','account-a','accepted-send-a');
      INSERT INTO broadcast_insights(id,broadcast_id,status) VALUES('insight-a','send-a','pending')`);
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://api.line.me/v2/oauth/accessToken') {
        return new Response(JSON.stringify({ access_token: 'refreshed-token', expires_in: 2592000 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (String(url) === 'https://api.line.me/v2/bot/insight/message/event?requestId=accepted-send-a') {
        const authorized = new Headers(init?.headers).get('Authorization') === 'Bearer refreshed-token';
        return new Response(authorized ? '{"overview":{"delivered":40,"uniqueImpression":30}}' : 'Expired token', {
          status: authorized ? 200 : 401, headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
    const { scheduled } = await import('./scheduled.js');
    await scheduled({ cron: '* * * * *', scheduledTime: Date.UTC(2026, 9, 21, 1, 1) } as ScheduledEvent,
      { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'unrelated-default' } as Parameters<typeof scheduled>[1],
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext);
    expect(sqlite.prepare("SELECT channel_access_token FROM line_accounts WHERE id='account-a'").get())
      .toEqual({ channel_access_token: 'refreshed-token' });
    expect(sqlite.prepare("SELECT status,retry_count,unique_impression FROM broadcast_insights WHERE id='insight-a'").get())
      .toEqual({ status: 'ready', retry_count: 0, unique_impression: 30 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errors).not.toHaveBeenCalled();
  } finally { sqlite.close(); }
});
