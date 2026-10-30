// インターン（すごい大学生ズ）の登録アンケート（3問）。
//
// 1問目 大学名：［大学を選択する］でミニアプリの小さな画面を開き、文字を打つと出る候補から選ぶ。
//   選ぶと画面が「大学名：〇〇大学」をトークに送って閉じる。画面が使えない人はトークに大学名を打てば、候補をボタンで返す
// 2問目 学年・3問目 卒業予定年：カードの中の選択肢を押して選ぶ
// トーク下に並ぶボタン（クイックリプライ）は見た目がよくないので使わない。選択肢はすべてカードの中に置く
// 答え終えたら：印を付ける・解放後のメニューに切り替える・答えをミニアプリのプロフィールに渡す
// はじめて友だち追加した人には、アンケートの入口（同意のカード）の前にあいさつの文を付けて、1回の返事でまとめて送る。
//   文はハーネスの定型文「ズ_あいさつ_1」「ズ_あいさつ_2」…から読む。1つも無ければ、今までどおりアンケートの入口だけを送る
//
// どこまで答えたかと答えは、友だちの metadata に入れる（survey_step / university_name ほか）。
// INTERN_SURVEY_ACCOUNT_ID のアカウントでだけ動く。ほかのアカウントの動きは変えない。
// UTAGE で動いていた登録後の仕組み（アンケート・印・鍵付きメニューの解放・未回答の再案内）はここで代わりをする。

import type { LineClient } from '@line-crm/line-sdk';
import { jstNow } from '@line-crm/db';
import { UNIVERSITIES_TSV } from './intern-universities.js';
import { buildQaAnswer, buildQaCarousel } from './intern-qa.js';
import { buildMessage } from './step-delivery.js';

export const SURVEY_PREFIX = 'isv:';

export type SurveyStep = 'consent' | 'university' | 'grade' | 'graduation_year' | 'done';

export interface SurveyConfig {
  accountId?: string;
  privacyPolicyUrl?: string;
  /** 大学を選ぶ小さな画面（ミニアプリ）。無ければトークに打ってもらう形だけになる */
  pickerUrl?: string;
  /** 答え終えた人に付け替える、解放後のリッチメニューの LINE 上の ID */
  unlockedRichMenuId?: string;
  /** 答えを渡すミニアプリの受け口と合言葉 */
  miniappSurveyUrl?: string;
  bridgeKey?: string;
}

export function surveyConfigFromEnv(env: {
  INTERN_SURVEY_ACCOUNT_ID?: string;
  INTERN_PRIVACY_POLICY_URL?: string;
  INTERN_UNIVERSITY_PICKER_URL?: string;
  INTERN_UNLOCKED_RICHMENU_ID?: string;
  INTERN_MINIAPP_SURVEY_URL?: string;
  INTERN_BRIDGE_KEY?: string;
}): SurveyConfig {
  return {
    accountId: env.INTERN_SURVEY_ACCOUNT_ID,
    privacyPolicyUrl: env.INTERN_PRIVACY_POLICY_URL,
    pickerUrl: env.INTERN_UNIVERSITY_PICKER_URL,
    unlockedRichMenuId: env.INTERN_UNLOCKED_RICHMENU_ID,
    miniappSurveyUrl: env.INTERN_MINIAPP_SURVEY_URL,
    bridgeKey: env.INTERN_BRIDGE_KEY,
  };
}

// 「大学を選ぶ」画面がトークに送ってくる文の形
export const PICKED_PREFIX = '大学名：';
export const PICKED_UNLISTED_PREFIX = '大学名（一覧にない）：';

// 付ける印。ハーネスの印は全アカウント共通なので、インターンのものは「ズ_」で始める
export const TAG_CONSENTED = 'ズ_状態_ポリシー同意済み';
export const TAG_ANSWERED = 'ズ_状態_アンケート回答済み';
export const TAG_UNLOCKED = 'ズ_状態_メニュー解放済み';
export const tagGraduationYear = (y: string) => `ズ_卒業年_${y}`;

export interface University {
  name: string;
  kind: '国' | '公' | '私';
}

// ── 大学名の検索 ──────────────────────────────────────────────────────────

// ミニアプリのプロフィールの検索と同じく、旧字体や全角・半角の違いを吸収する
const VARIANTS: Record<string, string> = {
  應: '応', 藝: '芸', 國: '国', 學: '学', 澤: '沢', 濱: '浜', 邊: '辺', 龍: '竜', 櫻: '桜', 關: '関', 廣: '広', 德: '徳', 獨: '独',
};

export function normalizeName(s: string): string {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[應藝國學澤濱邊龍櫻關廣德獨]/g, (c) => VARIANTS[c]);
}

