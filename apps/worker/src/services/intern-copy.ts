// インターン（すごい大学生ズ）の LINE で自動で送る文面。管理画面の「自動で送る文面」から直せる。
//
// 置き場は account_settings（KIDOUインターンのアカウント・キー intern_copy）に JSON で1つ。
// 保存していない項目・空の項目は、ここに書いた初期の文面を使う（保存が壊れていてもアンケートは止めない）。
// カードの形・色・ボタンの合図（isv:…）・学年の選択肢（ミニアプリのプロフィールと対応）はプログラム側に残す。
// Q&A の質問の id はボタンの合図に使う。公開後に変えると古いカードのボタンが効かなくなるので、画面では変えさせない。

import { QA_SECTIONS, type QaSection } from './intern-qa.js';

export const COPY_SETTING_KEY = 'intern_copy';

export interface InternCopy {
  consent: { title: string; body: string; button: string };
  university: { kicker: string; title: string; button: string; typeOnly: string; retryPrompt: string };
  candidates: {
    title: string;
    manyNote: string;
    notFoundTitle: string;
    notFoundNote: string;
    retry: string;
    notListed: string;
    registerRaw: string;
  };
  grade: { kicker: string; title: string };
  graduationYear: { kicker: string; title: string; years: string[] };
  done: { already: string };
  remind: { text: string };
  qa: { sections: QaSection[]; answerKicker: string; more: string };
  academyRequest: { done: string };
}

/** 文の中の {入力} は、学生が打った大学名に置き換える */
export const INPUT_MARK = '{入力}';
/** 会員サイトのリクエストの文の中の {講座名} は、できた講座・資料の名前に置き換える */
export const COURSE_NAME_MARK = '{講座名}';

export const DEFAULT_COPY: InternCopy = {
  consent: {
    title: 'アンケートのお願い（3問）',
    body: '利用規約とプライバシーポリシーに同意のうえ、\n3問のアンケートにご回答ください。\n\n回答後、下のメニューが開きます。',
    button: '同意して回答する',
  },
  university: {
    kicker: 'アンケート 1/3',
    title: '大学名を教えてください。',
    button: '大学を選択する',
    typeOnly: '1問目：大学名を入力して送ってください。\n例：早稲田、明治大学',
    retryPrompt: '大学名を入力して送ってください。',
  },
  candidates: {
    title: '当てはまる大学を選んでください。',
    manyNote: '候補が多いため、一部だけ出しています。見つからない場合は、もう少し詳しく入力してください。',
    notFoundTitle: '「{入力}」に当てはまる大学が見つかりませんでした。',
    notFoundNote: '大学名をもう一度入力するか、入力したままの名前で登録してください。',
    retry: 'もう一度入力する',
    notListed: 'この中にない',
    registerRaw: '「{入力}」で登録する',
  },
  grade: { kicker: 'アンケート 2/3', title: '現在の学年を選んでください。' },
  graduationYear: {
    kicker: 'アンケート 3/3',
    title: '卒業予定年を選んでください。',
    years: ['2027', '2028', '2029', '2030', '2031', '2032', '2033', '2034', '2035', '2036'],
  },
  done: { already: 'アンケートは回答済みです。' },
  remind: { text: 'アンケートがまだ途中です。答えると、画面下のメニュー（求人・マイページなど）が使えるようになります。' },
  qa: { sections: QA_SECTIONS, answerKicker: 'よくある質問', more: 'ほかの質問を見る' },
  academyRequest: {
    done: 'リクエストいただいた内容をもとに、会員サイトに「{講座名}」を用意しました。\n\nよければ、のぞいてみてください。',
  },
};

// LINE の決まりに合わせた上限
const LIMITS = {
  short: 40, // 見出し・ボタン
  title: 200, // 問いの見出し。カードの通知に出る文（LINE の決まりで400字まで）にも使う
  text: 1000, // 文
  qaSections: 12, // カルーセルは12枚まで
  qaItems: 6,
  question: 60,
  answer: 1000,
  years: 12,
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v : fallback);

