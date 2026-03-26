# PPAL LINE Harness — デプロイガイド

PPALのDiscord運用をLINEに移行するためのMVPセットアップ手順です。

## 前提条件

- Cloudflare アカウント（Workers・D1が使える状態）
- `npx wrangler login` 認証済み
- LINE Official Account（Messaging API チャンネル作成済み）
- LINE Login チャンネル（LIFF用）
- Teachable アカウント（Webhook設定権限あり）
- Node.js 18以上、npm

## アーキテクチャ

```
Teachable ──(webhook)──▶ Cloudflare Worker ──▶ D1 Database
LINE ─────(webhook)────▶ Cloudflare Worker ──▶ LINE Messaging API
管理者 ─────(API)────────▶ Cloudflare Worker
                              │
                              ▼
                         自動化ルール
                         タグ管理
                         シナリオ配信
```

## ステップ1: ワンコマンドセットアップ

```bash
cd ppal/scripts
bash ppal-setup.sh
```

このスクリプトが行うこと:
1. D1データベース `miyabi-line-crm` を作成
2. スキーマ + 全マイグレーション（001〜008）を適用
3. シークレットを対話的に設定（下記4つ）
4. Workerをデプロイ
5. ヘルスチェック

### 設定するシークレット

| シークレット | 取得場所 |
|------------|---------|
| `API_KEY` | 任意の文字列（管理画面アクセス用） |
| `LINE_CHANNEL_SECRET` | LINE Developers > Messaging API > チャンネルシークレット |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers > Messaging API > チャンネルアクセストークン（長期） |
| `LINE_LOGIN_CHANNEL_SECRET` | LINE Developers > LINE Login > チャンネルシークレット |

## ステップ2: LINE Developers Console 設定

1. LINE Developers Console を開く
2. Messaging API チャンネル > Messaging API 設定
3. Webhook URL を設定:
   ```
   https://miyabi-line-crm.YOUR_ACCOUNT.workers.dev/webhook
   ```
4. Webhook の利用: **オン**
5. 応答メッセージ: **オフ**（Workerが処理するため）
6. あいさつメッセージ: **オフ**（シナリオで制御）

### wrangler.toml の変数更新

```bash
cd apps/worker
```

`wrangler.toml` の `[vars]` セクションを編集:

```toml
[vars]
LIFF_URL              = "https://liff.line.me/YOUR_LIFF_APP_ID"
LINE_CHANNEL_ID       = "YOUR_LINE_CHANNEL_ID"
LINE_LOGIN_CHANNEL_ID = "YOUR_LINE_LOGIN_CHANNEL_ID"
ALLOWED_ORIGINS       = "https://your-admin.pages.dev"  # 管理画面URL
ENABLE_STEALTH_MODE   = "false"
```

変数を更新したら再デプロイ:

```bash
npx wrangler deploy
```

## ステップ3: PPALタグの移行

L-stepの20タグをLINE Harnessに作成します。

```bash
cd ppal/scripts
WORKER_URL=https://miyabi-line-crm.YOUR_ACCOUNT.workers.dev \
API_KEY=your-api-key \
npx tsx migrate-ppal-tags.ts
```

作成されるタグ:

| カテゴリ | タグ |
|---------|------|
| Segment | seg:初心者, seg:中級者, seg:経営者, seg:副業希望 |
| Status | sts:見込み客, sts:購入済み, sts:受講中, sts:受講完了, sts:解約済み |
| Engagement | eng:高, eng:中, eng:低 |
| Source | src:X, src:YouTube, src:紹介, src:広告 |
| Article | art:AI活用, art:副業 |
| Test | test:A, test:B |

## ステップ4: PPALシナリオの移行

L-stepの3シナリオをLINE Harnessに作成します。

```bash
WORKER_URL=https://miyabi-line-crm.YOUR_ACCOUNT.workers.dev \
API_KEY=your-api-key \
npx tsx migrate-ppal-scenarios.ts
```

作成されるシナリオ:

| シナリオ | トリガー | ステップ数 |
|---------|---------|---------|
| Welcome | 友だち追加 | 5ステップ（0〜7200分） |
| Launch_Countdown | sts:見込み客 タグ追加 | 5ステップ（0〜10220分） |
| Member_Onboarding | sts:購入済み タグ追加 | 5ステップ（0〜43200分） |