// よく使われる略し方 → 正式名
const ALIASES: Record<string, string[]> = {
  早大: ['早稲田大学'],
  慶大: ['慶應義塾大学'],
  慶応: ['慶應義塾大学'],
  東大: ['東京大学'],
  京大: ['京都大学'],
  阪大: ['大阪大学'],
  名大: ['名古屋大学'],
  九大: ['九州大学'],
  北大: ['北海道大学'],
  神大: ['神戸大学'],
  横国: ['横浜国立大学'],
  東工大: ['東京科学大学'],
  東京工業大学: ['東京科学大学'],
  医科歯科: ['東京科学大学'],
  東京医科歯科大学: ['東京科学大学'],
  理科大: ['東京理科大学'],
  明大: ['明治大学'],
  青学: ['青山学院大学'],
  中大: ['中央大学'],
  法大: ['法政大学'],
  関大: ['関西大学'],
  関学: ['関西学院大学'],
  同大: ['同志社大学'],
  立命: ['立命館大学'],
  日大: ['日本大学'],
  駒大: ['駒澤大学'],
  専大: ['専修大学'],
  京産: ['京都産業大学'],
  京産大: ['京都産業大学'],
  近大: ['近畿大学'],
  明学: ['明治学院大学'],
  亜大: ['亜細亜大学'],
  大東: ['大東文化大学'],
  外大: ['東京外国語大学', '神田外語大学', '関西外国語大学', '京都外国語大学'],
};

let cachedUniversities: (University & { key: string })[] | null = null;

export function universities(): (University & { key: string })[] {
  if (!cachedUniversities) {
    cachedUniversities = UNIVERSITIES_TSV.split('\n')
      .map((line) => line.split('\t'))
      .filter((cols) => cols.length >= 2 && cols[0].trim())
      .map(([name, kind]) => ({ name: name.trim(), kind: kind.trim() as University['kind'], key: normalizeName(name) }));
  }
  return cachedUniversities;
}

/** 学生が打った文字から、大学名の候補を探す（近い順） */
export function searchUniversities(input: string): University[] {
  let q = normalizeName(input);
  // 「早稲田大学 政治経済学部」のように学部まで書いた場合は「大学」までで切る
  const cut = q.indexOf('大学');
  if (cut > 0) q = q.slice(0, cut + 2);
  if (!q) return [];

  const list = universities();
  const byName = new Map(list.map((u) => [u.name, u]));
  const found: University[] = [];
  const seen = new Set<string>();
  const add = (u: University | undefined) => {
    if (u && !seen.has(u.name)) {
      seen.add(u.name);
      found.push({ name: u.name, kind: u.kind });
    }
  };

  const aliasKey = q.endsWith('大学') ? q.slice(0, -2) : q;
  for (const name of ALIASES[q] ?? ALIASES[aliasKey] ?? []) add(byName.get(name));

  const scored = list
    .map((u) => {
      if (u.key === q) return { u, score: 0 };
      if (u.key.startsWith(q)) return { u, score: 1 };
      if (u.key.includes(q)) return { u, score: 2 };
      return null;
    })
    .filter((x): x is { u: University & { key: string }; score: number } => x !== null)
    .sort((a, b) => a.score - b.score || a.u.name.length - b.u.name.length);
  for (const { u } of scored) add(u);
  return found;
}

// ── 送る中身 ──────────────────────────────────────────────────────────────

export const GRADES = ['学部1年', '学部2年', '学部3年', '学部4年', '修士1年', '修士2年', '博士1年', '博士2年', '博士3年', 'その他'];
export const GRADUATION_YEARS = ['2027', '2028', '2029', '2030', '2031', '2032', '2033', '2034', '2035', '2036'];

// 候補のカードに並べる大学の数。下に「もう一度入力する」「この中にない」を足す
const MAX_CANDIDATES = 8;
// ボタンの文字（読み上げ用の label）は20字まで
const LABEL_MAX = 20;
// 「この中にない」で記録する文字の長さの上限
const RAW_MAX = 40;

type Msg = Record<string, unknown>;

function label(text: string): string {
  return text.length > LABEL_MAX ? text.slice(0, LABEL_MAX - 1) + '…' : text;
}

// カードの見た目は Q&A のカード（クリーム）にそろえる
const CREAM = '#f6f1e7';
const INK = '#3a3a3a';
const SUB = '#8a7f6a';
const BORDER = '#e3dccd';

interface Choice {
  label: string;
  data: string;
  displayText: string;
  openKeyboard?: boolean;
}

function choice(labelText: string, data: string, displayText: string, openKeyboard = false): Choice {
  return { label: labelText, data, displayText, openKeyboard };
}

