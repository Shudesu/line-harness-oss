import { keywordMatches } from './auto-reply.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 2000;

// auto_reply にマッチした incoming は「人間対応不要」として未対応から除外する。
// 判定戦略は 2 系統:
//
// (A) 応答ありルール (response_type != 'silent'):
//     incoming 直後に source='auto_reply' delivery_type='reply' の outgoing が
//     messages_log に残っているかを「証拠」として確認する。ルール keyword が
//     後で書き換えられても歴史的判定がブレない。
//
// (B) keyword 一致 (応答なしルール / scope 外ルール / 古い証拠なし):
//     content がいずれかの active 自動返信 keyword と一致するなら、
//     button label / FAQ キーワードと見なして除外。
//     - response_type は問わない (応答ありルールも証拠が時間窓外/欠損な
//       ケースを救済)
//     - line_account_id scope は無視 (1アカに登録された button label を
//       別アカでも構造化メッセと判定)
//     - created_at による後付けルールガードも撤廃 (本番事故 2026-05-08 #2:
//       ルールが re-create されて created_at が新しくなると、古い incoming
//       が「ルール後付け」扱いされてフィルタを通り抜けていた。現実的には
//       button label / FAQ keyword は安定運用なので、現在の active キーワード
//       が一致したら歴史問わず構造化メッセと判定する。)
const ACTIVE_AUTO_REPLIES_SQL = `
  SELECT keyword, match_type
  FROM auto_replies
  WHERE is_active = 1
`;

interface ActiveRuleRow {
  keyword: string;
  match_type: string;
}

function matchesAnyKeyword(
  content: string,
  messageType: string,
  rules: ActiveRuleRow[],
): boolean {
  if (messageType !== 'text') return false;
  return rules.some((ar) => keywordMatches(ar, content));
}

// 同じ incoming に対して outgoing 'auto_reply' (delivery_type='reply') が
// 短時間内に発火していれば、この incoming は応答ありルールにマッチしたと判定する。
// 5 秒は webhook が auto_reply を送るまでの最大時間として保守的に取る。
const AUTO_REPLY_EVIDENCE_WINDOW_MS = 5_000;

/**
 * outgoing 1 件は incoming 1 件にしかマッチさせない。
 * 同じ友だちが短時間に複数メッセを送って auto_reply が 1 件しか飛ばないケース、
 * 古い free-form メッセが新しいマッチメッセの outgoing で誤判定される (codex
 * round 3 P1) のを防ぐ。consume 済み outgoing は配列から取り除く。
 */
function consumeAutoReplyEvidence(
  incomingAt: string,
  remainingOutgoings: { created_at: string }[],
): boolean {
  const inMs = new Date(incomingAt).getTime();
  for (let i = 0; i < remainingOutgoings.length; i++) {
    const outMs = new Date(remainingOutgoings[i].created_at).getTime();
    if (outMs >= inMs && outMs - inMs <= AUTO_REPLY_EVIDENCE_WINDOW_MS) {
      remainingOutgoings.splice(i, 1);
      return true;
    }
  }
  return false;
}

