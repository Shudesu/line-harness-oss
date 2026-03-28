# 21. デプロイメント

LINE Harness のローカル開発、本番デプロイ、CI/CD の完全ガイド。

---

## プロジェクト構成

```
line-harness/
├── apps/
│   ├── worker/        # Cloudflare Workers API サーバー + LIFF フロントエンド
│   └── web/           # Next.js 管理パネル
├── packages/
│   ├── db/            # D1 データベースクエリ + schema.sql
│   ├── sdk/           # @line-harness/sdk (TypeScript SDK)
│   ├── line-sdk/      # LINE Messaging API クライアント
│   └── shared/        # 共有型定義
├── pnpm-workspace.yaml
└── package.json
```

パッケージマネージャー: **pnpm 9.15.4**
Node.js: **>= 20**

---

## ローカル開発セットアップ

### 前提条件

- Node.js >= 20
- pnpm >= 9
- Cloudflare アカウント
- LINE Developers アカウント

### 初期セットアップ

```bash
# リポジトリクローン
git clone https://github.com/your-org/line-harness.git
cd line-harness

# 依存インストール
pnpm install

# パッケージビルド
pnpm -r build

# ローカル D1 データベース作成 + マイグレーション
pnpm db:migrate:local
```

### Worker 開発サーバー

```bash
pnpm dev:worker
# => wrangler dev (http://localhost:8787)
```

ローカルでは `.dev.vars` ファイルに環境変数を設定:

```ini
# apps/worker/.dev.vars
LINE_CHANNEL_SECRET=your-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=your-channel-access-token
API_KEY=dev-api-key
LIFF_URL=https://liff.line.me/YOUR_LIFF_ID
LINE_CHANNEL_ID=your-channel-id
LINE_LOGIN_CHANNEL_ID=your-login-channel-id
LINE_LOGIN_CHANNEL_SECRET=your-login-channel-secret
```

### 管理パネル開発

```bash
pnpm dev:web
# => next dev (http://localhost:3000)
```

`apps/web/src/lib/api.ts` でAPI URLを設定。

---

## Cloudflare Workers デプロイ

### 手動デプロイ

```bash
# 1. パッケージビルド
pnpm -r build

# 2. Worker デプロイ
pnpm deploy:worker
# => wrangler deploy (apps/worker/)
```

### wrangler.toml 設定

```toml
name = "line-crm-worker"
main = "src/index.ts"
compatibility_date = "2024-12-01"
workers_dev = true

[[d1_databases]]
binding = "DB"
database_name = "line-crm"
database_id = "YOUR_D1_DATABASE_ID"

[triggers]
crons = ["*/5 * * * *"]
```

- `workers_dev = true` で `*.workers.dev` サブドメインが自動割当
- cron は 5分毎に実行 (ステップ配信、予約配信、リマインダー、ヘルスチェック)

### シークレット設定

**絶対に wrangler.toml にシークレットを書かないこと。**

```bash
wrangler secret put API_KEY
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler secret put LINE_CHANNEL_ID
wrangler secret put LINE_LOGIN_CHANNEL_ID
wrangler secret put LINE_LOGIN_CHANNEL_SECRET
wrangler secret put LIFF_URL

# オプション
wrangler secret put STRIPE_WEBHOOK_SECRET
```

---

## GitHub Actions 自動デプロイ

`.github/workflows/deploy-worker.yml` に設定済み。

### トリガー条件

`main` ブランチへの push で、以下のパスに変更がある場合に実行:
- `apps/worker/**`
- `packages/db/**`
- `packages/shared/**`
- `packages/line-sdk/**`
- `.github/workflows/deploy-worker.yml`

### ワークフロー内容

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @line-crm/shared --filter @line-crm/line-sdk --filter @line-crm/db build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/worker
          command: deploy
```

### 必要な GitHub Secrets

| シークレット名 | 取得方法 |
|--------------|----------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard > My Profile > API Tokens > Create Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard > Workers > Account ID |

---

## 管理パネル デプロイ (Cloudflare Pages)

```bash
# 1. ビルド
pnpm deploy:web
# => next build (apps/web/)

