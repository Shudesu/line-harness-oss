# みやびライン — ベースライン & ポジショニング レポート

**作成日**: 2026-03-26
**作成者**: Claude Code (Sonnet 4.6)
**対象リポジトリ**: ShunsukeHayashi/line-harness-oss
**ベースコミット**: `ee3e01e` (fix/discord-oauth-clean)

---

## 1. エグゼクティブサマリー

みやびラインはオープンソースの LINE 公式アカウント CRM「line-harness-oss」のフォークとして、2026-03-24 に独立路線を宣言した。upstream（Shudesu/line-harness-oss）へのコントリビューションを永久停止し、PPAL コミュニティ・教育ビジネス特化の独自プロダクトとして開発を進めている。

フォーク開始から 3 日間で 65 コミット・18 PR マージを達成。Claude Code + Copilot Coding Agent + Claude Opus AI Review による **3 層マルチエージェント CI/CD パイプライン**を独自に構築しており、開発速度・品質管理の両面で他フォーカーを上回る体制を確立した。

---

## 2. upstream の現状分析

### 2-1. リポジトリ規模（2026-03-26 時点）

| 指標 | 値 |
|------|-----|
| Stars | 229 |
| Forks | 73 |
| Open Issues | 1 |
| リリース数 | 4（v0.2.0〜v0.4.0） |
| 公開日からの経過 | 3 日 |
| 公開後総コミット数 | 50 |

3 日で 229 スター・73 フォークは異常な速度であり、日本の LINE マーケティング市場における潜在需要の大きさを示している。

### 2-2. upstream 開発方向（v0.2.0〜v0.4.0 の推移）

```
v0.2.0 (2026-03-24)  Multi-Account Support
v0.2.1 (2026-03-24)  SDK Multi-Account + Bug Fixes
v0.3.0 (2026-03-25)  Domino Flow / Cross-Account Trigger / Lead Scoring
v0.4.0 (2026-03-26)  MCP Server / Auto URL Tracking / LIFF Click Attribution
```

**注目点**: v0.4.0 で「AI エージェントから MCP 経由で CRM を操作する」機能を追加。upstream 作者は AI オペレーション統合を最優先の差別化軸に据えていることがわかる。

### 2-3. upstream 作者 (Shudesu) のプロファイル

- GitHub アカウント作成: 2023-07-20
- 公開リポジトリ: 3 本（ほぼ本プロジェクト専用）
- Followers: 11
- Bio・所属・名前: 非公開

素性は不明だが、Cloudflare Workers / D1 / LINE API / マルチアカウント設計の深い知識を持つ実力者。1 日 1 リリースという開発速度から、フルタイムで本プロジェクトに注力している可能性が高い。

---

## 3. フォーカー競合マップ

### 3-1. 注目フォーカー 一覧（73 フォーク中）

| フォーカー | 方向性 | 技術水準 | 独自実装 | upstream への貢献 |
|-----------|--------|---------|---------|-----------------|
| **cursorvers** | 医療 AI × FUGUE | 高 | SSR リアルタイム / 移行ブリッジ | なし（独自路線） |
| **shota-lylkit** | 業務管理 SaaS | 中〜高 | Jobs / QR 出席 / Booking | PR #50 マージ済み |
| **michisirube** | 独自ブランディング | 不明 | リネーム・ドキュメント整理 | なし |
| **sogadaiki** | 運用改善 | 中 | LINE トークン自動更新 | PR #44/#45 マージ済み |
| **BKStock** | AI/セキュリティエンジニア | 高 | NadirClaw (LLM コスト最適化) | Issue 大量投稿のみ |
| **a-msy** (COMPUS) | ドキュメント整備 | 低〜中 | セットアップ手順の分離 | PR #49 マージ済み |
| **みやびライン** | PPAL 教育コミュニティ | 高 | Stripe / AI 返信 / Discord OAuth / unified_profiles | **永久停止（独立）** |

### 3-2. cursorvers の詳細分析（最注目競合）

**正体**: 医療 AI スタートアップ「Cursorvers Inc.」。以下の独立リポジトリを同時開発中。

| リポジトリ | 概要 |
|-----------|------|
| `guidescope` | 医療 AI 国内ガイドライン LLM プロンプトビルダー |
| `fugue-orchestrator` | **Claude をオーケストレーターに Codex/GLM/Gemini を委任するマルチモデル AI フレームワーク** |
| `cursorvers_line_free_dev` | 医療 AI 支援 LINE Bot（Deno/Supabase → Cloudflare 移行中） |
| `claude-code-harness` | Claude Code 専用開発ハーネス |

**line-harness-oss への独自実装（本日 2026-03-26）**:

