import { describe, it, expect } from 'vitest';
import {
  searchUniversities,
  reducePostback,
  reduceText,
  buildCandidatesMessage,
  buildStartMessage,
  universities,
  isSurveyAccount,
  gradeCode,
  handlePickedUniversity,
  greetingFromTemplates,
} from './intern-survey.js';

type QuickItem = { action: { label: string; data: string; inputOption?: string } };
// カードの中の押せる枠を上から順に集める
const quick = (m: unknown): QuickItem[] => {
  const out: QuickItem[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const o = n as Record<string, unknown>;
    if (o.type === 'box' && o.action) out.push({ action: o.action as QuickItem['action'] });
    Object.values(o).forEach(walk);
  };
  walk(m);
  return out;
};

describe('searchUniversities', () => {
  it('一覧を読み込める', () => {
    expect(universities().length).toBeGreaterThan(800);
  });

  it('大学名の一部で探せる', () => {
    expect(searchUniversities('早稲田')[0].name).toBe('早稲田大学');
    expect(searchUniversities('明治').map((u) => u.name)).toEqual(expect.arrayContaining(['明治大学', '明治学院大学']));
  });

  it('同じ名前がいちばん上に来る', () => {
    expect(searchUniversities('明治大学')[0].name).toBe('明治大学');
  });

  it('略し方で探せる', () => {
    expect(searchUniversities('早大')[0].name).toBe('早稲田大学');
    expect(searchUniversities('慶大')[0].name).toBe('慶應義塾大学');
    expect(searchUniversities('東工大')[0].name).toBe('東京科学大学');
    expect(searchUniversities('関学')[0].name).toBe('関西学院大学');
  });

  it('旧字体・新字体・全角半角の違いを吸収する', () => {
    expect(searchUniversities('慶応')[0].name).toBe('慶應義塾大学');
    expect(searchUniversities('国学院')[0].name).toBe('國學院大學');
    expect(searchUniversities('駒沢')[0].name).toBe('駒澤大学');
    expect(searchUniversities('独協')[0].name).toBe('獨協大学');
    expect(searchUniversities('ＺＥＮ')[0].name).toBe('ZEN大学');
  });

  it('学部まで書いても大学で探せる', () => {
    expect(searchUniversities('早稲田大学 政治経済学部')[0].name).toBe('早稲田大学');
  });

  it('当てはまらなければ空', () => {
    expect(searchUniversities('ほげほげ')).toEqual([]);
    expect(searchUniversities('   ')).toEqual([]);
  });
});

describe('buildCandidatesMessage', () => {
  it('候補＋もう一度＋この中にない をカードの中に出す（候補は最大8個）', () => {
    const m = buildCandidatesMessage('東京');
    expect(m.type).toBe('flex');
    expect(m.quickReply).toBeUndefined();
    const items = quick(m);
    expect(items.length).toBe(10);
    expect(items[8].action.data).toBe('isv:retry');
    expect(items[8].action.inputOption).toBe('openKeyboard');
    expect(items[9].action.data).toBe('isv:raw:東京');
    items.forEach((i) => expect(i.action.label.length).toBeLessThanOrEqual(20));
  });

  it('見つからないときは打ち直しと、打ったままの登録を出す', () => {
    const m = buildCandidatesMessage('ほげほげ');
    expect(JSON.stringify(m)).toContain('見つかりませんでした');
    expect(quick(m).map((i) => i.action.data)).toEqual(['isv:retry', 'isv:raw:ほげほげ']);
  });
});

describe('トーク下のボタンを使わない', () => {
  it('学年・卒業予定年はカードの中の選択肢で選ぶ', () => {
    const g = reducePostback({ survey_step: 'university' }, 'isv:u:早稲田大学', {})!.messages[0];
    expect(g.type).toBe('flex');
    expect(g.quickReply).toBeUndefined();
    expect(quick(g).length).toBe(10);
    const y = reducePostback({ survey_step: 'grade' }, 'isv:g:学部1年', {})!.messages[0];
    expect(y.type).toBe('flex');
    expect(y.quickReply).toBeUndefined();
    expect(quick(y).map((i) => i.action.data)[0]).toBe('isv:y:2027');
  });

  it('1問目のカードにもトーク下のボタンを付けない', () => {
    const m = reducePostback({ survey_step: 'consent' }, 'isv:consent', { pickerUrl: 'https://example.com/u' })!.messages[0];
    expect(m.quickReply).toBeUndefined();
  });
});

describe('buildStartMessage', () => {
  it('同意ボタンでキーボードが開く・リンクが無ければポリシーのボタンを出さない', () => {
    const m = buildStartMessage({});
    const json = JSON.stringify(m);
    expect(json).toContain('"inputOption":"openKeyboard"');
    expect(json).not.toContain('"uri"');
    // 1問目を画面で選ぶときはキーボードを開かない
    expect(JSON.stringify(buildStartMessage({ pickerUrl: 'https://example.com/u' }))).not.toContain('openKeyboard');
    expect(JSON.stringify(buildStartMessage({ privacyPolicyUrl: 'https://example.com/p' }))).toContain('https://example.com/p');
  });
});

