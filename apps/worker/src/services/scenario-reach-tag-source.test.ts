import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 回帰 (テルさんFX様 b91c48b0c3e3): シナリオ到達タグ (on_reach_tag_id) は plain INSERT ではなく
// attachTagAndFireSideEffects 経由で付与し、tag_change を発火させる。
// 直接の addTagToFriend に戻すと、タグ起点のオートメーション (リッチメニュー切替等) が動かなくなる。
describe('scenario reach tag fires tag_change', () => {
  for (const file of ['step-delivery.ts', 'immediate-first-step.ts']) {
    it(`${file} uses attachTagAndFireSideEffects, not addTagToFriend`, () => {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect(src).toContain('attachTagAndFireSideEffects');
      expect(src).not.toMatch(/\baddTagToFriend\b/);
    });
  }
});
