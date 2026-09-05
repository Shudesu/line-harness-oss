import { describe, expect, test } from 'vitest';
import { computeUnansweredInbox, countUnanswered } from './unanswered-inbox.js';

// 候補 friend のメタ + タイムスタンプ
interface InboxRow {
  friend_id: string;
  display_name: string | null;
  picture_url: string | null;
  line_account_id: string;
  account_name: string;
  last_incoming: string;
  last_manual: string | null;
  last_machine: string | null;
  // 旧 schema 互換 (テストヘルパーで preview として recentIncomings に展開する)
  last_incoming_type?: string;
  last_incoming_content?: string;
}

interface AutoReplyRow {
  keyword: string;
  match_type: string;
  line_account_id: string | null;
  created_at?: string;
}

interface RecentIncoming {
  friend_id: string;
  message_type: string;
  content: string;
  created_at: string;
}

interface AutoReplyOutgoing {
  friend_id: string;
  created_at: string;
}

function stubDB(canned: {
  rows: InboxRow[];
  recentIncomings?: RecentIncoming[];
  // Note: autoReplies はテスト便宜上 silent ルールとして扱われる
  // (実装の SILENT_AUTO_REPLIES_SQL は response_type='silent' で filter するため)。
  // 応答ありルールの evidence-based 判定をテストするには autoReplyOutgoings を渡す。
  autoReplies?: AutoReplyRow[];
  autoReplyOutgoings?: AutoReplyOutgoing[];
  // 旧 fixture 互換: 期待値メモとして残されている純粋データ。stubDB は使わない。
  total?: number;
  byAccount?: unknown[];
  oldestWait?: unknown;
}) {
  const incomings: RecentIncoming[] =
    canned.recentIncomings ??
    canned.rows.map((r) => ({
      friend_id: r.friend_id,
      message_type: r.last_incoming_type ?? 'text',
      content: r.last_incoming_content ?? '',
      created_at: r.last_incoming,
    }));
  incomings.sort(
    (a, b) =>
      a.friend_id.localeCompare(b.friend_id) || b.created_at.localeCompare(a.created_at),
  );

  const silentRules = (canned.autoReplies ?? []).map((ar) => ({
    ...ar,
    created_at: ar.created_at ?? '2000-01-01T00:00:00+09:00',
  }));

  const autoReplyOutgoings = canned.autoReplyOutgoings ?? [];

  return {
    prepare(sql: string) {
      const isAutoReplies = sql.includes('FROM auto_replies');
      // 候補 friend クエリ (CANDIDATES_SQL): "FROM friends f" を含み、JOIN agg
      const isCandidates = sql.includes('FROM friends f') && sql.includes('JOIN agg');
      // auto_reply outgoing クエリ: source='auto_reply' を WHERE に含む
      const isAutoReplyOutgoings =
        sql.includes("source='auto_reply'") && sql.includes('outgoing');
      // それ以外で messages_log を見るのは incomings クエリ
      const isRecentIncomings =
        sql.includes('messages_log') && !isAutoReplyOutgoings && !isCandidates;
      return {
        all: async () => {
          if (isAutoReplies) return { results: silentRules };
          if (isAutoReplyOutgoings) return { results: autoReplyOutgoings };
          if (isRecentIncomings) return { results: incomings };
          return { results: canned.rows };
        },
        first: async () => null,
        bind() {
          return this;
        },
      };
    },
  } as unknown as D1Database;
}

