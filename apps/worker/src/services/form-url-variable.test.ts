import { describe, it, expect } from 'vitest';
import { expandVariables } from './step-delivery.js';

/**
 * {{form_url:FORM_ID}} の展開。
 *
 * これが無かったため、シナリオ本文にフォームへの導線を置けず、
 * AI エージェントが自力でホスト直下の URL を組み立てて
 * 「永遠に読み込み中」の画面へ誘導する事故が起きた（2026-08-25 の実戦報告）。
 * 既存の {{auth_url:CHANNEL_ID}} と同じ「ID を明示する」規約に揃えてある
 * （{formUrl} 単体だと、どのフォームか決まらない）。
 */
const friend = { id: 'f1', display_name: 'テスト', user_id: 'u1' };

describe('expandVariables: {{form_url:ID}}', () => {
  it('liffId があれば liff.line.me 形式に展開する', () => {
    const out = expandVariables('こちら → {{form_url:form-123}}', friend, undefined, 'text', 'liff-abc');
    expect(out).toBe('こちら → https://liff.line.me/liff-abc?page=form&id=form-123');
  });

  it('ホスト直下の URL は作らない（liff.init が完了しないため）', () => {
    const out = expandVariables('{{form_url:f}}', friend, 'https://worker.example', 'text', 'liff-abc');
    expect(out).not.toContain('worker.example');
    expect(out).toContain('liff.line.me');
  });

  it('liffId が無いときは置換しない（空文字にしてリンクを消さない）', () => {
    // 空文字にすると「リンクが消えたメッセージ」が本人に届き、送り手が気づけない。
    // {{auth_url:}} が apiOrigin 無しのとき置換しないのと同じ規約。
    const out = expandVariables('{{form_url:form-123}}', friend, undefined, 'text', null);
    expect(out).toBe('{{form_url:form-123}}');
  });

  it('複数個・前後の空白を含む ID を扱える', () => {
    const out = expandVariables('{{form_url:a}} と {{form_url: b }}', friend, undefined, 'text', 'L');
    expect(out).toBe(
      'https://liff.line.me/L?page=form&id=a と https://liff.line.me/L?page=form&id=b',
    );
  });

  it('他の変数と併用できる', () => {
    const out = expandVariables('{{name}}さん {{form_url:x}}', friend, undefined, 'text', 'L');
    expect(out).toBe('テストさん https://liff.line.me/L?page=form&id=x');
  });
});
