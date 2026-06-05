/**
 * L-TRACK 互換: 認証スキップモード のマッチング処理
 *
 * skip_liff=1 のトラックリンクをクリックして友だち追加した場合、
 * クリック時点ではfriend_idが未確定。クリックログには ltp/fbclid/UA/IP のみ記録される。
 *
 * follow webhook 受信時にこの関数を呼ぶ。直近N分（デフォルト10分）の friend_id=NULL の
 * link_click を、時間窓+IP+UA で突合して、マッチしたら friend_id を埋める。
 *
 * 重要な制約: LINE follow webhook には IP/UA が来ない（公式仕様）ため、
 * このルートで取れるシグナルは「時間」のみ。同時複数 click 時は最終手段「直近1件のみ」になり、
 * L-TRACK と同じく精度に限界がある。
 *
 * 高精度モード（LIFF経由・確定的紐付け）を使う場合は、tracked_links.skip_liff=0 にする。
 */

import {
  findRecentAnonymousClickMatch,
  attachFriendToClick,
  getTrackedLinkById,
  addTagToFriend,
  enrollFriendInScenario,
} from '@line-crm/db';

export interface SkipLiffMatchResult {
  matched: boolean;
  clickId?: string;
  trackedLinkId?: string;
  strategy?: string;
  confidence?: number;
}

/**
 * follow webhook 受信時に呼ぶ。
 * @param db D1 database
 * @param friendId 新しく追加された friend のID
 * @param opts.windowSeconds 時間窓（デフォルト600秒=10分）
 * @returns マッチ成否と情報
 *
 * 注意: findRecentAnonymousClickMatch は DB layer で skip_liff=1 のtracked_link に限定済み。
 * よってここで link.skip_liff を再チェックする必要はない（DB layer で保証）。
 */
export async function trySkipLiffMatch(
  db: D1Database,
  friendId: string,
  opts: { windowSeconds?: number; lineAccountId?: string | null } = {},
): Promise<SkipLiffMatchResult> {
  const windowSeconds = opts.windowSeconds ?? 600;

  // webhook には IP/UA が来ないので、time_only マッチのみ実行可能。
  // High fix: tracked_link を先に取得（attach の前に自動アクション準備のため）。
  // High fix: lineAccountId で multi-account 境界を保つ。
  const match = await findRecentAnonymousClickMatch(db, {
    windowSeconds,
    lineAccountId: opts.lineAccountId,
  });
  if (!match) {
    return { matched: false };
  }

  // 時間窓マッチが見つかった → friend_id を埋める。
  // High fix: 競合制御のため戻り値を確認。同時 follow で既に他friendがマッチしていれば false が返る。
  const attached = await attachFriendToClick(
    db,
    match.click.id,
    friendId,
    match.strategy,
    match.confidence,
  );
  if (!attached) {
    // 既に別follow がマッチ済み（友だち追加が webhook 同時着信のレアケース）
    return { matched: false };
  }

  // tracked_link の自動アクション実行（findRecentAnonymousClickMatch で skip_liff=1 保証済み）
  const link = await getTrackedLinkById(db, match.click.tracked_link_id);
  if (link) {
    const actions: Promise<unknown>[] = [];
    if (link.tag_id) actions.push(addTagToFriend(db, friendId, link.tag_id));
    if (link.scenario_id) actions.push(enrollFriendInScenario(db, friendId, link.scenario_id));
    if (actions.length > 0) await Promise.allSettled(actions);

    // friends.first_tracked_link_id を設定（既存ロジックと同じ first-touch attribution）
    await db
      .prepare(
        `UPDATE friends
           SET first_tracked_link_id = ?
         WHERE id = ?
           AND (first_tracked_link_id IS NULL)`,
      )
      .bind(link.id, friendId)
      .run();
  }

  return {
    matched: true,
    clickId: match.click.id,
    trackedLinkId: match.click.tracked_link_id,
    strategy: match.strategy,
    confidence: match.confidence,
  };
}