function postbackAction(c: Choice): Msg {
  return {
    type: 'postback',
    label: label(c.label),
    data: c.data,
    displayText: c.displayText,
    ...(c.openKeyboard ? { inputOption: 'openKeyboard' } : {}),
  };
}

/** 押せる枠1つ。文字が長くても切れないよう折り返す */
function choiceBox(c: Choice, sub = false): Msg {
  return {
    type: 'box',
    layout: 'vertical',
    paddingAll: '11px',
    cornerRadius: '8px',
    borderWidth: '1px',
    borderColor: BORDER,
    backgroundColor: sub ? CREAM : '#ffffff',
    flex: 1,
    action: postbackAction(c),
    contents: [{ type: 'text', text: c.label, size: 'sm', color: sub ? SUB : INK, align: 'center', wrap: true }],
  };
}

/** 選択肢を cols 列に並べる */
function choiceGrid(choices: Choice[], cols: number): Msg[] {
  const rows: Msg[] = [];
  for (let i = 0; i < choices.length; i += cols) {
    const row = choices.slice(i, i + cols).map((c) => choiceBox(c));
    while (row.length < cols) row.push({ type: 'filler' });
    rows.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: row });
  }
  return rows;
}

/** 問いのカード。上に小さな見出し、太字の問い、その下に選択肢 */
function questionCard(opts: {
  altText: string;
  kicker?: string;
  title: string;
  note?: string;
  choices: Choice[];
  cols?: number;
  extra?: Choice[];
}): Msg {
  const head: Msg[] = [];
  if (opts.kicker) head.push({ type: 'text', text: opts.kicker, size: 'xs', color: SUB });
  head.push({ type: 'text', text: opts.title, weight: 'bold', size: 'md', color: INK, wrap: true });
  if (opts.note) head.push({ type: 'text', text: opts.note, size: 'xs', color: SUB, wrap: true });
  const body: Msg[] = [...choiceGrid(opts.choices, opts.cols ?? 1)];
  if (opts.extra?.length) {
    if (body.length) body.push({ type: 'separator', margin: 'md', color: BORDER });
    for (const c of opts.extra) body.push(choiceBox(c, true));
  }
  return creamCard(opts.altText, head, body);
}

function text(t: string): Msg {
  return { type: 'text', text: t };
}

/** 押す先が画面やリンクのときの枠。main は塗りつぶし（次に押してほしいもの） */
function linkBox(labelText: string, action: Msg, main: boolean): Msg {
  return {
    type: 'box',
    layout: 'vertical',
    paddingAll: '12px',
    cornerRadius: '8px',
    borderWidth: '1px',
    borderColor: main ? INK : BORDER,
    backgroundColor: main ? INK : '#ffffff',
    action,
    contents: [{ type: 'text', text: labelText, size: 'sm', weight: main ? 'bold' : 'regular', color: main ? '#ffffff' : INK, align: 'center', wrap: true }],
  };
}

/** クリームのカード（見出し＋本文の枠）。アンケート・Q&A のカードはすべてこの見た目にそろえる */
function creamCard(altText: string, head: Msg[], body: Msg[]): Msg {
  return {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', spacing: 'xs', backgroundColor: CREAM, paddingAll: '16px', contents: head },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', backgroundColor: CREAM, paddingTop: '0px', contents: body },
    },
  };
}

/** 登録の直後・やり直しのときに送る、プライバシーポリシーの確認と回答の入口 */
export function buildStartMessage(config: SurveyConfig): Msg {
  const body: Msg[] = [
    linkBox(
      '同意して回答する',
      {
        type: 'postback',
        label: '同意して回答する',
        data: `${SURVEY_PREFIX}consent`,
        displayText: '同意して回答する',
        // 1問目を画面で選ぶときはキーボードを開かない（カードが隠れるため）。トークに打つ形のときだけ開く
        ...(config.pickerUrl ? {} : { inputOption: 'openKeyboard' }),
      },
      true,
    ),
  ];
  // ボタンの下に、下線付きの文字のリンクで置く
  if (config.privacyPolicyUrl) {
    body.push({
      type: 'text',
      text: 'プライバシーポリシー',
      size: 'sm',
      color: '#1A73E8',
      margin: 'md',
      decoration: 'underline',
      align: 'center',
      action: { type: 'uri', label: 'プライバシーポリシー', uri: config.privacyPolicyUrl },
    });
  }
  return creamCard(
    'アンケートのお願い（3問）',
    [
      { type: 'text', text: 'アンケートのお願い（3問）', weight: 'bold', size: 'md', color: INK, wrap: true },
      {
        type: 'text',
        text: 'プライバシーポリシーに同意のうえ、\n3問のアンケートにご回答ください。\n\n回答後、下のメニューが開きます。',
        size: 'xs',
        color: SUB,
        wrap: true,
      },
    ],
    body,
  );
}