# 2. Cloudflare Pages にデプロイ
# Dashboard から GitHub リポジトリを接続、または:
wrangler pages deploy apps/web/.next --project-name=line-crm-admin
```

### Pages 設定

- ビルドコマンド: `pnpm install && pnpm -r build && pnpm --filter web build`
- 出力ディレクトリ: `apps/web/.next`
- Node.js バージョン: 22

---

## LIFF（Worker 統合）

LIFF フロントエンドは Worker に統合されています。`@cloudflare/vite-plugin` により `wrangler deploy` 時に Vite ビルドも自動実行され、Workers Static Assets として配信されます。

別途の LIFF デプロイは不要です。Worker をデプロイするだけで LIFF も一緒にデプロイされます。

### LIFF ビルド時環境変数

Worker デプロイ時に以下の環境変数が必要です（`.env` または環境変数で指定）:

| 変数名 | 説明 |
|--------|------|
| `VITE_LIFF_ID` | LIFF ID（例: `2009554425-4IMBmLQ9`） |
| `VITE_BOT_BASIC_ID` | Bot Basic ID（例: `@123abcde`） |

### LIFF エンドポイント URL

LIFF エンドポイント URL は Worker URL と同じです:
```
https://line-harness.your-account.workers.dev
```

---

## D1 データベースマイグレーション

### リモート (本番)

```bash
pnpm db:migrate
# => wrangler d1 execute line-crm --file=packages/db/schema.sql
```

### ローカル

```bash
pnpm db:migrate:local
# => wrangler d1 execute line-crm --file=packages/db/schema.sql --local
```

スキーマは `CREATE TABLE IF NOT EXISTS` を使用しているため、冪等に実行可能。既存テーブルはスキップされる。

### D1 データベース作成 (初回のみ)

```bash
wrangler d1 create line-crm
# => database_id が出力される → wrangler.toml に記入
```

---

## 環境変数チェックリスト

### Worker (必須)

| 変数名 | 説明 | 設定方法 |
|--------|------|----------|
| `DB` | D1 バインディング | wrangler.toml |
| `API_KEY` | REST API 認証キー | `wrangler secret put` |
| `LINE_CHANNEL_SECRET` | Messaging API チャネルシークレット | `wrangler secret put` |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API アクセストークン | `wrangler secret put` |
| `LIFF_URL` | LIFF アプリ URL | `wrangler secret put` |
| `LINE_CHANNEL_ID` | Messaging API チャネルID | `wrangler secret put` |
| `LINE_LOGIN_CHANNEL_ID` | LINE Login チャネルID | `wrangler secret put` |
| `LINE_LOGIN_CHANNEL_SECRET` | LINE Login チャネルシークレット | `wrangler secret put` |

### Worker (オプション)

| 変数名 | 説明 | 設定方法 |
|--------|------|----------|
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook 署名検証キー | `wrangler secret put` |

---

## DNS / ドメイン設定

### workers.dev サブドメイン (デフォルト)

`workers_dev = true` の場合、自動的に割り当てられる:
```
https://line-crm-worker.{account}.workers.dev
```

### カスタムドメイン

1. Cloudflare Dashboard > Workers > Custom Domains
2. ドメインを追加
3. DNS レコードが自動設定される

または wrangler.toml:
```toml
routes = [
  { pattern = "api.yourdomain.com", custom_domain = true }
]
```

### LINE Webhook URL 設定

LINE Developers Console > Messaging API > Webhook URL:
```
https://line-crm-worker.line-crm-api.workers.dev/webhook
```

---

## コスト概算

### Cloudflare Workers Free Tier

| リソース | 無料枠 | 説明 |
|---------|--------|------|
| リクエスト | 100,000/日 | Worker 呼び出し数 |
| D1 読み取り | 5,000,000/日 | DB クエリ数 |
| D1 書き込み | 100,000/日 | DB 変更数 |
| D1 ストレージ | 5GB | DB サイズ |
| Cron | 無制限 | 5分毎の定期実行 |

### 有料 (Workers Paid / $5/月)

| リソース | 有料枠 |
|---------|--------|
| リクエスト | 10,000,000/月 (以降 $0.30/100万) |
| D1 読み取り | 25,000,000,000/月 |
| D1 書き込み | 50,000,000/月 |
| D1 ストレージ | 5GB (以降 $0.75/GB) |

### LINE Messaging API

| プラン | 無料メッセージ | 追加メッセージ |
|--------|-------------|-------------|
| コミュニケーション | 200/月 | 不可 |
| ライト | 5,000/月 | 不可 |
| スタンダード | 30,000/月 | ~3円/通 |

### 目安

- 友だち 1,000 人以下: Cloudflare 無料枠 + LINE スタンダードで月額 ~15,000 円
- 友だち 10,000 人以下: Cloudflare $5/月 + LINE スタンダード
- L社/U社 の月額 30,000円〜と比較して大幅にコスト削減可能

---

## デプロイ後の確認

```bash
# API ヘルスチェック
curl https://line-crm-worker.line-crm-api.workers.dev/openapi.json

# 認証テスト
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://line-crm-worker.line-crm-api.workers.dev/api/friends/count

# Swagger UI
open https://line-crm-worker.line-crm-api.workers.dev/docs
```

---

## 既存環境のマイグレーション（LIFF 統合）

LIFF フロントエンドが Worker に統合されました。
別途デプロイしていた LIFF アプリ（CF Pages 等）は不要になります。

### 手順

1. **リポジトリを最新に更新**

```bash
git pull origin main && pnpm install
```

2. **Worker を再デプロイ（LIFF も自動ビルド・配信）**

```bash
VITE_LIFF_ID=xxx VITE_BOT_BASIC_ID=@xxx pnpm deploy:worker
```

3. **LINE Developers Console で LIFF エンドポイント URL を変更**
   - LINE Login チャネル → LIFF タブ → エンドポイント URL
   - 旧: `https://lh-liff-xxxxx.pages.dev`
   - 新: `https://line-harness.your-account.workers.dev`

4. **(任意) 旧 LIFF の CF Pages プロジェクトを削除**

```bash
npx wrangler pages project delete lh-liff-xxxxx
```
