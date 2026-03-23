import { jstNow } from './utils.js';
// スコアリング（Lead Scoring）クエリヘルパー

export interface ScoringRuleRow {
  id: string;
  name: string;
  event_type: string;
  score_value: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface FriendScoreRow {
  id: string;
  friend_id: string;
  scoring_rule_id: string | null;
  score_change: number;
  reason: string | null;
  created_at: string;
}

// --- スコアリングルール ---

export async function getScoringRules(db: D1Database): Promise<ScoringRuleRow[]> {
  const result = await db.prepare(`SELECT * FROM scoring_rules ORDER BY created_at DESC`).all<ScoringRuleRow>();
  return result.results;
}

export async function getScoringRuleById(db: D1Database, id: string): Promise<ScoringRuleRow | null> {
  return db.prepare(`SELECT * FROM scoring_rules WHERE id = ?`).bind(id).first<ScoringRuleRow>();
}

export async function createScoringRule(
  db: D1Database,
  input: { name: string; eventType: string; scoreValue: number },
): Promise<ScoringRuleRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO scoring_rules (id, name, event_type, score_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.eventType, input.scoreValue, now, now).run();
  return (await getScoringRuleById(db, id))!;
}

export async function updateScoringRule(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; eventType: string; scoreValue: number; isActive: boolean }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.eventType !== undefined) { sets.push('event_type = ?'); values.push(updates.eventType); }
  if (updates.scoreValue !== undefined) { sets.push('score_value = ?'); values.push(updates.scoreValue); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE scoring_rules SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteScoringRule(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM scoring_rules WHERE id = ?`).bind(id).run();
}

// --- スコア記録 ---

/** スコアイベントを記録し、friendsテーブルのスコアキャッシュを更新 */
export async function addScore(
  db: D1Database,
  input: { friendId: string; scoringRuleId?: string; scoreChange: number; reason?: string },
): Promise<void> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO friend_scores (id, friend_id, scoring_rule_id, score_change, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.friendId, input.scoringRuleId ?? null, input.scoreChange, input.reason ?? null, now).run();

  // スコアキャッシュを更新
  await db.prepare(`UPDATE friends SET score = score + ?, updated_at = ? WHERE id = ?`)
    .bind(input.scoreChange, now, input.friendId).run();
}

/** 友だちの現在スコアを取得 */
export async function getFriendScore(db: D1Database, friendId: string): Promise<number> {
  const row = await db.prepare(`SELECT score FROM friends WHERE id = ?`).bind(friendId).first<{ score: number }>();
  return row?.score ?? 0;
}

/** 友だちのスコア履歴を取得 */
export async function getFriendScoreHistory(db: D1Database, friendId: string): Promise<FriendScoreRow[]> {
  const result = await db.prepare(`SELECT * FROM friend_scores WHERE friend_id = ? ORDER BY created_at DESC`)
    .bind(friendId).all<FriendScoreRow>();
  return result.results;
}

/** イベントタイプに一致するアクティブなスコアリングルールを取得 */
export async function getActiveRulesByEvent(db: D1Database, eventType: string): Promise<ScoringRuleRow[]> {
  const result = await db.prepare(`SELECT * FROM scoring_rules WHERE event_type = ? AND is_active = 1`)
    .bind(eventType).all<ScoringRuleRow>();
  return result.results;
}

/** イベント発生時にスコアリングルールを適用 */
export async function applyScoring(db: D1Database, friendId: string, eventType: string): Promise<number> {
  const rules = await getActiveRulesByEvent(db, eventType);
  let totalChange = 0;
  for (const rule of rules) {
    await addScore(db, {
      friendId,
      scoringRuleId: rule.id,
      scoreChange: rule.score_value,
      reason: `${eventType} → ${rule.name}`,
    });
    totalChange += rule.score_value;
  }
  return totalChange;
}