// ── あいさつ（アンケートの入口の前に付ける） ─────────────────────────

// 定型文の名前。「ズ_あいさつ_1」「ズ_あいさつ_2」…を名前の順に送る
export const GREETING_PREFIX = 'ズ_あいさつ_';
const GREETING_NAME = /^ズ_あいさつ_\d+$/;
// 1回の返事で送れるのは5つまで。最後のアンケートの入口の分を残す
const GREETING_MAX = 4;

export interface TemplateRow {
  name: string;
  message_type: string;
  message_content: string;
}

/** 定型文の一覧から、あいさつの吹き出しを並べる */
export function greetingFromTemplates(rows: TemplateRow[]): Msg[] {
  return rows
    .filter((r) => GREETING_NAME.test(r.name) && r.message_content.trim())
    .sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }))
    .slice(0, GREETING_MAX)
    .map((r) => buildMessage(r.message_type, r.message_content) as unknown as Msg);
}

async function loadGreeting(db: D1Database): Promise<Msg[]> {
  const rows = await db
    .prepare("SELECT name, message_type, message_content FROM message_templates WHERE name LIKE 'ズ_あいさつ_%'")
    .all<TemplateRow>();
  return greetingFromTemplates(rows.results ?? []);
}

export function buildUniversityQuestion(config: SurveyConfig = {}): Msg {
  if (!config.pickerUrl) {
    return text('1問目：大学名を入力して送ってください。\n例：早稲田、明治大学');
  }
  return creamCard(
    '1問目：大学名を教えてください。',
    [
      { type: 'text', text: 'アンケート 1/3', size: 'xs', color: SUB },
      { type: 'text', text: '大学名を教えてください。', weight: 'bold', size: 'md', color: INK, wrap: true },
    ],
    [
      // 画面が開かない人向けの案内は出さないが、トークに大学名を打てば今までどおり受け付ける
      linkBox('大学を選択する', { type: 'uri', label: '大学を選択する', uri: config.pickerUrl }, true),
    ],
  );
}

export function buildCandidatesMessage(input: string): Msg {
  const shown = input.trim().slice(0, RAW_MAX);
  const retry = choice('もう一度入力する', `${SURVEY_PREFIX}retry`, 'もう一度入力する', true);
  const found = searchUniversities(input);

  if (found.length === 0) {
    return questionCard({
      altText: `「${shown}」に当てはまる大学が見つかりませんでした。`,
      kicker: 'アンケート 1/3',
      title: `「${shown}」に当てはまる大学が見つかりませんでした。`,
      note: '大学名をもう一度入力するか、入力したままの名前で登録してください。',
      choices: [],
      extra: [retry, choice(`「${shown}」で登録する`, `${SURVEY_PREFIX}raw:${shown}`, `「${shown}」で登録する`)],
    });
  }
  const items = found.slice(0, MAX_CANDIDATES).map((u) => choice(u.name, `${SURVEY_PREFIX}u:${u.name}`, u.name));
  const note = found.length > MAX_CANDIDATES
    ? '候補が多いため、一部だけ出しています。見つからない場合は、もう少し詳しく入力してください。'
    : undefined;
  return questionCard({
    altText: '当てはまる大学を選んでください。',
    kicker: 'アンケート 1/3',
    title: '当てはまる大学を選んでください。',
    note,
    choices: items,
    extra: [retry, choice('この中にない', `${SURVEY_PREFIX}raw:${shown}`, 'この中にない')],
  });
}

export function buildGradeQuestion(): Msg {
  return questionCard({
    altText: '2問目：現在の学年を選んでください。',
    kicker: 'アンケート 2/3',
    title: '現在の学年を選んでください。',
    choices: GRADES.map((g) => choice(g, `${SURVEY_PREFIX}g:${g}`, g)),
    cols: 2,
  });
}

export function buildGraduationYearQuestion(): Msg {
  return questionCard({
    altText: '3問目：卒業予定年を選んでください。',
    kicker: 'アンケート 3/3',
    title: '卒業予定年を選んでください。',
    choices: GRADUATION_YEARS.map((y) => choice(`${y}年`, `${SURVEY_PREFIX}y:${y}`, `${y}年`)),
    cols: 2,
  });
}

// 答え終えたときの画像（画面下のメニューと同じ2段×3列に、ボタンごとの説明を並べた絵）。R2 に置いてある。差し替えるときは名前の版を上げる
const DONE_IMAGE_URL = 'https://line-harness.line-haraness.workers.dev/images/intern-done-menu-v2.png';

