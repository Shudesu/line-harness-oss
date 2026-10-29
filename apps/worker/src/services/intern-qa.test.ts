import { describe, it, expect } from 'vitest';
import { QA_SECTIONS, buildQaAnswer, buildQaCarousel } from './intern-qa.js';
import { reducePostback } from './intern-survey.js';

const NG = ['圧倒的成長', '裁量', '即戦力', '成長できる環境', '必ず', '絶対に', '誰でも', '確実に', '本気', 'ガチ'];

describe('Q&A の中身', () => {
  const all = QA_SECTIONS.flatMap((s) => s.items);

  it('質問の名前が重ならない', () => {
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
  });

  it('回答は200字以内・NGワードなし', () => {
    for (const i of all) {
      expect(i.a.length, i.id).toBeLessThanOrEqual(200);
      for (const w of NG) expect(i.a + i.q, `${i.id}:${w}`).not.toContain(w);
    }
  });

  it('LINE の上限に収まる（カード10枚・合図300字・表示文300字）', () => {
    expect(QA_SECTIONS.length).toBeLessThanOrEqual(10);
    const json = JSON.stringify(buildQaCarousel('isv:'));
    expect(json.length).toBeLessThan(30000);
    for (const i of all) {
      expect(`isv:qa:${i.id}`.length).toBeLessThanOrEqual(300);
      expect(i.q.length).toBeLessThanOrEqual(300);
    }
  });
});

describe('Q&A のボタン', () => {
  it('メニューの Q&A でカルーセルが出る（アンケートの途中でも答えは変わらない）', () => {
    const r = reducePostback({ survey_step: 'grade', university_name: '早稲田大学' }, 'isv:qa', {});
    expect(r?.patch).toBeNull();
    expect((r?.messages[0] as any).contents.type).toBe('carousel');
  });

  it('質問を押すと回答と［ほかの質問を見る］が返る', () => {
    const r = reducePostback({ survey_step: 'done' }, 'isv:qa:fee', {});
    expect(r?.patch).toBeNull();
    const m = r?.messages[0] as any;
    expect(m.type).toBe('flex');
    expect(m.quickReply).toBeUndefined();
    const json = JSON.stringify(m);
    expect(json).toContain('利用料はかかりません');
    expect(json).toContain('"data":"isv:qa"');
  });

  it('知らない質問ならカルーセルを出し直す', () => {
    expect((buildQaAnswer('isv:', 'nothing') as any).contents.type).toBe('carousel');
  });
});
