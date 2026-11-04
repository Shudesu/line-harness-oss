// インターンの登録アンケートで答えた学年を、毎年4月1日に1つ進める（2026-11-04 そーご依頼）。
// ミニアプリのプロフィールの自動更新（kidou-intern の DB 133）と同じ決まりで、ハーネスの答え（friends.metadata）も進める。
//   ・学年に「どの年度の学年か」（grade_academic_year・4月始まり）を添え、今の年度との差の分だけ進める。何度動いても二重には進まない
//   ・学部1→2→3→4・修士1→2・博士1→2→3。最後の学年（学部4年・修士2年・博士3年）と「その他」はそのまま（留年・進学・卒業は本人にしか分からない）
//   ・卒業予定年は年がたっても変わらないので触らない
// あわせて、答えに合わせて印を付け替える。学年の印「ズ_学年_◯」と卒業年の印「ズ_卒業年_◯」は、今の答えの分だけを1つずつ残す
//   （答え直した人に古い卒業年の印が残っていると、配信の宛先選びで別の年の人に届いてしまうため）

import { jstNow } from '@line-crm/db';

export const GRADE_TAG_PREFIX = 'ズ_学年_';
export const GRADUATION_TAG_PREFIX = 'ズ_卒業年_';
export const tagGrade = (g: string) => `${GRADE_TAG_PREFIX}${g}`;
export const tagGraduationYear = (y: string) => `${GRADUATION_TAG_PREFIX}${y}`;

/** 4月始まりの年度（2027年3月 → 2026年度）。日本時間で数える */
export function academicYearJst(now: Date = new Date()): number {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return jst.getUTCFullYear() - (jst.getUTCMonth() < 3 ? 1 : 0);
}

const LAST: Record<string, number> = { 学部: 4, 修士: 2, 博士: 3 };

/** 学年を steps 年ぶん進める（最後の学年で止める・「その他」や知らない値はそのまま） */
export function advanceGrade(grade: string, steps: number): string {
  const m = /^(学部|修士|博士)([1-9])年$/.exec(grade);
  if (!m || steps <= 0) return grade;
  return `${m[1]}${Math.min(Number(m[2]) + steps, LAST[m[1]])}年`;
}

/** 答えを記録した年度。添えていない古い答えは、答え終えた日の年度とみなす */
function answeredYear(meta: Record<string, unknown>, now: Date): number {
  const y = Number(meta.grade_academic_year);
  if (Number.isInteger(y) && y > 2000) return y;
  const at = typeof meta.survey_completed_at === 'string' ? new Date(meta.survey_completed_at) : null;
  return at && !Number.isNaN(at.getTime()) ? academicYearJst(at) : academicYearJst(now);
}

/** 今の答えに合う印の名前 */
export function answerTagNames(meta: Record<string, unknown>): string[] {
  const names: string[] = [];
  if (typeof meta.grade === 'string' && meta.grade) names.push(tagGrade(meta.grade));
  if (typeof meta.graduation_year === 'string' && meta.graduation_year) names.push(tagGraduationYear(meta.graduation_year));
  return names;
}

const isAnswerTag = (name: string) => name.startsWith(GRADE_TAG_PREFIX) || name.startsWith(GRADUATION_TAG_PREFIX);