/** 答え終えたときに送る画像。押してもどこにも飛ばない（ボタンは画面下のメニューを使ってもらう） */
export function buildDoneMessage(): Msg {
  return { type: 'image', originalContentUrl: DONE_IMAGE_URL, previewImageUrl: DONE_IMAGE_URL };
}

/** メニューの「Q&A」。よくある質問のカルーセル */
export function buildQaMessage(): Msg {
  return buildQaCarousel(SURVEY_PREFIX);
}

// ── 答えの受け取り ────────────────────────────────────────────────────────

export interface SurveyState {
  survey_step?: SurveyStep;
  university_name?: string;
  university_kind?: string;
  university_unlisted?: boolean;
  grade?: string;
  graduation_year?: string;
  survey_completed_at?: string;
  /** あいさつを送った日時（二度送らない） */
  greeted_at?: string;
}

export interface SurveyResult {
  /** metadata に足す中身（なければ変えない） */
  patch: SurveyState | null;
  /** 返す中身（空なら返さない） */
  messages: Msg[];
  /** 答えのほかにすること。consented：同意の印 / completed：答え終えたときの片付け / unlock：メニューを開き直す */
  effects?: ('consented' | 'completed' | 'unlock')[];
}

/** ボタン（postback）を押したとき。アンケートのボタンでなければ null */
export function reducePostback(state: SurveyState, data: string, config: SurveyConfig): SurveyResult | null {
  if (!data.startsWith(SURVEY_PREFIX)) return null;
  const body = data.slice(SURVEY_PREFIX.length);
  const step = state.survey_step;

  if (body === 'qa') return { patch: null, messages: [buildQaMessage()] };
  // Q&A の質問のボタン。アンケートの途中でも答え終えたあとでも、回答だけ返す
  if (body.startsWith('qa:')) return { patch: null, messages: [buildQaAnswer(SURVEY_PREFIX, body.slice(3))] };
  if (body === 'start') {
    // 回答済みなのに鍵付きのメニューを押せた人は、メニューの付け替えが漏れている。付け直す
    if (step === 'done') return { patch: null, messages: [text('アンケートは回答済みです。')], effects: ['unlock'] };
    // 途中まで答えた人には、続きの問いを出す
    if (step === 'university' || step === 'grade' || step === 'graduation_year') {
      return { patch: null, messages: [currentQuestion(step, config)] };
    }
    return { patch: { survey_step: 'consent' }, messages: [buildStartMessage(config)] };
  }
  if (step === 'done') return { patch: null, messages: [text('アンケートは回答済みです。')] };

  if (body === 'consent') {
    // 1問目より先に進んでいる人が古い同意ボタンを押したときは、今の問いを出し直す
    if (step === 'grade' || step === 'graduation_year') return { patch: null, messages: [currentQuestion(step, config)] };
    return { patch: { survey_step: 'university' }, messages: [buildUniversityQuestion(config)], effects: ['consented'] };
  }
  if (body === 'retry') {
    if (step !== 'university') return { patch: null, messages: [currentQuestion(step, config)] };
    return { patch: null, messages: [text('大学名を入力して送ってください。')] };
  }
  if (body.startsWith('u:') || body.startsWith('raw:')) {
    if (step !== 'university') return { patch: null, messages: [currentQuestion(step, config)] };
    if (body.startsWith('u:')) return chooseUniversity(body.slice(2), config) ?? { patch: null, messages: [buildUniversityQuestion(config)] };
    return chooseRaw(body.slice(4), config);
  }
  if (body.startsWith('g:')) {
    if (step !== 'grade') return { patch: null, messages: [currentQuestion(step, config)] };
    const g = body.slice(2);
    if (!GRADES.includes(g)) return { patch: null, messages: [buildGradeQuestion()] };
    return { patch: { survey_step: 'graduation_year', grade: g }, messages: [buildGraduationYearQuestion()] };
  }
  if (body.startsWith('y:')) {
    if (step !== 'graduation_year') return { patch: null, messages: [currentQuestion(step, config)] };
    const y = body.slice(2);
    if (!GRADUATION_YEARS.includes(y)) return { patch: null, messages: [buildGraduationYearQuestion()] };
    return {
      patch: { survey_step: 'done', graduation_year: y, survey_completed_at: jstNow() },
      messages: [buildDoneMessage()],
      effects: ['completed'],
    };
  }
  return { patch: null, messages: [] };
}

function chooseUniversity(name: string, config: SurveyConfig): SurveyResult | null {
  const u = universities().find((x) => x.name === name);
  if (!u) return null;
  return {
    patch: { survey_step: 'grade', university_name: u.name, university_kind: u.kind, university_unlisted: false },
    messages: [buildGradeQuestion()],
  };
}

