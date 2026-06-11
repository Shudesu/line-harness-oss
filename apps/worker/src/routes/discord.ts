import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  handleDiscordReservationInteraction,
  verifyDiscordInteractionRequest,
} from '../services/discord-interactions.js';

const discord = new Hono<Env>();

discord.post('/api/integrations/discord/interactions', async (c) => {
  const body = await c.req.text();
  const verified = await verifyDiscordInteractionRequest(c.req.raw, c.env, body);
  if (!verified) return c.json({ error: 'invalid request signature' }, 401);

  let interaction: unknown;
  try {
    interaction = JSON.parse(body);
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  try {
    const response = await handleDiscordReservationInteraction(c.env.DB, interaction as Parameters<typeof handleDiscordReservationInteraction>[1]);
    return c.json(response);
  } catch (err) {
    console.error('POST /api/integrations/discord/interactions error:', err);
    return c.json({
      type: 4,
      data: {
        content: '予約確認処理でエラーが発生しました。',
        flags: 1 << 6,
      },
    });
  }
});

export { discord };
