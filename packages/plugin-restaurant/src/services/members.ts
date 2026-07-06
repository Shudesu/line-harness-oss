import type { LineHarness } from '@line-harness/sdk'
import { formatMemberNo } from '../lib/logic.js'
import { resolveFriendId } from '../lib/harness.js'

export interface MemberRow {
  id: string
  line_user_id: string
  friend_id: string | null
  member_no: string
  display_name: string | null
  birthday: string | null
  stamp_count: number
  total_visits: number
  last_visit_at: string | null
  created_at: string
  updated_at: string
}

export async function findMemberByLineUserId(db: D1Database, lineUserId: string): Promise<MemberRow | null> {
  return await db.prepare('SELECT * FROM members WHERE line_user_id = ?').bind(lineUserId).first<MemberRow>()
}

export async function findMemberByNo(db: D1Database, memberNo: string): Promise<MemberRow | null> {
  return await db
    .prepare('SELECT * FROM members WHERE member_no = ?')
    .bind(memberNo.trim().toUpperCase())
    .first<MemberRow>()
}

/**
 * Get or register the member for a verified LINE user. On first registration
 * we also try to resolve the LINE Harness friend id (retried on later visits
 * while it stays null).
 */
export async function getOrCreateMember(
  db: D1Database,
  client: LineHarness,
  lineUserId: string,
  displayName: string,
): Promise<MemberRow> {
  const existing = await findMemberByLineUserId(db, lineUserId)
  if (existing) {
    if (!existing.friend_id) {
      const friendId = await resolveFriendId(client, lineUserId).catch(() => null)
      if (friendId) {
        await db
          .prepare("UPDATE members SET friend_id = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(friendId, existing.id)
          .run()
        existing.friend_id = friendId
      }
    }
    return existing
  }

  const seq = await nextMemberSeq(db)
  const memberNo = formatMemberNo(seq)
  const id = crypto.randomUUID()
  const friendId = await resolveFriendId(client, lineUserId).catch(() => null)

  await db
    .prepare(
      'INSERT INTO members (id, line_user_id, friend_id, member_no, display_name) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(id, lineUserId, friendId, memberNo, displayName)
    .run()

  const created = await findMemberByLineUserId(db, lineUserId)
  if (!created) throw new Error('member insert failed')
  return created
}

export async function setBirthday(db: D1Database, memberId: string, birthday: string): Promise<void> {
  await db
    .prepare("UPDATE members SET birthday = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(birthday, memberId)
    .run()
}

/** Atomic member number sequence stored in settings. */
async function nextMemberSeq(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('member_seq', '1')
       ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = datetime('now')
       RETURNING value`,
    )
    .first<{ value: string }>()
  if (!row) throw new Error('member_seq update failed')
  return Number.parseInt(row.value, 10)
}