1. **FUGUE ブリッジ** (`apps/worker/src/routes/fugue-bridge.ts`, 96 行)
   - `POST /webhooks/line/fugue-bridge` — 他システムから移行するためのシャドーモードエンドポイント
   - `friend_add` イベントを SHA-256 ハッシュ化してプライバシーを保ちながら D1 に記録
   - Migration: `010_fugue_bridge.sql` — `fugue_shadow_events` テーブル
   - **意図**: FUGUE システムのユーザーを LINE CRM へ段階的に移行する橋渡し

2. **@opennextjs/cloudflare SSR 移行** (20 ファイル変更)
   - 静的エクスポートから Cloudflare Pages SSR へ
   - D1 バック HttpOnly クッキーセッション認証（セキュリティ強化）
   - **SSE リアルタイムイベント** (`/api/events`) — D1 を 5 秒ポーリング、55 秒ライフタイム
   - React フック `useEventSource` — exponential backoff 再接続
   - ダッシュボードに LIVE バッジとリアルタイムイベントフィード追加

**評価**: 技術水準は全フォーカー中最高。Claude Opus 4.6 (1M context) を開発に使用（Co-Author として記録あり）。ただし医療 AI が軸であり、みやびラインと**マーケットが重複しない**。

### 3-3. shota-lylkit の詳細分析

**正体**: KIT Inc. + LYL 株式会社の開発者（ハンドル名から 2 社関連と推測）。

**独自実装（PR #50、本日 upstream にマージ）**:
- Jobs / Bookings / 承認フロー / QR 出席管理 / レビュー / クレジットスコア
- LIFF 認証ミドルウェア追加
- SQLi 修正・CORS 制限・ファイルアップロード検証（セキュリティ P0 対応）
- R2 ストレージ / D1 バックアップ / N+1 クエリ修正

**方向性**: LINE を労務管理・業務管理プラットフォームの通知チャネルとして活用する B2B SaaS。飲食・小売・サービス業向け。みやびラインとは**ターゲット業界が異なる**。

### 3-4. BKStock の詳細分析

**正体**: LLM ルーター・サイバーセキュリティ系エンジニア（84 repos）。

| リポジトリ | 概要 |
|-----------|------|
| `NadirClaw` | LLM ルーター & AI コスト最適化プロキシ。Claude Code/Codex/Cursor/OpenClaw 向け。40〜70% コスト削減。 |
| `deepdarkCTI` | Cyber Threat Intelligence ソース収集 |
| `pinchtab` | ブラウザ自動化・マルチインスタンスオーケストレーター |

upstream に G-シリーズ（チーム機能）・F-シリーズ（分析機能）を系統的に Issue 投稿したが全件クローズ。**ユーザーとしての要望**であり直接競合ではない。

---

## 4. みやびライン ベースライン

### 4-1. リポジトリ規模（2026-03-26 時点）

| 指標 | 値 |
|------|-----|
| Stars | 1 |
| Forks | 0 |
| Open Issues | 8 |
| Total commits (main) | 65 |
| Merged PRs | 18（ShunsukeHayashi: 14 / Copilot: 4） |
| フォーク開始日 | 2026-03-24（3 日前） |
| 現在ブランチ | fix/discord-oauth-clean |

### 4-2. 実装済み機能マップ

#### API ルート（24 エンドポイント群）

```
apps/worker/src/routes/
├── affiliates.ts      — アフィリエイト管理（みやびライン独自）
├── ai.ts              — Claude AI 解析エンドポイント（T36）
├── automations.ts     — オートメーション（upstream ベース）
├── beta-feedback.ts   — ベータフィードバック収集 + GitHub Issue 自動作成
├── broadcasts.ts      — ブロードキャスト配信
├── calendar.ts        — Google カレンダー連携（みやびライン独自）
├── chats.ts           — チャット・オペレーター管理
├── conversions.ts     — コンバージョントラッキング
├── forms.ts           — フォーム機能
├── friends.ts         — 友だち管理
├── health.ts          — ヘルスチェック（バージョン情報付き）
├── liff.ts            — LIFF/LINE Login（1,181 行、最大ファイル）
├── line-accounts.ts   — マルチアカウント管理
├── notifications.ts   — 通知管理
├── openapi.ts         — OpenAPI スキーマ
├── reminders.ts       — リマインダー
├── rich-menus.ts      — リッチメニュー管理
├── scenarios.ts       — ステップシナリオ
├── scoring.ts         — リードスコアリング
├── stripe.ts          — Pro/Business 課金（T20、みやびライン独自）
├── tags.ts            — タグ管理
├── templates.ts       — テンプレートライブラリ
├── tracked-links.ts   — クリックトラッキング
├── users.ts           — ユーザー管理
├── webhook.ts         — LINE Webhook 処理
└── webhooks.ts        — Teachable Webhook（みやびライン独自）
```