describe('アンケートの流れ', () => {
  const cfg = {};

  it('同意 → 大学名 → 学年 → 卒業予定年 → 完了', () => {
    let state: Record<string, unknown> = { survey_step: 'consent' };
    const step = (data: string) => {
      const r = reducePostback(state, data, cfg)!;
      if (r.patch) state = { ...state, ...r.patch };
      return r;
    };

    step('isv:consent');
    expect(state.survey_step).toBe('university');

    const cand = reduceText(state, '早稲田')!;
    expect(quick(cand.messages[0])[0].action.data).toBe('isv:u:早稲田大学');
    expect(cand.patch).toBeNull();

    step('isv:u:早稲田大学');
    expect(state).toMatchObject({ survey_step: 'grade', university_name: '早稲田大学', university_kind: '私', university_unlisted: false });

    step('isv:g:学部3年');
    expect(state).toMatchObject({ survey_step: 'graduation_year', grade: '学部3年' });

    const done = step('isv:y:2028');
    expect(state).toMatchObject({ survey_step: 'done', graduation_year: '2028' });
    expect(state.survey_completed_at).toBeTruthy();
    expect(done.messages[0]).toMatchObject({ type: 'image', originalContentUrl: expect.stringContaining('intern-done-menu') });
  });

  it('一覧にない大学は打ったまま記録し、印を付ける', () => {
    const r = reducePostback({ survey_step: 'university' }, 'isv:raw:ハーバード大学', cfg)!;
    expect(r.patch).toMatchObject({ survey_step: 'grade', university_name: 'ハーバード大学', university_unlisted: true });
  });

  it('一覧にない名前を候補のボタンに見せかけても受け付けない', () => {
    const r = reducePostback({ survey_step: 'university' }, 'isv:u:架空大学', cfg)!;
    expect(r.patch).toBeNull();
  });

  it('今の問いと違うボタン（古いボタン）は記録せず、今の問いを出し直す', () => {
    const r = reducePostback({ survey_step: 'graduation_year' }, 'isv:g:学部1年', cfg)!;
    expect(r.patch).toBeNull();
    expect(String((r.messages[0] as any).altText)).toContain('3問目');
  });

  it('学年の途中で文字を送ったら、学年の問いを出し直す', () => {
    const r = reduceText({ survey_step: 'grade' }, 'こんにちは')!;
    expect(String((r.messages[0] as any).altText)).toContain('2問目');
  });

  it('アンケートの外の文字はふだんの処理に回す', () => {
    expect(reduceText({}, 'こんにちは')).toBeNull();
    expect(reduceText({ survey_step: 'done' }, 'こんにちは')).toBeNull();
    expect(reduceText({ survey_step: 'consent' }, 'こんにちは')).toBeNull();
  });

  it('答え終えた人の答えは変えない', () => {
    const r = reducePostback({ survey_step: 'done' }, 'isv:y:2030', cfg)!;
    expect(r.patch).toBeNull();
  });

  it('アンケートのボタンでなければ null', () => {
    expect(reducePostback({}, 'menu:jobs', cfg)).toBeNull();
  });
});

describe('isSurveyAccount', () => {
  it('設定したアカウントだけで動く', () => {
    expect(isSurveyAccount({ accountId: 'a' }, 'a')).toBe(true);
    expect(isSurveyAccount({ accountId: 'a' }, 'b')).toBe(false);
    expect(isSurveyAccount({}, 'a')).toBe(false);
    expect(isSurveyAccount({ accountId: 'a' }, null)).toBe(false);
  });
});

