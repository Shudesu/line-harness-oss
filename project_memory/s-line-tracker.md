# S線カスタマイザー 定点監視ファイル

**最終更新**: 2026-03-25
**Upstreamリポジトリ**: https://github.com/Shudesu/line-harness-oss
**我々のフォーク**: https://github.com/ShunsukeHayashi/line-harness-oss
**ローカルパス**: ~/dev/tools/line-harness-oss/

## リポジトリ関係図

```
Shudesu/line-harness-oss (Upstream / Original)
  ├── BKStock/line-harness-oss            (+5 ahead / AI analytics CRM)
  ├── daisukeishioka-pixel/line-harness-oss (+11 ahead / salon Stripe)
  ├── meomao19930511-lab/line-harness-oss-michisirube (+3 ahead / bug fix)
  └── ShunsukeHayashi/line-harness-oss   (+14 ahead, -30 behind / PPAL+MCP)
```

## Baseline snapshot (2026-03-25 初回キャプチャ)

| リポジトリ | stars | forks | ahead | files |
|-----------|-------|-------|-------|-------|
| Shudesu (upstream) | 7 | 4 | — | — |
| BKStock | — | — | 5 | 32 |
| daisukeishioka-pixel | — | — | 11 | 13 |
| meomao | — | — | 3 | 3 |
| ShunsukeHayashi (我々) | — | — | 14 (behind 30) | 30 |

---

## 監視対象（S線 3名）

### BKStock — AIビジネス診断 x モメンタム投資LINE

- **GitHub**: https://github.com/BKStock/line-harness-oss
- **ahead**: 5コミット / 32ファイル変更
- **ビジネス文脈**: 「KK」モメンタム投資専門家のLINEアシスタント
- **AI統合**: Claude Haiku 自動応答（Anthropic API 直接呼び出し）
- **独自機能**:
  - `GET /api/analytics/question-ranking` — 受信メッセージからキーワード頻度ランキング（カテゴリ自動分類）
  - `GET /api/analytics/revenue-summary` — MRR・新規/解約数・LTV集計（Stripe連動）
  - `GET /api/analytics/churn-risk` — 無言日数+メッセージ数減少でリスクスコア算出
  - `GET /api/unanswered` — AI未回答質問ボックス（管理者が返信してLINE送信）
  - `scenarios/ai-diagnosis/scenario.json` — 7問診断→プロダクトマッピング→7日ステップ配信
- **AI Systemプロンプト**: 100文字以内、具体銘柄は「講座でお伝えします」、投資無関係は拒否
- **コミット**: Co-Authored-By Claude Sonnet 4.6 — Claude Codeで開発
- **最終コミット**: 2026-03-24T15:46

### daisukeishioka-pixel — 整体卒業サロン LINE x Stripe課金

- **GitHub**: https://github.com/daisukeishioka-pixel/line-harness-oss
- **ahead**: 11コミット / 13ファイル変更
- **ビジネス文脈**: 整体院の「卒業サロン」— 治療後コミュニティ x サブスク課金
- **D1 DB ID（公開済み）**: 097ec44d-c37c-4cb7-88ef-e56873369e90
- **Claude Code セッション**: session_01R8cdWH..., session_01VrC2bf..., session_01QNVGny...
- **独自機能**:
  - `apps/liff/src/membership.ts` (555行) — LIFF会員マイページ（ステータス表示・入会・解約）
  - `packages/db/migrations/008_subscriptions.sql` — friendsにStripe管理カラム追加
  - `packages/db/migrations/009_salon_contents.sql` — contents（動画）+ schedules（ライブ）テーブル
  - `apps/worker/src/routes/stripe.ts` 大幅拡張 — Checkout・Webhook・Customer Portal・口座振替
  - `GET /api/liff/membership` — lineUserIdからサブスク情報返却
- **決済方式**: クレジットカード + 銀行振込（口座振替）両対応
- **自動タグ**: salon_member / subscription_cancelled / payment_failed
- **最終コミット**: 2026-03-25T05:33（本日も活発）

### meomao19930511-lab — 道標（michisirube）x score_thresholdバグ修正

- **GitHub**: https://github.com/meomao19930511-lab/line-harness-oss-michisirube
- **ahead**: 3コミット / 3ファイル変更
- **本番デプロイURL**: https://michisirube-admin.pages.dev/
- **使用AI**: Claude Opus 4.6（1M context）— 最上位モデル
- **独自修正**:
  - `event-bus.ts` — score_threshold バグ修正（processScoring と processAutomations の並列実行問題）
    - 旧: Promise.allSettled で scoring と automations を同時実行 → currentScore が automation に渡らない
    - 新: scoring を先に完了 → currentScore を取得 → payload に注入 → automations を実行
  - `README.md` — 本番管理画面URL追加
- **バグ修正の重要度**: オリジナルおよび我々のフォークも同じバグあり → 要取り込み
- **最終コミット**: 2026-03-25T04:44（本日）

---

## 我々のフォーク（ShunsukeHayashi）の現状

- **ahead**: 14コミット / 30 behind（オリジナルに30コミット後れ）
- **追加済み**: PPAL移行スクリプト、Stripe subscriptions、rate-limit、landing page、GitNexusスキル
- **オリジナルへの後れ**: v0.2.0〜v0.2.1の変更（マルチアカウント等）が未マージ

---

## 週次監視コマンド

```bash
# リポジトリ統計確認
gh api repos/Shudesu/line-harness-oss --jq '{stars: .stargazers_count, forks: .forks_count}'

# S線3者のahead数変化
for repo in BKStock/line-harness-oss daisukeishioka-pixel/line-harness-oss meomao19930511-lab/line-harness-oss-michisirube; do
  echo "=== $repo ==="
  gh api "repos/$repo/compare/Shudesu:line-harness-oss:main...main" --jq '{ahead: .ahead_by, files: (.files | length)}'
done
```

---

## 機能差分マトリクス（2026-03-25時点）

| 機能 | BKStock | daisukeishioka | meomao | 我々 |
|------|---------|----------------|--------|------|
| Claude AI自動応答 | YES（Haiku） | NO | NO | NO |
| 悩みランキング分析 | YES | NO | NO | NO |
| 収益ダッシュボード | YES | NO | NO | NO |
| ファン離脱予測(churn) | YES | NO | NO | NO |
| 未回答質問BOX | YES | NO | NO | NO |
| Stripe課金 | NO | YES（口座振替も） | NO | YES |
| LIFF会員マイページ | NO | YES | NO | NO |
| サロンコンテンツDB | NO | YES | NO | NO |
| score_threshold修正 | NO | NO | YES | NO |
| 本番デプロイ済み | 不明 | YES | YES | 未確認 |
| AI診断シナリオ | YES | NO | NO | NO |
