# みやびライン — タスク分解・依存関係グラフ・アサイン表

> **作成日**: 2026-03-26
> **バージョン**: 1.0.0
> **ステータス**: ACTIVE
> **スペックターゲット**: SPEC.md v2.1.0 (M0ベータ → SaaSリリース)

---

## 1. 現状スナップショット (2026-03-26)

### 達成済み (tasks.json より)

| フェーズ | 完了タスク数 | 主要成果 |
|---------|------------|---------|
| P1 Security | T01〜T09 完了 | CORS・認証・CI/CD基盤 |
| P2 Core CRM | T11〜T20 完了 | AI返信・Stripe基盤・LP・イベントバス |
| BUG修正 | T22 完了 | score_threshold バグ修正（event-bus.ts） |
| インフラ | T35・T36 完了 | 再デプロイ・Claude API実接続 |

### ビルド状態

```
pnpm -r build: ✅ PASS (2026-03-26)
  - apps/worker: ✅
  - apps/web: ✅ (全26ページ Static生成)
  - apps/liff: ✅
  - packages/*: ✅
```

### 未解決のオープン Issue (14件)

| # | Issue | 優先度 | 状態 |
|---|-------|--------|------|
| #57 | タスク整理・アサイン（本Issue） | HIGH | in_progress |
| #52 | T49: Teachable バイパス決済 getPlan() | MEDIUM | open |
| #51 | docs(test): Copilot pipeline check | LOW | open |
| #49 | Teachable Webhook LIFF連携案内 | MEDIUM | open |
| #48 | Discord OAuth エンドポイント (PPAL Identity Hub) | MEDIUM | open |
| #47 | unified_profiles テーブル追加 (migration 011) | MEDIUM | open |
| #46 | /health version — package.json バンドル除去 | HIGH | open |
| #45 | ログインページ利用規約同意チェックボックス | HIGH | open |
| #44 | /health version build-time define 注入 | HIGH | open |
| #43 | upstream v0.3.0 (Domino Flow) sync | MEDIUM | open |
| #41 | assignees API テスト | LOW | open |
| #39 | ヘルスチェック バージョン情報追加 | LOW | open |
| #33 | T27: 汎用AI自動応答ミドルウェア | MEDIUM | open |
| #21 | T21: PPALユーザーβ案内 | LOW | open |

---

## 2. スペック目標 (SPEC.md v2.1.0) との照合

### 実装済み ✅

| SPEC セクション | 状態 |
|----------------|------|
| §7.1 友だち管理 API | ✅ 完了 |
| §7.2 タグ管理 API | ✅ 完了 |
| §7.3 シナリオ管理 API | ✅ 完了 |
| §7.4 一斉配信 API | ✅ 完了 |
| §7.5 Stripe 連携 (基盤) | ✅ コード済み（secrets未設定） |
| §7.6 AI分析 API (`/api/ai/analyze`) | ✅ 完了 |
| §7.7 LINE Webhook 処理 | ✅ 完了 |
| §7.8 その他エンドポイント (scoring/forms等) | ✅ 完了 |
| §8 機能要件 (基本CRM) | ✅ 完了 |

### 実装中・未完了 🔜

| SPEC セクション | 状態 | 対応タスク |
|----------------|------|---------|
| §3 価格プラン (Stripe本番) | 🔜 secrets待ち | T37 |
| §6 DB migration 011_ai_consent | 🔜 T38前提 | T38 |
| §8.4 法務ページ (privacy/terms/tokutei) | 🔜 コード済み・内容要確認 | T38 |
| §8.5 オンボーディングウィザード | 🔜 未実装 | T40 |
| §14 MCP ツール統合 | 🔜 設計のみ | T42+ |

---

