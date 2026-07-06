import type { LineHarness } from '@line-harness/sdk'
import type { StoreConfig } from '../env.js'
import { isBirthday, isWinbackTarget, jstParts, sqliteToIso } from '../lib/logic.js'
import { getOrCreateTag, tryAddTag, trySendText } from '../lib/harness.js'
import { claimOnce } from '../lib/dedupe.js'
import type { MemberRow } from './members.js'
import { issueReward } from './stamps.js'

const WINBACK_TAG_NAME = '離反リスク'
/** 呼び戻しは一度送ったら60日間は再送しない */
const WINBACK_COOLDOWN_DAYS = 60

/**
 * Daily jobs (birthday coupons + winback), guarded so they run once per JST
 * day even though the cron fires every 10 minutes. First firing after 10:00
 * JST wins.
 */
export async function runDailyJobs(
  db: D1Database,
  client: LineHarness,
  config: StoreConfig,
  now: Date,
): Promise<{ ran: boolean; birthday: number; winback: number }> {
  const parts = jstParts(now)
  if (parts.hour < 10) return { ran: false, birthday: 0, winback: 0 }

  const claimed = await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, 'done') ON CONFLICT (key) DO NOTHING")
    .bind(`daily_jobs:${parts.date}`)
    .run()
  if (!claimed.meta.changes) return { ran: false, birthday: 0, winback: 0 }

  const birthday = await sendBirthdayCoupons(db, client, config, now)
  const winback = await sendWinbackMessages(db, client, config, now)
  return { ran: true, birthday, winback }
}

async function sendBirthdayCoupons(db: D1Database, client: LineHarness, config: StoreConfig, now: Date): Promise<number> {
  const parts = jstParts(now)
  const { results } = await db
    .prepare('SELECT * FROM members WHERE birthday IS NOT NULL AND friend_id IS NOT NULL')
    .all<MemberRow>()

  let sent = 0
  for (const member of results) {
    if (!isBirthday(member.birthday, parts.monthDay)) continue
    const dedupeKey = `birthday:${parts.year}:${member.id}`
    if (!(await claimOnce(db, member.id, 'birthday', dedupeKey))) continue

    const code = await issueReward(db, member.id, `お誕生日特典（${config.rewardName}）`, 'birthday')
    const delivered = await trySendText(
      client,
      member.friend_id,
      `🎂 お誕生日おめでとうございます！\n【${config.storeName}】から、ささやかですがお誕生日特典をお贈りします。\n\n特典コード: ${code}\n（有効期限: 発行から90日）\n\nご来店の際にスタッフへこの画面をお見せください。お会いできるのを楽しみにしています！`,
    )
    if (delivered) sent++
  }
  return sent
}

async function sendWinbackMessages(db: D1Database, client: LineHarness, config: StoreConfig, now: Date): Promise<number> {
  const { results } = await db
    .prepare('SELECT * FROM members WHERE last_visit_at IS NOT NULL AND friend_id IS NOT NULL')
    .all<MemberRow>()

  const tagId = results.length > 0 ? await getOrCreateTag(client, WINBACK_TAG_NAME) : null

  let sent = 0
  for (const member of results) {
    if (!isWinbackTarget(sqliteToIso(member.last_visit_at as string), config.winbackDays, now)) continue

    const recent = await db
      .prepare(
        `SELECT 1 FROM message_log WHERE member_id = ? AND kind = 'winback'
         AND sent_at > datetime('now', ?) LIMIT 1`,
      )
      .bind(member.id, `-${WINBACK_COOLDOWN_DAYS} days`)
      .first()
    if (recent) continue

    const dedupeKey = `winback:${jstParts(now).date}:${member.id}`
    if (!(await claimOnce(db, member.id, 'winback', dedupeKey))) continue

    const code = await issueReward(db, member.id, `カムバック特典（${config.rewardName}）`, 'winback')
    const delivered = await trySendText(
      client,
      member.friend_id,
      `お久しぶりです、【${config.storeName}】です🍽\n最近お会いできず寂しく思っています。\n\n次回ご来店で使える特典をご用意しました。\n特典コード: ${code}\n（有効期限: 発行から90日）\n\nまたのお越しを心よりお待ちしております！`,
    )
    await tryAddTag(client, member.friend_id, tagId)
    if (delivered) sent++
  }
  return sent
}