describe('computeUnansweredInbox', () => {
  test('incoming のみ / manual 無しの friend は 1 行として返る', async () => {
    const db = stubDB({
      rows: [
        {
          friend_id: 'f1',
          display_name: '山田',
          picture_url: 'https://x/p',
          line_account_id: 'a1',
          account_name: 'L ①',
          last_incoming: '2026-05-08T10:00:00+09:00',
          last_manual: null,
          last_machine: null,
          last_incoming_type: 'text',
          last_incoming_content: 'こんにちは',
        },
      ],
      total: 1,
      byAccount: [],
      oldestWait: null,
    });

    const result = await computeUnansweredInbox(db);
    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      friendId: 'f1',
      displayName: '山田',
      accountId: 'a1',
      accountName: 'L ①',
      lastIncomingAt: '2026-05-08T10:00:00+09:00',
      lastManualAt: null,
      lastMachineAt: null,
      lastIncomingType: 'text',
      lastIncomingContent: 'こんにちは',
    });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
  });

  test('total と pageSize / page を切り出す', async () => {
    const db = stubDB({
      rows: [
        {
          friend_id: 'f1', display_name: 'A', picture_url: null,
          line_account_id: 'a1', account_name: 'L ①',
          last_incoming: '2026-05-08T09:00:00+09:00',
          last_manual: null, last_machine: null,
          last_incoming_type: 'text', last_incoming_content: 'msg1',
        },
        {
          friend_id: 'f2', display_name: 'B', picture_url: null,
          line_account_id: 'a1', account_name: 'L ①',
          last_incoming: '2026-05-08T10:00:00+09:00',
          last_manual: null, last_machine: '2026-05-08T10:01:00+09:00',
          last_incoming_type: 'text', last_incoming_content: 'msg2',
        },
      ],
      total: 2,
      byAccount: [],
      oldestWait: null,
    });

    const p1 = await computeUnansweredInbox(db, { page: 1, pageSize: 1 });
    expect(p1.total).toBe(2);
    expect(p1.rows).toHaveLength(1);

    const p2 = await computeUnansweredInbox(db, { page: 2, pageSize: 1 });
    expect(p2.rows).toHaveLength(1);
    expect(p1.rows[0].friendId).not.toBe(p2.rows[0].friendId);
  });

  test('機械応答済 (last_machine) でもリストに残る — 人間の返事と見なさない', async () => {
    const db = stubDB({
      rows: [
        {
          friend_id: 'f1', display_name: 'A', picture_url: null,
          line_account_id: 'a1', account_name: 'L ①',
          last_incoming: '2026-05-08T10:00:00+09:00',
          last_manual: null,
          last_machine: '2026-05-08T10:00:30+09:00',
          last_incoming_type: 'text', last_incoming_content: 'help',
        },
      ],
      total: 1, byAccount: [], oldestWait: null,
    });

    const result = await computeUnansweredInbox(db);
    expect(result.rows[0].lastMachineAt).toBe('2026-05-08T10:00:30+09:00');
    expect(result.rows).toHaveLength(1);
  });

  test('account / q / minWaitMinutes フィルタ', async () => {
    const now = Date.now();
    const tenMinAgo = new Date(now - 10 * 60_000).toISOString();
    const twoHoursAgo = new Date(now - 120 * 60_000).toISOString();

    const db = stubDB({
      rows: [
        {
          friend_id: 'f1', display_name: '山田', picture_url: null,
          line_account_id: 'a1', account_name: 'L ①',
          last_incoming: tenMinAgo,
          last_manual: null, last_machine: null,
          last_incoming_type: 'text', last_incoming_content: 'こんにちは',
        },
        {
          friend_id: 'f2', display_name: '佐藤', picture_url: null,
          line_account_id: 'a2', account_name: 'L ②',
          last_incoming: twoHoursAgo,
          last_manual: null, last_machine: null,
          last_incoming_type: 'text', last_incoming_content: '料金教えて',
        },
      ],
      total: 2, byAccount: [], oldestWait: null,
    });

    expect((await computeUnansweredInbox(db, { account: 'a1' })).total).toBe(1);
    expect((await computeUnansweredInbox(db, { q: '山田' })).total).toBe(1);
    expect((await computeUnansweredInbox(db, { q: '料金' })).total).toBe(1);
    expect((await computeUnansweredInbox(db, { minWaitMinutes: 60 })).total).toBe(1);
    expect((await computeUnansweredInbox(db, { minWaitMinutes: 60 })).rows[0].friendId).toBe('f2');
  });
});

