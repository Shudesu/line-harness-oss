import type { LineHarness } from '@line-harness/sdk'
import type { StoreConfig } from '../env.js'
import { isoToSqlite, jstParts } from '../lib/logic.js'
import { trySendText } from '../lib/harness.js'
import { claimOnce } from '../lib/dedupe.js'
import type { MemberRow } from './members.js'

/** 来店からレビュー依頼送信までの遅延（滞在中に届かないよう2時間後） */
const REVIEW_ASK_DELAY_MS = 2 * 60 * 60 * 1000
/** 同一会員へのレビュー依頼は90日に1回まで */
const REVIEW_ASK_COOLDOWN_DAYS = 90

/** クーポン消込など「来店した」と判断できたときに呼ぶ（last_visit_at 更新のみ・スタンプは別管理） */
export async function markVisited(db: D1Database, memberId: string): Promise<void> {
  await db
    .prepare("UPDATE members SET last_visit_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .bind(memberId)
    .run()
}

/**
 * 来店判定（スタンプ取得・クーポン消込）を起点に、2時間後のGoogleレビュー
 * 依頼をキューに積む。GOOGLE_REVIEW_URL 未設定なら何もしない。
 * 90日クールダウン + dedupe_key で重複送信を防ぐ。
 */
export async function queueReviewAsk(
  db: D1Database,
  config: StoreConfig,
  member: Pick<MemberRow, 'id' | 'friend_id'>,
  now: Date,
): Promise<boolean> {
  if (!config.googleReviewUrl || !member.friend_id) return false

  const recent = await db
    .prepare(
      `SELECT 1 FROM message_log WHERE member_id = ? AND kind = 'review_ask'
       AND sent_at > datetime('now', ?) LIMIT 1`,
    )
    .bind(member.id, `-${REVIEW_ASK_COOLDOWN_DAYS} days`)
    .first()
  if (recent) return false

  const dedupeKey = `review_ask:${jstParts(now).date}:${member.id}`
  if (!(await claimOnce(db, member.id, 'review_ask', dedupeKey))) return false

  const sendAt = isoToSqlite(new Date(now.getTime() + REVIEW_ASK_DELAY_MS).toISOString())
  await db
    .prepare("INSERT INTO pending_notifications (id, member_id, kind, send_at) VALUES (?, ?, 'review_ask', ?)")
    .bind(crypto.randomUUID(), member.id, sendAt)
    .run()
  return true
}

/** Cron: 送信時刻を過ぎたキューを配信する */
export async function processPendingNotifications(
  db: D1Database,
  client: LineHarness,
  config: StoreConfig,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.kind, m.friend_id FROM pending_notifications p
       JOIN members m ON m.id = p.member_id
       WHERE p.status = 'pending' AND p.send_at <= datetime('now')
       LIMIT 50`,
    )
    .all<{ id: string; kind: string; friend_id: string | null }>()

  let sent = 0
  for (const row of results) {
    if (row.kind === 'review_ask' && config.googleReviewUrl) {
      const delivered = await trySendText(
        client,
        row.friend_id,
        `本日は【${config.storeName}】にご来店いただきありがとうございました🙏\n\nもしよろしければ、Googleでの感想投稿にご協力いただけると励みになります⭐\n${config.googleReviewUrl}\n\nまたのお越しを心よりお待ちしております！`,
      )
      if (delivered) sent++
    }
    await db
      .prepare("UPDATE pending_notifications SET status = 'sent' WHERE id = ?")
      .bind(row.id)
      .run()
  }
  return sent
}
