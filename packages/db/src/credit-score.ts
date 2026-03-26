import { jstNow } from './utils.js';

// --- 信用スコア（Credit Score）クエリヘルパー ---

export interface CreditScoreInfo {
  credit_score: number;
  total_completed: number;
  total_cancelled: number;
  no_show_count: number;
}

// --- スコア取得 ---

export async function getCreditScore(db: D1Database, friendId: string): Promise<CreditScoreInfo> {
  const row = await db
    .prepare('SELECT credit_score, total_completed, total_cancelled, no_show_count FROM friends WHERE id = ?')
    .bind(friendId)
    .first<CreditScoreInfo>();
  return row ?? { credit_score: 10, total_completed: 0, total_cancelled: 0, no_show_count: 0 };
}

// --- スコア計算ルール ---
// キャンセルタイミングに応じてペナルティを決定
//   early（24h以上前）: -1pt
//   late（24h〜1h前）:  -3pt
//   day_of（1h以内）:   -5pt
//   no_show（無断欠勤）: -10pt → 即利用停止
// 勤務完了ごとに +1pt 回復（上限10）

export function calculateCancelPenalty(cancelType: string): number {
  switch (cancelType) {
    case 'early': return -1;
    case 'late': return -3;
    case 'day_of': return -5;
    case 'no_show': return -10;
    default: return 0;
  }
}

export function determineCancelType(hoursBeforeWork: number): string {
  if (hoursBeforeWork < 0) return 'no_show'; // 勤務開始後
  if (hoursBeforeWork < 1) return 'day_of';
  if (hoursBeforeWork < 24) return 'late';
  return 'early';
}

// --- キャンセル処理（スコア減算＋ログ記録） ---

export async function processCancellation(
  db: D1Database,
  friendId: string,
  bookingId: string,
  jobId: string | null,
  cancelType: string,
  hoursBefore: number | null,
): Promise<{ scoreChange: number; scoreAfter: number; isBanned: boolean }> {
  const current = await getCreditScore(db, friendId);
  const scoreChange = calculateCancelPenalty(cancelType);
  const scoreAfter = Math.max(0, current.credit_score + scoreChange);

  // friends テーブル更新
  await db
    .prepare(
      `UPDATE friends SET
        credit_score = ?,
        total_cancelled = total_cancelled + 1
        ${cancelType === 'no_show' ? ', no_show_count = no_show_count + 1' : ''}
       WHERE id = ?`,
    )
    .bind(scoreAfter, friendId)
    .run();

  // キャンセルログ記録
  const logId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO cancellation_log (id, booking_id, friend_id, job_id, cancel_type, hours_before, score_change, score_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(logId, bookingId, friendId, jobId, cancelType, hoursBefore, scoreChange, scoreAfter)
    .run();

  return {
    scoreChange,
    scoreAfter,
    isBanned: scoreAfter <= 0 || cancelType === 'no_show',
  };
}

// --- 勤務完了処理（スコア回復） ---

export async function processCompletion(
  db: D1Database,
  friendId: string,
): Promise<{ scoreAfter: number }> {
  const current = await getCreditScore(db, friendId);
  const scoreAfter = Math.min(10, current.credit_score + 1);

  await db
    .prepare(
      'UPDATE friends SET credit_score = ?, total_completed = total_completed + 1 WHERE id = ?',
    )
    .bind(scoreAfter, friendId)
    .run();

  return { scoreAfter };
}

// --- キャンセル履歴取得 ---

export interface CancellationLogRow {
  id: string;
  booking_id: string;
  friend_id: string;
  job_id: string | null;
  cancel_type: string;
  hours_before: number | null;
  score_change: number;
  score_after: number;
  created_at: string;
}

export async function getCancellationLog(
  db: D1Database,
  friendId: string,
  limit = 20,
): Promise<CancellationLogRow[]> {
  const result = await db
    .prepare('SELECT * FROM cancellation_log WHERE friend_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(friendId, limit)
    .all<CancellationLogRow>();
  return result.results;
}