describe('countUnanswered', () => {
  test('total + byAccount + oldestWaitMinutes を未対応行から派生する', async () => {
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60_000).toISOString();
    const tenMinAgo = new Date(now - 10 * 60_000).toISOString();
    const db = stubDB({
      rows: [
        // a1 に 3 人
        {
          friend_id: 'f1', display_name: 'A', picture_url: null,
          line_account_id: 'a1', account_name: 'L ①',
          last_incoming: oneHourAgo,
          last_manual: null, last_machine: null,
          last_incoming_type: 'text', last_incoming_content: 'msg1',
        },
        {
          friend_id: 'f2', display_name: 'B', picture_url: null,
          line_account_id: 'a1', account_name: 'L ①',
          last_incoming: tenMinAgo,
          last_manual: null, last_machine: null,
          last_incoming_type: 'text', last_incoming_content: 'msg2',
        },
        {
          friend_id: 'f3', display_name: 'C', picture_url: null,
          line_account_id: 'a1', account_name: 'L ①',
          last_incoming: tenMinAgo,
          last_manual: null, last_machine: null,
          last_incoming_type: 'text', last_incoming_content: 'msg3',
        },
        // a2 に 2 人
        {
          friend_id: 'f4', display_name: 'D', picture_url: null,
          line_account_id: 'a2', account_name: 'L ②',
          last_incoming: tenMinAgo,
          last_manual: null, last_machine: null,
          last_incoming_type: 'text', last_incoming_content: 'msg4',
        },
        {
          friend_id: 'f5', display_name: 'E', picture_url: null,
          line_account_id: 'a2', account_name: 'L ②',
          last_incoming: tenMinAgo,
          last_manual: null, last_machine: null,
          last_incoming_type: 'text', last_incoming_content: 'msg5',
        },
      ],
    });

    const c = await countUnanswered(db);
    expect(c.total).toBe(5);
    expect(c.byAccount).toEqual([
      { accountId: 'a1', accountName: 'L ①', count: 3 },
      { accountId: 'a2', accountName: 'L ②', count: 2 },
    ]);
    expect(c.oldestWaitMinutes).toBeGreaterThanOrEqual(60);
    expect(c.oldestWaitMinutes).toBeLessThan(62);
  });

  test('未対応ゼロのときは total=0 / oldest=null', async () => {
    const db = stubDB({ rows: [] });
    const c = await countUnanswered(db);
    expect(c.total).toBe(0);
    expect(c.byAccount).toEqual([]);
    expect(c.oldestWaitMinutes).toBeNull();
  });
});

