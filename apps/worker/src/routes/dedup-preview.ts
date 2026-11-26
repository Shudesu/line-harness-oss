import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { Hono } from 'hono';
import { computeDedupBroadcastPreview } from '../services/dedup-broadcast.js';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

const dedupPreview = createAuthorizedRouter<Env>();

dedupPreview.post(
  '/api/broadcasts/dedup-preview',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const body = await c.req.json<{ accountIds: unknown; dedupPriority: unknown; targetTagId?: unknown }>();
    if (!Array.isArray(body.accountIds) || !body.accountIds.every((x) => typeof x === 'string')) {
      return c.json({ success: false, error: 'accountIds: array of strings required' }, 400);
    }
    if (!Array.isArray(body.dedupPriority) || !body.dedupPriority.every((x) => typeof x === 'string')) {
      return c.json({ success: false, error: 'dedupPriority: array of strings required' }, 400);
    }
    if (
      body.targetTagId !== undefined &&
      body.targetTagId !== null &&
      typeof body.targetTagId !== 'string'
    ) {
      return c.json({ success: false, error: 'targetTagId: string or null' }, 400);
    }
    const accountIds = body.accountIds as string[];
    const dedupPriority = body.dedupPriority as string[];
    const targetTagId = (body.targetTagId as string | null | undefined) ?? null;

    const preview = await computeDedupBroadcastPreview(
      c.env.DB,
      accountIds,
      dedupPriority,
      targetTagId,
    );

    // Strip recipients[] before returning — it's needed only by the send executor,
    // not the UI. Keeps the response payload small for large broadcasts.
    return c.json({
      success: true,
      data: {
        totalSelected: preview.totalSelected,
        uniqueRecipients: preview.uniqueRecipients,
        reduction: preview.reduction,
        reductionRate: preview.reductionRate,
        perAccount: preview.perAccount.map(({ recipients: _r, ...rest }) => rest),
      },
    });
  },
);

export default dedupPreview;
