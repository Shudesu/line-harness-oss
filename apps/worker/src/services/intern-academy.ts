// 会員サイト（ミニアプリ）の「講座リクエスト」に、運営が「作りました」を付けたときの知らせ。
//
// ミニアプリのサーバーが合言葉付きで /intern/academy-request-done を呼ぶ。ここでは KIDOUインターンの LINE から
// リクエストした学生に1回だけ、「自動で送る文面」の文＋講座へのリンクを送る。
// 呼ぶ側は送れなかったとき（502）だけ送り直す。同じリクエストの送り直しは、LINE の送り直し用の鍵で1回分にまとめる。

import type { LineClient } from '@line-crm/line-sdk';
import { jstNow } from '@line-crm/db';
import { fillCourseName, loadCopy } from './intern-copy.js';

export interface AcademyRequestDoneInput {
  lineUserId: string;
  title: string;
  url: string;
  requestId: string;
}

export type AcademyRequestDoneResult = 'SENT' | 'NOT_FOLLOWING' | 'LINE_FAILED';

const LINE_USER_ID = /^U[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_PREFIX = 'https://liff.line.me/';

/** 受け取った中身を確かめてそろえる。おかしければ null */
export function parseAcademyRequestDone(body: unknown): AcademyRequestDoneInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const lineUserId = typeof b.line_user_id === 'string' ? b.line_user_id : '';
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const url = typeof b.url === 'string' ? b.url.trim() : '';
  const requestId = typeof b.request_id === 'string' ? b.request_id.trim() : '';
  if (!LINE_USER_ID.test(lineUserId)) return null;
  if (!title || title.length > 80) return null;
  // リンクは LINE のミニアプリの入口だけ。改行などが混ざったものは断る
  if (!url.startsWith(URL_PREFIX) || url.length > 300 || /\s/.test(url)) return null;
  if (!UUID.test(requestId)) return null;
  return { lineUserId, title, url, requestId: requestId.toLowerCase() };
}

/** 届く文を作る。文は1000字で切り、最後の行に講座へのリンクを付ける（LINE の上限5000字に収まる） */
export function buildAcademyRequestDoneText(template: string, title: string, url: string): string {
  const filled = fillCourseName(template, title).slice(0, 1000);
  return `${filled}\n${url}`;
}

export async function sendAcademyRequestDone(
  db: D1Database,
  lineClient: Pick<LineClient, 'pushMessage'>,
  accountId: string,
  input: AcademyRequestDoneInput,
): Promise<AcademyRequestDoneResult> {
  const friend = await db
    .prepare('SELECT id, is_following FROM friends WHERE line_user_id = ? AND line_account_id = ?')
    .bind(input.lineUserId, accountId)
    .first<{ id: string; is_following: number | null }>();
  // 友だちでない・ブロック中の人には送らない（呼ぶ側は「済み」にして送り直さない）
  if (!friend || !friend.is_following) return 'NOT_FOLLOWING';

  const copy = await loadCopy(db, accountId);
  const text = buildAcademyRequestDoneText(copy.academyRequest.done, input.title, input.url);
  try {
    await lineClient.pushMessage(input.lineUserId, [{ type: 'text', text }], { retryKey: input.requestId });
  } catch (err) {
    // 同じ鍵で前に送れていたときは 409 が返る。届いているので送れた扱い（記録は前の回で済んでいる）
    if (err instanceof Error && /LINE API error: 409\b/.test(err.message)) return 'SENT';
    console.error('[intern-academy] push failed', err);
    return 'LINE_FAILED';
  }

  // トークの履歴に残す。残せなくても、届いてはいるので失敗にしない
  try {
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
         VALUES (?, ?, 'outgoing', 'text', ?, NULL, NULL, 'push', 'intern_academy_request', ?, ?)`,
      )
      .bind(crypto.randomUUID(), friend.id, text, accountId, jstNow())
      .run();
  } catch (err) {
    console.error('[intern-academy] log failed', err);
  }
  return 'SENT';
}