function chooseRaw(input: string, config: SurveyConfig): SurveyResult {
  const raw = input.trim().slice(0, RAW_MAX);
  if (!raw) return { patch: null, messages: [buildUniversityQuestion(config)] };
  return {
    patch: { survey_step: 'grade', university_name: raw, university_kind: '', university_unlisted: true },
    messages: [buildGradeQuestion()],
  };
}

/** 文字が届いたとき。アンケートの途中でなければ null（ふだんの自動応答に回す） */
export function reduceText(state: SurveyState, incoming: string, config: SurveyConfig = {}): SurveyResult | null {
  const step = state.survey_step;
  const t = incoming.trim();
  // 「大学を選ぶ」画面から送られた文（古い問いの画面から送られた場合も、今の問いを出し直す）
  const picked = t.startsWith(PICKED_PREFIX) ? t.slice(PICKED_PREFIX.length) : null;
  const pickedRaw = t.startsWith(PICKED_UNLISTED_PREFIX) ? t.slice(PICKED_UNLISTED_PREFIX.length) : null;
  if ((picked !== null || pickedRaw !== null) && step && step !== 'university' && step !== 'consent') {
    return { patch: null, messages: [currentQuestion(step, config)] };
  }
  if (step === 'university') {
    if (pickedRaw !== null) return chooseRaw(pickedRaw, config);
    if (picked !== null) return chooseUniversity(picked.trim(), config) ?? { patch: null, messages: [buildCandidatesMessage(picked)] };
    if (!t) return { patch: null, messages: [buildUniversityQuestion(config)] };
    return { patch: null, messages: [buildCandidatesMessage(incoming)] };
  }
  // 学年・卒業予定年はボタンで答える。ボタンが消えた人のために問いを出し直す
  if (step === 'grade' || step === 'graduation_year') return { patch: null, messages: [currentQuestion(step, config)] };
  return null;
}

function currentQuestion(step: SurveyStep | undefined, config: SurveyConfig = {}): Msg {
  if (step === 'grade') return buildGradeQuestion();
  if (step === 'graduation_year') return buildGraduationYearQuestion();
  if (step === 'done') return text('アンケートは回答済みです。');
  return buildUniversityQuestion(config);
}

// ── DB と LINE につなぐ ───────────────────────────────────────────────────

export function isSurveyAccount(config: SurveyConfig, lineAccountId: string | null): boolean {
  return !!config.accountId && config.accountId === lineAccountId;
}