// 候補 friend のメタデータ + 集約タイムスタンプ。
// プレビュー/タイプは別クエリで last_manual 以降の incoming 群から JS で決める
// (auto_reply マッチを除いた「最新の非マッチ incoming」が triage 対象)。
//
// chats.status='resolved' の friend は除外する。operator が管理画面で「解決済」に
// した会話は、手動返信していなくてもバッジから消えるべき (「未読通知が減らない」
// 2026-07-06 報告)。resolved 後に新しい非マッチ incoming が来ると webhook の
// upsertChatOnMessage が status を 'unread' に戻すので、除外は自動解除される。
// 'in_progress' は「まだ対応が終わってない」ので引き続きカウントする。
const CANDIDATES_SQL = `
  WITH agg AS (
    SELECT
      friend_id,
      MAX(CASE WHEN direction='incoming' AND (source IS NULL OR source != 'postback') THEN created_at END) AS last_incoming,
      MAX(CASE WHEN direction='outgoing' AND source='manual' THEN created_at END) AS last_manual,
      MAX(CASE WHEN direction='outgoing' AND source IN
          ('auto_reply','automation','automation_backfill','scenario','broadcast')
        THEN created_at END) AS last_machine
    FROM messages_log
    GROUP BY friend_id
  ),
  latest_chat AS (
    -- friend ごとの最新 chats 行の status (bare-column + 単一 MAX の argmax)。
    -- 相関サブクエリだと候補 friend 数ぶん個別 seek になるため一括 GROUP BY で取る。
    SELECT friend_id, status, MAX(created_at) AS created_at
    FROM chats
    GROUP BY friend_id
  )
  SELECT
    f.id            AS friend_id,
    f.display_name,
    f.picture_url,
    f.line_account_id,
    COALESCE(la.name, '(未分類)') AS account_name,
    agg.last_incoming,
    agg.last_manual,
    agg.last_machine
  FROM friends f
  LEFT JOIN line_accounts la ON la.id = f.line_account_id
  JOIN agg ON agg.friend_id = f.id
  LEFT JOIN latest_chat lc ON lc.friend_id = f.id
  WHERE f.is_following = 1
    AND (la.id IS NULL OR la.is_active = 1)
    AND agg.last_incoming IS NOT NULL
    AND (agg.last_manual IS NULL OR agg.last_manual < agg.last_incoming)
    AND COALESCE(lc.status, 'unread') != 'resolved'
  ORDER BY agg.last_incoming ASC
`;

// 候補 friend の "last_manual 以降の全 incoming" (postback 除く)。
// 当初は friend_id IN (?, ...) で candidate scope する設計だったが、
// D1 の prepared statement bind 変数上限 (100) を IN×2 で越えて 500 が出た
// (本番事故 2026-05-08)。代わりに last_manual を全 friend で集約する CTE に
// して bind 変数ゼロで動かす。messages_log は (friend_id, direction, created_at)
// の index で scan されるので、incoming サブセット取得は十分速い。
const RECENT_INCOMINGS_SQL = `
  WITH last_manual AS (
    SELECT friend_id, MAX(created_at) AS lm
    FROM messages_log
    WHERE direction='outgoing' AND source='manual'
    GROUP BY friend_id
  )
  SELECT ml.friend_id, ml.message_type, ml.content, ml.created_at
  FROM messages_log ml
  LEFT JOIN last_manual lm ON lm.friend_id = ml.friend_id
  WHERE ml.direction='incoming'
    AND (ml.source IS NULL OR ml.source != 'postback')
    AND (lm.lm IS NULL OR ml.created_at > lm.lm)
  ORDER BY ml.friend_id, ml.created_at DESC
`;

// 候補 friend の "last_manual 以降の auto_reply outgoing (reply 限定)"。
// delivery_type='reply' で絞ることで、forms.ts などが同じ source='auto_reply' で
// 記録する form-confirmation / webhook-failure push を証拠から除外する。
// 同じく bind 変数ゼロ。JS 側で friend_id ごとに group する。
const RECENT_AUTO_REPLY_OUTGOINGS_SQL = `
  WITH last_manual AS (
    SELECT friend_id, MAX(created_at) AS lm
    FROM messages_log
    WHERE direction='outgoing' AND source='manual'
    GROUP BY friend_id
  )
  SELECT ml.friend_id, ml.created_at
  FROM messages_log ml
  LEFT JOIN last_manual lm ON lm.friend_id = ml.friend_id
  WHERE ml.direction='outgoing'
    AND ml.source='auto_reply'
    AND ml.delivery_type='reply'
    AND (lm.lm IS NULL OR ml.created_at > lm.lm)
  ORDER BY ml.friend_id, ml.created_at ASC
`;


export interface UnansweredRow {
  friendId: string;
  displayName: string | null;
  pictureUrl: string | null;
  accountId: string;
  accountName: string;
  lastIncomingAt: string;
  lastManualAt: string | null;
  lastMachineAt: string | null;
  lastIncomingType: string;
  lastIncomingContent: string;
}

