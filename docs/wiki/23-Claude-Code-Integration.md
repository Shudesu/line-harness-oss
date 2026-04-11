# 23. Claude Code 連携ガイド

LINE Harness を Claude Code (AI) から操作するための完全ガイド。API ファーストで設計されており、全操作が CLI/API から実行可能。

---

## 概要

LINE Harness は「AI-first CRM」として設計されている。管理画面での手動操作ではなく、Claude Code からの自然言語指示で全機能を操作することを前提としている。

```
[ユーザー] --自然言語--> [Claude Code] --curl/SDK--> [LINE Harness API] --LINE API--> [友だち]
```

---

## セットアップ

### 1. API キーの確認

```bash
# API が動作していることを確認
curl -s -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-worker.your-subdomain.workers.dev/api/friends/count
```

### 2. line-harness スキルの設定

Claude Code のスキルとして登録することで、自然言語から LINE Harness 操作が可能になる。

CLAUDE.md またはプロジェクトの memory に以下を記載:

```markdown
## LINE Harness

- API URL: https://your-worker.your-subdomain.workers.dev
- API Key: (wrangler secretで管理)
- SDK: @line-harness/sdk (packages/sdk/)
- ドキュメント: /Users/axpr/claudecode/tools/line-harness/docs/wiki/
```

### 3. SDK の利用 (TypeScript プロジェクトの場合)

```typescript
import { LineHarness } from '@line-harness/sdk'

const lh = new LineHarness({
  apiUrl: 'https://your-worker.your-subdomain.workers.dev',
  apiKey: process.env.LINE_HARNESS_API_KEY!,
})
```

---

## Claude Code からの一般的なコマンド

### 友だち管理

```bash
# 友だち数確認
curl -s -H "Authorization: Bearer $KEY" \
  "$API/api/friends/count" | jq '.data.count'

# 友だち一覧（最新20件）
curl -s -H "Authorization: Bearer $KEY" \
  "$API/api/friends?limit=20" | jq '.data.items[] | {id, displayName, isFollowing}'

# 特定タグの友だち
curl -s -H "Authorization: Bearer $KEY" \
  "$API/api/friends?tagId=TAG_UUID&limit=100" | jq '.data.items[] | .displayName'

# 友だちにタグ追加
curl -X POST "$API/api/friends/FRIEND_UUID/tags" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"tagId": "TAG_UUID"}'

# メタデータ更新
curl -X PUT "$API/api/friends/FRIEND_UUID/metadata" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"plan": "premium", "note": "VIP顧客"}'
```

### タグ管理

```bash
# タグ一覧
curl -s -H "Authorization: Bearer $KEY" "$API/api/tags" | jq '.data[] | {id, name, color}'

# タグ作成
curl -X POST "$API/api/tags" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "セミナー参加者", "color": "#10B981"}'
```

### メッセージ送信

```bash
# 個別テキスト送信
curl -X POST "$API/api/friends/FRIEND_UUID/messages" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "こんにちは！お元気ですか？", "messageType": "text"}'

# 一斉配信（全員）
curl -X POST "$API/api/broadcasts" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "お知らせ",
    "messageType": "text",
    "messageContent": "明日のイベントをお楽しみに！",
    "targetType": "all"
  }'

# 即時配信
curl -X POST "$API/api/broadcasts/BROADCAST_UUID/send" \
  -H "Authorization: Bearer $KEY"
```

### シナリオ管理

```bash
# シナリオ一覧
curl -s -H "Authorization: Bearer $KEY" "$API/api/scenarios" | jq '.data[] | {id, name, triggerType, stepCount}'

# シナリオ作成 + ステップ追加
SCENARIO_ID=$(curl -s -X POST "$API/api/scenarios" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "ウェルカム", "triggerType": "friend_add"}' | jq -r '.data.id')

curl -X POST "$API/api/scenarios/$SCENARIO_ID/steps" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"stepOrder": 1, "delayMinutes": 0, "messageType": "text", "messageContent": "ようこそ！"}'

curl -X POST "$API/api/scenarios/$SCENARIO_ID/steps" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"stepOrder": 2, "delayMinutes": 1440, "messageType": "text", "messageContent": "1日後のフォローアップ"}'
```

