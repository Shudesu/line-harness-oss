🌐 **日本語** | [English](README.en.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

# LINE Harness

> ### **[LINE で無料体験する](https://shudesu.github.io/line-harness-oss/)** 👈

LINE 公式アカウントの完全オープンソース CRM。**L社 / U社 の無料代替**。
Cloudflare 無料枠で動く。サーバー代 **0 円**。Claude Code から全操作可能。

### ▶️ [動画で見る (YouTube・約20分)](https://youtu.be/DiRuGaeq1sM)

[![クリックで YouTube を再生 — LINE Harness 導入の全手順](https://img.youtube.com/vi/DiRuGaeq1sM/maxresdefault.jpg)](https://youtu.be/DiRuGaeq1sM)

**現バージョン**: v0.14.1 ・ MIT License ・ TypeScript / Cloudflare Workers + D1

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

### アフィリエイト計測（ASP）
- **アフィリリンク発行** — アフィリエイター自身が LIFF からワンタップで発行、短縮ドメイン対応
- **案件管理** — 案件ごとの固定額報酬を設定、複数案件を並列運用
- **時系列トラッキング** — クリック → 友だち追加 → CV を時系列で記録、last-touch 帰属で成果紐づけ
- **成果承認フロー** — 帰属 CV を承認/却下して報酬を確定、重複アカウント検知フラグで水増しを可視化
- **LINE push 通知** — 成果確定時にアフィリエイターへ自動プッシュ通知
- 詳細: [docs/wiki/27-Affiliate-ASP.md](docs/wiki/27-Affiliate-ASP.md)

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
- **Groq 自由文サポート Bot**（オプション）— `auto_replies` 未マッチ時に Groq 無料枠で応答。設定は `bot.config.json` + `knowledge-packs/`。有効化手順:
  1. `wrangler secret put GROQ_API_KEY`
  2. D1 マイグレーション 051–053 を適用
  3. `tsx scripts/seed-kb-articles.ts` で KB を投入
  4. 管理画面の `account_settings` に `groq_reply_enabled=true` を設定
  5. **LINE 公式アカウントマネージャーの「AIチャットボット(β)」は必ずオフ**（二重返信防止）
  - fail-closed 時は Claude にはフォールバックせず Conversation Inbox へエスカレーション（コスト優先）

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
- [LINE で無料体験する](https://shudesu.github.io/line-harness-oss/)
- [npm: @line-harness/sdk](https://www.npmjs.com/package/@line-harness/sdk)
- [npm: @line-harness/mcp-server](https://www.npmjs.com/package/@line-harness/mcp-server)
- [npm: create-line-harness](https://www.npmjs.com/package/create-line-harness)

---

## ライセンス

MIT License. 商用利用・改変・再配布自由。

---

## コントリビュート

Issue / PR 歓迎。OSS リポへの PR は `Shudesu/line-harness-oss` (このリポ) に投げてください。

---

## 開発者 / Author

**野田修一（Shudesu）** — Harness シリーズ（LINE Harness / IG Harness / X Harness）開発者、AIエージェント株式会社 代表

- GitHub: [@Shudesu](https://github.com/Shudesu)
- X: [@ai_shunoda](https://x.com/ai_shunoda)
- YouTube: [野田 修一 | The Harnessで0円](https://www.youtube.com/@ai_nodashuichi)
- 公式ドキュメント: [Harness Wiki](https://harness-wiki.pages.dev)
- 商用ツールとの比較・料金データ: [The Harness Lab](https://the-harness.com)

---

> **LINE Harness** by [@Shudesu](https://github.com/Shudesu) — AI ネイティブ時代の OSS LINE CRM
