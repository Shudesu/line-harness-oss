import { jstNow } from './utils.js';

// --- 評価（Reviews）クエリヘルパー ---

export interface ReviewRow {
  id: string;
  booking_id: string;
  job_id: string;
  reviewer_type: 'worker' | 'nursery';
  reviewer_id: string;
  target_id: string;
  overall_rating: number;
  punctuality: number | null;
  communication: number | null;
  skill: number | null;
  attitude: number | null;
  comment: string | null;
  created_at: string;
}

export interface CreateReviewInput {
  bookingId: string;
  jobId: string;
  reviewerType: 'worker' | 'nursery';
  reviewerId: string;
  targetId: string;
  overallRating: number;
  punctuality?: number;
  communication?: number;
  skill?: number;
  attitude?: number;
  comment?: string;
}

// --- 評価作成 ---

export async function createReview(db: D1Database, input: CreateReviewInput): Promise<ReviewRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO reviews (id, booking_id, job_id, reviewer_type, reviewer_id, target_id, overall_rating, punctuality, communication, skill, attitude, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.bookingId,
      input.jobId,
      input.reviewerType,
      input.reviewerId,
      input.targetId,
      input.overallRating,
      input.punctuality ?? null,
      input.communication ?? null,
      input.skill ?? null,
      input.attitude ?? null,
      input.comment ?? null,
    )
    .run();
  return (await getReviewById(db, id))!;
}

// --- 評価取得 ---

export async function getReviewById(db: D1Database, id: string): Promise<ReviewRow | null> {
  return db.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first<ReviewRow>();
}

// --- 予約に対する評価があるか確認 ---

export async function getReviewByBookingAndType(
  db: D1Database,
  bookingId: string,
  reviewerType: 'worker' | 'nursery',
): Promise<ReviewRow | null> {
  return db
    .prepare('SELECT * FROM reviews WHERE booking_id = ? AND reviewer_type = ?')
    .bind(bookingId, reviewerType)
    .first<ReviewRow>();
}

// --- ターゲットの平均評価 ---

export interface RatingStats {
  averageRating: number;
  totalReviews: number;
  avgPunctuality: number | null;
  avgCommunication: number | null;
  avgSkill: number | null;
  avgAttitude: number | null;
}

export async function getTargetRatingStats(
  db: D1Database,
  targetId: string,
): Promise<RatingStats> {
  const row = await db
    .prepare(
      `SELECT
        ROUND(AVG(overall_rating), 1) as avg_rating,
        COUNT(*) as total,
        ROUND(AVG(punctuality), 1) as avg_punctuality,
        ROUND(AVG(communication), 1) as avg_communication,
        ROUND(AVG(skill), 1) as avg_skill,
        ROUND(AVG(attitude), 1) as avg_attitude
       FROM reviews WHERE target_id = ?`,
    )
    .bind(targetId)
    .first<{
      avg_rating: number | null;
      total: number;
      avg_punctuality: number | null;
      avg_communication: number | null;
      avg_skill: number | null;
      avg_attitude: number | null;
    }>();

  return {
    averageRating: row?.avg_rating ?? 0,
    totalReviews: row?.total ?? 0,
    avgPunctuality: row?.avg_punctuality ?? null,
    avgCommunication: row?.avg_communication ?? null,
    avgSkill: row?.avg_skill ?? null,
    avgAttitude: row?.avg_attitude ?? null,
  };
}

// --- 求人の評価一覧 ---

export async function getReviewsByJob(db: D1Database, jobId: string): Promise<ReviewRow[]> {
  const result = await db
    .prepare('SELECT * FROM reviews WHERE job_id = ? ORDER BY created_at DESC')
    .bind(jobId)
    .all<ReviewRow>();
  return result.results;
}

// --- ターゲットの評価一覧 ---

export async function getReviewsByTarget(
  db: D1Database,
  targetId: string,
  limit = 20,
): Promise<ReviewRow[]> {
  const result = await db
    .prepare('SELECT * FROM reviews WHERE target_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(targetId, limit)
    .all<ReviewRow>();
  return result.results;
}
