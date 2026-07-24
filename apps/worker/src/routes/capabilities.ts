import { Hono } from 'hono';
import type { Env } from '../index.js';
import { BUNDLE_VERSION, WORKER_HASH } from '../_version.js';

export const HARNESS_VERSION = BUNDLE_VERSION === '0.0.0-dev'
  ? '0.17.0'
  : BUNDLE_VERSION;
export const API_VERSION = 2;
export const CONNECTOR_VERSION = '2026-05-20';
export const MIN_APP_VERSION = '1.0.0';
export const FEATURES = [
  'friends',
  'broadcasts',
  'scenarios',
  'tracked_links',
  'forms',
  'staff',
  'tags',
  'templates',
  'scoring',
  'automations',
  'conversions',
  'affiliates',
  'chats',
  'conversations',
  'auto_replies',
  'rich_menus',
  'webhooks',
  'stripe',
  'line_accounts',
  'line-cross-link',
  'x-cross-link',
  'ig-cross-link',
  'provider_receipt_v1',
  'dispatch_readback_v1',
  'push_retry_key_v1',
  'account_scope_fingerprint_v1',
] as const;

export const capabilities = new Hono<Env>();

capabilities.get('/api/capabilities', async (c) => {
  return c.json({
    success: true,
    data: {
      harness_kind: 'line',
      harness_version: HARNESS_VERSION,
      api_version: API_VERSION,
      features: FEATURES,
      min_app_version: MIN_APP_VERSION,
      product: 'line-harness',
      platform: 'line',
      version: HARNESS_VERSION,
      connectorVersion: CONNECTOR_VERSION,
      release: {
        version: BUNDLE_VERSION,
        workerHash: WORKER_HASH,
      },
      external_writes: {
        message_send: 'provider_receipt_v1',
      },
      identity: {
        primaryKey: 'line_friend_id',
        supportedLinks: ['x_user_id', 'ig_igsid'],
      },
      endpoints: {
        health: '/api/health',
        staffMe: '/api/staff/me',
        lineAccounts: '/api/line-accounts',
        friends: '/api/friends',
        broadcasts: '/api/broadcasts',
        scenarios: '/api/scenarios',
        trackedLinks: '/api/tracked-links',
        trackedLinkClicks: '/api/tracked-links/:id/clicks',
        forms: '/api/forms',
        tags: '/api/tags',
        chats: '/api/chats',
        runtimeMessageSend: '/api/runtime/messages:send',
        runtimeAccountScope: '/api/runtime/conversations/:conversationRef/account-scope',
        runtimeDispatchReadback: '/api/runtime/dispatches/:clientRequestId',
        liff: '/liff',
      },
    },
  });
});