/** 保存された中身に、無い項目・空の項目を初期の文面で埋める */
export function mergeCopy(saved: unknown): InternCopy {
  const s = isObj(saved) ? saved : {};
  const out = {} as Record<string, unknown>;
  for (const [group, defaults] of Object.entries(DEFAULT_COPY) as [keyof InternCopy, Obj][]) {
    const g = isObj(s[group]) ? (s[group] as Obj) : {};
    const merged: Obj = {};
    for (const [k, def] of Object.entries(defaults)) {
      // 選択肢・Q&A は下で確かめて入れる（並びを初期の文面とそろえるため、ここで場所だけ取る）
      merged[k] = typeof def === 'string' ? str(g[k], def) : def;
    }
    out[group] = merged;
  }
  const c = out as unknown as InternCopy;
  const years = (s.graduationYear as Obj | undefined)?.years;
  c.graduationYear.years = Array.isArray(years) && years.length && years.every((y) => typeof y === 'string' && /^\d{4}$/.test(y))
    ? (years as string[])
    : DEFAULT_COPY.graduationYear.years;
  const sections = (s.qa as Obj | undefined)?.sections;
  c.qa.sections = validQaSections(sections) ? (sections as QaSection[]) : DEFAULT_COPY.qa.sections;
  return c;
}

function validQaSections(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.every((sec) =>
    isObj(sec) && typeof sec.title === 'string' && sec.title.trim() !== '' && Array.isArray(sec.items) && sec.items.length > 0 &&
    sec.items.every((it: unknown) => isObj(it) && typeof it.id === 'string' && /^[a-z0-9-]{1,40}$/.test(it.id) &&
      typeof it.q === 'string' && it.q.trim() !== '' && typeof it.a === 'string' && it.a.trim() !== ''));
}