export interface UnansweredInboxResult {
  total: number;
  page: number;
  pageSize: number;
  rows: UnansweredRow[];
}

export interface UnansweredCount {
  total: number;
  byAccount: Array<{ accountId: string; accountName: string; count: number }>;
  oldestWaitMinutes: number | null;
}

export interface UnansweredInboxOptions {
  q?: string;
  account?: string;
  minWaitMinutes?: number;
  page?: number;
  pageSize?: number;
}

interface RawCandidateRow {
  friend_id: string;
  display_name: string | null;
  picture_url: string | null;
  line_account_id: string;
  account_name: string;
  last_incoming: string;
  last_manual: string | null;
  last_machine: string | null;
}

interface RawIncomingRow {
  friend_id: string;
  message_type: string;
  content: string;
  created_at: string;
}

function applyFilters(rows: UnansweredRow[], opts: UnansweredInboxOptions): UnansweredRow[] {
  let filtered = rows;
  if (opts.account) {
    filtered = filtered.filter((r) => r.accountId === opts.account);
  }
  if (opts.minWaitMinutes && opts.minWaitMinutes > 0) {
    const cutoff = Date.now() - opts.minWaitMinutes * 60_000;
    filtered = filtered.filter((r) => new Date(r.lastIncomingAt).getTime() <= cutoff);
  }
  if (opts.q) {
    const q = opts.q.toLowerCase();
    filtered = filtered.filter((r) => {
      if (r.displayName?.toLowerCase().includes(q)) return true;
      if (r.lastIncomingContent.toLowerCase().includes(q)) return true;
      return false;
    });
  }
  return filtered;
}

/**
 * Single source of truth.
 *
 * 1. CANDIDATES_SQL で「last_incoming > last_manual」の friend を取る。
 * 2. 候補 friend に scope して "last_manual 以降の incoming" と "auto_reply outgoing" を取る。
 * 3. silent ルール一覧を取る (応答ありルールは outgoing 証拠で判定するので不要)。
 * 4. JS で各 incoming を判定: 応答あり証拠 OR silent ルール match で「マッチ済」、
 *    マッチしない最新の incoming を preview として採用。全部マッチした thread のみ除外。
 */
async function getAllUnansweredRows(db: D1Database): Promise<UnansweredRow[]> {
  const candidatesResult = await db.prepare(CANDIDATES_SQL).all<RawCandidateRow>();
  const candidates = candidatesResult.results ?? [];
  if (candidates.length === 0) return [];

  // 候補 friend のみを残すための Set。後段の JS group で他の friend は無視する。
  const candidateIds = new Set(candidates.map((c) => c.friend_id));

  const [incomingsResult, autoReplyOutgoingsResult, activeRulesResult] = await Promise.all([
    db.prepare(RECENT_INCOMINGS_SQL).all<RawIncomingRow>(),
    db.prepare(RECENT_AUTO_REPLY_OUTGOINGS_SQL).all<{ friend_id: string; created_at: string }>(),
    db.prepare(ACTIVE_AUTO_REPLIES_SQL).all<ActiveRuleRow>(),
  ]);

  const activeRules = activeRulesResult.results ?? [];

  // friend_id ごとに incomings を集める (created_at DESC でソート済み)。
  // 候補外の friend のメッセは捨てる (memory 節約)。
  const incomingsByFriend = new Map<string, RawIncomingRow[]>();
  for (const row of incomingsResult.results ?? []) {
    if (!candidateIds.has(row.friend_id)) continue;
    const list = incomingsByFriend.get(row.friend_id) ?? [];
    list.push(row);
    incomingsByFriend.set(row.friend_id, list);
  }
  // friend_id ごとに auto_reply outgoings を集める (created_at ASC ソート済み)。
  const autoReplyOutgoingsByFriend = new Map<string, { created_at: string }[]>();
  for (const row of autoReplyOutgoingsResult.results ?? []) {
    if (!candidateIds.has(row.friend_id)) continue;
    const list = autoReplyOutgoingsByFriend.get(row.friend_id) ?? [];
    list.push({ created_at: row.created_at });
    autoReplyOutgoingsByFriend.set(row.friend_id, list);
  }

  const rows: UnansweredRow[] = [];
  for (const c of candidates) {
    const incomings = incomingsByFriend.get(c.friend_id) ?? [];
    // outgoings は consume するのでコピーを作る (元 Map の他参照を破壊しない)。
    // incomings は新しい順に処理し、各 outgoing を 1 incoming にしか割り当てない。
    const remainingOutgoings = [...(autoReplyOutgoingsByFriend.get(c.friend_id) ?? [])];

    let nonMatching: RawIncomingRow | undefined;
    for (const i of incomings) {
      if (consumeAutoReplyEvidence(i.created_at, remainingOutgoings)) continue;
      if (matchesAnyKeyword(i.content, i.message_type, activeRules)) continue;
      // この incoming は人間対応必要 → preview として採用 (最新の非マッチ)
      nonMatching = i;
      break;
    }
    if (!nonMatching) continue;

    rows.push({
      friendId: c.friend_id,
      displayName: c.display_name,
      pictureUrl: c.picture_url,
      accountId: c.line_account_id,
      accountName: c.account_name,
      lastIncomingAt: nonMatching.created_at,
      lastManualAt: c.last_manual,
      lastMachineAt: c.last_machine,
      lastIncomingType: nonMatching.message_type,
      lastIncomingContent: nonMatching.content,
    });
  }

  // 新しい順 (= 直近 incoming が先頭)。実運用では「最近来た会話を上から潰す」
  // 流れの方が手が動く (2026-05-12 野田さん運用フィードバック)。
  rows.sort((a, b) => b.lastIncomingAt.localeCompare(a.lastIncomingAt));
  return rows;
}

