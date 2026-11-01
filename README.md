# L Harness

LINE公式アカウントの配信・顧客管理・自動化を、オープンソースで。開発者は **野田修一（Shudesu）** です。

> ### [野田修一の公式LINEに登録して、無料ガイドを受け取る →](https://line-crm-worker.line-crm-api.workers.dev/auth/line?ref=github)
>
> L Harnessの導入を考えている方へ。まずは公式LINEの無料ガイドから始められます。

## クラウド版も無料で公開中 — インストール・サーバー構築不要

**[L Harness Cloudを無料で始める →](https://theharness.cloud/line)**

Googleでログインし、ご自身のLINE公式アカウントのチャネル情報を設定すると、専用の管理画面・データベースを利用できます。サーバー構築やコマンド操作は不要です。カード登録も不要です。

クラウド利用料0円の先着枠を提供しています。**現在の空き枠・利用条件は[Cloud公式ページ](https://theharness.cloud/line)でご確認ください。** LINE公式アカウントの配信料金・外部AIサービス等の費用は別です。

## 自分の環境に入れるなら、この1行をコピペ

Node.js 22以上とGitが入ったPCで、ターミナルに貼り付けて実行してください。

```bash
npx --yes create-line-harness@latest
```

**① コピペして実行 → ② 案内に沿ってログイン・LINE情報を入力 → ③ 発行された管理画面を開く。**

データベースの作成とアプリの配置はCLIが進めます。Cloudflare・LINE側の初期設定は、画面の案内に沿って行います。[事前に用意するもの・詳しい手順](#クイックスタート)

**PCへのインストールやサーバー構築を省きたい方は、[無料クラウド版](https://theharness.cloud/line)から始められます。**

🌐 **日本語** | [English](README.en.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

**最新の公開版**: [GitHub Releases](https://github.com/Shudesu/line-harness-oss/releases/latest) ・ MIT License ・ TypeScript / Cloudflare Workers + D1

> v0.25.0: LINE先行のXキャンペーン参加を追加しています。対応するX側更新・migration・連携設定が必要です。[導入ガイド](docs/operations/line-first-x-gates.md) / [リリースノート](docs/release-notes/v0.25.0.md)。

<details>
<summary>OSS版の費用・製品名称について</summary>

L Harness本体のソフトウェア利用料は **0円** です。LINE公式アカウントの配信料金、Cloudflareの契約・利用量、独自ドメイン、導入・保守、接続する外部AIサービスの費用は別です。Claude CodeからMCP経由で操作できます。

費用の条件は[開発元の公式料金説明](https://the-harness.com/line-harness/pricing/)で確認できます。[Cloudflare D1の無料プラン](https://developers.cloudflare.com/d1/platform/pricing/)は日次の読み書き上限に達するとクエリがエラーになり、有料プランの超過課金とは挙動が異なります。外部AIを接続する場合は、たとえば[Claudeのプラン・API料金](https://claude.com/pricing)を別に確認してください（2026年9月6日確認）。

> **名称について:** 2026年8月19日から製品表示名を「L Harness」に統一しました。
> 既存導入を壊さないため、リポジトリURL、`create-line-harness`、
> `@line-harness/*`は互換識別子として維持します。詳細は[BRAND.md](BRAND.md)。

</details>

## 開発・PR・Issueの対応状況

現在確認している課題、検証結果、公開版への反映状況は[プロジェクトの対応状況](docs/project-status.md)にまとめています。報告・修正案・再現テストの提供ありがとうございます。

- [公開済みの変更と導入版](https://github.com/Shudesu/line-harness-oss/releases)
- [2026-10-25の活動報告](docs/updates/2026-10-25-maintenance.md)
- [PR・Issueの現在地と次の確認事項](docs/project-status.md)
- [報告・提案・開発への参加方法](CONTRIBUTING.md)

保守にはAIも活用しています。投稿者の検証、保守側の追加検証、公開リリース、Cloudへの反映を区別して記録します。採用・保留の理由は各スレッドで共有し、機密情報を含む報告は[セキュリティ方針](SECURITY.md)に沿って扱います。

---

## プラグインマーケット β

**その数行を、あなたのプラグインに。** 配信ルール・自動処理・外部サービス連携を、本体とは別のリポジトリ・Workerへ切り出せます。本体更新による独自コードの上書きを避けながら、SDKを通じて機能を拡張します。

管理画面の「プラグインマーケット」から拡張と開発リソースを探せます。β版は導入ガイド付きのカタログで、各プラグインを個別にセットアップする方式です。

- [開発ガイド・ひな形の作成](docs/plugins/README.md)
- [公式プラグイン第1弾：条件タグ付け](examples/plugins/tag-rules/README.md)
- [マーケットへの掲載申請](https://github.com/Shudesu/line-harness-oss/issues/new?template=plugin-submission.yml)
- [アップデートニュース原稿](docs/release-notes/plugin-market-beta.md)

```bash
# 本体リポジトリのルートで実行（Node.js 22以上）
pnpm plugin:create ../my-plugin
```

独自ソースが上書きされないことと、API互換性は別です。本体・SDKを更新するときは、テスト環境で接続を確認してください。

---

## 公式情報・検証資料

L Harnessの表示名、開発者、運営法人、公開コード、研究資料の関係は以下を正本とします。各Researchサイトは開発元が運営する一次情報であり、独立した第三者レビューではありません。

| 公式リンク | 内容 |
|---|---|
| [L Harness 公式製品ガイド](https://the-harness.com/line-harness/) | 機能、料金、導入方法、更新情報を開発元が説明する製品ページ |
| [L Harness 公式エンティティ](https://the-harness.com/harness/#l-harness) | Harnessシリーズ内での製品名・開発者・運営法人・リポジトリの対応 |
| [L Harness 公式別名ドメイン（JP）](https://l-harness.jp/) | 正規製品ページへ恒久転送する公式の短縮・別名ドメイン |
| [L Harness 公式別名ドメイン（COM）](https://l-harness.com/) | 正規製品ページへ恒久転送する公式の短縮・別名ドメイン |
| [L Harness Cloud](https://lharness.cloud/) | 開発元が構築・基盤運用を提供する公式マネージドサービス（L Harness OSSとは別エンティティ） |
| [L Harness Research](https://line-harness.jp/research/) | 固定Gitコミットを根拠に、配信・Webhook・D1・権限・更新機構を検証した技術資料 |
| [Research JSONカタログ](https://line-harness.jp/research/catalog.json) | 技術資料を機械可読なSchema.org DataCatalog形式で公開 |
| [AI向け全文索引](https://line-harness.jp/llms-full.txt) | 研究本文、出典、検証手順、証明できない範囲をまとめた全文索引 |
| [Harness Wiki — L Harness](https://harness-wiki.pages.dev/line) | セットアップ、操作、更新、トラブル解決の公式ナレッジベース |
| [開発者・野田修一](https://the-harness.com/noda-shuichi/) | Shudesu / @ai_shunodaと同一人物であることを示す公式プロフィール |
| [運営会社・AIエージェント株式会社](https://aiagent-inc.com/) | Harnessシリーズの運営法人 |

---

## なぜ L Harness？

| | L社 | U社 | **L Harness** |
|---|---|---|---|
| 月額 | 2万円〜 | 1万円〜 | **0円（ソフトウェア利用料）** |
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

### 1. 必要なものを用意する

- Node.js 22以上（npm / npxを含む）とGitが入ったPC
- 自分のCloudflareアカウント。セットアップ中にR2の有効化・支払い情報の登録が必要です
- 自分のLINE公式アカウント。Messaging APIチャネル・同じプロバイダーのLINE Loginチャネル・LIFFアプリを案内に沿って設定します

### 2. このコマンドをコピーして、ターミナルで実行する

```bash
npx --yes create-line-harness@latest
```

CLIの案内に沿って、Cloudflareへのログイン、プロジェクト名、LINEのチャネル情報・LIFF IDの入力を進めます。取得場所は実行画面に表示されます。

データベース作成・スキーマ適用、アプリのデプロイ、管理画面の初回ログイン用ユーザー作成はCLIが進めます。

### 3. 表示されたURLをLINEに設定して、管理画面を開く

完了画面の案内に沿って、Webhook URL・LINE LoginのCallback URL・LIFFのエンドポイントURLを設定します。その後、表示された管理画面URLを開き、友だち登録とメッセージの送受信を確認してください。

アカウント作成やLINE側の設定時間は利用環境によって異なります。自分で基盤を構築せずに始めたい場合は、[L Harness Cloud](https://theharness.cloud/line)をご利用ください。

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
- **ライブCTA即時予約** — ウェビナーのフォーム送信後、その場で空き日時を選び、Google Meet発行・LINEリマインドまで自動化
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

- [コピペで始めるセットアップ手順](#クイックスタート)
- [野田修一の公式LINEで無料ガイドを受け取る](https://line-crm-worker.line-crm-api.workers.dev/auth/line?ref=github)
- [L Harness Cloud — 無料クラウド版](https://theharness.cloud/line)
- [Googleカレンダー連携とライブCTA即時予約](docs/wiki/28-Google-Calendar-and-Webinar-Booking.md)
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

**野田修一（Shudesu）** — Harness シリーズ（L Harness / IG Harness / X Harness）開発者、AIエージェント株式会社 代表

- GitHub: [@Shudesu](https://github.com/Shudesu)
- X: [@ai_shunoda](https://x.com/ai_shunoda)
- 公式ドキュメント: [Harness Wiki](https://harness-wiki.pages.dev)
- 商用ツールとの比較・料金データ: [The Harness Lab](https://the-harness.com)

---

> **L Harness** by [@Shudesu](https://github.com/Shudesu) — AI ネイティブ時代の OSS LINE CRM