### 分析・レポート

```bash
# CV レポート (今月)
curl -s -H "Authorization: Bearer $KEY" \
  "$API/api/conversions/report?startDate=$(date +%Y-%m-01)" | jq '.data'

# アフィリエイト全体レポート
curl -s -H "Authorization: Bearer $KEY" \
  "$API/api/affiliates-report" | jq '.data[] | {affiliateName, totalClicks, totalConversions, totalRevenue}'

# アカウントヘルス
curl -s -H "Authorization: Bearer $KEY" \
  "$API/api/accounts/ACC_UUID/health" | jq '{riskLevel: .data.riskLevel, latestCheck: .data.logs[0]}'
```

---

## ワークフロー例

### 1. 自然言語からシナリオ作成

ユーザーの指示: 「友だち追加時に挨拶→1時間後にサービス案内→3日後にクーポン送信するシナリオを作って」

Claude Code の実行:

```bash
API="https://your-worker.your-subdomain.workers.dev"
KEY="YOUR_API_KEY"

# シナリオ作成
SCENARIO=$(curl -s -X POST "$API/api/scenarios" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "友だち追加ウェルカム", "triggerType": "friend_add"}')
SID=$(echo $SCENARIO | jq -r '.data.id')

# ステップ1: 即時挨拶
curl -s -X POST "$API/api/scenarios/$SID/steps" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"stepOrder": 1, "delayMinutes": 0, "messageType": "text", "messageContent": "友だち追加ありがとうございます！\nこれから便利な情報をお届けします。"}'

# ステップ2: 1時間後のサービス案内
curl -s -X POST "$API/api/scenarios/$SID/steps" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"stepOrder": 2, "delayMinutes": 60, "messageType": "text", "messageContent": "当サービスの3つの特徴をご紹介します！\n\n1. 簡単操作\n2. 安心サポート\n3. お手頃価格"}'

# ステップ3: 3日後のクーポン
curl -s -X POST "$API/api/scenarios/$SID/steps" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"stepOrder": 3, "delayMinutes": 4320, "messageType": "text", "messageContent": "特別クーポンをプレゼント！\n\nクーポンコード: WELCOME2026\n有効期限: 7日間\n\n今すぐご利用ください！"}'

echo "シナリオ作成完了: $SID"
```

### 2. セグメント配信

ユーザーの指示: 「VIPタグが付いていて、フォロー中の友だちだけにお知らせを送って」

```bash
# VIPタグのID取得
VIP_TAG=$(curl -s -H "Authorization: Bearer $KEY" "$API/api/tags" | jq -r '.data[] | select(.name=="VIP") | .id')

# 配信作成
BC=$(curl -s -X POST "$API/api/broadcasts" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"VIP限定お知らせ\", \"messageType\": \"text\", \"messageContent\": \"VIP会員限定のお知らせです。\", \"targetType\": \"all\"}")
BC_ID=$(echo $BC | jq -r '.data.id')

# セグメント配信
curl -X POST "$API/api/broadcasts/$BC_ID/send-segment" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"conditions\": {\"operator\": \"AND\", \"rules\": [{\"type\": \"tag_exists\", \"value\": \"$VIP_TAG\"}, {\"type\": \"is_following\", \"value\": true}]}}"
```

### 3. フォーム作成 + 自動タグ付け

ユーザーの指示: 「アンケートフォームを作って、回答したら自動でタグ付けして」

```bash
# タグ作成
TAG=$(curl -s -X POST "$API/api/tags" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "アンケート回答済み", "color": "#8B5CF6"}')
TAG_ID=$(echo $TAG | jq -r '.data.id')

# フォーム作成
curl -X POST "$API/api/forms" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"利用者アンケート\",
    \"description\": \"サービスに関するアンケートです\",
    \"fields\": [
      {\"name\": \"satisfaction\", \"label\": \"満足度\", \"type\": \"select\", \"required\": true, \"options\": [\"とても満足\", \"満足\", \"普通\", \"不満\"]},
      {\"name\": \"feedback\", \"label\": \"ご意見\", \"type\": \"textarea\", \"required\": false}
    ],
    \"onSubmitTagId\": \"$TAG_ID\",
    \"saveToMetadata\": true
  }"
```

