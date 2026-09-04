// 指名なし予約の担当スタッフ割当。
//
// 「指名なし枠」は is_designation_optional を立てた仮想スタッフ行として表現されて
// いる。この行に予約を入れてしまうと仮想スタッフが 1 件しか同時に受けられないため、
// 実スタッフが 3 名空いていても指名なしでは 1 件しか取れない。
//
// そこで予約確定時に実スタッフへ割り当てる。候補の並びは仕様どおり
//   1. その時刻に対応可能なスタッフを抽出
//   2. 当日の予約件数が少ないスタッフを優先
//   3. 同数ならスタッフ ID 順 (決定性のため)
// とする。呼び出し側は先頭から順に INSERT を試し、競合したら次の候補へ進む。

export interface AssignmentCandidate {
  staffId: string;
  /** 当日 (JST) の requested/confirmed 件数。少ない順に優先する。 */
  dayBookingCount: number;
}

/**
 * 候補を仕様の優先順位で並べる。純関数なので単体テストしやすい。
 */
export function orderAssignmentCandidates(
  candidates: AssignmentCandidate[],
): string[] {
  return [...candidates]
    .sort((a, b) =>
      a.dayBookingCount !== b.dayBookingCount
        ? a.dayBookingCount - b.dayBookingCount
        : a.staffId.localeCompare(b.staffId),
    )
    .map((c) => c.staffId);
}

/**
 * 指定日 (JST) の予約件数をスタッフ別に数える。
 * cancelled / rejected / expired は枠を占有しないので除外する。
 */
export async function countBookingsByStaffForDate(
  db: D1Database,
  staffIds: string[],
  jstDate: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>(staffIds.map((id) => [id, 0]));
  if (staffIds.length === 0) return out;
  const placeholders = staffIds.map(() => '?').join(',');
  // starts_at は UTC 保存なので JST 日付へ寄せて比較する
  const rows = await db
    .prepare(
      `SELECT staff_id, COUNT(*) AS n
         FROM bookings
        WHERE staff_id IN (${placeholders})
          AND status IN ('requested','confirmed')
          AND date(datetime(starts_at, '+9 hours')) = ?
        GROUP BY staff_id`,
    )
    .bind(...staffIds, jstDate)
    .all<{ staff_id: string; n: number }>();
  for (const r of rows.results) out.set(r.staff_id, r.n);
  return out;
}
