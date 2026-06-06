/**
 * L-TRACK 互換: レポート集計
 *
 * 期間別/月別/日別の集計を返す。L-TRACK のレポートUIと同じカラム:
 *   - メディア名 / トラック名 / トラックコード
 *   - クリック数
 *   - 友だち登録数 + 登録率 (%)
 *   - 初回ブロック発生 1H/3H/24H/全体 (件数 + %)
 *   - AF確定条件 / 確定件数 / 単価 / 報酬額
 *
 * 「発生日」起点で集計（L-TRACK 仕様。友だち登録日ベースではない）。
 *  = link_clicks.clicked_at をベースに集計する。
 */

export interface ReportRow {
  tracked_link_id: string;
  tracked_link_name: string;
  media_name: string | null;
  af_confirm_type: 'immediate' | '1h' | '3h' | '24h';
  af_amount: number | null;
  // クリックと登録
  click_count: number;
  friend_add_count: number;
  // 初回ブロック (友だち追加から N 時間以内に is_following=0 になった件数)
  block_1h: number;
  block_3h: number;
  block_24h: number;
  block_total: number;
  // AF確定
  af_confirmed_count: number;  // ad_conversion_logs で status='sent' な件数
  af_revenue_yen: number;       // af_amount × af_confirmed_count
  // 集計キー (期間/月/日)
  bucket: string;
}

export type ReportGranularity = 'total' | 'month' | 'day';

/**
 * レポート集計クエリ。
 *
 * since/until が指定されると link_clicks.clicked_at で絞る。
 * lineAccountId で multi-account 境界を絞る。
 * granularity で集計軸を変える（total = 期間別1行、month = 年月別、day = 日別）。
 */
export async function getReport(
  db: D1Database,
  opts: {
    since?: string;
    until?: string;
    lineAccountId?: string | null;
    granularity?: ReportGranularity;
    trackedLinkId?: string;
  } = {},
): Promise<ReportRow[]> {
  const granularity = opts.granularity ?? 'total';

  const wheres: string[] = ['1 = 1'];
  const binds: unknown[] = [];
  if (opts.since) {
    wheres.push('lc.clicked_at >= ?');
    binds.push(opts.since);
  }
  if (opts.until) {
    wheres.push('lc.clicked_at <= ?');
    binds.push(opts.until);
  }
  if (opts.lineAccountId) {
    wheres.push('(tl.line_account_id IS NULL OR tl.line_account_id = ?)');
    binds.push(opts.lineAccountId);
  }
  if (opts.trackedLinkId) {
    wheres.push('tl.id = ?');
    binds.push(opts.trackedLinkId);
  }

  const bucketExpr =
    granularity === 'month'
      ? `substr(lc.clicked_at, 1, 7)`
      : granularity === 'day'
        ? `substr(lc.clicked_at, 1, 10)`
        : `'total'`;

  // Codex指摘 High対応:
  // - AF確定集計 (afc) は base と同じ since/until/lineAccountId/trackedLinkId フィルタを反映
  // - friend を別リンクで二重カウントしないため、friend_id × tracked_link_id でグループ化
  // - ブロック判定は friends.blocked_at が利用可能ならそれを使い、無ければ updated_at で代替し、
  //   コメントで「profile変更で誤判定し得る」と明示する
  // - bucket は base 側で確定したものを afc 側にも使えるよう、follower のための join 用にユニーク化
  //
  // 簡素化: af_confirmed_count は base 行(=同 bucket × 同 tracked_link_id) ごとに、
  // ad_conversion_logs.sent な friend が「その bucket × link 範囲内のクリックを持つ」件数で数える。
  // これにより指定期間外CVが混入しない。
  const sql = `
    WITH base AS (
      SELECT
        ${bucketExpr} AS bucket,
        tl.id            AS tracked_link_id,
        tl.name          AS tracked_link_name,
        tl.media_name    AS media_name,
        tl.af_confirm_type AS af_confirm_type,
        tl.af_amount     AS af_amount,
        lc.id            AS click_id,
        lc.friend_id     AS friend_id,
        lc.clicked_at    AS clicked_at,
        f.id             AS f_id,
        f.created_at     AS f_created_at,
        f.is_following   AS f_is_following,
        f.updated_at     AS f_updated_at
      FROM link_clicks lc
      INNER JOIN tracked_links tl ON tl.id = lc.tracked_link_id
      LEFT JOIN friends f ON f.id = lc.friend_id
      WHERE ${wheres.join(' AND ')}
    ),
    afc AS (
      SELECT DISTINCT
        base.bucket,
        base.tracked_link_id,
        base.f_id AS friend_id
      FROM base
      INNER JOIN ad_conversion_logs l
        ON l.friend_id = base.f_id
        AND l.status = 'sent'
        AND l.created_at >= COALESCE(base.clicked_at, l.created_at)
    )
    SELECT
      base.bucket,
      base.tracked_link_id,
      base.tracked_link_name,
      base.media_name,
      base.af_confirm_type,
      base.af_amount,
      COUNT(DISTINCT base.click_id) AS click_count,
      COUNT(DISTINCT base.f_id)     AS friend_add_count,
      -- ブロック判定: friends.is_following=0 かつ updated_at が created_at から N 時間以内。
      -- 注: profile 更新でも updated_at が動くため、誤判定の余地あり (Codex指摘 Medium)。
      -- 厳密化には blocked_at 専用カラムが必要 (将来 migration 058)。
      SUM(CASE WHEN base.f_is_following = 0
                 AND base.f_updated_at IS NOT NULL
                 AND (julianday(base.f_updated_at) - julianday(base.f_created_at)) <= (1.0/24.0)
               THEN 1 ELSE 0 END) AS block_1h,
      SUM(CASE WHEN base.f_is_following = 0
                 AND base.f_updated_at IS NOT NULL
                 AND (julianday(base.f_updated_at) - julianday(base.f_created_at)) <= (3.0/24.0)
               THEN 1 ELSE 0 END) AS block_3h,
      SUM(CASE WHEN base.f_is_following = 0
                 AND base.f_updated_at IS NOT NULL
                 AND (julianday(base.f_updated_at) - julianday(base.f_created_at)) <= 1.0
               THEN 1 ELSE 0 END) AS block_24h,
      SUM(CASE WHEN base.f_is_following = 0 THEN 1 ELSE 0 END) AS block_total,
      (SELECT COUNT(*) FROM afc WHERE afc.bucket = base.bucket AND afc.tracked_link_id = base.tracked_link_id) AS af_confirmed_count
    FROM base
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY base.bucket DESC, base.tracked_link_name ASC
  `;

  const result = await db.prepare(sql).bind(...binds).all<ReportRow & { af_confirmed_count: number }>();
  return (result.results ?? []).map((r) => ({
    ...r,
    af_revenue_yen: (r.af_amount ?? 0) * (r.af_confirmed_count ?? 0),
  }));
}
