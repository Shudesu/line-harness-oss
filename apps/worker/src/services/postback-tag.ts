import { attachTagAndFireSideEffects } from './friend-tag-attach.js';

/**
 * ページを開かないボタン（postback）を押した人に印（タグ）を付けるための合図。
 * 形は `lh_tag=<タグID>&lh_tag=<タグID>&kw=<自動返信のキーワード>`。
 * lh_tag= で始まらない合図（インターンのアンケートなど今までのもの）は null で、何も変えない。
 * kw が無いときは、自動返信とは合わせない（印を付けるだけ）。
 */
export function parsePostbackTags(data: string): { tagIds: string[]; keyword: string | null } | null {
  if (!data.startsWith('lh_tag=')) return null;
  const params = new URLSearchParams(data);
  const tagIds = [...new Set(params.getAll('lh_tag').filter((id) => id !== ''))];
  if (tagIds.length === 0) return null;
  const kw = params.get('kw');
  return { tagIds, keyword: kw ? kw : null };
}

/**
 * 実在するタグだけ付ける（消されたタグ・打ち間違いは飛ばす）。付けた数を返す。
 * 新しく付いたときは、そのタグで始まるシナリオも開始する（質問に答えたら教育配信が始まる、など）。
 */
export async function applyPostbackTags(db: D1Database, friendId: string, tagIds: string[]): Promise<number> {
  let applied = 0;
  for (const tagId of tagIds) {
    const exists = await db.prepare('SELECT 1 FROM tags WHERE id = ?').bind(tagId).first();
    if (!exists) {
      console.error(`[postback-tag] unknown tag ${tagId} — skipped`);
      continue;
    }
    await attachTagAndFireSideEffects(db, friendId, tagId);
    applied += 1;
  }
  return applied;
}