## ステップ5: Teachable Webhook 自動化設定

```bash
WORKER_URL=https://miyabi-line-crm.YOUR_ACCOUNT.workers.dev \
API_KEY=your-api-key \
npx tsx ppal-automation-rules.ts
```

このスクリプトが行うこと:
1. Teachable用Webhookエンドポイントを作成（シークレットキー生成）
2. 購入時の自動化ルール作成
   - `sts:購入済み` + `sts:受講中` タグ付与
   - `Member_Onboarding` シナリオ開始
3. 解約時の自動化ルール作成
   - `sts:解約済み` タグ付与
   - `sts:受講中` + `sts:購入済み` タグ削除

### Teachable管理画面で設定

出力された Webhook URL と Secret を Teachable に登録:

```
Settings > Integrations > Webhooks
Webhook URL: https://miyabi-line-crm.YOUR_ACCOUNT.workers.dev/api/webhooks/incoming/{id}/receive
Secret: (スクリプト出力値)
Events: sale.created, subscription.cancelled
```

## 動作確認

```bash
# ヘルスチェック
curl https://miyabi-line-crm.YOUR_ACCOUNT.workers.dev/api/health

# タグ一覧確認
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://miyabi-line-crm.YOUR_ACCOUNT.workers.dev/api/tags

# シナリオ一覧確認
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://miyabi-line-crm.YOUR_ACCOUNT.workers.dev/api/scenarios

# 自動化ルール一覧確認
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://miyabi-line-crm.YOUR_ACCOUNT.workers.dev/api/automations
```

## リッチメニュー設定（オプション）

LINE Developers Console でリッチメニューを2種類作成後、自動化ルールを追加:

```bash
# Guest用メニュー → Member用メニューへの切替ルール
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "リッチメニュー切替（購入後）",
    "triggerType": "tag_added",
    "triggerValue": "<sts:購入済みのtag_id>",
    "actions": [
      { "actionType": "switch_rich_menu", "actionValue": "<Member用rich_menu_id>" }
    ]
  }' \
  https://miyabi-line-crm.YOUR_ACCOUNT.workers.dev/api/automations
```

## セキュリティ設定

### 本番環境での必須設定

```toml
# wrangler.toml
[vars]
ALLOWED_ORIGINS = "https://your-admin.example.com"  # 管理画面のオリジンのみ許可
```

### レートリミット（デフォルト設定）

| エンドポイント | 制限 | ウィンドウ |
|-------------|------|---------|
| `/api/broadcasts/*` | 10リクエスト | 60秒 |
| `/api/friends/*` | 100リクエスト | 60秒 |
| `/api/liff/*` | 60リクエスト | 60秒 |

### Cronジョブ

`wrangler.toml` に設定済み（5分間隔）:
```toml
[triggers]
crons = ["*/5 * * * *"]
```

シナリオのステップ配信・スケジュール済みブロードキャストを自動実行します。

## スクリプト実行順序

```
ppal-setup.sh          # 1回目（初回セットアップ）
  ↓
migrate-ppal-tags.ts   # 1回目（タグ作成）
  ↓
migrate-ppal-scenarios.ts  # 1回目（シナリオ作成）
  ↓
ppal-automation-rules.ts   # 1回目（自動化ルール作成）
```

## トラブルシューティング

### Workerがデプロイできない

```bash
# 認証状態確認
npx wrangler auth list

# 再ログイン
npx wrangler login
```

### D1のdatabase_idが取れない

```bash
npx wrangler d1 list
```

`wrangler.toml` の `database_id` を手動で設定してください。

### LINE Webhookが届かない

1. Webhook URL が正しいか確認（末尾に `/webhook`）
2. LINE Developers Console で「検証」ボタンを押す
3. Workerのログを確認: `npx wrangler tail`

### Teachable Webhookが届かない

```bash
# Webhookシークレット確認
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://miyabi-line-crm.YOUR_ACCOUNT.workers.dev/api/webhooks
```

シークレットが一致しているか確認してください。
