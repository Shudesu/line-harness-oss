import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * エンロール個票エンドポイントの回帰テスト。
 *
 * 「進行中1・到達0」の先が見えず、条件付きステップの切り分けに
 * 人間のフィードバック3往復とクライアント JS の解析が必要になった
 * （2026-08-25 の実戦報告）。書いた結果を読み取れる API を対で用意する。
 */
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'scenarios.ts'),
  'utf8',
);

describe('scenarios: エンロール個票', () => {
  it('エンドポイントが存在する', () => {
    expect(SRC).toContain("scenarios.get('/api/scenarios/:id/enrollments'");
  });

  it('次に配信されるステップを JOIN で解決している（現在ステップより大きい最小 step_order）', () => {
    // step-delivery.ts の find と同じ基準。ここがズレると
    // 「次に何が起きるはずか」が実際と食い違って、また誤診を生む。
    expect(SRC).toContain('SELECT MIN(step_order) FROM scenario_steps');
    expect(SRC).toContain('step_order > fs.current_step_order');
  });

  it('次ステップの条件と nextStepOnFalse を返す', () => {
    expect(SRC).toContain('ns.condition_type AS next_condition_type');
    expect(SRC).toContain('ns.next_step_on_false AS next_step_on_false');
  });

  it('「条件が false だから待っている」とは書かない（実装は順次進むため）', () => {
    // 実装（step-delivery.ts）は nextStepOnFalse が null でも順次次へ進む。
    // 断定的な理由を返すと、報告と実装が食い違ったときに誤診を誘発する。
    // 事実（条件の有無・次回予定）だけを出す。
    expect(SRC).toContain('条件 ${conditionType} が設定されています');
    expect(SRC).not.toContain('条件成立を待っています');
  });

  it('limit は上限500で clamp する', () => {
    expect(SRC).toContain('Math.min(Math.max(Number(c.req.query(\'limit\') ?? 100) || 100, 1), 500)');
  });
});
