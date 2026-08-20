import { Hono } from 'hono';
import {
  getTags,
  getTagsWithCounts,
  createTag,
  deleteTag,
  updateTagMileageSettings,
  enqueueHistoricTagMileage,
} from '@line-crm/db';
import type { Tag as DbTag } from '@line-crm/db';
import type { Env } from '../index.js';

const tags = new Hono<Env>();

function serializeTag(row: DbTag & { friend_count?: number }) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    mileageReward: Number(row.mileage_reward ?? 0),
    referralMileageReward: Number(row.referral_mileage_reward ?? 0),
    mileageMultiplierBps: row.mileage_multiplier_bps == null
      ? null
      : Number(row.mileage_multiplier_bps),
    mileageMultiplierPriority: Number(row.mileage_multiplier_priority ?? 0),
    createdAt: row.created_at,
    ...(row.friend_count !== undefined ? { friendCount: row.friend_count } : {}),
  };
}

// GET /api/tags - list all tags
// ?withCounts=1 adds friendCount (JOIN over friend_tags) — admin UI only, so
// the many picker/filter consumers keep the cheap plain SELECT.
tags.get('/api/tags', async (c) => {
  try {
    const withCounts = c.req.query('withCounts') === '1';
    const items = withCounts
      ? await getTagsWithCounts(c.env.DB)
      : await getTags(c.env.DB);
    return c.json({ success: true, data: items.map(serializeTag) });
  } catch (err) {
    console.error('GET /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tags/:id/mileage - configure a one-time tag reward and/or tier multiplier.
tags.patch('/api/tags/:id/mileage', async (c) => {
  try {
    const body = await c.req.json<{
      rewardMiles?: unknown;
      referralRewardMiles?: unknown;
      multiplierBps?: unknown;
      multiplierPriority?: unknown;
    }>();
    const rewardMiles = Number(body.rewardMiles ?? 0);
    const referralRewardMiles = Number(body.referralRewardMiles ?? 0);
    const multiplierBps = body.multiplierBps === null || body.multiplierBps === ''
      ? null
      : Number(body.multiplierBps);
    const multiplierPriority = Number(body.multiplierPriority ?? 0);
    if (!Number.isInteger(rewardMiles) || rewardMiles < 0 || rewardMiles > 1_000_000) {
      return c.json({ success: false, error: 'rewardMiles must be an integer between 0 and 1000000' }, 400);
    }
    if (!Number.isInteger(referralRewardMiles) || referralRewardMiles < 0 || referralRewardMiles > 1_000_000) {
      return c.json({ success: false, error: 'referralRewardMiles must be an integer between 0 and 1000000' }, 400);
    }
    if (multiplierBps !== null && (
      !Number.isInteger(multiplierBps) || multiplierBps < 1000 || multiplierBps > 100000
    )) {
      return c.json({ success: false, error: 'multiplierBps must be null or an integer between 1000 and 100000' }, 400);
    }
    if (!Number.isInteger(multiplierPriority) || multiplierPriority < 0 || multiplierPriority > 1000) {
      return c.json({ success: false, error: 'multiplierPriority must be an integer between 0 and 1000' }, 400);
    }

    const tag = await updateTagMileageSettings(c.env.DB, c.req.param('id'), {
      rewardMiles,
      referralRewardMiles,
      multiplierBps,
      multiplierPriority,
    });
    if (!tag) return c.json({ success: false, error: 'Not found' }, 404);
    const queued = rewardMiles > 0 || referralRewardMiles > 0
      ? await enqueueHistoricTagMileage(c.env.DB, tag.id)
      : 0;
    return c.json({ success: true, data: { tag: serializeTag(tag), queued } });
  } catch (err) {
    console.error('PATCH /api/tags/:id/mileage error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tags - create tag
tags.post('/api/tags', async (c) => {
  try {
    const body = await c.req.json<{ name?: unknown; color?: string }>();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const tag = await createTag(c.env.DB, {
      name,
      color: body.color,
    });

    return c.json({ success: true, data: serializeTag(tag) }, 201);
  } catch (err) {
    // tags.name has a UNIQUE constraint — surface duplicates as 409, not 500
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: 'tag name already exists' }, 409);
    }
    console.error('POST /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tags/:id - delete tag
// friend_tags rows cascade via FK (ON DELETE CASCADE), but affiliate_offers.tag_id
// references tags without a cascade — D1 enforces it, so surface that as 409.
tags.delete('/api/tags/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteTag(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof Error && err.message.includes('FOREIGN KEY constraint')) {
      return c.json(
        { success: false, error: 'tag is referenced by other records (e.g. affiliate offers)' },
        409,
      );
    }
    console.error('DELETE /api/tags/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { tags };
