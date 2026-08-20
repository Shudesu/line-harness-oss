import { Hono } from 'hono';
import {
  createAffiliateOffer,
  updateAffiliateOffer,
  listAffiliateOffers,
  getAffiliateOfferById,
  type AffiliateOffer,
} from '@line-crm/db';
import type { Env } from '../index.js';

/**
 * Admin-side affiliate offer (案件) CRUD. Mounted under `/api/affiliate-offers`,
 * so it inherits admin auth from authMiddleware (only `/api/liff/*` is skipped).
 *
 * snake_case DB rows → camelCase responses via serializeOffer, mirroring
 * routes/affiliates.ts's serializeAffiliate.
 */
const affiliateOffers = new Hono<Env>();

function serializeOffer(row: AffiliateOffer) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    rewardAmount: row.reward_amount,
    rewardMiles: row.reward_miles ?? 0,
    mileageProgramId: row.mileage_program_id ?? 'default',
    lineAccountId: row.line_account_id,
    tagId: row.tag_id,
    scenarioId: row.scenario_id,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

/** reward_amount must be a non-negative integer when supplied. */
function isValidReward(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

// GET /api/affiliate-offers - list all (optionally activeOnly)
affiliateOffers.get('/api/affiliate-offers', async (c) => {
  try {
    const activeOnly = c.req.query('activeOnly') === 'true';
    const items = await listAffiliateOffers(c.env.DB, { activeOnly });
    return c.json({ success: true, data: items.map(serializeOffer) });
  } catch (err) {
    console.error('GET /api/affiliate-offers error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliate-offers/:id - get single
affiliateOffers.get('/api/affiliate-offers/:id', async (c) => {
  try {
    const item = await getAffiliateOfferById(c.env.DB, c.req.param('id'));
    if (!item) {
      return c.json({ success: false, error: 'Offer not found' }, 404);
    }
    return c.json({ success: true, data: serializeOffer(item) });
  } catch (err) {
    console.error('GET /api/affiliate-offers/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/affiliate-offers - create
affiliateOffers.post('/api/affiliate-offers', async (c) => {
  try {
    const body = await c.req
      .json<{
        name?: string;
        description?: string | null;
        rewardAmount?: number;
        rewardMiles?: number;
        lineAccountId?: string | null;
        tagId?: string | null;
        scenarioId?: string | null;
      }>()
      .catch(() => ({}) as Record<string, never>);

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }
    if (body.rewardAmount !== undefined && !isValidReward(body.rewardAmount)) {
      return c.json(
        { success: false, error: 'rewardAmount must be a non-negative integer' },
        400,
      );
    }
    if (body.rewardMiles !== undefined && !isValidReward(body.rewardMiles)) {
      return c.json(
        { success: false, error: 'rewardMiles must be a non-negative integer' },
        400,
      );
    }

    const offer = await createAffiliateOffer(c.env.DB, {
      name,
      description: body.description ?? null,
      rewardAmount: body.rewardAmount,
      rewardMiles: body.rewardMiles,
      lineAccountId: body.lineAccountId ?? null,
      tagId: body.tagId ?? null,
      scenarioId: body.scenarioId ?? null,
    });
    return c.json({ success: true, data: serializeOffer(offer) }, 201);
  } catch (err) {
    console.error('POST /api/affiliate-offers error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/affiliate-offers/:id - update
affiliateOffers.put('/api/affiliate-offers/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req
      .json<{
        name?: string;
        description?: string | null;
        rewardAmount?: number;
        rewardMiles?: number;
        lineAccountId?: string | null;
        tagId?: string | null;
        scenarioId?: string | null;
        isActive?: boolean;
      }>()
      .catch(() => ({}) as Record<string, never>);

    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
      return c.json({ success: false, error: 'name cannot be empty' }, 400);
    }
    if (body.rewardAmount !== undefined && !isValidReward(body.rewardAmount)) {
      return c.json(
        { success: false, error: 'rewardAmount must be a non-negative integer' },
        400,
      );
    }
    if (body.rewardMiles !== undefined && !isValidReward(body.rewardMiles)) {
      return c.json(
        { success: false, error: 'rewardMiles must be a non-negative integer' },
        400,
      );
    }

    const existing = await getAffiliateOfferById(c.env.DB, id);
    if (!existing) {
      return c.json({ success: false, error: 'Offer not found' }, 404);
    }

    const updated = await updateAffiliateOffer(c.env.DB, id, {
      name: body.name !== undefined ? body.name.trim() : undefined,
      description: body.description,
      reward_amount: body.rewardAmount,
      reward_miles: body.rewardMiles,
      line_account_id: body.lineAccountId,
      tag_id: body.tagId,
      scenario_id: body.scenarioId,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Offer not found' }, 404);
    }
    return c.json({ success: true, data: serializeOffer(updated) });
  } catch (err) {
    console.error('PUT /api/affiliate-offers/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { affiliateOffers };
