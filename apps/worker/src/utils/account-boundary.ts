/**
 * Codex P0 修正用: friend と lineAccountId の所属境界を検査する共通ヘルパ。
 *
 * 任意 UUID で他テナント friend に対する読み取り/更新/CV記録/スコア加算が
 * できる経路があったため、各ルートで以下を強制する:
 *   1. friendId / lineAccountId の形式チェック (UUID/シンプル hex)
 *   2. friend 行の存在チェック
 *   3. friend.line_account_id が呼び出し側の lineAccountId と厳密一致する
 *
 * Codex P1 修正 (2026-06-07): UI 側が lineAccountId を渡すよう改修済のため、
 * legacy NULL 救済 (line_account_id IS NULL の friend を素通し) は撤去した。
 * NULL row を残すと他テナント経由で読まれるリスクがあるため、本関数が呼ばれた
 * 時点 (= UI から lineAccountId が来た時点) では legacy 救済はしない。
 * UI が lineAccountId を渡さない場合の互換性は、各ルート側で関数を呼ばずに
 * legacy 互換分岐を残して担保する。
 *
 * 形式: friends.bulk と同じ idPattern を使う。
 */

const idPattern = /^[a-f0-9-]{32,36}$/i;

export interface FriendBoundaryRow {
  id: string;
  line_account_id: string | null;
}

export type GetFriendOrRejectResult<F extends FriendBoundaryRow> =
  | { ok: true; friend: F }
  | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * friendId と lineAccountId のフォーマット検証 + friend 行取得 + 所属境界チェックを
 * 1 ステップで実行する。呼び出し側はマッチした friend 行 (line_account_id 込) を
 * そのまま使える。
 *
 * Codex P1 修正 (2026-06-07): legacy NULL 救済を撤去。lineAccountId が指定された
 * 呼び出し (= 厳密境界モード) では、friend.line_account_id が一致しない限り 403。
 * NULL row も含めて他テナント経由で読まれないように扱う。
 */
export async function getFriendOrReject(
  db: D1Database,
  friendId: string,
  lineAccountId: string,
): Promise<GetFriendOrRejectResult<FriendBoundaryRow>> {
  if (!idPattern.test(friendId) || !idPattern.test(lineAccountId)) {
    return { ok: false, status: 400, error: 'invalid id format' };
  }
  const friend = await db
    .prepare('SELECT id, line_account_id FROM friends WHERE id = ?')
    .bind(friendId)
    .first<FriendBoundaryRow>();
  if (!friend) {
    return { ok: false, status: 404, error: 'friend not found' };
  }
  if (friend.line_account_id !== lineAccountId) {
    return {
      ok: false,
      status: 403,
      error: '別のアカウントに属する friend です',
    };
  }
  return { ok: true, friend };
}

/**
 * idPattern を再利用したいルート用 (個別 validation を加えたいとき)。
 */
export function isValidAccountOrFriendId(id: string): boolean {
  return idPattern.test(id);
}
