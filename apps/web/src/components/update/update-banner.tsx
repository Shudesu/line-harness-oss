'use client'

/**
 * hyhome カスタマイズ: 改造検知・アップグレード警告バナーを完全に無効化。
 *
 * 理由: このプロジェクトは Shudesu/line-harness-oss を母体としつつも、
 * hyhome 独自の UI / 機能拡張 (L-TRACK 互換、レポート、ポストバック履歴等) を
 * 継続的に加える前提のため、「公式リリースとの差分検知」は意図的な改造として
 * 常に true になる。
 *
 * 元の改造検知ロジックを完全に bypass し、何も表示しない。
 * 自動アップデートは不要 = hyhome 独自ツールとして運用するため。
 */

export function UpdateBanner() {
  return null
}