async function readState(db: D1Database, friendId: string): Promise<Record<string, unknown>> {
  const row = await db.prepare('SELECT metadata FROM friends WHERE id = ?').bind(friendId).first<{ metadata: string | null }>();
  try {
    const parsed = row?.metadata ? JSON.parse(row.metadata) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function ensureTag(db: D1Database, name: string): Promise<string> {
  const found = await db.prepare('SELECT id FROM tags WHERE name = ?').bind(name).first<{ id: string }>();
  if (found) return found.id;
  await db
    .prepare('INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), name, '#3a7d5c', jstNow())
    .run();
  const row = await db.prepare('SELECT id FROM tags WHERE name = ?').bind(name).first<{ id: string }>();
  return row!.id;
}

async function addTags(db: D1Database, friendId: string, names: string[]): Promise<void> {
  for (const name of names) {
    const tagId = await ensureTag(db, name);
    await db
      .prepare('INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)')
      .bind(friendId, tagId, jstNow())
      .run();
  }
}

/** 学年の答え → ミニアプリのプロフィールの値 */
export function gradeCode(grade: string | undefined): string | null {
  const map: Record<string, string> = {
    学部1年: 'B1', 学部2年: 'B2', 学部3年: 'B3', 学部4年: 'B4',
    修士1年: 'M1', 修士2年: 'M2', 博士1年: 'D', 博士2年: 'D', 博士3年: 'D', その他: 'OTHER',
  };
  return grade ? map[grade] ?? null : null;
}

/** 答えをミニアプリのプロフィールに渡す。失敗してもアンケートは止めない（答えはハーネスに残っている） */
export async function sendAnswersToMiniapp(config: SurveyConfig, lineUserId: string, state: SurveyState): Promise<boolean> {
  if (!config.miniappSurveyUrl || !config.bridgeKey) return false;
  try {
    const res = await fetch(config.miniappSurveyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-key': config.bridgeKey },
      body: JSON.stringify({
        line_user_id: lineUserId,
        university_name: state.university_name ?? '',
        university_unlisted: !!state.university_unlisted,
        grade: gradeCode(state.grade),
        graduation_year: state.graduation_year ? Number(state.graduation_year) : null,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) console.error('[intern-survey] miniapp answer failed', res.status);
    return res.ok;
  } catch (err) {
    console.error('[intern-survey] miniapp answer error', err);
    return false;
  }
}

async function unlockMenu(lineClient: LineClient, config: SurveyConfig, lineUserId: string): Promise<void> {
  if (!config.unlockedRichMenuId) return;
  await lineClient.linkRichMenuToUser(lineUserId, config.unlockedRichMenuId);
}

async function runEffects(
  db: D1Database,
  lineClient: LineClient,
  config: SurveyConfig,
  friendId: string,
  lineUserId: string,
  state: SurveyState,
  effects: SurveyResult['effects'],
): Promise<void> {
  for (const effect of effects ?? []) {
    try {
      if (effect === 'consented') await addTags(db, friendId, [TAG_CONSENTED]);
      if (effect === 'unlock') {
        await unlockMenu(lineClient, config, lineUserId);
        await addTags(db, friendId, [TAG_UNLOCKED]);
      }
      if (effect === 'completed') {
        const names = [TAG_ANSWERED];
        if (state.graduation_year) names.push(tagGraduationYear(state.graduation_year));
        await addTags(db, friendId, names);
        await unlockMenu(lineClient, config, lineUserId);
        await addTags(db, friendId, [TAG_UNLOCKED]);
        await sendAnswersToMiniapp(config, lineUserId, state);
      }
    } catch (err) {
      console.error(`[intern-survey] effect ${effect} failed`, err);
    }
  }
}

async function apply(
  db: D1Database,
  lineClient: LineClient,
  config: SurveyConfig,
  replyToken: string | null,
  friend: { id: string; lineUserId: string },
  meta: Record<string, unknown>,
  result: SurveyResult,
  lineAccountId: string | null,
): Promise<void> {
  const friendId = friend.id;
  const next = { ...meta, ...(result.patch ?? {}) } as SurveyState;
  // 通常の送信（返事の鍵が無いとき）は、送れてから進みを記録する。送れずに記録だけ進むと、押し直しても次の問いが届かなくなる
  if (!replyToken && result.messages.length > 0) {
    await lineClient.pushMessage(friend.lineUserId, result.messages as never);
  }
  if (result.patch) {
    await db
      .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(next), jstNow(), friendId)
      .run();
  }
  if (replyToken && result.messages.length > 0) {
    await lineClient.replyMessage(replyToken, result.messages as never);
  }
  // メニューの付け替えは返事を返してから（返事の鍵は1分で切れるため先に使う）
  await runEffects(db, lineClient, config, friendId, friend.lineUserId, next, result.effects);
  for (const m of result.messages) {
    const content = m.type === 'text' ? String(m.text) : JSON.stringify(m.contents ?? m);
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
         VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, ?, 'auto_reply', ?, ?)`,
      )
      .bind(crypto.randomUUID(), friendId, String(m.type), content, replyToken ? 'reply' : 'push', lineAccountId ?? null, jstNow())
      .run();
  }
}

/** アンケートのボタンなら処理して true を返す */
export async function handleSurveyPostback(
  db: D1Database,
  lineClient: LineClient,
  config: SurveyConfig,
  opts: { friendId: string; lineUserId: string; data: string; replyToken: string; lineAccountId: string | null },
): Promise<boolean> {
  if (!isSurveyAccount(config, opts.lineAccountId) || !opts.data.startsWith(SURVEY_PREFIX)) return false;
  const meta = await readState(db, opts.friendId);
  const result = reducePostback(meta as SurveyState, opts.data, config);
  if (!result) return false;
  await apply(db, lineClient, config, opts.replyToken, { id: opts.friendId, lineUserId: opts.lineUserId }, meta, result, opts.lineAccountId);
  return true;
}

/** アンケートの途中の文字なら処理して true を返す */
export async function handleSurveyText(
  db: D1Database,
  lineClient: LineClient,
  config: SurveyConfig,
  opts: { friendId: string; lineUserId: string; text: string; replyToken: string; lineAccountId: string | null },
): Promise<boolean> {
  if (!isSurveyAccount(config, opts.lineAccountId)) return false;
  const meta = await readState(db, opts.friendId);
  const result = reduceText(meta as SurveyState, opts.text, config);
  if (!result) return false;
  await apply(db, lineClient, config, opts.replyToken, { id: opts.friendId, lineUserId: opts.lineUserId }, meta, result, opts.lineAccountId);
  return true;
}

/**
 * 「大学を選ぶ」画面がトークに文を送れなかったとき（LINE の外で開いた等）の受け口から呼ぶ。
 * 選んだ大学を記録し、2問目を送る（返事の鍵が無いので、ここだけは通常の送信になる）
 */
export async function handlePickedUniversity(
  db: D1Database,
  lineClient: LineClient,
  config: SurveyConfig,
  opts: { lineUserId: string; name: string; unlisted: boolean },
): Promise<'ok' | 'not_found' | 'not_waiting'> {
  if (!config.accountId) return 'not_found';
  const row = await db
    .prepare('SELECT id FROM friends WHERE line_user_id = ? AND line_account_id = ?')
    .bind(opts.lineUserId, config.accountId)
    .first<{ id: string }>();
  if (!row) return 'not_found';
  const meta = await readState(db, row.id);
  const incoming = (opts.unlisted ? PICKED_UNLISTED_PREFIX : PICKED_PREFIX) + opts.name;
  const state = meta as SurveyState;
  if (state.survey_step !== 'university') return 'not_waiting';
  const result = reduceText(state, incoming, config);
  if (!result) return 'not_waiting';
  await apply(db, lineClient, config, null, { id: row.id, lineUserId: opts.lineUserId }, meta, result, config.accountId);
  return 'ok';
}

/** 友だち追加（ブロック解除を含む）のとき、まだ答え終えていなければアンケートの入口を送る */
export async function startSurveyOnFollow(
  db: D1Database,
  lineClient: LineClient,
  config: SurveyConfig,
  opts: { friendId: string; lineUserId: string; replyToken: string | null; lineAccountId: string | null },
): Promise<void> {
  if (!isSurveyAccount(config, opts.lineAccountId)) return;
  const meta = await readState(db, opts.friendId);
  const friend = { id: opts.friendId, lineUserId: opts.lineUserId };
  // 答え終えた人が一度ブロックして戻ってきたときは、メニューだけ開き直す
  if ((meta as SurveyState).survey_step === 'done') {
    await runEffects(db, lineClient, config, friend.id, friend.lineUserId, meta as SurveyState, ['unlock']);
    return;
  }
  const state = meta as SurveyState;
  // はじめての人（アンケートにまだ手を付けておらず、あいさつも未送信）には、入口の前にあいさつを付ける
  const greeting = !state.survey_step && !state.greeted_at ? await loadGreeting(db) : [];
  const result: SurveyResult = {
    patch: greeting.length ? { survey_step: 'consent', greeted_at: jstNow() } : { survey_step: 'consent' },
    messages: [...greeting, buildStartMessage(config)],
  };
  await apply(db, lineClient, config, opts.replyToken, friend, meta, result, opts.lineAccountId);
}

// ── 未回答の人への再案内（UTAGE の「01 アンケート未回答の方へ」の代わり） ─────────

/**
 * 友だち追加の翌日以降の20時に、まだ答え終えていない人へアンケートの入口を1回だけ送り直す。
 * 5分ごとの定期実行から呼ぶ。20:00〜20:04 の回だけ動く。送った人には survey_reminded_at を入れて二度送らない
 */
export async function remindUnansweredSurveys(
  db: D1Database,
  lineClient: LineClient,
  config: SurveyConfig,
  now: Date = new Date(),
): Promise<number> {
  if (!config.accountId) return 0;
  const jst = new Date(now.getTime() + 9 * 3600_000);
  if (jst.getUTCHours() !== 20 || jst.getUTCMinutes() >= 5) return 0;
  // 今日の0時（日本時間）より前に友だちになった人だけ（＝翌日以降）
  const today = jst.toISOString().slice(0, 10);
  const rows = await db
    .prepare(
      `SELECT id, line_user_id, metadata FROM friends
       WHERE line_account_id = ? AND is_following = 1 AND created_at < ?
         AND COALESCE(json_extract(metadata, '$.survey_step'), '') <> 'done'
         AND json_extract(metadata, '$.survey_reminded_at') IS NULL
       LIMIT 200`,
    )
    .bind(config.accountId, `${today}T00:00:00`)
    .all<{ id: string; line_user_id: string; metadata: string | null }>();
  let sent = 0;
  for (const row of rows.results) {
    let meta: Record<string, unknown> = {};
    try {
      meta = row.metadata ? JSON.parse(row.metadata) : {};
    } catch {
      meta = {};
    }
    const step = (meta as SurveyState).survey_step;
    const message = step === 'university' || step === 'grade' || step === 'graduation_year'
      ? currentQuestion(step, config)
      : buildStartMessage(config);
    // 先に「送った」を記録してから送る（途中で止まっても二重に送らない）
    await db
      .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify({ ...meta, survey_reminded_at: jstNow(), ...(step ? {} : { survey_step: 'consent' }) }), jstNow(), row.id)
      .run();
    try {
      await lineClient.pushMessage(row.line_user_id, [text('アンケートがまだ途中です。答えると、画面下のメニュー（求人・マイページなど）が使えるようになります。'), message] as never);
      sent++;
    } catch (err) {
      console.error('[intern-survey] reminder failed', err);
    }
  }
  return sent;
}
