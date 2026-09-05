import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * フォームの公開 URL をレスポンスに含めることの回帰テスト。
 *
 * 含めていなかったせいで、AI エージェントがホスト直下の URL
 * （`https://<host>/?page=form&id=...`）を自力で組み立て、liff.init が完了せず
 * 「永遠に読み込み中」の画面を作る事故が起きた（2026-08-25 の実戦報告）。
 * 正しい形は liff.line.me 経由で、liffId は line_accounts にしか無い。
 */
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'forms.ts'),
  'utf8',
);

describe('forms: 公開 URL', () => {
  it('serializeForm が formUrl を返す', () => {
    expect(SRC).toContain('formUrl: formPublicUrl(');
  });

  it('URL は liff.line.me 形式（ホスト直下ではない）', () => {
    expect(SRC).toContain('https://liff.line.me/${liffId}?page=form&id=${formId}');
  });

  it('liffId 未設定なら null を返す（LIFF 未構成のテナント）', () => {
    expect(SRC).toContain('if (!liffId) return null;');
  });

  it('一覧・取得・作成・更新の4経路すべてで liffId を解決している', () => {
    const n = (SRC.match(/resolveDefaultLineAccount\(c\.env\.DB\)/g) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(4);
  });
});
