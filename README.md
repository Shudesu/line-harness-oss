🌐 **日本語** | [English](README.en.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

# LINE Harness

> ### **[LINE で無料体験する](https://shudesu.github.io/line-harness-oss/)** 👈

LINE 公式アカウントの完全オープンソース CRM。**L社 / U社 の無料代替**。
Cloudflare 無料枠で動く。サーバー代 **0 円**。Claude Code から全操作可能。

### ▶️ [動画で見る (YouTube・約20分)](https://youtu.be/DiRuGaeq1sM)

[![クリックで YouTube を再生 — LINE Harness 導入の全手順](https://img.youtube.com/vi/DiRuGaeq1sM/maxresdefault.jpg)](https://youtu.be/DiRuGaeq1sM)

**現バージョン**: v0.13.2 ・ MIT License ・ TypeScript / Cloudflare Workers + D1

---

## なぜ LINE Harness？

| | L社 | U社 | **LINE Harness** |
|---|---|---|---|
| 月額 | 2万円〜 | 1万円〜 | **0円** |
| ステップ配信 | ✅ | ✅ | ✅ |
| セグメント配信 | ✅ | ✅ | ✅ |
| リッチメニュー切替 | ✅ | ✅ | ✅ |
| フォーム (LIFF) | ✅ | ✅ | ✅ |
| スコアリング | ✅ | ❌ | ✅ |
| IF-THEN 自動化 | 一部 | 一部 | ✅ |
| API 公開 | ❌ | ❌ | **全機能** |
| Claude Code (AI) 対応 | ❌ | ❌ | **MCP server 同梱** |
| BAN 検知 & 自動アカウント切替 | ❌ | ❌ | **✅** |
| マルチアカウント | 別契約 | 別契約 | **標準搭載** |
| 友だち重複検出 | ❌ | ❌ | **✅** (picture_url トークン照合) |
| ソースコード | 非公開 | 非公開 | **MIT (このリポ)** |

---

## クイックスタート

### 1 コマンドで完全セットアップ

```bash
npx create-line-harness
```

CLI が以下を全部やる:
- Cloudflare アカウント認証 (wrangler login)
- D1 データベース作成 + スキーマ・マイグレーション適用
- Worker / 管理画面のデプロイ
- LINE 公式アカウントの credentials 登録
- LIFF アプリの自動作成
- 管理画面初回ログイン用 Owner ユーザー作成

所要時間: 約 5 分。完了すれば管理画面 (`https://<your-name>-admin.pages.dev`) で即運用開始。

### 必要なもの

- Cloudflare アカウント（無料枠で OK）
- LINE 公式アカウント + Messaging API channel
- Node.js 22+ / pnpm

---

## 主要機能

### 配信
- **ステップ配信** — `delay_minutes` で分単位制御、条件分岐、ステルス送信
- **ブロードキャスト** — 全員 / タグ / セグメント、即時 or 予約、500 人超は自動キュー化
- **リマインダー** — 指定日時からのカウントダウン配信（セミナー 3 日前 / 1 日前 / 当日）
- **テンプレート** — `{{name}}` `{{uid}}` `{{auth_url:CHANNEL_ID}}` で個別パーソナライズ
- **トラッキングリンク** — クリック計測 → 自動タグ付け → シナリオ起動

### CRM
- **友だち管理** — Webhook 自動登録、プロフィール取得、カスタムメタデータ
- **タグ** — 配信条件・シナリオトリガー
- **スコアリング** — 行動ベースのリードスコア自動計算
- **オペレーターチャット** — 管理画面から直接 1:1 返信
- **Conversation Inbox** — 未返信の会話を放置時間順で一覧（自動配信は除外判定）
- **重複検出** — `picture_url` 中間トークンで複数アカウント間の同一ユーザーを自動タグ付け

### マーケティング
- **リッチメニュー** — ユーザー別 / タグ別の自動切替
- **フォーム (LIFF)** — LINE 内完結フォーム、回答 → メタデータ自動保存
- **カレンダー予約** — Google Calendar 連携の予約システム (LIFF)
- **スタッフ管理** — Owner / Admin / Staff の 3 ロール、API key 個別発行

### 自動化
- **IF-THEN ルール** — 7 種のトリガー × 6 種のアクション
- **自動返信** — キーワード完全一致 / 部分一致
- **Webhook IN/OUT** — Stripe / Slack 等の外部サービス連携
- **通知ルール** — 条件付きアラート配信
- **配信タイミング** — `delay_minutes` と `scheduled_at` で完全制御（v0.13.2 で時間ゲート全廃、運用側ハンドル）

### マルチアカウント
- **複数 LINE 公式アカウント** を 1 つのダッシュボードで管理
- **アカウント別シナリオ・タグ・配信** スコープ
- **BAN 検知** → 自動で次のアカウントへ友だち移行（pool 機能）
- **トラフィックプール** — 複数アカウントへ自動振り分け

### AI 統合
- **MCP Server 同梱** (`@line-harness/mcp-server`) — Claude Code から自然言語で全操作
  - `list_conversations` / `get_conversation` — 未返信会話の AI 監視
  - `create_scenario` / `update_step` — シナリオを AI に作らせる
  - `broadcast` / `send_message` — メッセージ送信（要ユーザー確認）
- **公式 SDK** (`@line-harness/sdk`) — TypeScript の型付き SDK、ESM + CJS、ゼロ依存

### iOS アプリ対応
- **`GET /api/capabilities`** — iOS 公式アプリ (the-harness-ios) との互換判定エンドポイント
- Owner / Admin / Staff いずれのロールでも利用可能

---

## アーキテクチャ

```
[ LINE Platform ] ⇄ [ Cloudflare Worker (Hono) ] ⇄ [ D1 SQLite ]
                              ⇅
                    [ Cloudflare Pages (Next.js 15) ]
                              ⇅
                    [ MCP Server / SDK / Claude Code ]
```

- **Worker** (`apps/worker`): API + LIFF + Webhook 受信、cron で配信処理
- **Web** (`apps/web`): Next.js 15 ダッシュボード（19 セクション）
- **Packages**:
  - `@line-harness/sdk` — TypeScript SDK
  - `@line-harness/mcp-server` — Claude Code 用 MCP server
  - `create-line-harness` — セットアップ CLI
  - `@line-harness/plugin-template` — プラグイン拡張用テンプレート
  - `@line-harness/db` — D1 マイグレーション + ヘルパー
  - `@line-harness/line-sdk` — LINE API 薄ラッパー
  - `@line-harness/shared` — 型定義共有

---

## ドキュメント

- [セットアップガイド (動画)](https://youtu.be/DiRuGaeq1sM)
- [Fork + Cloudflare 運用ガイド](docs/FORK_CLOUDFLARE_WORKFLOW.md)
- [LINE で無料体験する](https://shudesu.github.io/line-harness-oss/)
- [npm: @line-harness/sdk](https://www.npmjs.com/package/@line-harness/sdk)
- [npm: @line-harness/mcp-server](https://www.npmjs.com/package/@line-harness/mcp-server)
- [npm: create-line-harness](https://www.npmjs.com/package/create-line-harness)

---

## Fork して自分の Cloudflare で運用する

LINE Harness は、fork した repo を自分の本番環境として育てる運用を推奨します。

1. この repo を自分の GitHub アカウントへ fork
2. fork の GitHub Actions に Cloudflare secrets / variables を設定
3. `main` に merge された変更を Cloudflare Workers / Pages へ自動 deploy
4. `Update from upstream` workflow で本流アップデートを PR として取り込む
5. 自分専用の機能は fork の feature branch で開発

ローカルPCは開発・確認用です。本番は GitHub Actions と Cloudflare に寄せると、本流機能と自分の改造を両方育てやすくなります。

---

## ライセンス

MIT License. 商用利用・改変・再配布自由。

---

## コントリビュート

Issue / PR 歓迎。OSS リポへの PR は `Shudesu/line-harness-oss` (このリポ) に投げてください。

- 貢献方法: [CONTRIBUTING.md](CONTRIBUTING.md)
- セキュリティ報告: [SECURITY.md](SECURITY.md)
- サポート・質問: [SUPPORT.md](SUPPORT.md)
- Private ↔ OSS 同期方針: [docs/OSS-SYNC-CHARTER.md](docs/OSS-SYNC-CHARTER.md)

---

> **LINE Harness** by [@Shudesu](https://github.com/Shudesu) — AI ネイティブ時代の OSS LINE CRM
