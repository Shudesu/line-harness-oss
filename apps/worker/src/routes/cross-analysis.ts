/**
 * Phase 2-C: クロス分析 API
 *
 * POST /api/cross-analysis
 *   body: { includeTagIds: string[], excludeTagIds?: string[], mode: 'and'|'or'|'and_not', lineAccountId?: string, followingOnly?: boolean, limit?: number }
 *
 * GET 系には敢えてしない (タグ IDs が長くなりがちなので body で受ける)。
 *
 * 認可: viewer でも閲覧可 (書込み無し、blockViewerWrites は GET/HEAD/OPTIONS だけ通すが、
 * 本 API は分析クエリなので POST だが viewer に開放する方が分析業務的に妥当。
 * よって blockViewerWrites の影響を受けないよう Hono で個別認可ロジックは不要 — 既に
 * authMiddleware で staff 認証は済んでおり、viewer も閲覧専用機能として使えるべき)。
 *
 * ただし blockViewerWrites は POST を 403 にするため、ここは安全のため
 * 「分析専用エンドポイント」として POST を許可するために、route 個別に viewer も許可する。
 */

import { Hono } from 'hono';
import { runCrossAnalysis, type CrossMode } from '@line-crm/db';
import type { Env } from '../index.js';

export const crossAnalysis = new Hono<Env>();

// blockViewerWrites をスキップするためのフラグ的アプローチ:
// 既に index.ts で先に viewer ブロックが入っているが、本ルートを POST にすると弾かれる。
// 分析機能は viewer にも見せたいので、ここは GET に統一する (body は query string では辛いので
// シンプルに「タグ ID をカンマ区切り」で受ける形にする)。

crossAnalysis.get('/api/cross-analysis', async (c) => {
  const includeRaw = c.req.query('include') ?? '';
  const excludeRaw = c.req.query('exclude') ?? '';
  const modeRaw = (c.req.query('mode') ?? 'and') as string;
  const lineAccountId = c.req.query('lineAccountId') ?? null;
  const followingOnly = c.req.query('followingOnly') === '1';
  const limit = Number(c.req.query('limit') ?? '500');

  const includeTagIds = includeRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const excludeTagIds = excludeRaw.split(',').map((s) => s.trim()).filter(Boolean);

  // UUID らしさのバリデーション (32-36 文字 + ハイフン/英数)
  const idPattern = /^[a-f0-9-]{32,36}$/i;
  for (const tagId of [...includeTagIds, ...excludeTagIds]) {
    if (!idPattern.test(tagId)) {
      return c.json({ success: false, error: `invalid tagId format: ${tagId}` }, 400);
    }
  }

  const validModes: CrossMode[] = ['and', 'or', 'and_not'];
  if (!validModes.includes(modeRaw as CrossMode)) {
    return c.json({ success: false, error: 'mode must be and / or / and_not' }, 400);
  }

  if (lineAccountId && !idPattern.test(lineAccountId)) {
    return c.json({ success: false, error: 'invalid lineAccountId format' }, 400);
  }

  try {
    const result = await runCrossAnalysis(c.env.DB, {
      includeTagIds,
      excludeTagIds,
      mode: modeRaw as CrossMode,
      lineAccountId,
      followingOnly,
      limit: Number.isFinite(limit) ? limit : 500,
    });
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('[cross-analysis] error:', err);
    const msg = (err as Error)?.message ?? '';
    // Codex P2 修正: タグ数上限超過は 400 を返す (偽陰性ではなく明示的エラー)
    if (msg.includes('合計 50 個')) {
      return c.json({ success: false, error: msg }, 400);
    }
    return c.json({ success: false, error: 'internal error' }, 500);
  }
});