### 4. デプロイ

ユーザーの指示: 「Worker をデプロイして」

```bash
cd /Users/axpr/claudecode/tools/line-harness

# パッケージビルド
pnpm -r build

# Worker デプロイ
pnpm deploy:worker

# デプロイ確認
curl -s https://your-worker.your-subdomain.workers.dev/api/friends/count \
  -H "Authorization: Bearer $KEY" | jq '.data.count'
```

### 5. データベースマイグレーション

```bash
cd /Users/axpr/claudecode/tools/line-harness

# スキーマ適用
pnpm db:migrate
```

---

## AI ファースト運用のティップス

### 1. 全操作を API 経由で行う

管理画面は状態の確認用。変更は全て Claude Code から API を叩く。これにより:
- 操作の再現性が確保される
- バッチ処理が容易
- 操作ログが残る

### 2. SDK を活用する

複雑な操作には SDK のワークフローヘルパーが便利:

```typescript
// 1行でシナリオ作成
await lh.createStepScenario('名前', 'friend_add', [
  { delay: '0m', type: 'text', content: '即時' },
  { delay: '1h', type: 'text', content: '1時間後' },
])

// 1行で一斉配信
await lh.broadcastText('全員へのお知らせ')
```

### 3. OpenAPI スペックを活用

```bash
# エンドポイント一覧を確認
curl -s https://your-worker.your-subdomain.workers.dev/openapi.json | jq '.paths | keys'
```

### 4. jq でデータ加工

```bash
# 友だちの名前一覧
curl -s -H "Authorization: Bearer $KEY" "$API/api/friends?limit=100" | \
  jq -r '.data.items[] | "\(.displayName) (\(.id))"'

# タグ別の友だち数
for TAG_ID in $(curl -s -H "Authorization: Bearer $KEY" "$API/api/tags" | jq -r '.data[].id'); do
  NAME=$(curl -s -H "Authorization: Bearer $KEY" "$API/api/tags" | jq -r ".data[] | select(.id==\"$TAG_ID\") | .name")
  COUNT=$(curl -s -H "Authorization: Bearer $KEY" "$API/api/friends?tagId=$TAG_ID" | jq '.data.total')
  echo "$NAME: $COUNT人"
done
```

---

## 自動化パターン

### Cron + Claude Code

launchd や cron で定期的に Claude Code を実行し、LINE Harness を自動操作:

```bash
# 毎週月曜日に CV レポートを Slack に送信
0 9 * * 1 claude -m "LINE Harness のCVレポートを取得して、Slack の #marketing チャネルに投稿して"
```

### Webhook トリガー

外部イベントで LINE メッセージを自動送信:

```bash
# 受信 Webhook を作成
curl -X POST "$API/api/webhooks/incoming" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Shopify 注文通知", "sourceType": "shopify"}'
```

外部システムから受信 Webhook にPOSTすると、イベントバスが発火し、設定された自動化ルールが実行される。

### Stripe 連携の自動化

Stripe の `metadata` に `line_friend_id` を設定するだけで:
1. 決済成功時にスコア自動加算
2. 商品IDベースの自動タグ付与
3. サブスクリプション解約時の自動タグ付与

---

## ファイルパス一覧 (Claude Code 用)

| パス | 内容 |
|------|------|
| `/Users/axpr/claudecode/tools/line-harness/` | プロジェクトルート |
| `apps/worker/src/` | Worker API ソースコード |
| `apps/worker/src/routes/` | 全ルートハンドラー |
| `apps/worker/src/services/` | ビジネスロジック |
| `apps/worker/wrangler.toml` | Worker 設定 |
| `apps/web/` | Next.js 管理パネル |
| `apps/worker/src/client/` | LIFF フロントエンド（Worker 統合） |
| `packages/db/schema.sql` | D1 スキーマ定義 |
| `packages/db/src/` | データベースクエリ |
| `packages/sdk/src/` | TypeScript SDK ソース |
| `packages/line-sdk/src/` | LINE API クライアント |
| `docs/wiki/` | ドキュメント |
