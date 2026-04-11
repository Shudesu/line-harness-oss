# Getting Started — LINE Harness 初期セットアップガイド

## 前提条件

| 要件 | バージョン | 備考 |
|------|-----------|------|
| Node.js | 20+ | `node -v` で確認 |
| pnpm | 9+ | `npm install -g pnpm` でインストール |
| Cloudflare アカウント | — | [サインアップ](https://dash.cloudflare.com/sign-up) |
| LINE Developers アカウント | — | [登録](https://developers.line.biz/) |
| Wrangler CLI | 最新 | `npm install -g wrangler` |

## 1. LINE Developers Console セットアップ

### 1.1 Messaging API チャネル作成

1. [LINE Developers Console](https://developers.line.biz/console/) にログイン
2. プロバイダーを作成（なければ新規作成）
3. 「Messaging API」チャネルを作成
4. 以下の値を控える:

| 項目 | 場所 | 環境変数 |
|------|------|---------|
| チャネルシークレット | Basic settings | `LINE_CHANNEL_SECRET` |
| チャネルアクセストークン | Messaging API → Issue | `LINE_CHANNEL_ACCESS_TOKEN` |
| チャネルID | Basic settings | `LINE_CHANNEL_ID` |

### 1.2 LINE Login チャネル作成（必須）

**⚠️ Messaging API チャネルだけでは不十分。LINE Login チャネルが必須。**

Messaging API だけだと、友だち追加時に UUID（内部ユーザーID）が取得できない。
LINE Login チャネルを作り、`/auth/line?ref=xxx` 経由で友だち追加させることで:
- **UUID 自動取得**（`users` テーブルに自動登録 + `friends.user_id` に紐づけ）
- **流入経路追跡**（`ref` パラメータ）
- **広告クリックID記録**（gclid/fbclid/UTM）
- **マルチアカウント横断の同一人物判定**

が全て自動化される。これが LINE Harness の核心機能。

1. LINE Developers Console → 同一プロバイダー内で「LINE Login」チャネルを作成
2. 「LIFF」タブで LIFF アプリを追加
3. エンドポイント URL: デプロイ後の Worker URL を設定（LIFF は Worker に統合されています）
4. Scope: `profile`, `openid` を有効化
5. 控える値:

| 項目 | 環境変数 |
|------|---------|
| LIFF ID | `LIFF_URL`（`https://liff.line.me/{LIFF_ID}` 形式） |
| LINE Login チャネルID | `LINE_LOGIN_CHANNEL_ID` |
| LINE Login チャネルシークレット | `LINE_LOGIN_CHANNEL_SECRET` |

## 2. リポジトリのセットアップ

```bash
# クローン
git clone https://github.com/your-org/line-harness.git
cd line-harness

# 依存関係インストール
pnpm install
```

### モノレポ構造

```
line-harness/
├── apps/
│   ├── web/              # Next.js 管理画面
│   └── worker/           # Cloudflare Workers API + Webhook + LIFF フロントエンド
├── packages/
│   ├── db/               # D1 スキーマ & クエリ関数
│   ├── line-sdk/         # LINE Messaging API ラッパー
│   ├── sdk/              # @line-harness/sdk (クライアントSDK)
│   └── shared/           # 共有型定義
├── package.json          # pnpm workspace root
└── pnpm-workspace.yaml
```

> **Note**: LIFF フロントエンドは Worker に統合されています。`@cloudflare/vite-plugin` により Worker デプロイ時に自動ビルドされ、Workers Static Assets として配信されます。LIFF エンドポイント URL は Worker URL と同じです。

## 3. Cloudflare D1 データベース作成

```bash
# D1 データベースを作成
npx wrangler d1 create line-crm

# 出力例:
# ✅ Successfully created DB 'line-crm'
# database_id = "YOUR_D1_DATABASE_ID"
```

出力される `database_id` を `apps/worker/wrangler.toml` に記入:

```toml
[[d1_databases]]
binding = "DB"
database_name = "line-crm"
database_id = "ここに貼り付け"
```

### スキーマ適用

```bash
# 本番D1にスキーマ適用
npx wrangler d1 execute line-crm --file=packages/db/schema.sql

# ローカルD1にスキーマ適用（開発用）
pnpm db:migrate:local
```

## 4. Workers シークレット設定

```bash
# LINE チャネルシークレット
npx wrangler secret put LINE_CHANNEL_SECRET
# プロンプトに LINE チャネルシークレットを入力

# LINE チャネルアクセストークン
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
# プロンプトに チャネルアクセストークン（長期）を入力

# 管理画面API認証キー（任意の文字列）
npx wrangler secret put API_KEY
# プロンプトに 任意のAPIキーを入力（例: sk-your-secret-key-here）

# LINE チャネルID
npx wrangler secret put LINE_CHANNEL_ID

# LIFF URL（オプション）
npx wrangler secret put LIFF_URL

# LINE Login チャネル情報（必須 — UUID自動取得に必要）
npx wrangler secret put LINE_LOGIN_CHANNEL_ID
npx wrangler secret put LINE_LOGIN_CHANNEL_SECRET
```

### 全環境変数一覧

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `LINE_CHANNEL_SECRET` | 必須 | Messaging API チャネルシークレット |
| `LINE_CHANNEL_ACCESS_TOKEN` | 必須 | Messaging API チャネルアクセストークン（長期） |
| `API_KEY` | 必須 | 管理画面/SDK認証用のBearerトークン |
| `LINE_CHANNEL_ID` | 任意 | Messaging API チャネルID |
| `LIFF_URL` | 任意 | LIFF アプリ URL |
| `LINE_LOGIN_CHANNEL_ID` | **必須** | LINE Login チャネルID（UUID自動取得・`/auth/line` に必須） |
| `LINE_LOGIN_CHANNEL_SECRET` | **必須** | LINE Login チャネルシークレット（OAuth コード交換に必須） |

### 管理画面の環境変数（Vercel / CF Pages）

| 変数名 | 説明 |
|--------|------|
| `NEXT_PUBLIC_API_URL` | Workers API の URL（例: `https://your-worker.your-subdomain.workers.dev`） |

> **セキュリティ注意**: `NEXT_PUBLIC_*` にAPIキーを設定しないでください。管理画面のログインページでAPIキーを入力する方式に変更されました（v0.5.1+）。

## 5. Workers デプロイ

```bash
# ビルド & デプロイ
pnpm deploy:worker

# デプロイ後に表示されるURLを控える
# 例: https://your-worker-name.your-subdomain.workers.dev
```

### ローカル開発

```bash
# Workers ローカル起動（http://localhost:8787）
pnpm dev:worker

# 管理画面ローカル起動（http://localhost:3001）
pnpm dev:web
```

## 6. LINE Webhook 設定

1. [LINE Developers Console](https://developers.line.biz/console/) → チャネル → Messaging API
2. Webhook URL に以下を設定:
   ```
   https://your-worker-name.your-subdomain.workers.dev/webhook
   ```
3. 「Use webhook」を有効化
4. 「Verify」ボタンで接続テスト → 成功すればOK
5. 「Auto-reply messages」を **無効** に設定（LINE Harness側で制御するため）
6. 「Greeting messages」を **無効** に設定（シナリオで制御するため）

## 7. 管理画面デプロイ

### Cloudflare Pages（推奨）

```bash
cd apps/web
npx wrangler pages deploy .next --project-name=your-admin-name
```

### Vercel

```bash
cd apps/web
vercel deploy
```

Vercel ダッシュボードからの場合:
1. リポジトリを接続
2. Root Directory: `apps/web`
3. Framework Preset: Next.js
4. 環境変数を設定（`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_API_KEY`）
5. デプロイ

## 8. 動作確認

### 8.1 Webhook テスト

LINE公式アカウントを友だち追加し、友だちが自動登録されることを確認:

```bash
# 友だち一覧を取得
curl -s https://your-worker.your-subdomain.workers.dev/api/friends \
  -H "Authorization: Bearer YOUR_API_KEY" | jq
```

期待レスポンス:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "lineUserId": "U1234567890abcdef",
        "displayName": "テストユーザー",
        "pictureUrl": "https://profile.line-scdn.net/...",
        "isFollowing": true,
        "metadata": {},
        "tags": [],
        "createdAt": "2026-03-21T10:30:00.000+09:00",
        "updatedAt": "2026-03-21T10:30:00.000+09:00"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 50,
    "hasNextPage": false
  }
}
```

### 8.2 メッセージ送信テスト

```bash
# 友だちにテキストメッセージを送信
curl -X POST https://your-worker.your-subdomain.workers.dev/api/friends/{friendId}/messages \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "LINE Harness から送信テスト！"}'
```

### 8.3 管理画面ログイン確認

ブラウザで管理画面URL にアクセスし、ダッシュボードが表示されることを確認。友だちページで登録済みの友だちが表示されればセットアップ完了。

### 8.4 Cron 動作確認

5分毎の Cron トリガーが動作しているか確認:

```bash
# Cloudflare ダッシュボード → Workers → your-worker-name → Triggers
# Cron Triggers に */5 * * * * が表示されていればOK
```

## 9. SDK セットアップ（プログラムからの操作）

```bash
npm install @line-harness/sdk
```

```typescript
import { LineHarness } from '@line-harness/sdk'

const client = new LineHarness({
  apiUrl: 'https://your-worker.your-subdomain.workers.dev',
  apiKey: 'YOUR_API_KEY',
})

// 友だち一覧取得
const friends = await client.friends.list()
console.log(friends.items)

// タグ作成
const tag = await client.tags.create({ name: 'VIP', color: '#EF4444' })

// 友だちにタグ付け
await client.friends.addTag(friends.items[0].id, tag.id)
```

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| Webhook Verify 失敗 | URL誤り or Workers未デプロイ | URLとデプロイ状態を確認 |
| 401 Unauthorized | API_KEY 不一致 | `wrangler secret list` で設定確認 |
| 友だち追加しても登録されない | Webhook無効 or シグネチャ不一致 | LINE Console で Webhook 有効化確認 |
| Cron が動かない | wrangler.toml に crons 未設定 | `[triggers] crons = ["*/5 * * * *"]` を確認 |
| CORS エラー | origin 不一致 | Workers は `origin: '*'` で全許可（MVP） |
