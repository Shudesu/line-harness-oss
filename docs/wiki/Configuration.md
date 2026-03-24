# Configuration — LINE Harness 設定リファレンス

## wrangler.toml

Workers のデプロイ設定ファイル。パス: `apps/worker/wrangler.toml`

```toml
name = "line-crm-worker"
main = "src/index.ts"
compatibility_date = "2024-12-01"
workers_dev = true

# シークレットは wrangler secret put で設定
# ここにハードコードしない

[[d1_databases]]
binding = "DB"
database_name = "line-crm"
database_id = "YOUR_D1_DATABASE_ID"

[triggers]
crons = ["*/5 * * * *"]
```

### 各フィールドの説明

| フィールド | 値 | 説明 |
|-----------|-----|------|
| `name` | `line-crm-worker` | Workers の名前（デプロイ先URLに影響） |
| `main` | `src/index.ts` | エントリーポイント |
| `compatibility_date` | `2024-12-01` | Workers ランタイム互換日 |
| `workers_dev` | `true` | `*.workers.dev` サブドメインを有効化 |
| `binding` | `DB` | D1 バインディング名（コード内で `c.env.DB` としてアクセス） |
| `database_name` | `line-crm` | D1 データベース名 |
| `database_id` | UUID | `wrangler d1 create` で取得した ID |
| `crons` | `["*/5 * * * *"]` | 5分毎の Cron トリガー |

## 環境変数 / シークレット

### Workers シークレット（wrangler secret put）

| 変数名 | 必須 | 型 | 説明 | 例 |
|--------|------|-----|------|-----|
| `LINE_CHANNEL_SECRET` | 必須 | string | Messaging API チャネルシークレット | `abc123def456...` |
| `LINE_CHANNEL_ACCESS_TOKEN` | 必須 | string | Messaging API 長期アクセストークン | `eyJhbGciOi...` |
| `API_KEY` | 必須 | string | REST API 認証用 Bearer トークン | `sk-my-secret-key` |
| `LINE_CHANNEL_ID` | 任意 | string | Messaging API チャネルID | `1234567890` |
| `LIFF_URL` | 任意 | string | LIFF アプリ URL | `https://liff.line.me/12345-abcde` |
| `LINE_LOGIN_CHANNEL_ID` | 任意 | string | LINE Login チャネルID（UUID連携用） | `9876543210` |
| `LINE_LOGIN_CHANNEL_SECRET` | 任意 | string | LINE Login チャネルシークレット | `xyz789...` |

### シークレット設定コマンド

```bash
# 全シークレットを設定
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put API_KEY
npx wrangler secret put LINE_CHANNEL_ID
npx wrangler secret put LIFF_URL
npx wrangler secret put LINE_LOGIN_CHANNEL_ID
npx wrangler secret put LINE_LOGIN_CHANNEL_SECRET

# 設定済みシークレット一覧確認
npx wrangler secret list
```

### Env 型定義

```typescript
// apps/worker/src/index.ts
export type Env = {
  Bindings: {
    DB: D1Database;
    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    API_KEY: string;
    LIFF_URL: string;
    LINE_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_SECRET: string;
  };
};
```

### 管理画面の環境変数

Next.js 管理画面で必要な環境変数。Vercel / CF Pages のダッシュボードで設定:

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `NEXT_PUBLIC_API_URL` | Workers API URL | `https://line-crm-worker.line-crm-api.workers.dev` |
| `NEXT_PUBLIC_API_KEY` | API 認証キー（API_KEY と同値） | `sk-my-secret-key` |

## D1 データベースセットアップ

### 新規作成

```bash
# D1 作成
npx wrangler d1 create line-crm

# 出力される database_id を wrangler.toml に記入
```

### スキーマ適用

```bash
# 本番
npx wrangler d1 execute line-crm --file=packages/db/schema.sql

# ローカル開発
pnpm db:migrate:local
# = wrangler d1 execute line-crm --file=packages/db/schema.sql --local
```

### D1 ダッシュボード確認

```bash
# テーブル一覧確認
npx wrangler d1 execute line-crm --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

# レコード数確認
npx wrangler d1 execute line-crm --command="SELECT COUNT(*) FROM friends"
```

### D1 バインディング

Workers 内では `c.env.DB` として D1Database インスタンスにアクセス:

```typescript
const db = c.env.DB;
const result = await db.prepare('SELECT * FROM friends WHERE id = ?').bind(id).first();
```

## Cron トリガー

### 設定

`wrangler.toml` の `[triggers]` セクションで定義:

```toml
[triggers]
crons = ["*/5 * * * *"]
```

### Cron ハンドラ

5分毎に以下の4つの処理を `Promise.allSettled` で並列実行:

```typescript
// apps/worker/src/index.ts
async function scheduled(event, env, ctx) {
  const lineClient = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);
  await Promise.allSettled([
    processStepDeliveries(env.DB, lineClient),      // ステップ配信
    processScheduledBroadcasts(env.DB, lineClient),  // 予約配信
    processReminderDeliveries(env.DB, lineClient),   // リマインダー
    checkAccountHealth(env.DB),                       // ヘルスチェック
  ]);
}
```

### Cron 実行間隔の変更

```toml
# 1分毎（より即時的な配信が必要な場合）
crons = ["* * * * *"]

# 10分毎（コスト節約）
crons = ["*/10 * * * *"]

# 毎時0分（1時間毎）
crons = ["0 * * * *"]
```

注意: 間隔を変更すると `next_delivery_at` の精度に影響する。5分毎が推奨。

## CORS 設定

MVP では全オリジン許可:

```typescript
// apps/worker/src/index.ts
app.use('*', cors({ origin: '*' }));
```

本番環境では管理画面のドメインに制限することを推奨:

```typescript
app.use('*', cors({
  origin: ['https://line-crm-admin.pages.dev', 'https://your-domain.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));
```

## JST タイムゾーン標準化

### 設計方針

LINE Harness は全タイムスタンプを **JST (UTC+9)** で統一しています。理由:
- LINE公式アカウントの利用者は日本が大多数
- Cron 配信の時間計算で UTC 変換ミスを防ぐ
- D1 (SQLite) にはタイムゾーン機能がないため、アプリケーション層で統一

### フォーマット

```
YYYY-MM-DDTHH:mm:ss.sss+09:00
```

例: `2026-03-21T14:30:00.000+09:00`

### ユーティリティ関数

```typescript
// packages/db/src/utils.ts

// 現在時刻を JST 文字列で取得
jstNow(): string
// → "2026-03-23T15:30:00.000+09:00"

// Date オブジェクトを JST 文字列に変換
toJstString(date: Date): string

// 2つのタイムスタンプをエポック比較（Z と +09:00 混在対応）
isTimeBefore(a: string, b: string): boolean
```

### API レスポンスでの表示

全 API レスポンスの `createdAt`, `updatedAt`, `scheduledAt` 等は JST 形式:

```json
{
  "createdAt": "2026-03-21T10:30:00.000+09:00",
  "updatedAt": "2026-03-21T10:30:00.000+09:00"
}
```

### 予約配信の時刻指定

配信予約はJST文字列で指定:

```bash
curl -X POST https://line-crm-worker.line-crm-api.workers.dev/api/broadcasts \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "明日のお知らせ",
    "messageType": "text",
    "messageContent": "明日10時からセール開始！",
    "targetType": "all",
    "scheduledAt": "2026-03-24T10:00:00.000+09:00"
  }'
```

## 認証が不要なパス一覧

以下のパスは `authMiddleware` で認証をスキップします:

| パス | 理由 |
|------|------|
| `/webhook` | LINE Webhook署名検証で保護 |
| `/docs` | OpenAPI ドキュメント（公開） |
| `/openapi.json` | OpenAPI 仕様（公開） |
| `/api/affiliates/click` | クリックトラッキング（匿名アクセス可） |
| `/t/*` | トラッキングリンクリダイレクト |
| `/api/liff/*` | LIFF IDトークン認証 |
| `/auth/*` | LINE Login フロー |
| `/api/integrations/stripe/webhook` | Stripe Webhook 署名検証 |
| `/api/webhooks/incoming/*/receive` | 受信Webhook（個別シークレット検証） |
| `/api/forms/*/submit` | フォーム送信（LIFFから） |
| `/api/forms/*` (GET) | フォーム定義取得（LIFF表示用） |

## ローカル開発設定

### Workers ローカル起動

```bash
pnpm dev:worker
# → http://localhost:8787
# D1 はローカルモード（.wrangler/state/ に SQLite ファイル）
```

### 管理画面ローカル起動

```bash
pnpm dev:web
# → http://localhost:3001
# NEXT_PUBLIC_API_URL=http://localhost:8787 に設定
```

### ローカル Webhook テスト

ngrok 等で localhost をトンネル:

```bash
ngrok http 8787
# → https://xxxx.ngrok.io
# LINE Console で Webhook URL を https://xxxx.ngrok.io/webhook に設定
```

## npm スクリプト一覧

```bash
pnpm dev:worker          # Workers ローカル起動
pnpm dev:web             # 管理画面ローカル起動
pnpm build               # 全パッケージビルド
pnpm deploy:worker       # Workers デプロイ
pnpm deploy:web          # 管理画面ビルド
pnpm db:migrate          # 本番D1にスキーマ適用
pnpm db:migrate:local    # ローカルD1にスキーマ適用
```