describe('auto_reply マッチ除外', () => {
  const baseRow = (overrides: Partial<InboxRow>): InboxRow => ({
    friend_id: 'f1',
    display_name: 'A',
    picture_url: null,
    line_account_id: 'a1',
    account_name: 'L ①',
    last_incoming: '2026-05-08T10:00:00+09:00',
    last_manual: null,
    last_machine: null,
    last_incoming_type: 'text',
    last_incoming_content: 'msg',
    ...overrides,
  });

  test('exact match の auto_reply キーワードは除外される', async () => {
    const db = stubDB({
      rows: [
        baseRow({ friend_id: 'f1', last_incoming_content: '導入相談' }),
        baseRow({ friend_id: 'f2', last_incoming_content: 'こんにちはお元気ですか' }),
      ],
      autoReplies: [
        { keyword: '導入相談', match_type: 'exact', line_account_id: null },
      ],
    });

    const result = await computeUnansweredInbox(db);
    expect(result.total).toBe(1);
    expect(result.rows[0].friendId).toBe('f2');
  });

  test('contains match の auto_reply キーワードを含むメッセは除外される', async () => {
    const db = stubDB({
      rows: [
        baseRow({ friend_id: 'f1', last_incoming_content: '料金教えてください' }),
        baseRow({ friend_id: 'f2', last_incoming_content: '昨日は楽しかった' }),
      ],
      autoReplies: [
        { keyword: '料金', match_type: 'contains', line_account_id: null },
      ],
    });

    const result = await computeUnansweredInbox(db);
    expect(result.total).toBe(1);
    expect(result.rows[0].friendId).toBe('f2');
  });

  test('auto_reply のスコープを跨いで keyword echo を除外する', async () => {
    // 1 アカウントだけに登録された button label でも、別アカウントの友だちが
    // 同じ文字列を送ってきたら button label echo と見なして除外する。
    // (本番事故 2026-05-08: L Harness ② のユーザーが「体験を完了する」と送って
    //  ①b 専用ルールしか無かったため未対応に大量出現していた)
    const db = stubDB({
      rows: [
        baseRow({ friend_id: 'f1', line_account_id: 'a1', last_incoming_content: '導入相談' }),
        baseRow({ friend_id: 'f2', line_account_id: 'a2', account_name: 'L ②', last_incoming_content: '導入相談' }),
      ],
      autoReplies: [
        // a1 専用ルールでも、a2 の同 keyword incoming にも適用する
        { keyword: '導入相談', match_type: 'exact', line_account_id: 'a1' },
      ],
    });

    const result = await computeUnansweredInbox(db);
    expect(result.total).toBe(0);
  });

  test('画像/スタンプ等 (text 以外) は keyword 除外の対象外', async () => {
    const db = stubDB({
      rows: [
        baseRow({
          friend_id: 'f1',
          last_incoming_type: 'sticker',
          last_incoming_content: 'sticker_id_12345',
        }),
      ],
      autoReplies: [
        // たまたま keyword が sticker の content と一致しても、type=text 以外には適用しない
        { keyword: 'sticker_id_12345', match_type: 'exact', line_account_id: null },
      ],
    });

    const result = await computeUnansweredInbox(db);
    expect(result.total).toBe(1);
    expect(result.rows[0].friendId).toBe('f1');
  });

  test('質問 → 後 button タップ: 自由記述 incoming は preview として残る', async () => {
    // last_manual なし、incoming 2件: 古い自由記述 + 新しい button タップ (auto_reply マッチ)
    const db = stubDB({
      rows: [
        baseRow({ friend_id: 'f1', last_incoming: '2026-05-08T10:05:00+09:00' }),
      ],
      recentIncomings: [
        // f1 の最新 = button タップ (マッチ)、その前 = 自由記述
        {
          friend_id: 'f1',
          message_type: 'text',
          content: '導入相談',
          created_at: '2026-05-08T10:05:00+09:00',
        },
        {
          friend_id: 'f1',
          message_type: 'text',
          content: 'すみません質問があります',
          created_at: '2026-05-08T10:00:00+09:00',
        },
      ],
      autoReplies: [
        { keyword: '導入相談', match_type: 'exact', line_account_id: null },
      ],
    });

    const result = await computeUnansweredInbox(db);
    expect(result.total).toBe(1);
    // preview は 自由記述 (button タップではない)
    expect(result.rows[0].lastIncomingContent).toBe('すみません質問があります');
    expect(result.rows[0].lastIncomingAt).toBe('2026-05-08T10:00:00+09:00');
  });

  test('全 incoming がマッチした thread は除外される', async () => {
    const db = stubDB({
      rows: [
        baseRow({ friend_id: 'f1', last_incoming: '2026-05-08T10:05:00+09:00' }),
      ],
      recentIncomings: [
        {
          friend_id: 'f1',
          message_type: 'text',
          content: '導入相談',
          created_at: '2026-05-08T10:05:00+09:00',
        },
        {
          friend_id: 'f1',
          message_type: 'text',
          content: 'コスト比較',
          created_at: '2026-05-08T10:00:00+09:00',
        },
      ],
      autoReplies: [
        { keyword: '導入相談', match_type: 'exact', line_account_id: null },
        { keyword: 'コスト比較', match_type: 'exact', line_account_id: null },
      ],
    });

    const result = await computeUnansweredInbox(db);
    expect(result.total).toBe(0);
  });

  test('現在 active なルールは過去 incoming にも適用される', async () => {
    // 本番事故 2026-05-08 #2: ルールが re-create されると created_at が新しくなり、
    // 古い incoming が「ルール後付け」扱いで除外されない問題があった。
    // 現実的には button label / FAQ keyword は安定運用なので、現在の active
    // キーワードが一致したら歴史問わず構造化メッセと判定する。
    const db = stubDB({
      rows: [
        baseRow({ friend_id: 'f1', last_incoming: '2026-05-08T10:00:00+09:00' }),
      ],
      recentIncomings: [
        {
          friend_id: 'f1',
          message_type: 'text',
          content: '導入相談',
          created_at: '2026-05-08T10:00:00+09:00',
        },
      ],
      autoReplies: [
        // ルールが incoming の翌日に作成されていても適用する
        {
          keyword: '導入相談',
          match_type: 'exact',
          line_account_id: null,
          created_at: '2026-05-09T00:00:00+09:00',
        },
      ],
    });

    const result = await computeUnansweredInbox(db);
    expect(result.total).toBe(0);
  });

  test('応答ありルール: outgoing auto_reply 証拠で除外 (rule edit に左右されない)', async () => {
    // ルール定義は無いが、実際に auto_reply outgoing が記録されている場合 → 除外
    const db = stubDB({
      rows: [
        baseRow({ friend_id: 'f1', last_incoming: '2026-05-08T10:00:00+09:00' }),
      ],
      recentIncomings: [
        {
          friend_id: 'f1',
          message_type: 'text',
          content: 'なんでも質問',
          created_at: '2026-05-08T10:00:00+09:00',
        },
      ],
      autoReplyOutgoings: [
        // incoming 直後 (2 秒後) に auto_reply 発火 → 「マッチ済」と判定
        { friend_id: 'f1', created_at: '2026-05-08T10:00:02+09:00' },
      ],
      autoReplies: [], // silent ルール無し
    });

    const result = await computeUnansweredInbox(db);
    expect(result.total).toBe(0);
  });

  test('応答ありルール: outgoing が遠すぎ (5秒超) なら証拠扱いしない', async () => {
    const db = stubDB({
      rows: [
        baseRow({ friend_id: 'f1', last_incoming: '2026-05-08T10:00:00+09:00' }),
      ],
      recentIncomings: [
        {
          friend_id: 'f1',
          message_type: 'text',
          content: 'なんでも質問',
          created_at: '2026-05-08T10:00:00+09:00',
        },
      ],
      autoReplyOutgoings: [
        // 10秒後 — incoming への応答とは見なせない (別の auto_reply の可能性)
        { friend_id: 'f1', created_at: '2026-05-08T10:00:10+09:00' },
      ],
    });

    const result = await computeUnansweredInbox(db);
    expect(result.total).toBe(1);
  });

  test('outgoing 1 件は incoming 1 件にしか consume されない: 古い free-form は残る', async () => {
    // 友だちが free-form A → keyword B と短時間で 2 連投。auto_reply は B にだけ反応。
    // 古い A は消費されない outgoing 無しなので "non-matching" として残るべき。
    const db = stubDB({
      rows: [
        baseRow({ friend_id: 'f1', last_incoming: '2026-05-08T10:00:02+09:00' }),
      ],
      recentIncomings: [
        // f1 で 2 件、新しい順
        {
          friend_id: 'f1',
          message_type: 'text',
          content: 'B (keyword)',
          created_at: '2026-05-08T10:00:02+09:00',
        },
        {
          friend_id: 'f1',
          message_type: 'text',
          content: 'A (free)',
          created_at: '2026-05-08T10:00:00+09:00',
        },
      ],
      autoReplyOutgoings: [
        // B の応答 1 件のみ
        { friend_id: 'f1', created_at: '2026-05-08T10:00:03+09:00' },
      ],
    });

    const result = await computeUnansweredInbox(db);
    expect(result.total).toBe(1);
    // A (free) が preview として残る — outgoing は B に consume されているので
    // A は证拠なしと判定される
    expect(result.rows[0].lastIncomingContent).toBe('A (free)');
  });

  test('countUnanswered も auto_reply 除外を反映する', async () => {
    const db = stubDB({
      rows: [
        baseRow({ friend_id: 'f1', last_incoming_content: '導入相談' }),
        baseRow({ friend_id: 'f2', last_incoming_content: 'free message' }),
      ],
      autoReplies: [
        { keyword: '導入相談', match_type: 'exact', line_account_id: null },
      ],
    });

    const c = await countUnanswered(db);
    expect(c.total).toBe(1);
    expect(c.byAccount).toEqual([{ accountId: 'a1', accountName: 'L ①', count: 1 }]);
  });

  test('複数 friend は lastIncoming 新→古 順に並ぶ', async () => {
    const db = stubDB({
      rows: [
        baseRow({
          friend_id: 'f_old',
          last_incoming: '2026-05-01T10:00:00+09:00',
          last_incoming_content: 'old',
        }),
        baseRow({
          friend_id: 'f_mid',
          last_incoming: '2026-05-05T10:00:00+09:00',
          last_incoming_content: 'mid',
        }),
        baseRow({
          friend_id: 'f_new',
          last_incoming: '2026-05-10T10:00:00+09:00',
          last_incoming_content: 'new',
        }),
      ],
    });

    const result = await computeUnansweredInbox(db);
    expect(result.rows.map((r) => r.friendId)).toEqual(['f_new', 'f_mid', 'f_old']);
  });

  test('getUnansweredFriendIds は未対応 friend の Set を返す', async () => {
    const db = stubDB({
      rows: [
        baseRow({ friend_id: 'f_un1' }),
        baseRow({ friend_id: 'f_un2' }),
      ],
    });

    const { getUnansweredFriendIds } = await import('./unanswered-inbox.js');
    const ids = await getUnansweredFriendIds(db);
    expect(ids).toBeInstanceOf(Set);
    expect(ids.has('f_un1')).toBe(true);
    expect(ids.has('f_un2')).toBe(true);
    expect(ids.size).toBe(2);
  });

  test('getUnansweredFriendIds は auto_reply matched を除外する', async () => {
    const db = stubDB({
      rows: [
        baseRow({ friend_id: 'f_keep', last_incoming_content: '通常メッセ' }),
        baseRow({ friend_id: 'f_drop', last_incoming_content: '導入相談' }),
      ],
      autoReplies: [
        { keyword: '導入相談', match_type: 'exact', line_account_id: null },
      ],
    });

    const { getUnansweredFriendIds } = await import('./unanswered-inbox.js');
    const ids = await getUnansweredFriendIds(db);
    expect(ids.has('f_keep')).toBe(true);
    expect(ids.has('f_drop')).toBe(false);
    expect(ids.size).toBe(1);
  });
});