export async function computeUnansweredInbox(
  db: D1Database,
  opts: UnansweredInboxOptions = {},
): Promise<UnansweredInboxResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const allRows = await getAllUnansweredRows(db);
  const filtered = applyFilters(allRows, opts);
  const slice = filtered.slice(offset, offset + pageSize);

  return {
    total: filtered.length,
    page,
    pageSize,
    rows: slice,
  };
}

/**
 * 未対応 friend の row map を返す。row には未対応判定後の preview (auto_reply
 * matched 等を除いた最新の actionable incoming) が含まれる。
 * /api/chats?unansweredOnly=true で preview を上書きするのに使う。
 */
export async function getUnansweredRowsMap(db: D1Database): Promise<Map<string, UnansweredRow>> {
  const rows = await getAllUnansweredRows(db);
  return new Map(rows.map((r) => [r.friendId, r]));
}

/**
 * 未対応 (人間が返事してない) friend ID の Set を返す。
 * /api/chats?unansweredOnly=true で chat list を絞るのに使う。
 * 判定ロジックは getAllUnansweredRows と同じ source of truth。
 */
export async function getUnansweredFriendIds(db: D1Database): Promise<Set<string>> {
  const map = await getUnansweredRowsMap(db);
  return new Set(map.keys());
}

export async function countUnanswered(db: D1Database): Promise<UnansweredCount> {
  const allRows = await getAllUnansweredRows(db);

  const byAccountMap = new Map<string, { accountName: string; count: number }>();
  let oldest: string | null = null;
  for (const r of allRows) {
    const key = r.accountId ?? '__unassigned__';
    const existing = byAccountMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      byAccountMap.set(key, { accountName: r.accountName, count: 1 });
    }
    if (oldest === null || r.lastIncomingAt < oldest) oldest = r.lastIncomingAt;
  }

  const byAccount = [...byAccountMap.entries()]
    .map(([accountId, v]) => ({ accountId, accountName: v.accountName, count: v.count }))
    .sort((a, b) => b.count - a.count);

  const oldestWaitMinutes =
    oldest !== null
      ? Math.max(0, Math.floor((Date.now() - new Date(oldest).getTime()) / 60_000))
      : null;

  return {
    total: allRows.length,
    byAccount,
    oldestWaitMinutes,
  };
}