#### サービス層（11 サービス）

```
apps/worker/src/services/
├── ban-monitor.ts          — BAN 監視
├── broadcast.ts            — 配信エンジン
├── event-bus.ts            — イベント駆動オートメーション
├── google-calendar.ts      — Google カレンダー同期
├── miyabi-ai-router.ts     — AI 返信ルーター（T36）
├── reminder-delivery.ts    — リマインダー配信
├── segment-query.ts        — セグメントクエリ
├── segment-send.ts         — セグメント配信
├── stealth.ts              — ステルス機能
├── step-delivery.ts        — シナリオステップ配信
└── token-refresh.ts        — LINE アクセストークン自動更新
```

#### D1 マイグレーション（13 ファイル）

| マイグレーション | 内容 |
|----------------|------|
| 001〜002 | friends / scenarios / steps / tags / automations / broadcasts |
| 003 | entry_routes（登録経路） |
| 004 | friend_metadata（LINE profile 同期） |
| 005 | step_branching（条件分岐） |
| 006 | tracked_links（クリック追跡） |
| 007 | forms（フォーム機能） |
| 008 | multi_account / rate_limit |
| 009 | beta_feedback / token_expiry |
| 010 | token_expiry（修正版） |
| **011** | **unified_profiles（Identity Hub: LINE + Discord + Teachable 統合）** |
| **012** | **discord_id_unique（Discord ID ユニーク制約）** |

#### CI/CD パイプライン（8 ワークフロー）

```
.github/workflows/
├── ci.yml               — TypeScript build + typecheck
├── ai-review.yml        — Claude Opus 4.6 コードレビュー
├── auto-merge.yml       — AI Review APPROVE → squash merge 自動化
├── copilot-assign.yml   — [auto] Issue → Copilot Coding Agent 自動アサイン
├── copilot-watchdog.yml — action_required ブロック監視（5 分間隔 + event-driven）
├── decompose.yml        — Claude Opus で Issue を atomic sub-issue に分解
├── deploy-worker.yml    — Cloudflare Workers デプロイ（手動トリガー）
└── pr-preview.yml       — PR プレビュー
```

### 4-3. みやびライン 独自機能（upstream 非存在）

| 機能 | ファイル | 概要 |
|------|---------|------|
| Stripe 課金 | `stripe.ts` | Pro ($29/月) / Business ($99/月) サブスクリプション |
| AI 返信ルーター | `miyabi-ai-router.ts` | Claude API によるメッセージ自動返信 |
| Discord OAuth | `liff.ts` | HMAC-signed state + LINE ID token 検証 |
| unified_profiles | migration 011 | LINE / Discord / Teachable を 1 レコードに統合 |
| Teachable Webhook | `webhooks.ts` | 購入完了 → LINE LIFF 連携案内の自動送信 |
| アフィリエイト管理 | `affiliates.ts` | アフィリエイト報酬管理 |
| Google カレンダー | `calendar.ts` | 予約・スケジュール連携 |
| ベータフィードバック | `beta-feedback.ts` | フィードバック収集 + GitHub Issue 自動作成 |
| PPAL 分離 | `ppal/` ディレクトリ | PPAL 専用コードの分離管理 |
| 3 層 AI CI/CD | `.github/workflows/` | Copilot 実装 → Opus レビュー → 自動マージ |

### 4-4. liff.ts の独自実装詳細（1,181 行）

upstream の liff.ts と比較して以下を独自実装:

- **UTM パラメータ完全対応**: `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` / `utm_term`
- **広告クリック ID 追跡**: `gclid`（Google Ads）/ `fbclid`（Meta Ads）
- **マルチアカウント LIFF**: DB からアカウント情報を動的解決
- **クロスアカウントリンク**: `uid` パラメータで既存ユーザーへの紐付け
- **Discord OAuth フロー**: HMAC-signed state、コールバック、DB 保存
- **Teachable 連携**: 購入確認後の LIFF リダイレクト
- **ref コード追跡**: 登録経路の完全トラッキング

---

## 5. ポジショニング分析

### 5-1. 競合比較マトリクス

```
                    技術水準
                    高 |
                       |   cursorvers (医療AI)
                       |
                       |         みやびライン (PPAL)
                       |
                       |   shota-lylkit (業務管理)
                    低 |___________________________________
                         汎用 ←──────────── 特化
```

### 5-2. みやびラインの差別化軸

**競合しない理由（ポジション分析）**:

