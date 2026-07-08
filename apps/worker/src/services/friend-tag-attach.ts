import { getScenarios, enrollFriendInScenario, jstNow } from '@line-crm/db';
import { fireEvent } from './event-bus.js';

// friend に tag を attach し、`POST /api/friends/:id/tags` と同じ side effects を発火する。
// side effects: tag_added シナリオ enrollment + tag_change イベント (automation/webhook/scoring 用)。
//
// 新規付与のときだけ side effects を発火する (`changes` を見る)。同じ friend に同じ tag を
// 自動付与で繰り返し叩いたとき、シナリオの重複 enrollment や tag_change の重複発火を防ぐ。
//
// POST /api/friends/:id/tags は手動操作の signal として「毎クリックで発火」する設計のため、
// この helper には合流させていない (重複 enroll はチェックがあるが tag_change は冪等でない)。
// 自動経路 (予約 auto-tag 等) はここ経由で呼ぶ。
export async function attachTagAndFireSideEffects(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<{ added: boolean }> {
  // 「新規付与か」の判定に INSERT の meta.changes を使わない。本番 D1 ランタイムでは
  // INSERT OR IGNORE の meta.changes がテスト環境 (miniflare) と一致しない場合があり、
  // 判定が偽って false になると tag_change が発火せず外部連携が静かに欠落する。
  // SELECT で存在確認してから INSERT する方式は環境差の影響を受けない。
  const alreadyAttached = await db
    .prepare(`SELECT 1 AS x FROM friend_tags WHERE friend_id = ? AND tag_id = ?`)
    .bind(friendId, tagId)
    .first();
  if (alreadyAttached) return { added: false };
  await db
    .prepare(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
       VALUES (?, ?, ?)`,
    )
    .bind(friendId, tagId, jstNow())
    .run();

  const scenarios = await getScenarios(db);
  for (const scenario of scenarios) {
    if (
      scenario.trigger_type === 'tag_added' &&
      scenario.is_active &&
      scenario.trigger_tag_id === tagId
    ) {
      const existing = await db
        .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
        .bind(friendId, scenario.id)
        .first();
      if (!existing) {
        await enrollFriendInScenario(db, friendId, scenario.id);
      }
    }
  }

  await fireEvent(db, 'tag_change', { friendId, eventData: { tagId, action: 'add' } });
  return { added: true };
}
