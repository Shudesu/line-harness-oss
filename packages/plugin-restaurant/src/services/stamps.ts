import type { LineHarness } from '@line-harness/sdk'
import type { StoreConfig } from '../env.js'
import { addStampToCard, jstParts, randomCode } from '../lib/logic.js'
import { trySendText } from '../lib/harness.js'
import { queueReviewAsk } from './review.js'
import type { MemberRow } from './members.js'

export type StampSource = 'store_code' | 'staff' | 'reservation'

export interface StampOutcome {
  stampCount: number
  stampGoal: number
  rewardEarned: boolean
  rewardCode: string | null
}

const MAX_CODE_ATTEMPTS_PER_DAY = 10

/**
 * Today's store code (JST-rotated, 4 chars). Created lazily on first staff
 * fetch of the day; customers can only verify, never mint.
 */
export async function getTodayVisitCode(db: D1Database, now: Date): Promise<string> {
  const key = `visit_code:${jstParts(now).date}`
  const existing = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  if (existing) return existing.value

  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  const code = randomCode(4, bytes)
  // Another isolate may have raced us — keep whichever landed first.
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING')
    .bind(key, code)
    .run()
  const final = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return final?.value ?? code
}

export type CodeCheck = 'ok' | 'wrong' | 'not_ready' | 'rate_limited' | 'already_today'

/** Verify a customer-entered store code, with a per-member daily attempt cap. */
export async function checkVisitCode(db: D1Database, member: MemberRow, input: string, now: Date): Promise<CodeCheck> {
  const today = jstParts(now).date

  const stampedToday = await db
    .prepare("SELECT 1 FROM visits WHERE member_id = ? AND date(visited_at, '+9 hours') = ? LIMIT 1")
    .bind(member.id, today)
    .first()
  if (stampedToday) return 'already_today'

  const attemptsKey = `code_attempts:${today}:${member.id}`
  const attempts = await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, '1')
       ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = datetime('now')
       RETURNING value`,
    )
    .bind(attemptsKey)
    .first<{ value: string }>()
  if (Number.parseInt(attempts?.value ?? '1', 10) > MAX_CODE_ATTEMPTS_PER_DAY) return 'rate_limited'

  const codeRow = await db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(`visit_code:${today}`)
    .first<{ value: string }>()
  if (!codeRow) return 'not_ready'
  return codeRow.value === input.trim().toUpperCase() ? 'ok' : 'wrong'
}

/**
 * Record a visit and add one stamp. When the card fills up, issue a reward,
 * reset the card, and notify the member on LINE.
 */
export async function grantStamp(
  db: D1Database,
  client: LineHarness,
  config: StoreConfig,
  member: MemberRow,
  source: StampSource,
): Promise<StampOutcome> {
  const { newCount, rewardEarned } = addStampToCard(member.stamp_count, config.stampGoal)

  await db.batch([
    db
      .prepare('INSERT INTO visits (id, member_id, source) VALUES (?, ?, ?)')
      .bind(crypto.randomUUID(), member.id, source),
    db
      .prepare(
        `UPDATE members SET stamp_count = ?, total_visits = total_visits + 1,
         last_visit_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(newCount, member.id),
  ])

  await queueReviewAsk(db, config, member, new Date())

  let rewardCode: string | null = null
  if (rewardEarned) {
    rewardCode = await issueReward(db, member.id, config.rewardName, 'stamp')
    await trySendText(
      client,
      member.friend_id,
      `🎉 スタンプが${config.stampGoal}個たまりました！\n「${config.rewardName}」をプレゼントします。\n\n特典コード: ${rewardCode}\n\n次回ご来店時にスタッフへこの画面をお見せください。（会員証の「特典」からいつでも確認できます）`,
    )
  }

  return { stampCount: newCount, stampGoal: config.stampGoal, rewardEarned, rewardCode }
}

/** Issue a reward coupon (90-day expiry) and return its redeem code. */
export async function issueReward(
  db: D1Database,
  memberId: string,
  name: string,
  kind: 'stamp' | 'birthday' | 'winback' | 'manual',
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = new Uint8Array(6)
    crypto.getRandomValues(bytes)
    const code = `RW-${randomCode(6, bytes)}`
    try {
      await db
        .prepare(
          `INSERT INTO rewards (id, member_id, name, code, kind, expires_at)
           VALUES (?, ?, ?, ?, ?, datetime('now', '+90 days'))`,
        )
        .bind(crypto.randomUUID(), memberId, name, code, kind)
        .run()
      return code
    } catch {
      // UNIQUE collision on code — retry with a fresh one
    }
  }
  throw new Error('reward code generation failed')
}

export interface RewardRow {
  id: string
  member_id: string
  name: string
  code: string
  kind: string
  status: string
  issued_at: string
  redeemed_at: string | null
  expires_at: string | null
}

export async function listRewards(db: D1Database, memberId: string): Promise<RewardRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM rewards WHERE member_id = ? AND status = 'issued'
       AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY issued_at DESC`,
    )
    .bind(memberId)
    .all<RewardRow>()
  return results
}

export type RedeemResult = { ok: true; reward: RewardRow } | { ok: false; reason: 'not_found' | 'already_redeemed' | 'expired' }

export async function redeemReward(db: D1Database, code: string): Promise<RedeemResult> {
  const reward = await db
    .prepare('SELECT * FROM rewards WHERE code = ?')
    .bind(code.trim().toUpperCase())
    .first<RewardRow>()
  if (!reward) return { ok: false, reason: 'not_found' }
  if (reward.status === 'redeemed') return { ok: false, reason: 'already_redeemed' }
  if (reward.status === 'expired' || (reward.expires_at && reward.expires_at <= new Date().toISOString().replace('T', ' ').slice(0, 19)))
    return { ok: false, reason: 'expired' }

  await db
    .prepare("UPDATE rewards SET status = 'redeemed', redeemed_at = datetime('now') WHERE id = ?")
    .bind(reward.id)
    .run()
  reward.status = 'redeemed'
  return { ok: true, reward }
}
