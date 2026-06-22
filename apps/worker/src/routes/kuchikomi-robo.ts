import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  buildKuchikomiRoboReviewRequest,
  sendKuchikomiRoboReviewRequest,
  type KuchikomiRoboReviewRequestInput,
} from '../services/kuchikomi-robo.js';

const kuchikomiRobo = new Hono<Env>();

kuchikomiRobo.get('/api/integrations/kuchikomi-robo/status', async (c) => {
  return c.json({
    success: true,
    data: {
      configured: Boolean(c.env.KUCHIKOMI_ROBO_WEBHOOK_URL),
      hasApiKey: Boolean(c.env.KUCHIKOMI_ROBO_API_KEY),
      hasSharedSecret: Boolean(c.env.KUCHIKOMI_ROBO_SHARED_SECRET),
      defaultStoreId: c.env.KUCHIKOMI_ROBO_STORE_ID ?? null,
    },
  });
});

kuchikomiRobo.post('/api/integrations/kuchikomi-robo/review-request', async (c) => {
  try {
    const body = await c.req.json<KuchikomiRoboReviewRequestInput>();
    const request = await buildKuchikomiRoboReviewRequest(c.env.DB, body, {
      defaultStoreId: c.env.KUCHIKOMI_ROBO_STORE_ID,
    });
    const delivery = await sendKuchikomiRoboReviewRequest(c.env, request);
    return c.json({
      success: true,
      data: {
        delivered: true,
        status: delivery.status,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/integrations/kuchikomi-robo/review-request error:', err);
    if (message.includes('not configured')) {
      return c.json({ success: false, error: message }, 503);
    }
    if (message.includes('needs friendId')) {
      return c.json({ success: false, error: message }, 400);
    }
    return c.json({ success: false, error: message }, 502);
  }
});

export { kuchikomiRobo };
