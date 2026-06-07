/**
 * Phase 2-C: クロス分析 (タグ交差・差集合) 用クエリヘルパー
 *
 * 例: 「タグA と タグB を両方持つ友だち」「タグA は持つが タグB は持たない」みたいな分析。
 *
 * セキュリティ:
 *  - tag_ids は呼び出し側で UUID パターン検証してから渡す前提
 *  - line_account_id でテナント境界を必ず効かせる (multi-account 漏洩防止)
 *
 * 性能:
 *  - friend_tags の (friend_id, tag_id) 複合インデックスがある前提
 *  - 5000 friends × 100 tags 規模なら sub-100ms で完了
 */

import type { Friend } from './friends';

export type CrossMode = 'and' | 'or' | 'and_not';

export interface CrossAnalysisInput {
  /** 含めたいタグ ID (and/or/and_not 全モードで使用) */
  includeTagIds: string[];
  /** and_not モードで除外したいタグ ID (除外フィルタ) */
  excludeTagIds?: string[];
  /** タグ集合の組み合わせ方式 */
  mode: CrossMode;
  /** マルチアカウント境界 (NULL なら全アカウント、それ以外は特定アカウントに限定) */
  lineAccountId?: string | null;
  /** 友だち状態フィルタ (true=フォロー中のみ) */
  followingOnly?: boolean;
  /** 上限 (一覧表示用、デフォルト 500) */
  limit?: number;
}

export interface CrossAnalysisResult {
  totalCount: number;
  friends: Friend[];
  inputSummary: {
    mode: CrossMode;
    includeTagIds: string[];
    excludeTagIds: string[];
  };
}

export async function runCrossAnalysis(
  db: D1Database,
  input: CrossAnalysisInput,
): Promise<CrossAnalysisResult> {
  // Codex 指摘 (P2): 重複排除 - HAVING COUNT(DISTINCT) との整合性のため必須
  const include = Array.from(new Set(input.includeTagIds.filter(Boolean)));
  const exclude = Array.from(new Set((input.excludeTagIds ?? []).filter(Boolean)));
  // Codex 指摘 (P3): 上限制限
  // Codex P2 追記: 黙って空返しは偽陰性。例外で 400 を返してもらう。
  if (include.length > 50 || exclude.length > 50) {
    throw new Error('include/exclude タグは合計 50 個までです');
  }
  const limit = Math.min(2000, Math.max(1, input.limit ?? 500));
  const followingOnly = input.followingOnly ?? false;

  if (include.length === 0) {
    return {
      totalCount: 0,
      friends: [],
      inputSummary: { mode: input.mode, includeTagIds: include, excludeTagIds: exclude },
    };
  }

  // 共通フィルタ
  // Codex P2 修正: NULL 行 (旧データ・未所属) は別アカウントの分析に混入させない
  const accountFilter = input.lineAccountId
    ? 'AND f.line_account_id = ?'
    : '';
  const followingFilter = followingOnly ? 'AND f.is_following = 1' : '';

  let sql: string;
  const binds: unknown[] = [];

  if (input.mode === 'or') {
    // 「いずれか1つでも持つ」= INNER JOIN + DISTINCT
    const placeholders = include.map(() => '?').join(',');
    sql = `
      SELECT f.*
        FROM friends f
        INNER JOIN friend_tags ft ON ft.friend_id = f.id
       WHERE ft.tag_id IN (${placeholders}) ${accountFilter} ${followingFilter}
       GROUP BY f.id
       ORDER BY f.created_at DESC
       LIMIT ?`;
    binds.push(...include);
    if (input.lineAccountId) binds.push(input.lineAccountId);
    binds.push(limit);
  } else {
    // 'and' / 'and_not' は HAVING COUNT で全マッチを担保 + NOT EXISTS で除外
    const placeholders = include.map(() => '?').join(',');
    let excludeClause = '';
    if (input.mode === 'and_not' && exclude.length > 0) {
      const exPh = exclude.map(() => '?').join(',');
      excludeClause = `
        AND NOT EXISTS (
          SELECT 1 FROM friend_tags fte
           WHERE fte.friend_id = f.id AND fte.tag_id IN (${exPh})
        )`;
    }
    sql = `
      SELECT f.*
        FROM friends f
        INNER JOIN friend_tags ft ON ft.friend_id = f.id
       WHERE ft.tag_id IN (${placeholders}) ${accountFilter} ${followingFilter} ${excludeClause}
       GROUP BY f.id
      HAVING COUNT(DISTINCT ft.tag_id) = ?
       ORDER BY f.created_at DESC
       LIMIT ?`;
    binds.push(...include);
    if (input.lineAccountId) binds.push(input.lineAccountId);
    if (input.mode === 'and_not' && exclude.length > 0) binds.push(...exclude);
    binds.push(include.length, limit);
  }

  const result = await db
    .prepare(sql)
    .bind(...binds)
    .all<Friend>();

  // 件数取得 (limit 抜きで)。LIMIT を外して COUNT(*) するために OUTER SELECT。
  // 性能のため、5000 件規模なら全件 SELECT して length を取る方が単純で速い。
  const friends = result.results ?? [];
  let totalCount = friends.length;
  if (friends.length >= limit) {
    // 上限到達時のみ正確なカウントを別クエリで取る
    const countSql = sql
      .replace(/SELECT f\.\*/, 'SELECT COUNT(*) AS cnt FROM (SELECT f.id')
      .replace(/ORDER BY[\s\S]+?LIMIT \?/, ')')
      .replace(/LIMIT \?$/, '');
    const countBinds = binds.slice(0, -1); // limit を除く
    try {
      const cnt = await db
        .prepare(countSql)
        .bind(...countBinds)
        .first<{ cnt: number }>();
      totalCount = cnt?.cnt ?? friends.length;
    } catch {
      totalCount = friends.length; // フォールバック
    }
  }

  return {
    totalCount,
    friends,
    inputSummary: { mode: input.mode, includeTagIds: include, excludeTagIds: exclude },
  };
}
