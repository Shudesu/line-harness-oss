# LINE Harness

**LINE公式アカウントの完全オープンソース CRM。L-step / Utage の無料代替。**

Claude Code から自然言語で全操作できる、AI ネイティブ設計。

```
> 「来週セミナー参加者に3日前と前日にリマインド送って」
> 「友だち全員に明日10時にセール告知して」
> 「フォーム作って申込者にVIPタグつけてフォローシナリオ開始して」
```

管理画面を開く必要なし。

**[LINE で体験する](https://line-crm-worker.line-crm-api.workers.dev/auth/line?ref=github)** — 友だち追加するだけで、ステップ配信・フォーム・自動返信を実際に体験できます。

---

## なぜ LINE Harness？

| | L-step | Utage | **LINE Harness** |
|---|---|---|---|
| 月額 | 2万円〜 | 1万円〜 | **0円** |
| ステップ配信 | ✅ | ✅ | ✅ |
| セグメント配信 | ✅ | ✅ | ✅ |
| リッチメニュー切替 | ✅ | ✅ | ✅ |
| フォーム | ✅ | ✅ | ✅ |
| スコアリング | ✅ | ❌ | ✅ |
| IF-THEN 自動化 | 一部 | 一部 | ✅ |
| API 公開 | ❌ | ❌ | **全機能** |
| AI (Claude Code) 対応 | ❌ | ❌ | **✅** |
| BAN 検知 & 自動移行 | ❌ | ❌ | **✅** |
| マルチアカウント | 別契約 | 別契約 | **標準搭載** |
| ソースコード | 非公開 | 非公開 | **MIT** |

---

## 全機能一覧

### 配信
- **ステップ配信** — delay_minutes で分単位制御、条件分岐、ステルスモード
- **即時配信** — ブロードキャスト即時送信、個別メッセージ即時送信
- **ブロードキャスト** — 全員/タグ/セグメント配信、即時 or 予約配信、バッチ送信
- **リマインダー** — 指定日からのカウントダウン配信（セミナー3日前、1日前、当日）
- **テンプレート** — メッセージテンプレートの管理・再利用
- **テンプレート変数** — `{{name}}`, `{{uid}}`, `{{auth_url:CHANNEL_ID}}` で友だちごとにパーソナライズ
- **配信時間帯制御** — 9:00-23:00 JST のみ配信、ユーザー別の好み時間設定

### CRM
- **友だち管理** — Webhook 自動登録、プロフィール取得、カスタムメタデータ
- **タグ** — セグメント分け、配信条件、シナリオトリガー
- **スコアリング** — 行動ベースのリードスコア自動計算
- **オペレーターチャット** — 管理画面から直接 LINE 返信

### マーケティング
- **リッチメニュー** — ユーザー別・タグ別のメニュー切替
- **トラッキングリンク** — クリック計測 + 自動タグ付け + シナリオ開始
- **フォーム (LIFF)** — LINE 内で完結するフォーム、回答→メタデータ自動保存
- **カレンダー予約** — Google Calendar 連携の予約システム (LIFF)

### 自動化
- **IF-THEN ルール** — 7種のトリガー × 6種のアクション
- **自動返信** — キーワードマッチ（完全一致/部分一致）
- **Webhook IN/OUT** — 外部サービス連携（Stripe, Slack 等）
- **通知ルール** — 条件付きアラート配信

### 安全性
- **BAN 検知** — アカウントヘルスの自動監視（normal/warning/danger）
- **アカウント移行** — BAN 時のワンクリック移行（友だち・タグ・シナリオ引き継ぎ）
- **ステルスモード** — 送信ジッター、バッチ間隔ランダム化
- **マルチアカウント** — 1 Worker で複数アカウント管理、Webhook 署名で自動ルーティング
- **クロスプロバイダー UUID 統合** — `?uid=` パラメータで別プロバイダー間の同一人物を自動リンク
- **管理画面アカウント切替** — サイドバーでアカウント切替、全ページがアカウント別にフィルタ

### 分析
- **CV 計測** — コンバージョンポイント定義 → イベント記録 → レポート
- **アフィリエイト** — コード発行、クリック追跡、報酬計算
- **流入元追跡** — `/auth/line?ref=xxx` で友だち追加経路を自動記録

---

## 技術スタック

```
LINE Platform ──→ Cloudflare Workers (Hono) ──→ D1 (SQLite)
                         ↑                          ↑
                   Cron (5分毎)              42 テーブル
                         ↓
                  LINE Messaging API

Next.js 15 (管理画面) ──→ Workers API ──→ D1
LIFF (Vite) ──→ Workers API ──→ D1
TypeScript SDK ──→ Workers API ──→ D1
Claude Code ──→ Workers API ──→ D1
```

| レイヤー | 技術 |
|---------|------|
| API / Webhook | Cloudflare Workers + Hono |
| データベース | Cloudflare D1 (SQLite) — 42 テーブル |
| 管理画面 | Next.js 15 (App Router) + Tailwind CSS |
| LIFF | Vite + TypeScript |
| SDK | TypeScript (ESM + CJS, 41 テスト) |
| 定期実行 | Workers Cron Triggers (5分毎) |
| CI/CD | GitHub Actions → 自動デプロイ |

**Cloudflare 無料枠で 5,000 友だちまで運用可能。サーバー代 0 円。**

---

## クイックスタート

### 前提条件

- Node.js 20+, pnpm 9+
- [Cloudflare アカウント](https://dash.cloudflare.com/sign-up)
- [LINE Developers アカウント](https://developers.line.biz/)

### 1. セットアップ

```bash
git clone https://github.com/Shudesu/line-harness-oss.git
cd line-harness-oss
pnpm install
```

### 2. LINE チャネル設定

[LINE Developers Console](https://developers.line.biz/console/) で **2つのチャネル** を作成:

1. **Messaging API チャネル** — メッセージ送受信用
2. **LINE Login チャネル** — UUID 自動取得用（**必須**）

> ⚠️ LINE Login チャネルがないと `/auth/line` 経由の友だち追加で UUID が取れません。
> UUID がないとマルチアカウント統合・流入追跡が機能しません。

### 3. D1 データベース作成

```bash
npx wrangler d1 create line-crm
# → 出力される database_id を apps/worker/wrangler.toml に記入

npx wrangler d1 execute line-crm --file=packages/db/schema.sql
```

### 4. シークレット設定

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put API_KEY
npx wrangler secret put LINE_LOGIN_CHANNEL_ID
npx wrangler secret put LINE_LOGIN_CHANNEL_SECRET
```

### 5. デプロイ

```bash
pnpm deploy:worker
# → https://your-worker.your-subdomain.workers.dev
```

### 6. LINE Webhook 設定

LINE Developers Console → Messaging API → Webhook URL:
```
https://your-worker.your-subdomain.workers.dev/webhook
```

### 7. 動作確認

```bash
# 友だち追加URL（これを LP や SNS に貼る）
https://your-worker.your-subdomain.workers.dev/auth/line?ref=test

# API 疎通確認
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-worker.your-subdomain.workers.dev/api/friends/count
```

---

## プロジェクト構成

```
line-harness-oss/
├── apps/
│   ├── worker/           # Cloudflare Workers API (Hono)
│   ├── web/              # Next.js 15 管理画面
│   └── liff/             # LINE ミニアプリ (Vite)
├── packages/
│   ├── db/               # D1 スキーマ + クエリ (42テーブル)
│   ├── sdk/              # TypeScript SDK (41テスト)
│   ├── line-sdk/         # LINE Messaging API ラッパー
│   └── shared/           # 共有型定義
├── docs/
│   └── wiki/             # 全23ページのドキュメント
└── .github/
    └── workflows/        # GitHub Actions 自動デプロイ
```

---

## API エンドポイント（抜粋）

25 のルートファイル、100+ エンドポイント。全一覧は [Wiki: API Reference](https://github.com/Shudesu/line-harness-oss/wiki/20-API-Reference) を参照。

```bash
# 友だち一覧
GET  /api/friends?limit=20&offset=0&tagId=xxx

# シナリオ作成
POST /api/scenarios
{ "name": "ウェルカム", "triggerType": "friend_add" }

# ステップ追加
POST /api/scenarios/:id/steps
{ "stepOrder": 0, "delayMinutes": 0, "messageType": "text", "messageContent": "ようこそ！" }

# ブロードキャスト予約
POST /api/broadcasts
{ "title": "セール", "messageType": "text", "messageContent": "50% OFF!", "targetType": "all", "scheduledAt": "2026-04-01T10:00:00+09:00" }

# 自動化ルール作成
POST /api/automations
{ "name": "友だち追加→ウェルカム", "eventType": "friend_add", "actions": [{"type": "add_tag", "params": {"tagId": "xxx"}}] }
```

---

## ドキュメント

**[📖 Wiki（全23ページ）](https://github.com/Shudesu/line-harness-oss/wiki)**

| カテゴリ | ページ |
|---------|--------|
| はじめに | [Home](https://github.com/Shudesu/line-harness-oss/wiki/Home) · [Getting Started](https://github.com/Shudesu/line-harness-oss/wiki/Getting-Started) · [Architecture](https://github.com/Shudesu/line-harness-oss/wiki/Architecture) · [Configuration](https://github.com/Shudesu/line-harness-oss/wiki/Configuration) |
| 配信 | [Scenarios](https://github.com/Shudesu/line-harness-oss/wiki/Scenarios) · [Broadcasts](https://github.com/Shudesu/line-harness-oss/wiki/Broadcasts) · [Reminders](https://github.com/Shudesu/line-harness-oss/wiki/12-Reminders) |
| CRM | [Friends](https://github.com/Shudesu/line-harness-oss/wiki/Friends) · [Tags](https://github.com/Shudesu/line-harness-oss/wiki/Tags) · [Scoring](https://github.com/Shudesu/line-harness-oss/wiki/13-Scoring) · [Chat](https://github.com/Shudesu/line-harness-oss/wiki/16-Chat-and-AutoReply) |
| マーケ | [Rich Menus](https://github.com/Shudesu/line-harness-oss/wiki/09-Rich-Menus) · [Tracked Links](https://github.com/Shudesu/line-harness-oss/wiki/10-Tracked-Links) · [Forms & LIFF](https://github.com/Shudesu/line-harness-oss/wiki/11-Forms-and-LIFF) · [CV & Affiliates](https://github.com/Shudesu/line-harness-oss/wiki/17-CV-Tracking-and-Affiliates) |
| 自動化 | [Automation](https://github.com/Shudesu/line-harness-oss/wiki/14-Automation) · [Webhooks](https://github.com/Shudesu/line-harness-oss/wiki/15-Webhooks-and-Notifications) |
| 安全性 | [Multi-Account & BAN](https://github.com/Shudesu/line-harness-oss/wiki/18-Multi-Account-and-BAN) |
| 開発 | [SDK Reference](https://github.com/Shudesu/line-harness-oss/wiki/19-SDK-Reference) · [API Reference](https://github.com/Shudesu/line-harness-oss/wiki/20-API-Reference) · [Deployment](https://github.com/Shudesu/line-harness-oss/wiki/21-Deployment) · [Operations](https://github.com/Shudesu/line-harness-oss/wiki/22-Operations) · [Claude Code](https://github.com/Shudesu/line-harness-oss/wiki/23-Claude-Code-Integration) |

---

## コスト

| 友だち数 | 月額コスト |
|----------|-----------|
| 〜5,000 | **無料**（Cloudflare 無料枠） |
| 〜10,000 | 約 $10/月（D1 + Workers 有料プラン） |
| 50,000+ | 約 $25/月 + Queues 推奨 |

L-step: 月額 21,780円〜。LINE Harness: **0円〜。**

---

## ローカル開発

```bash
pnpm dev:worker    # → http://localhost:8787
pnpm dev:web       # → http://localhost:3001
pnpm db:migrate:local
```

---

## コントリビュート

Issue・PR 歓迎。[Wiki](https://github.com/Shudesu/line-harness-oss/wiki) を読んでからの参加を推奨。

---

## ライセンス

MIT
