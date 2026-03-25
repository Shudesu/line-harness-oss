# LINE Harness OSS — コントリビューションルール
# MANDATORY: PR作成前に必ずこのファイルを参照すること

**Version**: 1.0.0
**作成日**: 2026-03-25
**優先度**: P0（絶対遵守）

---

## ルール0: upstream の動向確認（毎日実行 + PR作成前に必須）

### 同期頻度: 毎日（週1は遅すぎる）

```bash
# セッション開始時に毎回実行（または1日1回以上）
git fetch upstream
git log upstream/main --oneline -10    # 直近10コミットの方向性確認
git diff HEAD upstream/main --stat     # 自分のフォークとの差分量確認

# PR作成前には必ず20コミット分確認
git log upstream/main --oneline -20
gh issue list --repo Shudesu/line-harness-oss --state open
gh pr list --repo Shudesu/line-harness-oss --state open
```

### upstream シンク確認スクリプト

```bash
# ~/dev/tools/line-harness-oss で実行
bash project_memory/scripts/check-upstream.sh
```

### 同期チェック記録

最終確認日時: `project_memory/UPSTREAM_SYNC_LOG.md` に記録すること。
2日以上 fetch していない場合は必ず実行してから作業開始。

---

## upstream のコアゴール（2026-03-25 時点）

Shudesu/line-harness-oss の開発ゴールは以下。PRはこれに合致するもののみ許可。

| カテゴリ | 具体的な方向性 |
|---------|--------------|
| **汎用LINE CRM** | L社/U社の無料OSS代替。PPAL固有・みやび固有の機能はNG |
| **マルチアカウント** | 複数LINEチャンネル対応（79cec2c, 229a91a等で推進中） |
| **トークン自動管理** | auto-refresh（#45マージ済み）、BAN検知・自動移行 |
| **配信機能強化** | delivery_type tracking, push-only stats, 条件分岐 |
| **リファラー・パーソナライズ** | ref_code, conditional variables, LIFF integration |
| **API完全公開** | Claude Code から全操作可能なCLI/MCP対応 |
| **Cloudflare無料枠** | Workers + D1 + Pages で月額0円運用 |

---

## ルール1: 1機能 = 1PR

- 1つのPRに複数の機能・修正を混在させない
- OK例: `fix(event-bus): inject currentScore between scoring and automations`
- NG例: `feat: AI統合 + 法務ページ + オンボーディング` (複数機能を1PRに)

## ルール2: フォーク固有コードの混入禁止

upstream にマージできない私有コードを含むPRは作成しない。

| NG（フォーク固有） | OK（汎用）|
|------------------|---------|
| PPAL専用スクリプト | 汎用バグ修正 |
| みやびブランドのUI | 機能改善 |
| 特定ビジネスのシナリオ | テストスイート |
| 商用サービスへのハードコードされたURL | ドキュメント改善 |

## ルール3: クリティカルなものだけ出す（最重要ルール）

**積極的にPRを出さない。アグレッシブに貢献しない。**

PRを出すのは以下の条件を**全て**満たす場合のみ:

### 出してよいもの（クリティカルのみ）

| 種別 | 具体例 | 判断基準 |
|------|--------|---------|
| **バグ修正（本番クリティカル）** | score_threshold でオートメーションが動かない | upstream ユーザーに実害がある |
| **データ破壊を防ぐ修正** | DBスキーマ不整合、トークン失効でユーザーがロック | 放置すると損失が生じる |
| **セキュリティ修正** | 認証バイパス、トークン露出 | 即座にリスクがある |

### 出さないもの（アグレッシブに出さない）

- 機能追加（どんなに便利でも upstream が求めていなければNG）
- テスト追加（upstream が自分で追加するまで待つ）
- リファクタリング（コードスタイルの好み）
- ドキュメント改善（些細なもの）
- パフォーマンス改善（体感できない程度）
- 「あったらいい」機能（MUST ではなく WANT のもの）

**原則: 「これがないと壊れる」ものだけ出す。それ以外は自分のフォークに留める。**

## ルール4: PRレビューチェックリスト

PR作成前に以下を全てチェック:

```
[ ] git fetch upstream を実行して最新状態を確認した
[ ] upstream/main の直近20コミットを読んだ
[ ] このPRの変更が upstream のゴールに合致している
[ ] フォーク固有のコード（PPAL、みやび等）が含まれていない
[ ] 1PR = 1機能/修正のみ
[ ] ビルドが通る（pnpm build エラーなし）
[ ] TypeCheck が通る（型エラーなし）
[ ] コミットメッセージが Conventional Commits 形式
[ ] PR タイトルが英語かつ 70文字以内
[ ] PR本文に「Why」（なぜこの変更が必要か）が書いてある
```

---

## upstream のコミット分析（定期更新）

### 2026-03-25 時点の最新20コミット傾向

```
sync: delivery_type tracking, push-only stats     ← 配信統計機能強化
chore: add sync script + clean remaining secrets  ← 開発基盤整備
sync: cross-account trigger, CTA simplify         ← マルチアカウント連携
Merge: feat/token-auto-refresh (#45)              ← トークン自動更新
fix: sync schema.sql with migrations              ← DBスキーマ整合
docs: LINE demo link to top                       ← ドキュメント
feat: /r/:ref landing page, conditional variables ← リファラー機能
feat: multi-account LIFF token verification       ← マルチアカウント
fix: LIFF ID token verification channel ID        ← バグ修正
sync: form reply, OAuth immediate delivery        ← フォーム・OAuth
```

**傾向サマリー**: upstream はマルチアカウント対応・配信統計・リファラートラッキングに注力中。
バグ修正と汎用機能強化は歓迎される。

---

## PRテンプレート

```markdown
## Why
<!-- なぜこの変更が必要か。upstream のどのゴールに貢献するか -->

## What
<!-- 具体的な変更内容 -->

## How to test
<!-- テスト手順 -->

## Checklist
- [ ] upstream/main の最新20コミットを確認した
- [ ] フォーク固有コードなし
- [ ] 1PR = 1機能
- [ ] ビルド通過確認
```

---

## 違反した場合

このルールに違反したPRは即座にクローズする。
maintainer（@ai_shunoda）から「PPAL固有コードはNG」「1機能1PRで」のフィードバックを
2026-03-25 に受領済み。2度目の違反は upstream との関係を損なう。
