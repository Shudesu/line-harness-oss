import { Hono } from 'hono';
import {
  getConversionPoints,
  getConversionPointById,
  createConversionPoint,
  deleteConversionPoint,
  trackConversion,
  getConversionEvents,
  getConversionReport,
  getConversionApprovalQueue,
  setConversionApproval,
  getConversionApprovalNotifyInfo,
  syncAffiliateConversionMileage,
} from '@line-crm/db';
import { IDENTITY_KEY_SQL } from '../lib/identity-key.js';
import { notifyAffiliateApproval } from '../services/affiliate-notifier.js';
import type { Env } from '../index.js';

const conversions = new Hono<Env>();

// ── Conversion Points ───────────────────────────────────────────────────────

// GET /api/conversions/points - list all
conversions.get('/api/conversions/points', async (c) => {
  try {
    const items = await getConversionPoints(c.env.DB);
    return c.json({
      success: true,
      data: items.map((p) => ({
        id: p.id,
        name: p.name,
        eventType: p.event_type,
        value: p.value,
        createdAt: p.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/conversions/points error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/conversions/points - create
conversions.post('/api/conversions/points', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      eventType: string;
      value?: number | null;
    }>();

    if (!body.name || !body.eventType) {
      return c.json({ success: false, error: 'name and eventType are required' }, 400);
    }

    const point = await createConversionPoint(c.env.DB, body);
    return c.json({
      success: true,
      data: {
        id: point.id,
        name: point.name,
        eventType: point.event_type,
        value: point.value,
        createdAt: point.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/conversions/points error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/conversions/points/:id - delete
conversions.delete('/api/conversions/points/:id', async (c) => {
  try {
    await deleteConversionPoint(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/conversions/points/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── Conversion Tracking ─────────────────────────────────────────────────────

// POST /api/conversions/track - record conversion
conversions.post('/api/conversions/track', async (c) => {
  try {
    const body = await c.req.json<{
      conversionPointId: string;
      friendId: string;
      userId?: string | null;
      affiliateCode?: string | null;
      metadata?: Record<string, unknown> | null;
    }>();

    if (!body.conversionPointId || !body.friendId) {
      return c.json(
        { success: false, error: 'conversionPointId and friendId are required' },
        400,
      );
    }

    const event = await trackConversion(c.env.DB, {
      conversionPointId: body.conversionPointId,
      friendId: body.friendId,
      userId: body.userId,
      affiliateCode: body.affiliateCode,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    });

    return c.json({
      success: true,
      data: {
        id: event.id,
        conversionPointId: event.conversion_point_id,
        friendId: event.friend_id,
        userId: event.user_id,
        affiliateCode: event.affiliate_code,
        metadata: event.metadata,
        createdAt: event.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/conversions/track error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/conversions/events - list events with filters
conversions.get('/api/conversions/events', async (c) => {
  try {
    const events = await getConversionEvents(c.env.DB, {
      conversionPointId: c.req.query('conversionPointId'),
      friendId: c.req.query('friendId'),
      affiliateCode: c.req.query('affiliateCode'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      limit: Number(c.req.query('limit') ?? '100'),
      offset: Number(c.req.query('offset') ?? '0'),
    });

    return c.json({
      success: true,
      data: events.map((e) => ({
        id: e.id,
        conversionPointId: e.conversion_point_id,
        friendId: e.friend_id,
        userId: e.user_id,
        affiliateCode: e.affiliate_code,
        metadata: e.metadata,
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/conversions/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/conversions/report - aggregated report
conversions.get('/api/conversions/report', async (c) => {
  try {
    const report = await getConversionReport(c.env.DB, {
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    });

    return c.json({ success: true, data: report });
  } catch (err) {
    console.error('GET /api/conversions/report error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── Approval Queue (ASP Phase 2) ─────────────────────────────────────────────

const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected']);

// GET /api/conversions/approvals?status=pending|approved|rejected
// Affiliate-attributed CVs awaiting/holding an approval decision. duplicateFlag
// reuses the Phase 1 identity_key heuristic scoped per affiliate.
conversions.get('/api/conversions/approvals', async (c) => {
  try {
    const status = c.req.query('status') ?? 'pending';
    if (!APPROVAL_STATUSES.has(status)) {
      return c.json(
        { success: false, error: 'status must be pending, approved, or rejected' },
        400,
      );
    }

    const limit = Math.min(500, Math.max(1, Number.parseInt(c.req.query('limit') ?? '', 10) || 200));
    const offset = Math.max(0, Number.parseInt(c.req.query('offset') ?? '', 10) || 0);

    const rows = await getConversionApprovalQueue(c.env.DB, {
      status: status as 'pending' | 'approved' | 'rejected',
      identityKeySql: IDENTITY_KEY_SQL,
      limit,
      offset,
    });

    return c.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api/conversions/approvals error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/conversions/events/:id/approval - approve/reject an attributed CV
conversions.patch('/api/conversions/events/:id/approval', async (c) => {
  try {
    const body = await c.req
      .json<{ status?: string }>()
      .catch(() => ({}) as { status?: string });

    if (body.status !== 'approved' && body.status !== 'rejected') {
      return c.json(
        { success: false, error: 'status must be approved or rejected' },
        400,
      );
    }

    const updated = await setConversionApproval(
      c.env.DB,
      c.req.param('id'),
      body.status,
    );
    if (updated === false) {
      // Missing event OR non-attributed CV (approval flow only applies to
      // affiliate-attributed rows) — both surface as 404.
      return c.json(
        { success: false, error: 'Attributed conversion event not found' },
        404,
      );
    }

    // Mileage projection is retry-safe and runs even for `already_set`. This is
    // deliberate: if an earlier request updated the approval row but failed
    // before writing the ledger, the operator's retry repairs the partial work.
    await syncAffiliateConversionMileage(
      c.env.DB,
      c.req.param('id'),
      body.status,
    );

    if (updated === 'already_set') {
      // Idempotent re-click: the status is already set to the requested value.
      // Return 200 so the UI does not show an error to the operator.
      return c.json({
        success: true,
        data: { id: c.req.param('id'), approvalStatus: body.status },
      });
    }

    // ASP: notify the attributed affiliate on approval only (never on reject).
    // Best-effort — notifyAffiliateApproval swallows its own errors, but guard
    // the info lookup too so a push failure can never fail the approval request.
    if (body.status === 'approved') {
      try {
        const info = await getConversionApprovalNotifyInfo(c.env.DB, c.req.param('id'));
        if (info) {
          await notifyAffiliateApproval(
            c.env.DB,
            c.env,
            info.affiliateId,
            info.offerName,
            info.rewardAmount,
          );
        }
      } catch (err) {
        console.error('Affiliate approval notify failed (non-blocking):', err);
      }
    }

    return c.json({ success: true, data: { id: c.req.param('id'), approvalStatus: body.status } });
  } catch (err) {
    console.error('PATCH /api/conversions/events/:id/approval error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { conversions };