export async function ensureTag(db: D1Database, name: string): Promise<string> {
  const found = await db.prepare('SELECT id FROM tags WHERE name = ?').bind(name).first<{ id: string }>();
  if (found) return found.id;
  await db
    .prepare('INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), name, '#3a7d5c', jstNow())
    .run();
  const row = await db.prepare('SELECT id FROM tags WHERE name = ?').bind(name).first<{ id: string }>();
  return row!.id;
}

type TagRow = { friend_id: string; tag_id: string; name: string };

/** 学年・卒業年の印を、今の答えの分だけにそろえる。変えた数を返す */
async function reconcileAnswerTags(db: D1Database, friendId: string, desired: string[], current: TagRow[]): Promise<number> {
  let changed = 0;
  for (const t of current) {
    if (desired.includes(t.name)) continue;
    await db.prepare('DELETE FROM friend_tags WHERE friend_id = ? AND tag_id = ?').bind(friendId, t.tag_id).run();
    changed++;
  }
  for (const name of desired) {
    if (current.some((t) => t.name === name)) continue;
    const tagId = await ensureTag(db, name);
    await db
      .prepare('INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)')
      .bind(friendId, tagId, jstNow())
      .run();
    changed++;
  }
  return changed;
}

async function currentAnswerTags(db: D1Database, friendId: string): Promise<TagRow[]> {
  const rows = await db
    .prepare(`SELECT ft.friend_id, ft.tag_id, t.name FROM friend_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.friend_id = ? AND t.name LIKE 'ズ%'`)
    .bind(friendId)
    .all<TagRow>();
  return rows.results.filter((t) => isAnswerTag(t.name));
}

/** 答え終えたとき。学年・卒業年の印を今の答えに付け替える（答え直した人の古い印を外す） */
export async function syncAnswerTags(db: D1Database, friendId: string, meta: Record<string, unknown>): Promise<void> {
  await reconcileAnswerTags(db, friendId, answerTagNames(meta), await currentAnswerTags(db, friendId));
}

function parseMeta(s: string | null): Record<string, unknown> {
  try {
    const v = s ? JSON.parse(s) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * 答え終えた人の学年を年度の差の分だけ進め、学年・卒業年の印を答えに合わせる。6時間ごとの定期実行から呼ぶ。
 * 変える必要がある人だけ書き換える（毎回全員を書き直さない）
 */
export async function maintainInternGrades(
  db: D1Database,
  accountId: string | undefined,
  now: Date = new Date(),
): Promise<{ advanced: number; retagged: number }> {
  if (!accountId) return { advanced: 0, retagged: 0 };
  const year = academicYearJst(now);
  const friends = await db
    .prepare(`SELECT id, metadata FROM friends WHERE line_account_id = ? AND json_extract(metadata, '$.survey_step') = 'done'`)
    .bind(accountId)
    .all<{ id: string; metadata: string | null }>();
  const tags = await db
    .prepare(
      `SELECT ft.friend_id, ft.tag_id, t.name FROM friend_tags ft
       JOIN tags t ON t.id = ft.tag_id JOIN friends f ON f.id = ft.friend_id
       WHERE f.line_account_id = ? AND t.name LIKE 'ズ%'`,
    )
    .bind(accountId)
    .all<TagRow>();
  const byFriend = new Map<string, TagRow[]>();
  for (const t of tags.results) {
    if (!isAnswerTag(t.name)) continue;
    byFriend.set(t.friend_id, [...(byFriend.get(t.friend_id) ?? []), t]);
  }

  let advanced = 0;
  let retagged = 0;
  for (const row of friends.results) {
    const meta = parseMeta(row.metadata);
    const grade = typeof meta.grade === 'string' ? meta.grade : '';
    if (grade) {
      const from = answeredYear(meta, now);
      const next = advanceGrade(grade, year - from);
      if (next !== grade || meta.grade_academic_year !== Math.max(from, year)) {
        // 学年と年度だけを書き換える（同じ時に届いたほかの答えを消さない）
        await db
          .prepare(`UPDATE friends SET metadata = json_set(COALESCE(metadata, '{}'), '$.grade', ?, '$.grade_academic_year', ?), updated_at = ? WHERE id = ?`)
          .bind(next, Math.max(from, year), jstNow(), row.id)
          .run();
        if (next !== grade) advanced++;
        meta.grade = next;
      }
    }
    try {
      if (await reconcileAnswerTags(db, row.id, answerTagNames(meta), byFriend.get(row.id) ?? [])) retagged++;
    } catch (err) {
      console.error('[intern-grade] retag failed', row.id, err);
    }
  }
  return { advanced, retagged };
}
