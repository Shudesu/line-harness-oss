import { describe, expect, it } from 'vitest';
import { DEFAULT_COPY, fillCourseName, fillInput, mergeCopy, validateCopy } from './intern-copy.js';
import { buildCandidatesMessage, buildGraduationYearQuestion, buildStartMessage, reducePostback } from './intern-survey.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('mergeCopy', () => {
  it('保存が無い・壊れているときは初期の文面', () => {
    expect(mergeCopy(null)).toEqual(DEFAULT_COPY);
    expect(mergeCopy('x')).toEqual(DEFAULT_COPY);
  });
  it('空の欄・無い欄は初期の文面で埋め、直した欄は残す', () => {
    const c = mergeCopy({ consent: { title: '新しい見出し', body: '  ' }, graduationYear: { years: ['20x'] } });
    expect(c.consent.title).toBe('新しい見出し');
    expect(c.consent.body).toBe(DEFAULT_COPY.consent.body);
    expect(c.consent.button).toBe(DEFAULT_COPY.consent.button);
    expect(c.graduationYear.years).toEqual(DEFAULT_COPY.graduationYear.years);
  });
});

describe('validateCopy', () => {
  it('初期の文面はそのまま通る', () => {
    const r = validateCopy(clone(DEFAULT_COPY));
    expect(r.ok).toBe(true);
  });
  it('空の欄・長いボタン・おかしな年・重なる質問を断る', () => {
    const c = clone(DEFAULT_COPY) as any;
    c.grade.title = '';
    c.consent.button = 'あ'.repeat(21);
    c.graduationYear.years = ['2028', '28'];
    c.qa.sections[1].items[0].id = c.qa.sections[0].items[0].id;
    const r = validateCopy(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
  it('長すぎる問い・「そのまま登録」のボタンを断る（カードの通知・押したときの文が LINE の上限を超えるため）', () => {
    const c = clone(DEFAULT_COPY) as any;
    c.university.title = 'あ'.repeat(201);
    c.candidates.registerRaw = '「{入力}」' + 'あ'.repeat(20);
    const r = validateCopy(c);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('1問目の問い'))).toBe(true);
      expect(r.errors.some((e) => e.includes('そのまま登録'))).toBe(true);
    }
  });
});

describe('アンケートが文面を使う', () => {
  const copy = clone(DEFAULT_COPY);
  copy.consent.title = 'お願いの見出し';
  copy.consent.button = '同意して進む';
  copy.candidates.notFoundTitle = '{入力} は見つかりません';
  copy.graduationYear.years = ['2040'];
  const config = { copy };

  it('同意のカード', () => {
    const json = JSON.stringify(buildStartMessage(config));
    expect(json).toContain('お願いの見出し');
    expect(json).toContain('同意して進む');
  });
  it('{入力} を置き換える', () => {
    expect(fillInput('「{入力}」で登録', '東大')).toBe('「東大」で登録');
    expect(JSON.stringify(buildCandidatesMessage('ほげほげ', config))).toContain('ほげほげ は見つかりません');
  });
  it('卒業予定年は直した選択肢だけを受け付ける', () => {
    expect(JSON.stringify(buildGraduationYearQuestion(config))).toContain('2040年');
    const ok = reducePostback({ survey_step: 'graduation_year' }, 'isv:y:2040', config);
    expect(ok?.patch?.graduation_year).toBe('2040');
    const ng = reducePostback({ survey_step: 'graduation_year' }, 'isv:y:2028', config);
    expect(ng?.patch).toBeNull();
  });
  it('Q&A は直した中身を出す', () => {
    const c2 = clone(DEFAULT_COPY);
    c2.qa.sections = [{ title: '新しい見出し', items: [{ id: 'x1', q: '新しい質問', a: '新しい回答' }] }];
    const carousel = JSON.stringify(reducePostback({}, 'isv:qa', { copy: c2 })?.messages);
    expect(carousel).toContain('新しい質問');
    const answer = JSON.stringify(reducePostback({}, 'isv:qa:x1', { copy: c2 })?.messages);
    expect(answer).toContain('新しい回答');
  });
});

describe('並び', () => {
  it('保存し直しても初期の文面と同じ形（項目の並びも同じ）になる', () => {
    const r = validateCopy(clone(DEFAULT_COPY))
    expect(r.ok && JSON.stringify(r.copy)).toBe(JSON.stringify(DEFAULT_COPY))
  })
})

describe('LINE の上限を超えないよう、送る前に切る', () => {
  it('カードの通知に出る文は400字まで', () => {
    const copy = clone(DEFAULT_COPY);
    copy.consent.title = 'あ'.repeat(1000);
    const m = buildStartMessage({ copy } as never) as { altText: string };
    expect(m.altText.length).toBe(400);
  });
});

describe('会員サイトのリクエストの文', () => {
  it('保存が古く項目が無いときは初期の文面', () => {
    const c = mergeCopy({ consent: { title: 'x' } });
    expect(c.academyRequest.done).toBe(DEFAULT_COPY.academyRequest.done);
    expect(c.academyRequest.done).toContain('{講座名}');
  });
  it('直した文は残す', () => {
    expect(mergeCopy({ academyRequest: { done: '新しい文' } }).academyRequest.done).toBe('新しい文');
  });
  it('空・長すぎる文は断る', () => {
    const c = clone(DEFAULT_COPY) as any;
    c.academyRequest.done = '';
    const r = validateCopy(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('academyRequest.done'))).toBe(true);
    c.academyRequest.done = 'あ'.repeat(1001);
    expect(validateCopy(c).ok).toBe(false);
  });
  it('{講座名} を置き換える', () => {
    expect(fillCourseName('「{講座名}」を用意しました。{講座名}', 'ES')).toBe('「ES」を用意しました。ES');
  });
});