| 軸 | upstream | cursorvers | shota-lylkit | みやびライン |
|----|---------|------------|-------------|-----------|
| ターゲット | 汎用 CRM | 医療 AI クリニック | 業務管理 B2B | 教育コミュニティ / PPAL |
| 収益モデル | OSS（無料） | B2B SaaS（未定） | B2B SaaS（未定） | Stripe 課金済み |
| 認証基盤 | LINE のみ | LINE + FUGUE | LINE のみ | LINE + Discord + Teachable |
| 開発体制 | 個人（高速） | スタートアップ | 2 社 | マルチ AI エージェント |
| AI 統合 | MCP Server | FUGUE フレームワーク | なし | AI 返信ルーター |

みやびラインは「PPAL 教育コミュニティ × LINE × Discord × Teachable の三軸統合」という独自のニッチを確立しており、他の 73 フォーカーが踏み込んでいない領域にいる。

### 5-3. 技術的優位性

1. **唯一の Stripe 課金実装フォーク**: 収益化が即座に可能
2. **唯一の Discord OAuth 実装フォーク**: コミュニティプラットフォームとの統合
3. **唯一の unified_profiles 実装**: LINE / Discord / Teachable を一元管理
4. **最先端の CI/CD 体制**: 3 層 AI パイプラインを持つフォークは他に存在しない

---

## 6. 現在の課題と未解決事項

### 6-1. オープンブランチ

| ブランチ | 内容 | 状態 |
|---------|------|------|
| `fix/discord-oauth-clean` | Discord OAuth HMAC 実装（PR 未作成） | **要 PR 作成** |

### 6-2. オープン Issues（優先度順）

| # | タイトル | 優先度 | アクション |
|---|---------|--------|-----------|
| #67 | Discord OAuth CSRF・認証バイパス修正 | P0 | Copilot に `[auto]` Issue で対応 |
| #68 | Teachable Webhook 認証・冪等性修正 | P0 | 同上 |
| #43 | upstream v0.4.0 sync (MCP Server) | P1 | 取り込み可否の意思決定が必要 |
| #48 | Discord OAuth エンドポイント追加 | P1 | fix/discord-oauth-clean のPR化 |
| #49 | Teachable Webhook → LIFF 連携 | P2 | #68 解決後に対応 |
| #33 | T27: 汎用 AI 自動応答ミドルウェア | P2 | miyabi-ai-router.ts の拡張 |
| #21 | T21: PPAL ユーザーへの β 案内 | P3 | 機能安定後に対応 |

### 6-3. upstream v0.4.0 sync の意思決定

upstream が本日追加した機能の評価:

| 機能 | みやびラインへの価値 | 取り込み推奨 |
|------|-------------------|------------|
| MCP Server（AI 操作） | 高（miyabi-ai-router と相補） | ○ 検討 |
| Auto URL Tracking | 中（tracked-links.ts と重複） | △ 要確認 |
| LIFF Click Attribution | 高（UTM 追跡の強化） | ○ 検討 |

---

## 7. 中期開発ロードマップ（推奨）

### Phase A — セキュリティ修正（今週中）
- Issue #67: Discord OAuth CSRF 修正
- Issue #68: Teachable Webhook 認証修正
- fix/discord-oauth-clean → PR 作成・マージ

### Phase B — MCP Server 評価（来週）
- upstream v0.4.0 の MCP Server コードを精査
- みやびライン独自の MCP ツール定義を検討
- Issue #43 をクローズするか独自実装かの判断

### Phase C — Identity Hub 完成（2 週間後）
- unified_profiles を軸に Discord / Teachable / LINE の統合フローを完成
- PPAL メンバーの自動 LINE 登録フロー
- Stripe 課金 → Discord ロール付与 → LINE シナリオ開始の自動化

---

## 8. 結論

みやびラインは upstream から 3 日でフォークし、すでに独自の **PPAL × LINE × Discord × Teachable 統合 CRM** としての輪郭を持っている。技術水準・CI/CD 体制ともに他フォーカーに劣っていない。

ポジション上の競合はなく、引き続き **upstream 完全独立・独自路線** での開発が最善である。短期的には Discord OAuth のセキュリティ修正を完了させ、中期的には unified_profiles を核とした Identity Hub の完成が最優先タスクとなる。

upstream が MCP Server を追加したことで「AI エージェント操作」の軸が業界標準になりつつある点は注視が必要。みやびライン独自の MCP 実装（Miyabi MCP Bundle との統合）を計画的に進めることを推奨する。

---

*本レポートは 2026-03-26 時点のスナップショットです。*
*次回更新推奨タイミング: Phase A 完了後（Discord OAuth / Teachable Webhook セキュリティ修正後）*
