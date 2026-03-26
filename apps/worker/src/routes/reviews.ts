import { Hono } from 'hono';
import {
  createReview,
  getReviewByBookingAndType,
  getTargetRatingStats,
  getReviewsByTarget,
  getCalendarBookingById,
  getJobById,
  getCreditScore,
  getCancellationLog,
  processCompletion,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { assertOwnFriendId } from '../middleware/liff-auth.js';

const reviews = new Hono<Env>();

// ========== 評価投稿（公開: LIFF用 — ワーカーが園を評価） ==========

reviews.post('/api/reviews', async (c) => {
  try {
    const body = await c.req.json<{
      bookingId: string;
      reviewerType: 'worker' | 'nursery';
      reviewerId: string;
      overallRating: number;
      punctuality?: number;
      communication?: number;
      skill?: number;
      attitude?: number;
      comment?: string;
    }>();

    if (!body.bookingId || !body.reviewerType || !body.reviewerId || !body.overallRating) {
      return c.json({ success: false, error: 'bookingId, reviewerType, reviewerId, overallRating are required' }, 400);
    }

    // LIFF認証時はレビュアーIDが自分のfriendIdであることを検証
    if (c.get('liffFriendId') && body.reviewerType === 'worker' && !assertOwnFriendId(c, body.reviewerId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    if (body.overallRating < 1 || body.overallRating > 5) {
      return c.json({ success: false, error: 'overallRating must be between 1 and 5' }, 400);
    }

    // 予約情報を取得
    const booking = await getCalendarBookingById(c.env.DB, body.bookingId);
    if (!booking) return c.json({ success: false, error: 'Booking not found' }, 404);

    const jobId = booking.job_id;
    if (!jobId) return c.json({ success: false, error: 'Booking has no associated job' }, 400);

    // 重複チェック
    const existing = await getReviewByBookingAndType(c.env.DB, body.bookingId, body.reviewerType);
    if (existing) {
      return c.json({ success: false, error: 'Review already submitted for this booking' }, 400);
    }

    // ターゲットIDを決定
    // worker が評価 → ターゲットは園（job の connection_id）
    // nursery が評価 → ターゲットはワーカー（booking の friend_id）
    const job = await getJobById(c.env.DB, jobId);
    let targetId: string;
    if (body.reviewerType === 'worker') {
      targetId = job?.connection_id || jobId;
    } else {
      targetId = booking.friend_id || '';
    }

    const review = await createReview(c.env.DB, {
      bookingId: body.bookingId,
      jobId,
      reviewerType: body.reviewerType,
      reviewerId: body.reviewerId,
      targetId,
      overallRating: body.overallRating,
      punctuality: body.punctuality,
      communication: body.communication,
      skill: body.skill,
      attitude: body.attitude,
      comment: body.comment,
    });

    // ワーカーの評価投稿時、勤務完了として信用スコアを+1（チェックアウト済みの場合）
    if (body.reviewerType === 'worker' && booking.friend_id) {
      await processCompletion(c.env.DB, booking.friend_id);
    }

    return c.json({ success: true, data: { id: review.id } }, 201);
  } catch (err) {
    console.error('POST /api/reviews error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 評価ステータス確認（公開: LIFF用） ==========
// この予約に対して既に評価済みかどうか

reviews.get('/api/reviews/check', async (c) => {
  try {
    const bookingId = c.req.query('bookingId');
    const reviewerType = c.req.query('reviewerType') as 'worker' | 'nursery';
    if (!bookingId || !reviewerType) {
      return c.json({ success: false, error: 'bookingId and reviewerType are required' }, 400);
    }

    const existing = await getReviewByBookingAndType(c.env.DB, bookingId, reviewerType);
    return c.json({
      success: true,
      data: {
        hasReviewed: !!existing,
        review: existing ? {
          id: existing.id,
          overallRating: existing.overall_rating,
          comment: existing.comment,
          createdAt: existing.created_at,
        } : null,
      },
    });
  } catch (err) {
    console.error('GET /api/reviews/check error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 対象の評価統計（公開） ==========

reviews.get('/api/reviews/stats/:targetId', async (c) => {
  try {
    const targetId = c.req.param('targetId');
    const stats = await getTargetRatingStats(c.env.DB, targetId);
    return c.json({ success: true, data: stats });
  } catch (err) {
    console.error('GET /api/reviews/stats/:targetId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 対象の評価一覧（公開） ==========

reviews.get('/api/reviews/target/:targetId', async (c) => {
  try {
    const targetId = c.req.param('targetId');
    const items = await getReviewsByTarget(c.env.DB, targetId);
    return c.json({
      success: true,
      data: items.map((r) => ({
        id: r.id,
        reviewerType: r.reviewer_type,
        overallRating: r.overall_rating,
        punctuality: r.punctuality,
        communication: r.communication,
        skill: r.skill,
        attitude: r.attitude,
        comment: r.comment,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/reviews/target/:targetId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 信用スコア取得（公開: LIFF用） ==========

reviews.get('/api/credit-score/:friendId', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    // LIFF認証時は自分のスコアのみ閲覧可能
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
    const score = await getCreditScore(c.env.DB, friendId);
    return c.json({
      success: true,
      data: {
        creditScore: score.credit_score,
        totalCompleted: score.total_completed,
        totalCancelled: score.total_cancelled,
        noShowCount: score.no_show_count,
        canApply: score.credit_score > 0,
      },
    });
  } catch (err) {
    console.error('GET /api/credit-score/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== キャンセル履歴（管理: API_KEY認証） ==========

reviews.get('/api/credit-score/:friendId/history', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const log = await getCancellationLog(c.env.DB, friendId);
    return c.json({ success: true, data: log });
  } catch (err) {
    console.error('GET /api/credit-score/:friendId/history error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { reviews };