describe('大学を選ぶ画面・答え終えたあと', () => {
  const cfg = { pickerUrl: 'https://liff.line.me/x/university.html' };

  it('同意すると「大学を選択する」ボタンのカードが届き、同意の印を付ける', () => {
    const r = reducePostback({ survey_step: 'consent' }, 'isv:consent', cfg)!;
    expect(r.patch).toEqual({ survey_step: 'university' });
    expect(JSON.stringify(r.messages[0])).toContain('大学を選択する');
    expect(r.effects).toEqual(['consented']);
  });

  it('画面から送られた「大学名：〇〇」はそのまま決まり、2問目へ進む', () => {
    const r = reduceText({ survey_step: 'university' }, '大学名：早稲田大学', cfg)!;
    expect(r.patch).toMatchObject({ survey_step: 'grade', university_name: '早稲田大学', university_unlisted: false });
  });

  it('一覧にない大学は打った名前のまま記録する', () => {
    const r = reduceText({ survey_step: 'university' }, '大学名（一覧にない）：架空学院大学', cfg)!;
    expect(r.patch).toMatchObject({ survey_step: 'grade', university_name: '架空学院大学', university_unlisted: true });
  });

  it('画面から送られた名前が一覧に無ければ候補を出す', () => {
    const r = reduceText({ survey_step: 'university' }, '大学名：早稲田', cfg)!;
    expect(r.patch).toBeNull();
    expect(JSON.stringify(r.messages[0])).toContain('早稲田大学');
  });

  it('2問目の途中で古い画面から送っても、答えは変わらない', () => {
    const r = reduceText({ survey_step: 'grade', university_name: '明治大学' }, '大学名：早稲田大学', cfg)!;
    expect(r.patch).toBeNull();
  });

  it('3問目に答えると片付け（印・メニュー・ミニアプリへの受け渡し）をする', () => {
    const r = reducePostback({ survey_step: 'graduation_year' }, 'isv:y:2028', cfg)!;
    expect(r.effects).toEqual(['completed']);
  });

  it('回答済みの人が鍵付きメニューを押したら、メニューを開き直す', () => {
    const r = reducePostback({ survey_step: 'done' }, 'isv:start', cfg)!;
    expect(r.effects).toEqual(['unlock']);
  });

  it('途中の人が鍵付きメニューを押したら、続きの問いを出す', () => {
    const r = reducePostback({ survey_step: 'grade' }, 'isv:start', cfg)!;
    expect(JSON.stringify(r.messages[0])).toContain('2問目');
  });

  it('学年をミニアプリの値に直す', () => {
    expect(gradeCode('学部3年')).toBe('B3');
    expect(gradeCode('博士2年')).toBe('D');
    expect(gradeCode('その他')).toBe('OTHER');
  });
});

describe('大学を選ぶ画面からの受け渡し（通常の送信）', () => {
  const cfg = { accountId: 'intern', pickerUrl: 'https://liff.line.me/x/university.html' };
  const U = 'U' + '0'.repeat(32);
  // friends の1行だけを持つ小さな DB の代わり
  const fakeDb = () => {
    const store = { metadata: JSON.stringify({ survey_step: 'university' }) };
    const db = {
      prepare(sql: string) {
        let args: unknown[] = [];
        const stmt = {
          bind(...a: unknown[]) { args = a; return stmt; },
          async first() {
            if (sql.startsWith('SELECT id FROM friends')) return { id: 'f1' };
            if (sql.startsWith('SELECT metadata')) return { metadata: store.metadata };
            return null;
          },
          async run() {
            if (sql.startsWith('UPDATE friends SET metadata')) store.metadata = String(args[0]);
            return {};
          },
        };
        return stmt;
      },
    };
    return { db: db as unknown as D1Database, store };
  };

  it('2問目が送れなかったら進みを記録しない（押し直せば届く）', async () => {
    const { db, store } = fakeDb();
    const client = { pushMessage: async () => { throw new Error('quota'); } };
    await expect(
      handlePickedUniversity(db, client as never, cfg, { lineUserId: U, name: '明治大学', unlisted: false }),
    ).rejects.toThrow();
    expect(JSON.parse(store.metadata).survey_step).toBe('university');
  });

  it('2問目が送れたら進みを記録する', async () => {
    const { db, store } = fakeDb();
    const sent: unknown[] = [];
    const client = { pushMessage: async (_u: string, m: unknown) => { sent.push(m); } };
    expect(await handlePickedUniversity(db, client as never, cfg, { lineUserId: U, name: '明治大学', unlisted: false })).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(store.metadata)).toMatchObject({ survey_step: 'grade', university_name: '明治大学' });
  });
});

describe('あいさつ（アンケートの入口の前に付ける）', () => {
  const rows = [
    { name: 'ズ_あいさつ_2', message_type: 'text', message_content: '2' },
    { name: 'ズ_あいさつ_10', message_type: 'text', message_content: '10' },
    { name: 'ズ_あいさつ_1', message_type: 'text', message_content: '1' },
    { name: 'ズ_あいさつ_3', message_type: 'text', message_content: '3' },
    { name: 'ズ_あいさつ_4', message_type: 'text', message_content: '4' },
    { name: 'ズ_あいさつ_5', message_type: 'text', message_content: '' },
    { name: 'ズ_あいさつ1_1', message_type: 'text', message_content: '前の作りの名前' },
    { name: 'ズ_あいさつ_ボタン名', message_type: 'text', message_content: '前の作りの名前' },
    { name: 'ほかの定型文', message_type: 'text', message_content: '関係ない' },
  ];
  const texts = (ms: unknown[]) => ms.map((m) => (m as { text?: string }).text);

  it('「ズ_あいさつ_数字」だけを名前の順に並べ、1回に送れる数（4つ）までにする。空の定型文は飛ばす', () => {
    expect(texts(greetingFromTemplates(rows))).toEqual(['1', '2', '3', '4']);
    expect(greetingFromTemplates([])).toEqual([]);
  });
});
