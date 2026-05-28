import { Hono } from 'hono';
import type { Env } from '../index.js';
import { resolveProviderConfig } from '../config/provider.js';

const providerConfig = new Hono<Env>();

providerConfig.get('/api/public/provider-config', async (c) => {
  try {
    const data = await resolveProviderConfig(c.env);
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/public/provider-config error:', err);
    return c.json({ success: false, error: 'internal_error' }, 500);
  }
});

export { providerConfig };