/** 管理画面から来た中身を確かめる。問題があれば、その内容を日本語で返す */
export function validateCopy(input: unknown): { ok: true; copy: InternCopy } | { ok: false; errors: string[] } {
  if (!isObj(input)) return { ok: false, errors: ['中身が読めませんでした'] };
  const errors: string[] = [];
  for (const [group, defaults] of Object.entries(DEFAULT_COPY) as [keyof InternCopy, Obj][]) {
    const g = input[group];
    if (!isObj(g)) {
      errors.push(`「${group}」がありません`);
      continue;
    }
    for (const [k, def] of Object.entries(defaults)) {
      if (typeof def !== 'string') continue;
      const v = g[k];
      if (typeof v !== 'string' || !v.trim()) errors.push(`空の欄があります（${group}.${k}）`);
      else if (v.length > LIMITS.text) errors.push(`長すぎる欄があります（${group}.${k}）`);
    }
  }
  // ボタンの文字は LINE の決まりで20字まで
  const short: [string, unknown][] = [
    ['同意のボタン', (input.consent as Obj | undefined)?.button],
    ['大学を選ぶボタン', (input.university as Obj | undefined)?.button],
    ['もう一度入力するボタン', (input.candidates as Obj | undefined)?.retry],
    ['この中にないボタン', (input.candidates as Obj | undefined)?.notListed],
    ['ほかの質問を見るボタン', (input.qa as Obj | undefined)?.more],
    ['そのまま登録するボタン', (input.candidates as Obj | undefined)?.registerRaw],
  ];
  for (const [name, v] of short) {
    if (typeof v === 'string' && v.length > 20) errors.push(`${name}は20字までです`);
  }
  // 問いの見出しは、カードの通知に出る文にも使う
  const titles: [string, unknown][] = [
    ['アンケートのお願いの見出し', (input.consent as Obj | undefined)?.title],
    ['1問目の問い', (input.university as Obj | undefined)?.title],
    ['候補があったときの問い', (input.candidates as Obj | undefined)?.title],
    ['見つからなかったときの問い', (input.candidates as Obj | undefined)?.notFoundTitle],
    ['2問目の問い', (input.grade as Obj | undefined)?.title],
    ['3問目の問い', (input.graduationYear as Obj | undefined)?.title],
  ];
  for (const [name, v] of titles) {
    if (typeof v === 'string' && v.length > LIMITS.title) errors.push(`${name}は${LIMITS.title}字までです`);
  }

  const years = (input.graduationYear as Obj | undefined)?.years;
  if (!Array.isArray(years) || years.length === 0) errors.push('卒業予定年の選択肢がありません');
  else {
    if (years.length > LIMITS.years) errors.push(`卒業予定年の選択肢は${LIMITS.years}個までです`);
    if (!years.every((y) => typeof y === 'string' && /^\d{4}$/.test(y))) errors.push('卒業予定年は「2028」のように西暦4桁で入れてください');
    if (new Set(years).size !== years.length) errors.push('卒業予定年に同じ年が2つあります');
  }

  const sections = (input.qa as Obj | undefined)?.sections;
  if (!Array.isArray(sections) || sections.length === 0) errors.push('Q&A のカードが1枚もありません');
  else {
    if (sections.length > LIMITS.qaSections) errors.push(`Q&A のカードは${LIMITS.qaSections}枚までです`);
    const ids = new Set<string>();
    sections.forEach((sec, i) => {
      const n = i + 1;
      if (!isObj(sec) || typeof sec.title !== 'string' || !sec.title.trim()) errors.push(`Q&A ${n}枚目の見出しが空です`);
      else if (sec.title.length > LIMITS.short) errors.push(`Q&A ${n}枚目の見出しは${LIMITS.short}字までです`);
      const items = isObj(sec) ? sec.items : null;
      if (!Array.isArray(items) || items.length === 0) {
        errors.push(`Q&A ${n}枚目に質問がありません`);
        return;
      }
      if (items.length > LIMITS.qaItems) errors.push(`Q&A ${n}枚目の質問は${LIMITS.qaItems}個までです`);
      items.forEach((it, j) => {
        const where = `Q&A ${n}枚目の${j + 1}問目`;
        if (!isObj(it) || typeof it.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(it.id)) {
          errors.push(`${where}の内部の名前が正しくありません`);
          return;
        }
        if (ids.has(it.id)) errors.push(`${where}の内部の名前がほかと重なっています`);
        ids.add(it.id);
        if (typeof it.q !== 'string' || !it.q.trim()) errors.push(`${where}の質問が空です`);
        else if (it.q.length > LIMITS.question) errors.push(`${where}の質問は${LIMITS.question}字までです`);
        if (typeof it.a !== 'string' || !it.a.trim()) errors.push(`${where}の回答が空です`);
        else if (it.a.length > LIMITS.answer) errors.push(`${where}の回答は${LIMITS.answer}字までです`);
      });
    });
  }
  if (errors.length) return { ok: false, errors };
  // 余計な項目は捨て、決まった形にそろえて残す
  const copy = mergeCopy(input);
  copy.qa.sections = (sections as QaSection[]).map((sec) => ({
    title: sec.title.trim(),
    items: sec.items.map((it) => ({ id: it.id, q: it.q.trim(), a: it.a.trim() })),
  }));
  return { ok: true, copy };
}

export async function loadCopy(db: D1Database, accountId: string | undefined): Promise<InternCopy> {
  if (!accountId) return DEFAULT_COPY;
  try {
    const row = await db
      .prepare('SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?')
      .bind(accountId, COPY_SETTING_KEY)
      .first<{ value: string }>();
    return row ? mergeCopy(JSON.parse(row.value)) : DEFAULT_COPY;
  } catch (err) {
    console.error('[intern-copy] load failed', err);
    return DEFAULT_COPY;
  }
}

export async function loadCopyRecord(db: D1Database, accountId: string): Promise<{ copy: InternCopy; updatedAt: string | null }> {
  const row = await db
    .prepare('SELECT value, updated_at FROM account_settings WHERE line_account_id = ? AND key = ?')
    .bind(accountId, COPY_SETTING_KEY)
    .first<{ value: string; updated_at: string }>();
  if (!row) return { copy: DEFAULT_COPY, updatedAt: null };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    parsed = null;
  }
  return { copy: mergeCopy(parsed), updatedAt: row.updated_at };
}

export async function saveCopy(db: D1Database, accountId: string, copy: InternCopy, now: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), accountId, COPY_SETTING_KEY, JSON.stringify(copy), now, now)
    .run();
}

/** 文の {入力} を置き換える */
export function fillInput(t: string, input: string): string {
  return t.split(INPUT_MARK).join(input);
}

/** 文の {講座名} を置き換える */
export function fillCourseName(t: string, title: string): string {
  return t.split(COURSE_NAME_MARK).join(title);
}
