# LINE OSS CRM

LINE公式アカウント向けオープンソースCRM / マーケティングオートメーションツール。
L-step や Utage の代替として、無料（または低コスト）で運用できます。

## 機能

- **友だち管理** — Webhook で自動登録、タグ付け、セグメント分け
- **ステップ配信** — シナリオ作成、遅延配信、友だち追加/タグトリガー
- **一斉配信** — 全員またはタグ絞り込み、予約配信
- **自動応答** — キーワードマッチによる自動返信
- **管理画面** — Next.js ダッシュボードで直感的に操作

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| API / Webhook | Cloudflare Workers + Hono |
| データベース | Cloudflare D1 (SQLite) |
| 定期実行 | Workers Cron Triggers (5分毎) |
| 管理画面 | Next.js 15 (App Router) + Tailwind CSS |
| LINE連携 | LINE Messaging API (自作型付きSDK) |

## アーキテクチャ

```
LINE Platform → CF Workers (webhook) → D1
                                      ↓
Vercel (Admin UI) → CF Workers (API) → D1
                                      ↓
CF Cron Trigger → Workers → LINE Messaging API
```

## 5分デプロイガイド

### 前提条件

- Node.js 20+
- pnpm 9+
- [Cloudflare アカウント](https://dash.cloudflare.com/sign-up)
- [LINE Developers アカウント](https://developers.line.biz/)

### 1. LINE チャネル設定

1. [LINE Developers Console](https://developers.line.biz/console/) でプロバイダーを作成
2. Messaging API チャネルを作成
3. 以下を控えておく:
   - **チャネルシークレット** (Basic settings)
   - **チャネルアクセストークン** (Messaging API → Issue)

### 2. リポジトリのセットアップ

```bash
git clone https://github.com/your-org/line-oss-crm.git
cd line-oss-crm
cp .env.example .env
# .env を編集して LINE の認証情報を入力
pnpm install
```

### 3. Cloudflare D1 データベース作成

```bash
# D1 データベースを作成
npx wrangler d1 create line-crm

# 出力される database_id を apps/worker/wrangler.toml に記入
# [[d1_databases]] の database_id = "ここに貼り付け"

# スキーマを適用
npx wrangler d1 execute line-crm --file=packages/db/schema.sql
```

### 4. Workers のシークレット設定

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
# → LINE チャネルシークレットを入力

npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
# → LINE チャネルアクセストークンを入力

npx wrangler secret put API_KEY
# → 管理画面用の任意のAPIキーを入力
```

### 5. Workers デプロイ

```bash
pnpm deploy:worker
# デプロイ後に表示される URL を控える
# 例: https://line-crm-worker.your-subdomain.workers.dev
```

### 6. LINE Webhook 設定

1. LINE Developers Console → チャネル → Messaging API
2. Webhook URL: `https://line-crm-worker.your-subdomain.workers.dev/webhook`
3. Webhook を有効化
4. 「検証」ボタンで接続テスト

### 7. 管理画面デプロイ (Vercel)

```bash
cd apps/web

# 環境変数を設定
# NEXT_PUBLIC_API_URL=https://line-crm-worker.your-subdomain.workers.dev
# NEXT_PUBLIC_API_KEY=上で設定したAPIキー

vercel deploy
```

または Vercel ダッシュボードからインポート:
1. リポジトリを接続
2. Root Directory: `apps/web`
3. 環境変数を設定
4. デプロイ

### 8. 動作確認

1. LINE公式アカウントを友だち追加
2. 管理画面で友だちが表示されることを確認
3. テストメッセージを送信

## ローカル開発

```bash
# Workers (ローカル)
pnpm dev:worker
# → http://localhost:8787

# 管理画面 (ローカル)
pnpm dev:web
# → http://localhost:3001

# ローカル D1 にスキーマ適用
pnpm db:migrate:local
```

## プロジェクト構成

```
line-oss-crm/
├── apps/
│   ├── web/              # Next.js 管理画面
│   └── worker/           # Cloudflare Workers API
├── packages/
│   ├── db/               # D1 スキーマ & クエリ
│   ├── line-sdk/         # LINE Messaging API ラッパー
│   └── shared/           # 共有型定義
├── wrangler.toml
└── package.json
```

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/webhook` | LINE Webhook |
| GET | `/api/friends` | 友だち一覧 |
| GET | `/api/friends/:id` | 友だち詳細 |
| GET | `/api/friends/count` | 友だち数 |
| POST | `/api/friends/:id/tags` | タグ追加 |
| DELETE | `/api/friends/:id/tags/:tagId` | タグ削除 |
| GET | `/api/tags` | タグ一覧 |
| POST | `/api/tags` | タグ作成 |
| DELETE | `/api/tags/:id` | タグ削除 |
| GET | `/api/scenarios` | シナリオ一覧 |
| GET | `/api/scenarios/:id` | シナリオ詳細 |
| POST | `/api/scenarios` | シナリオ作成 |
| PUT | `/api/scenarios/:id` | シナリオ更新 |
| DELETE | `/api/scenarios/:id` | シナリオ削除 |
| POST | `/api/scenarios/:id/steps` | ステップ追加 |
| PUT | `/api/scenarios/:id/steps/:stepId` | ステップ更新 |
| DELETE | `/api/scenarios/:id/steps/:stepId` | ステップ削除 |
| GET | `/api/broadcasts` | 配信一覧 |
| POST | `/api/broadcasts` | 配信作成 |
| PUT | `/api/broadcasts/:id` | 配信更新 |
| DELETE | `/api/broadcasts/:id` | 配信削除 |
| POST | `/api/broadcasts/:id/send` | 配信実行 |

## スケーリング

| 友だち数 | コスト目安 |
|----------|-----------|
| ~5,000 | 無料 |
| ~10,000 | D1: $0.75/100万読取, Workers: $5/月 |
| 50,000+ | Queues追加で配信レート制御推奨 |

## ライセンス

MIT
