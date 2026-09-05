import { Hono } from 'hono';
import {
  getAffiliates,
  getAffiliateById,
  getAffiliateByCode,
  createAffiliate,
  createAffiliateWithRandomCode,
  createAffiliateLink,
  updateAffiliate,
  deleteAffiliate,
  recordAffiliateClick,
  getAffiliateReport,
  getAffiliateReportV2,
  getFriendById,
  getFriendJourney,
  getAffiliateByFriendId,
  getAffiliateJourneys,
  listAffiliateLinks,
  listAffiliateOffers,
} from '@line-crm/db';
import { IDENTITY_KEY_SQL } from '../lib/identity-key.js';
import { resolveLinkBaseUrl } from '../lib/link-base-url.js';
import type { Env } from '../index.js';

const affiliates = new Hono<Env>();

function serializeAffiliate(row: { id: string; name: string; code: string; commission_rate: number; is_active: number; created_at: string; friend_id?: string | null }) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    commissionRate: row.commission_rate,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    friendId: row.friend_id ?? null,
  };
}

// GET /api/affiliates - list all
affiliates.get('/api/affiliates', async (c) => {
  try {
    const items = await getAffiliates(c.env.DB);
    return c.json({ success: true, data: items.map(serializeAffiliate) });
  } catch (err) {
    console.error('GET /api/affiliates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliates/:id - get single
affiliates.get('/api/affiliates/:id', async (c) => {
  try {
    const item = await getAffiliateById(c.env.DB, c.req.param('id'));
    if (!item) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    return c.json({ success: true, data: serializeAffiliate(item) });
  } catch (err) {
    console.error('GET /api/affiliates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/affiliates - create (admin-side)
//
// Three call shapes, all backward compatible:
//   1. Random-code create:  { name?, commissionRate?, friendId?, issueInitialLink? }
//        - `code` is auto-generated (unguessable base62 slug). No manual entry.
//        - `friendId` binds the affiliate 1:1 to a LINE friend (migration 046
//          partial UNIQUE index enforces one affiliate per friend).
//        - When friendId is given, `name` defaults to the friend's display_name
//          and an initial link is issued by default (issueInitialLink=true).
//   2. Legacy explicit create: { name, code, commissionRate? }
//        - OSS back-compat. `code` must be >= 4 chars, alphanumeric only.
const CODE_RE = /^[A-Za-z0-9]{4,}$/;

affiliates.post('/api/affiliates', async (c) => {
  try {
    const body = await c.req.json<{
      name?: string;
      code?: string;
      commissionRate?: number;
      friendId?: string;
      issueInitialLink?: boolean;
    }>();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const friendId = typeof body.friendId === 'string' ? body.friendId.trim() : '';

    // Require at least one of name / code / friendId to identify the affiliate.
    if (!name && !code && !friendId) {
      return c.json(
        { success: false, error: 'name, code, or friendId is required' },
        400,
      );
    }

    // Resolve the friend (if binding) up front: 404 on unknown friend, and use
    // its display_name when the caller did not supply a name.
    let resolvedName = name;
    if (friendId) {
      const friend = await getFriendById(c.env.DB, friendId);
      if (!friend) {
        return c.json({ success: false, error: 'Friend not found' }, 404);
      }
      if (!resolvedName) {
        resolvedName = (friend.display_name || 'Affiliate').trim();
      }
    }

    // ── Legacy explicit-code path (OSS back-compat) ─────────────────────────
    // Only taken when a code was supplied AND no friend binding is requested.
    if (code && !friendId) {
      if (!CODE_RE.test(code)) {
        return c.json(
          {
            success: false,
            error: 'code must be at least 4 alphanumeric characters',
          },
          400,
        );
      }
      if (!resolvedName) {
        return c.json({ success: false, error: 'name is required' }, 400);
      }
      try {
        const item = await createAffiliate(c.env.DB, {
          name: resolvedName,
          code,
          commissionRate: body.commissionRate,
        });
        return c.json({ success: true, data: serializeAffiliate(item) }, 201);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/UNIQUE constraint failed/i.test(msg) && /affiliates\.code/i.test(msg)) {
          return c.json(
            { success: false, error: 'このコードは既に使われています' },
            409,
          );
        }
        throw err;
      }
    }

    // ── Random-code path (admin default) ────────────────────────────────────
    if (!resolvedName) {
      resolvedName = 'Affiliate';
    }

    let item;
    try {
      item = await createAffiliateWithRandomCode(c.env.DB, {
        name: resolvedName,
        commissionRate: body.commissionRate,
        friendId: friendId || null,
      });
    } catch (err) {
      // The friend_id partial UNIQUE index throws when the friend already has an
      // affiliate. Confirm and return 409 with a friendly message.
      const msg = err instanceof Error ? err.message : String(err);
      if (friendId && /UNIQUE constraint failed/i.test(msg)) {
        const existing = await getAffiliateByFriendId(c.env.DB, friendId);
        if (existing) {
          return c.json(
            { success: false, error: 'この友だちは既にアフィリエイターです' },
            409,
          );
        }
      }
      throw err;
    }

    // Issue an initial link. Defaults to true when a friend is bound.
    const shouldIssueLink =
      body.issueInitialLink !== undefined
        ? body.issueInitialLink
        : Boolean(friendId);

    let link: { refCode: string; url: string } | undefined;
    if (shouldIssueLink) {
      const created = await createAffiliateLink(c.env.DB, { affiliateId: item.id });
      const baseUrl = await resolveLinkBaseUrl(c.env.DB, c.env);
      link = { refCode: created.ref_code, url: `${baseUrl}/${created.ref_code}` };
    }

    return c.json(
      { success: true, data: serializeAffiliate(item), link: link ?? null },
      201,
    );
  } catch (err) {
    console.error('POST /api/affiliates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/affiliates/:id - update
affiliates.put('/api/affiliates/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      commissionRate?: number;
      isActive?: boolean;
    }>();

    const updated = await updateAffiliate(c.env.DB, id, {
      name: body.name,
      commission_rate: body.commissionRate,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    return c.json({ success: true, data: serializeAffiliate(updated) });
  } catch (err) {
    console.error('PUT /api/affiliates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/affiliates/:id - delete
affiliates.delete('/api/affiliates/:id', async (c) => {
  try {
    await deleteAffiliate(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/affiliates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliates/:id/report - affiliate performance report (v2)
// Extends the legacy report with ref_tracking-based clicks, add-time friendAdds,
// conversionsByPoint, estimatedCommission and identity-key duplicateFlags.
affiliates.get('/api/affiliates/:id/report', async (c) => {
  try {
    const report = await getAffiliateReportV2(c.env.DB, c.req.param('id'), {
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      identityKeySql: IDENTITY_KEY_SQL,
    });

    if (!report) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    return c.json({ success: true, data: report });
  } catch (err) {
    console.error('GET /api/affiliates/:id/report error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliates/:id/journeys - attributed-friend journey summaries
// Cursor-paginated on (addedAt, friendId), same scheme as GET /api/chats.
affiliates.get('/api/affiliates/:id/journeys', async (c) => {
  try {
    const affiliate = await getAffiliateById(c.env.DB, c.req.param('id'));
    if (!affiliate) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10);
    const page = await getAffiliateJourneys(c.env.DB, c.req.param('id'), {
      limit: Number.isFinite(limitParam) ? limitParam : undefined,
      beforeAt: c.req.query('beforeAt') || undefined,
      beforeId: c.req.query('beforeId') || undefined,
    });
    return c.json({ success: true, data: page.items, nextCursor: page.nextCursor });
  } catch (err) {
    console.error('GET /api/affiliates/:id/journeys error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliates/:id/links - list all ref_code links for an affiliate
affiliates.get('/api/affiliates/:id/links', async (c) => {
  try {
    const affiliate = await getAffiliateById(c.env.DB, c.req.param('id'));
    if (!affiliate) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    const links = await listAffiliateLinks(c.env.DB, c.req.param('id'));
    const offerNames = await (async () => {
      const offers = await listAffiliateOffers(c.env.DB, { activeOnly: false });
      return new Map(offers.map((o) => [o.id, o.name]));
    })();
    const data = links.map((row) => ({
      ...row,
      offer_name: row.offer_id != null ? (offerNames.get(row.offer_id) ?? null) : null,
    }));
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/affiliates/:id/links error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/:id/journey - time-ordered event journey for one friend
affiliates.get('/api/friends/:id/journey', async (c) => {
  try {
    const events = await getFriendJourney(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: { events } });
  } catch (err) {
    console.error('GET /api/friends/:id/journey error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/affiliates/click - record click (public endpoint tracked by ref param)
affiliates.post('/api/affiliates/click', async (c) => {
  try {
    const body = await c.req.json<{
      code: string;
      url?: string | null;
    }>();

    if (!body.code) {
      return c.json({ success: false, error: 'code is required' }, 400);
    }

    const affiliate = await getAffiliateByCode(c.env.DB, body.code);
    if (!affiliate) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }

    const ipAddress = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null;
    await recordAffiliateClick(c.env.DB, affiliate.id, body.url, ipAddress);
    return c.json({ success: true, data: null }, 201);
  } catch (err) {
    console.error('POST /api/affiliates/click error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliates/report - all affiliates report
affiliates.get('/api/affiliates-report', async (c) => {
  try {
    const report = await getAffiliateReport(c.env.DB, undefined, {
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    });
    return c.json({ success: true, data: report });
  } catch (err) {
    console.error('GET /api/affiliates-report error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { affiliates };
