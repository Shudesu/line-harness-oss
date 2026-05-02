import { Hono } from 'hono';
import type { Env } from '../index.js';

export const HARNESS_VERSION = '0.12.0';
export const API_VERSION = 1;
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
    },
  });
});
