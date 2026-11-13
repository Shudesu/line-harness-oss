/**
 * 質問カードの「その他（自由に入力）」に打たれた文を、答えとして受け取るための決まり。
 * 質問の返事待ち（待ちシナリオが進行中）で、まだ答えていない人の文だけが対象。
 * それ以外の人の文は今までどおり普通のトークとして扱う。
 */
type FreeTextAnswerRule = {
  lineAccountId: string;
  /** 返事待ちのあいだ進行しているシナリオ */
  waitingScenarioId: string;
  /** これが付いていれば答え済み（ボタンで答えた人など） */
  answeredTagId: string;
  /** 答えとして受け取ったときに付けるタグ */
  tagIds: string[];
  /** お礼として返す自動返信のキーワード（ボタンで答えたときと同じ返信） */
  replyKeyword: string;
};

const RULES: FreeTextAnswerRule[] = [
  {
    // 軌道（朝活）の登録時の質問「軌道が気になった理由」
    lineAccountId: 'a60cb342-99ff-4ffc-b04a-3b4b2307e0f5',
    waitingScenarioId: '92147a01-20e0-42db-b6a7-c95e5ee19455',
    answeredTagId: 'aa43c4e9-79ca-4fdc-8e84-ccf19c131a4a',
    tagIds: [
      '4f7ef601-20e5-4bc1-bc5b-3ca3d2e51293', // 軌_理由_その他
      'aa43c4e9-79ca-4fdc-8e84-ccf19c131a4a', // 軌_質問に回答
      '5069f021-a276-4dd7-b02a-a03dec16092a', // 軌_教育配信開始
    ],
    replyKeyword: 'asa_q1',
  },
];

export async function findFreeTextAnswer(
  db: D1Database,
  friendId: string,
  lineAccountId: string | null | undefined,
): Promise<{ tagIds: string[]; replyKeyword: string } | null> {
  if (!lineAccountId) return null;
  for (const rule of RULES) {
    if (rule.lineAccountId !== lineAccountId) continue;
    const waiting = await db
      .prepare(
        `SELECT 1 FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ? AND status IN ('active', 'delivering')`,
      )
      .bind(friendId, rule.waitingScenarioId)
      .first();
    if (!waiting) continue;
    const answered = await db
      .prepare(`SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ?`)
      .bind(friendId, rule.answeredTagId)
      .first();
    if (answered) continue;
    return { tagIds: rule.tagIds, replyKeyword: rule.replyKeyword };
  }
  return null;
}

/**
 * 質問カードのボタンの押し直しかどうか。送ったカードのボタンは押せなくできないので、
 * 答え済みの人がもう一度押したときは、印も返信も何もしない（最初の答えだけ残す）。
 */
export async function isRepeatedAnswer(
  db: D1Database,
  friendId: string,
  lineAccountId: string | null | undefined,
  tagIds: string[],
): Promise<boolean> {
  if (!lineAccountId) return false;
  for (const rule of RULES) {
    if (rule.lineAccountId !== lineAccountId) continue;
    if (!tagIds.includes(rule.answeredTagId)) continue;
    const answered = await db
      .prepare(`SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ?`)
      .bind(friendId, rule.answeredTagId)
      .first();
    if (answered) return true;
  }
  return false;
}
