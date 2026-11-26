import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { health } from './health.js';
import type { Env } from '../index.js';

vi.mock('@line-crm/db', () => ({
  getStaffByApiKey: vi.fn(async () => null),
  getAccountHealthLogs: vi.fn(async () => []),
  getLatestRiskLevel: vi.fn(async () => null),
  getAccountMigrations: vi.fn(async () => []),
  getAccountMigrationById: vi.fn(async () => null),
  createAccountMigration: vi.fn(),
  updateAccountMigration: vi.fn(),
}));

function env(): Env['Bindings'] {
  return {
    DB: {} as D1Database,
    IMAGES: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    TENANT_SCHEDULER: {} as Env['Bindings']['TENANT_SCHEDULER'],
    LINE_CHANNEL_SECRET: 'secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    API_KEY: 'env-key',
    LIFF_URL: 'https://liff.example.test',
    LINE_CHANNEL_ID: 'line-channel',
    LINE_LOGIN_CHANNEL_ID: 'login-channel',
    LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
    WORKER_URL: 'https://worker.example.test',
  };
}

function app() {
  const a = new Hono<Env>();
  a.use('*', authMiddleware);
  a.route('/', health);
  return a;
}

// The liveness endpoints are what `create-line-harness update` and the
// self-update verify phase probe after a deploy — they must answer 200
// with no credentials, or every update ends in a bogus health warning
// (CLI) or rollback (self-update).
describe('liveness endpoints are public', () => {
  test.each(['/health', '/api/health'])('GET %s → 200 without credentials', async (path) => {
    const res = await app().request(path, {}, env());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
  });
});

describe('account health stays auth-guarded', () => {
  test('GET /api/accounts/:id/health without credentials → 401', async () => {
    const res = await app().request('/api/accounts/a1/health', {}, env());
    expect(res.status).toBe(401);
  });
});