## 3. タスク依存関係グラフ (DAG)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  みやびライン アクティブタスク DAG (2026-03-26 更新)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【CLUSTER A: インフラ基盤 — 他の全クラスタへの前提】

  [#44/#46] /health バージョン注入 ────────────────────────────►
              build-time define 方式                          │
              CI/CDで自動検証                                  │
              DEPENDS: なし / BLOCKS: 本番監視                │
                                                              │
  [#45] ログインページ同意チェックボックス ──────────────────── ▼
          T38法務ページと同期が必要                          [CLUSTER B へ]
          DEPENDS: なし / BLOCKS: T38法務完成

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【CLUSTER B: マネタイズ基盤 — SaaSリリースの前提条件】

  [T38] 法務ページ確認・ai_consent migration ──────────────────┐
          privacy.tsx / terms.tsx / tokutei.tsx                │
          011_ai_consent.sql 適用                              │
          DEPENDS: #45 / BLOCKS: T37, T39, T41                │
                                                               │
  [T37] Stripe本番設定 ─────────────────────────────────────── ▼
          wrangler secrets設定                               [CLUSTER C へ]
          テスト決済通過 (Pro ¥2,980 / Business ¥9,800)
          DEPENDS: T38 / BLOCKS: T39, T41

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【CLUSTER C: ユーザー獲得 — β案内・LP改修】

  [T39] LP改修 ────────────────────────────────────────────────┐
          L-step比較表                                         │
          AI統合デモGIF                                        │
          PPAL割引セクション                                   │
          DEPENDS: T37+T38 / BLOCKS: T41                      │
                                                               │
  [T40] オンボーディングウィザード ──────────────────────────── ▼
          LINEチャネル接続3ステップ                          [CLUSTER D へ]
          DEPENDS: T38 / BLOCKS: T41

  [T41] PPALメンバーβ案内 ──────────────────────────────────►
          早期アクセスフロー
          PPAL2026クーポンコード
          DEPENDS: T37+T38+T39+T40

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【CLUSTER D: Identity Hub — PPAL統合 (新機能フェーズ)】

  [#47] unified_profiles テーブル (migration) ─────────────────┐
          DEPENDS: なし / BLOCKS: #48, #49, #52               │
                                                               │
  [#48] Discord OAuth エンドポイント ─────────────────────────  │
          DEPENDS: #47 / BLOCKS: #49                          │
                                                               │
  [#49] Teachable Webhook LIFF連携案内 ───────────────────────  │
          DEPENDS: #47, #48 / BLOCKS: #52                     │
                                                               │
  [#52] Teachable バイパス決済 getPlan() ────────────────────── ▼
          DEPENDS: #47, #49 / BLOCKS: なし              [SaaS強化フェーズ]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【CLUSTER E: SaaS品質向上 — 並行可能・後半フェーズ】

  [T28] E2Eテストスイート (vitest / 60%+) ── 独立、いつでも開始
  [T31] スコアリングルール管理UI ──────────── 独立、いつでも開始
  [T32] 友だちCSVエクスポート ─────────────── 独立、いつでも開始
  [T24] PPAL固有コード分離 (リファクタ) ──── 独立、いつでも開始

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【CLUSTER F: アーカイブ・保留】

  [#43] upstream v0.3.0 sync ─── 保留（upstream方針確認後）
  [#33] T27 AI自動応答MW ──────── T36完了済みにより再検討
  [#21] T21 PPALβ案内 ─────────── T41で統合・クローズ推奨
  [#39] ヘルスチェック ───────── #44/#46で対応済み・クローズ推奨
  [#41] assignees API テスト ──── テスト済み・クローズ推奨

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 4. アトミックタスク分解 (優先度順)

### 🔴 CRITICAL / 今すぐ着手

#### A-1: /health バージョン注入 (Issue #44, #46 統合)

```
目的: /health エンドポイントに package.json バージョンを
      build-time define で安全に注入する

アトミック分解:
  A-1-1: wrangler.toml に define = { APP_VERSION = "..." } 設定追加
  A-1-2: apps/worker/src/routes/health.ts で APP_VERSION 参照
  A-1-3: pnpm -r build で型チェック通過確認
  A-1-4: CI でバージョン検証テスト追加

BLOCKS: Issue #44, #46 クローズ可能
EFFORT: 1h
AGENT: Copilot
```

#### A-2: ログイン同意チェックボックス (Issue #45)

```
目的: ログインページに利用規約・プライバシーポリシー同意
      チェックボックスを追加 (GDPR/特商法対応)

アトミック分解:
  A-2-1: apps/web/src/app/login/page.tsx に同意チェックボックス追加
  A-2-2: チェックなしはサブミット不可のバリデーション
  A-2-3: privacy/terms/tokutei へのリンク設置

DEPENDS: なし (T38完了前でも先行実装可)
BLOCKS: T38完全完了
EFFORT: 2h
AGENT: Copilot
```

---

### 🟠 HIGH / 今週中

#### B-1: 法務ページ完成 + ai_consent migration (T38)

```
目的: 有料サービス提供に必須の法務ページ整備

アトミック分解:
  B-1-1: apps/web/src/app/privacy/page.tsx — 本物のプライバシーポリシー記載
          (現在: 167B → 要充実化)
  B-1-2: apps/web/src/app/terms/page.tsx — 利用規約記載
  B-1-3: apps/web/src/app/tokutei/page.tsx — 特定商取引法記載
          (会社: 合同会社みやび / 代表: 林駿甫 / 連絡先: support@ambitiousai.co.jp)
  B-1-4: packages/db/migrations/011_ai_consent.sql 適用確認
          (friends テーブルに ai_consent, ai_consent_updated_at 追加)
  B-1-5: apps/web フッターに privacy/terms/tokutei リンク追加

DEPENDS: なし (コード済みのページに内容充実)
BLOCKS: T37, T39, T41
EFFORT: 4h
AGENT: Copilot (HTML/TSX生成に適任)
```

#### B-2: Stripe 本番設定 (T37)

```
目的: wrangler secrets 設定 + テスト決済 通過

アトミック分解:
  B-2-1: 手動: Stripe Dashboardで Pro/Business Product & Price 作成
  B-2-2: 手動: wrangler secret put STRIPE_PRO_PRICE_ID
  B-2-3: 手動: wrangler secret put STRIPE_BUSINESS_PRICE_ID
  B-2-4: 手動: wrangler secret put STRIPE_WEBHOOK_SECRET
  B-2-5: テスト決済: POST /api/integrations/stripe/checkout 確認
  B-2-6: SPEC.md §3 の Stripe Product/Price ID を実際の値に更新

DEPENDS: T38 (法務ページ)
BLOCKS: T39, T41
EFFORT: 3h (手動作業含む)
AGENT: 林（手動）+ Copilot (コード部分)
NOTE: secrets はコードに書かない。wrangler secretsコマンドで設定。
```

---

### 🟡 MEDIUM / 今週後半〜来週

#### C-1: LP改修 (T39)

```
目的: L-step比較・AI統合デモ・PPAL割引を訴求

アトミック分解:
  C-1-1: apps/web/src/app/landing/page.tsx ヒーローセクション改修
          - 「L-stepに月3万払い続けますか？」コピー
  C-1-2: L-step vs みやびライン 比較表コンポーネント
  C-1-3: AI統合デモセクション (GIFまたはスクショ)
  C-1-4: PPAL割引セクション (Pro初月無料 / PPAL2026クーポン)
  C-1-5: CTA ボタン「無料で始める」「L-stepを卒業する」

DEPENDS: T37, T38
BLOCKS: T41
EFFORT: 6h
AGENT: Copilot
```

#### C-2: オンボーディングウィザード (T40)

```
目的: 非技術者がLINEチャネルを3ステップで接続できるUI

アトミック分解:
  C-2-1: apps/web/src/app/onboarding/ ページ新規作成
  C-2-2: Step 1: LINE Developers Console でチャネル作成ガイド
  C-2-3: Step 2: Channel Secret / Access Token 入力フォーム
  C-2-4: Step 3: Webhook URL 設定確認 + 動作テスト
  C-2-5: 完了後ダッシュボードへリダイレクト
  C-2-6: apps/worker/src/routes/ にオンボーディング検証API追加

DEPENDS: T38
BLOCKS: T41
EFFORT: 8h
AGENT: Copilot
```

---

### 🔵 MEDIUM / SaaS強化フェーズ (並行可)

#### D-1: Identity Hub (Issue #47→#48→#49→#52)

```
目的: Teachable + Discord + LINE の統合IDシステム

アトミック分解:
  D-1-1 (#47): unified_profiles テーブル migration 作成
  D-1-2 (#48): GET/POST /api/discord/oauth エンドポイント
  D-1-3 (#49): POST /webhook/incoming での Teachable イベント処理
               → LIFF連携案内メッセージ自動送信
  D-1-4 (#52): getPlan() ミドルウェア (Teachableユーザー = Proプラン扱い)

DEPENDS: なし (独立クラスタ)
BLOCKS: なし
EFFORT: 12h (合計)
AGENT: Copilot (Issue #47→#48→#49→#52 の順で投入)
```

#### E-1: E2Eテストスイート (T28)

```
目的: vitest で 60%+ カバレッジ

アトミック分解:
  E-1-1: vitest + @cloudflare/vitest-pool-workers セットアップ
  E-1-2: event-bus.ts ユニットテスト (既存 event-bus.test.ts 拡張)
  E-1-3: webhook.ts インテグレーションテスト
  E-1-4: stripe.ts モックテスト
  E-1-5: scoring.ts ユニットテスト
  E-1-6: CI (ci.yml) にテスト実行ステップ追加

DEPENDS: なし
BLOCKS: なし
EFFORT: 8h
AGENT: Copilot
```

#### E-2: スコアリングUI (T31)

```
目的: 管理画面でスコアリングルールを編集できるUI

アトミック分解:
  E-2-1: apps/web/src/app/scoring/ ページ改修
  E-2-2: スコアリングルール一覧コンポーネント
  E-2-3: ルール作成/編集モーダル
  E-2-4: DELETE エンドポイント接続

DEPENDS: なし
BLOCKS: なし
EFFORT: 4h
AGENT: Copilot
```

#### E-3: 友だちCSVエクスポート (T32)

```
目的: 管理画面から友だちデータをCSVでダウンロード

アトミック分解:
  E-3-1: GET /api/friends/export エンドポイント追加
          (CSV形式: id, lineUserId, displayName, tags, score, createdAt)
  E-3-2: apps/web/src/app/friends/ にエクスポートボタン追加
  E-3-3: ダウンロード処理 (Blob + URL.createObjectURL)

DEPENDS: なし
BLOCKS: なし
EFFORT: 3h
AGENT: Copilot
```

---

## 5. インパクト試算

### リリース判断マトリクス

| タスク | MRR インパクト | ユーザー獲得 | リスク低減 | 工数 | スコア |
|--------|-------------|------------|---------|------|-------|
| B-2 Stripe本番 | ¥2,980〜/月×N社 | 直接 | HIGH | 3h | **95** |
| B-1 法務ページ | 有料化前提 | 間接 | CRITICAL | 4h | **92** |
| A-1 /health版 | — | — | MEDIUM | 1h | **70** |
| A-2 同意チェック | — | — | MEDIUM | 2h | **68** |
| C-1 LP改修 | ×2倍想定 | 直接 | LOW | 6h | **85** |
| C-2 オンボード | 離脱率-30% | 間接 | LOW | 8h | **78** |
| D-1 Identity Hub | PPAL連携 | 間接 | LOW | 12h | **72** |
| E-1 E2Eテスト | — | — | MEDIUM | 8h | **65** |
| E-2 スコアリングUI | 機能完結 | 間接 | LOW | 4h | **60** |
| E-3 CSVエクスポート | 競合対抗 | 間接 | LOW | 3h | **58** |

### 推奨実行順序

```
Week 1 (今週):
  Day 1-2: A-1 (#44/#46統合) → A-2 (#45) → B-1 (T38法務)
  Day 3-5: B-2 (T37 Stripe手動設定)

Week 2:
  Day 1-3: C-1 (T39 LP改修)
  Day 4-7: C-2 (T40 オンボーディング)
  → T41 PPALβ案内 実行 (Week 2末)

Week 3-4 (SaaS強化):
  D-1 (#47→#48→#49→#52 順次)
  E-1 (T28 テスト) — 並行
  E-2 (T31) + E-3 (T32) — 並行
```

---

## 6. エージェントアサイン表

| タスク | Issue | AGENT | 優先度 | 状態 |
|--------|-------|-------|--------|------|
| /health バージョン注入 | #44, #46 | **Copilot** | CRITICAL | → Issue投入 |
| ログイン同意チェック | #45 | **Copilot** | HIGH | → Issue投入 |
| 法務ページ完成 (T38) | 新規 | **Copilot** | HIGH | → Issue投入 |
| Stripe本番設定 (T37) | 新規 | **林（手動）** | HIGH | → 手動作業 |
| LP改修 (T39) | 新規 | **Copilot** | HIGH | → T38完了後 |
| オンボーディング (T40) | 新規 | **Copilot** | MEDIUM | → T38完了後 |
| PPALβ案内 (T41) | 新規 | **main** | MEDIUM | → T37完了後 |
| Identity Hub (#47〜#52) | #47,#48,#49,#52 | **Copilot** | MEDIUM | → 順次 |
| E2Eテスト (T28) | 新規 | **Copilot** | MEDIUM | → 並行可 |
| スコアリングUI (T31) | 新規 | **Copilot** | MEDIUM | → 並行可 |
| CSVエクスポート (T32) | 新規 | **Copilot** | MEDIUM | → 並行可 |

### クローズ推奨 Issue

| Issue | 理由 |
|-------|------|
| #39 ヘルスチェック | #44/#46で統合対応 |
| #41 assignees API テスト | 目的達成済み |
| #21 T21 PPALβ案内 | T41で統合 |
| #33 T27 AI自動応答 | T36完了により古い内容 |

---

## 7. ベースライン測定 (Agent Skill Bus 連携)

### 現在の品質スコア

| 指標 | 現在値 | 目標値 |
|------|--------|--------|
| ビルド成功率 | 100% | 100% |
| TypeScript strict エラー | 0 | 0 |
| テストカバレッジ | ~0% | 60%+ |
| 法務ページ充足度 | ~20% | 100% |
| Stripe本番稼働 | 0% | 100% |
| オンボーディング完成度 | 0% | 100% |

### 改善サイクル (PDCA)

```
Plan  → 本ドキュメントのタスク分解
Do    → Copilot Issue投入 → Draft PR → CI
Check → pnpm -r build + typecheck + AI Review
Act   → APPROVE → squash merge → 次タスクへ
```

---

## 8. Copilot Issue 投入テンプレート

### 即時実行: /health バージョン注入 (#44/#46統合版)

```bash
gh issue create \
  --repo ShunsukeHayashi/line-harness-oss \
  --title "[auto] fix(health): build-time version injection via wrangler define" \
  --label "copilot,auto,P1-security" \
  --body "## 問題
apps/worker/src/routes/health.ts の version フィールドが
package.json を直接バンドルしているため、ファイルサイズ増大と
ビルド時の型エラーが発生している。

## 修正内容
1. wrangler.toml に \`[define]\` セクション追加:
   APP_VERSION = '0.1.0'
2. apps/worker/src/routes/health.ts で \`APP_VERSION\` 定数を参照
3. package.json の直接 import を除去

## 完了条件
- [ ] pnpm -r build が通る
- [ ] GET /health に { version: '0.1.0' } が含まれる
- [ ] package.json バンドルなし"
```

### 即時実行: 法務ページ完成 (T38 アトミック版)

```bash
gh issue create \
  --repo ShunsukeHayashi/line-harness-oss \
  --title "[auto] feat(T38): 法務3ページ実装 — プライバシーポリシー・利用規約・特定商取引法" \
  --label "copilot,auto" \
  --body "## やりたいこと
有料SaaS提供に必要な法務3ページを実装する。

## 要件
### privacy/page.tsx
- 合同会社みやび / 代表: 林駿甫
- データ収集目的（LINEユーザー情報、支払い情報）
- Cloudflare（米国）へのデータ転送
- AI処理に関する同意事項
- 問い合わせ: support@ambitiousai.co.jp

### terms/page.tsx
- 利用規約（月額サブスクリプション条件）
- Pro: ¥2,980/月、Business: ¥9,800/月
- 禁止事項・免責事項
- 準拠法: 日本法

### tokutei/page.tsx
- 特定商取引法に基づく表記
- 販売業者: 合同会社みやび
- 代表: 林駿甫
- 所在地: 愛知県一宮市（設立後正式住所）
- 連絡先: support@ambitiousai.co.jp
- 価格: Pro ¥2,980/月・Business ¥9,800/月
- 返金: 月額サブスク・初月返金可

### フッターリンク追加
- apps/web/src/components/layout/ のフッターに
  privacy / terms / tokutei へのリンク追加

## 完了条件
- [ ] pnpm -r build が通る
- [ ] /privacy /terms /tokutei が 200 を返す（現在167B空ページ）
- [ ] フッターに3ページへのリンクが表示される"
```

---

*このドキュメントは TASK_DECOMPOSITION.md として project_memory/ に保存し、
エージェント間で共有されます。更新時はバージョンと日付を更新してください。*
