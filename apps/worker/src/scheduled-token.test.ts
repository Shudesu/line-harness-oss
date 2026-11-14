import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineAccount } from '@line-crm/db';
import type { Env } from './index.js';

const mocks = vi.hoisted(() => ({
  getLineAccounts: vi.fn(), updateLineAccount: vi.fn(),
  queued: vi.fn(), broadcasts: vi.fn(), steps: vi.fn(), reminders: vi.fn(),
  insights: vi.fn(), webinar: vi.fn(), followups: vi.fn(),
}));
vi.mock('@line-crm/db', async (original) => ({
  ...await original<typeof import('@line-crm/db')>(),
  getLineAccounts: mocks.getLineAccounts, updateLineAccount: mocks.updateLineAccount,
  recoverStalledBroadcasts: vi.fn(), recoverStuckDeliveries: vi.fn(),
}));
vi.mock('./services/x-gate-client.js', () => ({ flushXGateEvents: vi.fn() }));
vi.mock('./services/broadcast.js', () => ({ processQueuedBroadcasts: mocks.queued, processScheduledBroadcasts: mocks.broadcasts }));
vi.mock('./services/step-delivery.js', () => ({ processStepDeliveries: mocks.steps }));
vi.mock('./services/reminder-delivery.js', () => ({ processReminderDeliveries: mocks.reminders }));
vi.mock('./services/insight-fetcher.js', () => ({ processInsightFetch: mocks.insights }));
vi.mock('./services/booking-reminders.js', () => ({ processDueReminders: vi.fn(async () => ({ sent: 0, failed: 0 })) }));
vi.mock('./services/event-booking-reminders.js', () => ({ processDueEventReminders: vi.fn(async () => ({ sent: 0, failed: 0 })) }));
vi.mock('./services/meet-consultation-reminders.js', () => ({ processDueMeetConsultationReminders: vi.fn(async () => ({ sent: 0, failed: 0 })) }));
vi.mock('./services/webinar-reminders.js', () => ({ processWebinarReminders: mocks.webinar }));
vi.mock('./services/webinar-followups.js', () => ({ processWebinarFollowups: mocks.followups }));
vi.mock('./routes/line-proxy.js', () => ({ lineProxy: { fetch: vi.fn() } }));

import { scheduled } from './scheduled.js';
import { resetDefaultLineTokenCache, withDefaultLineToken } from './services/default-line-token.js';

const NOW = Date.UTC(2026, 10, 10, 3, 1);
const DB = {} as D1Database;
let rows: LineAccount[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetDefaultLineTokenCache();
  rows = [{ id: 'synthetic-main', channel_id: '1001', name: 'main', channel_secret: 'synthetic-secret',
    channel_access_token: 'expired-token', token_expires_at: new Date(NOW - 1000).toISOString(), is_active: 1 } as LineAccount];
  mocks.getLineAccounts.mockImplementation(async () => rows.map((row) => ({ ...row })));
  mocks.updateLineAccount.mockImplementation(async (_db, id, changes) => {
    rows = rows.map((row) => row.id === id ? { ...row, ...changes } : row);
  });
  mocks.webinar.mockResolvedValue({ sent: 0, failed: 0 });
  mocks.followups.mockResolvedValue({ sent: 0, failed: 0 });
  // No real network or message delivery. Only token issuance may reach this mock.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe('https://api.line.me/v2/oauth/accessToken');
    return new Response(JSON.stringify({ access_token: 'fresh-token', expires_in: 2592000 }));
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function tick(env: Env['Bindings']) {
  await scheduled({ cron: '* * * * *', scheduledTime: NOW } as ScheduledEvent, env, {} as ExecutionContext);
}

describe('scheduled token refresh integration', () => {
  it('uses refreshed tokens for the same tick and replaces a warm HTTP cache without extra reads', async () => {
    const env = { DB, LINE_CHANNEL_SECRET: 'synthetic-secret' } as Env['Bindings'];
    expect((await withDefaultLineToken(env)).LINE_CHANNEL_ACCESS_TOKEN).toBe('expired-token');
    mocks.getLineAccounts.mockClear();
    await tick(env);
    expect(rows[0].channel_access_token).toBe('fresh-token');
    for (const job of [mocks.queued, mocks.broadcasts, mocks.steps, mocks.reminders]) {
      expect(job).toHaveBeenCalledTimes(1);
      expect(job.mock.calls[0][1]).toHaveProperty('channelAccessToken', 'fresh-token');
    }
    expect(mocks.webinar.mock.calls[0][1].defaultAccessToken).toBe('fresh-token');
    expect(mocks.followups.mock.calls[0][1].defaultAccessToken).toBe('fresh-token');
    expect(mocks.insights.mock.calls[0][1].get('synthetic-main')).toHaveProperty('channelAccessToken', 'fresh-token');
    expect((await withDefaultLineToken(env)).LINE_CHANNEL_ACCESS_TOKEN).toBe('fresh-token');
    // One read in token-refresh and one post-refresh snapshot for all consumers.
    expect(mocks.getLineAccounts).toHaveBeenCalledTimes(2);
    expect(env.LINE_CHANNEL_ACCESS_TOKEN).toBeUndefined();
  });

  it('preserves an explicitly configured default token while refreshing account-specific clients', async () => {
    const env = { DB, LINE_CHANNEL_SECRET: 'synthetic-secret', LINE_CHANNEL_ACCESS_TOKEN: 'explicit-token' } as Env['Bindings'];
    await tick(env);
    expect(mocks.queued.mock.calls[0][1]).toHaveProperty('channelAccessToken', 'explicit-token');
    expect(mocks.webinar.mock.calls[0][1].defaultAccessToken).toBe('explicit-token');
    expect(mocks.insights.mock.calls[0][1].get('synthetic-main')).toHaveProperty('channelAccessToken', 'fresh-token');
    expect(mocks.getLineAccounts).toHaveBeenCalledTimes(2);
  });

  it('continues scheduled jobs with the still-valid token when issuance fails', async () => {
    rows[0].token_expires_at = new Date(NOW + 86400000).toISOString();
    rows[0].channel_access_token = 'still-valid-token';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    await tick({ DB, LINE_CHANNEL_SECRET: 'synthetic-secret' } as Env['Bindings']);
    expect(mocks.queued.mock.calls[0][1]).toHaveProperty('channelAccessToken', 'still-valid-token');
    expect(mocks.updateLineAccount).not.toHaveBeenCalled();
  });
});
