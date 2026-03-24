# 15. Webhook & 通知 (Webhooks and Notifications)

## 概要

LINE Harnessは3種類のWebhookメカニズムと通知システムを提供する:

1. **LINE Webhook（受信）** - LINE PlatformからLINE Harnessへのイベント通知
2. **受信Webhook (Incoming)** - 外部システムからLINE Harnessへのデータ受信
3. **送信Webhook (Outgoing)** - LINE Harnessから外部システムへのイベント通知
4. **通知ルール** - イベント発生時の管理者向け通知

## 1. LINE Webhookイベント処理

### エンドポイント

```
POST /webhook
```

LINE Developers Consoleで設定するWebhook URL。認証はLINEの署名検証で行う（Bearer tokenではない）。

### 署名検証

```typescript
const valid = await verifySignature(channelSecret, rawBody, signature);
```

`X-Line-Signature` ヘッダーの値を `LINE_CHANNEL_SECRET` でHMAC-SHA256検証する。無効な署名でも常に200 OKを返す（LINE Platformの要件）。

### 処理されるイベント

| イベント | 処理内容 |
|---|---|
| `follow` | 友だち登録/更新、プロフィール取得、friend_addシナリオ登録、delay=0のステップ即時配信、イベントバス発火 |
| `unfollow` | `friends.is_following` を `false` に更新 |
| `message` (text) | メッセージログ記録、チャット作成/更新、自動応答チェック、イベントバス発火 |

### 即時配信の仕組み

友だち追加時、`delay_minutes = 0` の最初のステップは即座にpushMessageで送信される（cronの5分待ちを回避）。2番目以降のステップはcronスケジュールに委ねられる。

### イベントバス発火

各イベント処理後に `fireEvent()` が呼ばれ、以下が並列実行される:
- 送信Webhook通知
- スコアリングルール適用
- オートメーションルール実行
- 通知ルール処理

---

## 2. 受信Webhook (Incoming Webhooks)

外部システム（Stripe、Google Calendar、カスタムシステム等）からLINE Harnessにデータを送信するための仕組み。

### データモデル

```sql
CREATE TABLE incoming_webhooks (
  id TEXT PRIMARY KEY,              -- UUID
  name TEXT NOT NULL,               -- 名前（例: 「Stripe決済通知」）
  source_type TEXT NOT NULL DEFAULT 'custom',  -- stripe, google_calendar, custom 等
  secret TEXT,                      -- 署名検証用シークレット
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 受信エンドポイント

```
POST /api/webhooks/incoming/:id/receive
```

認証不要（公開エンドポイント）。Webhook IDで識別し、`is_active` チェックを行う。

受信時の処理:
1. Webhook IDでレコードを検索
2. 非アクティブなら404を返す
3. イベントバスに `incoming_webhook.{source_type}` イベントを発火
4. オートメーション・スコアリング・通知ルールが連動して処理

### APIエンドポイント

#### 受信Webhook一覧取得

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/webhooks/incoming" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "id": "wh-uuid-1",
      "name": "Stripe決済通知",
      "sourceType": "stripe",
      "secret": "whsec_xxx...",
      "isActive": true,
      "createdAt": "2026-03-20T10:00:00.000",
      "updatedAt": "2026-03-20T10:00:00.000"
    }
  ]
}
```

#### 受信Webhook作成

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/webhooks/incoming" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Stripe決済通知",
    "sourceType": "stripe",
    "secret": "whsec_test_xxxxx"
  }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": {
    "id": "new-wh-uuid",
    "name": "Stripe決済通知",
    "sourceType": "stripe",
    "isActive": true,
    "createdAt": "2026-03-22T10:00:00.000"
  }
}
```

#### 受信Webhook更新

```bash
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/webhooks/incoming/WH_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "isActive": false }'
```

#### 受信Webhook削除

```bash
curl -X DELETE "https://line-crm-worker.line-crm-api.workers.dev/api/webhooks/incoming/WH_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### 外部からのWebhook受信（公開）

```bash
# Stripeからの決済通知を受信（認証不要）
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/webhooks/incoming/WH_UUID/receive" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "payment_intent.succeeded",
    "data": {
      "object": {
        "amount": 5000,
        "currency": "jpy",
        "metadata": { "friendId": "friend-uuid" }
      }
    }
  }'
```

**レスポンス:**

```json
{ "success": true, "data": { "received": true, "source": "stripe" } }
```

---

## 3. 送信Webhook (Outgoing Webhooks)

LINE Harness内部でイベントが発生した時に、外部URLにPOSTリクエストを送信する仕組み。Slack通知、外部CRM連携、カスタム処理などに使用。

### データモデル

```sql
CREATE TABLE outgoing_webhooks (
  id TEXT PRIMARY KEY,                     -- UUID
  name TEXT NOT NULL,                      -- 名前
  url TEXT NOT NULL,                       -- 送信先URL
  event_types TEXT NOT NULL DEFAULT '[]',  -- JSON配列: 監視するイベントタイプ
  secret TEXT,                             -- HMAC署名用シークレット
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### event_types の設定

JSON配列で監視するイベントタイプを指定:

```json
["friend_add", "message_received", "tag_change", "cv_fire"]
```

ワイルドカード `"*"` を指定すると全イベントを受信:

```json
["*"]
```

### HMAC署名検証

送信Webhookに `secret` が設定されている場合、リクエストボディのHMAC-SHA256署名が `X-Webhook-Signature` ヘッダーに付与される。

```
X-Webhook-Signature: hex_encoded_hmac_sha256_signature
```

検証ロジック（受信側で実装）:

```javascript
const crypto = require('crypto');
const expectedSignature = crypto
  .createHmac('sha256', webhookSecret)
  .update(requestBody)
  .digest('hex');
const isValid = expectedSignature === request.headers['x-webhook-signature'];
```

### 送信ペイロード形式

```json
{
  "event": "friend_add",
  "timestamp": "2026-03-22T14:00:00.000",
  "data": {
    "friendId": "friend-uuid",
    "eventData": { "displayName": "田中太郎" }
  }
}
```

### APIエンドポイント

#### 送信Webhook一覧取得

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/webhooks/outgoing" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "id": "out-wh-uuid-1",
      "name": "Slack通知",
      "url": "https://hooks.slack.com/services/T.../B.../xxx",
      "eventTypes": ["friend_add", "cv_fire"],
      "secret": "my-webhook-secret",
      "isActive": true,
      "createdAt": "2026-03-20T10:00:00.000",
      "updatedAt": "2026-03-20T10:00:00.000"
    }
  ]
}
```

#### 送信Webhook作成

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/webhooks/outgoing" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "全イベントSlack通知",
    "url": "https://hooks.slack.com/services/T.../B.../xxx",
    "eventTypes": ["*"],
    "secret": "my-secret-key-123"
  }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": {
    "id": "new-out-wh-uuid",
    "name": "全イベントSlack通知",
    "url": "https://hooks.slack.com/services/T.../B.../xxx",
    "eventTypes": ["*"],
    "isActive": true,
    "createdAt": "2026-03-22T10:00:00.000"
  }
}
```

#### 送信Webhook更新

```bash
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/webhooks/outgoing/OUT_WH_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "eventTypes": ["friend_add", "form_submit", "cv_fire"],
    "isActive": true
  }'
```

#### 送信Webhook削除

```bash
curl -X DELETE "https://line-crm-worker.line-crm-api.workers.dev/api/webhooks/outgoing/OUT_WH_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## 4. 通知ルール (Notification Rules)

管理者向けの通知システム。イベント発生時にダッシュボード通知、Webhook通知、メール通知（将来対応）を生成する。

### データモデル

#### notification_rules テーブル

```sql
CREATE TABLE notification_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL,              -- 監視するイベントタイプ
  conditions TEXT NOT NULL DEFAULT '{}', -- JSON: 閾値等の条件
  channels TEXT NOT NULL DEFAULT '["webhook"]',  -- JSON配列: 通知チャネル
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### notifications テーブル

```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  rule_id TEXT REFERENCES notification_rules (id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT NOT NULL,            -- webhook, email, dashboard
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  metadata TEXT,                    -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_notifications_status ON notifications (status);
CREATE INDEX idx_notifications_created ON notifications (created_at);
```

### 通知チャネル

| チャネル | 動作 | 状態 |
|---|---|---|
| `dashboard` | DBに記録のみ（管理画面で確認） | 実装済み |
| `webhook` | 送信Webhookと統合 | 実装済み |
| `email` | SendGrid等で送信 | 将来実装 |

### APIエンドポイント

#### 通知ルール一覧取得

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/notifications/rules" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "id": "rule-uuid-1",
      "name": "新規友だち通知",
      "eventType": "friend_add",
      "conditions": {},
      "channels": ["dashboard", "webhook"],
      "isActive": true,
      "createdAt": "2026-03-20T10:00:00.000",
      "updatedAt": "2026-03-20T10:00:00.000"
    }
  ]
}
```

#### 通知ルール作成

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/notifications/rules" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "高スコア到達通知",
    "eventType": "score_threshold",
    "conditions": { "score_threshold": 100 },
    "channels": ["dashboard", "webhook"]
  }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": {
    "id": "new-rule-uuid",
    "name": "高スコア到達通知",
    "eventType": "score_threshold",
    "channels": ["dashboard", "webhook"],
    "createdAt": "2026-03-22T10:00:00.000"
  }
}
```

#### 通知ルール更新

```bash
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/notifications/rules/RULE_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "channels": ["dashboard"], "isActive": false }'
```

#### 通知ルール削除

```bash
curl -X DELETE "https://line-crm-worker.line-crm-api.workers.dev/api/notifications/rules/RULE_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### 通知一覧取得

```bash
# 全通知
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/notifications" \
  -H "Authorization: Bearer YOUR_API_KEY"

# ステータスでフィルタ
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/notifications?status=pending&limit=50" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "id": "notif-uuid-1",
      "ruleId": "rule-uuid-1",
      "eventType": "friend_add",
      "title": "新規友だち通知: friend_add",
      "body": "{\"friendId\":\"friend-uuid\",\"eventData\":{\"displayName\":\"田中太郎\"}}",
      "channel": "dashboard",
      "status": "pending",
      "metadata": { "displayName": "田中太郎" },
      "createdAt": "2026-03-22T14:00:00.000"
    }
  ]
}
```

---

## 活用パターン

### パターン: Stripe → LINE Harness → Slack通知 + 顧客タグ付け

```bash
# 1. 受信Webhook作成（Stripe用）
IN_WH=$(curl -s -X POST ".../api/webhooks/incoming" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Stripe","sourceType":"stripe"}' | jq -r '.data.id')

# 2. 送信Webhook作成（Slack通知用）
curl -X POST ".../api/webhooks/outgoing" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Slack","url":"https://hooks.slack.com/...","eventTypes":["incoming_webhook.stripe"]}'

# 3. オートメーション作成（決済完了→タグ付与）
curl -X POST ".../api/automations" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Stripe決済完了","eventType":"incoming_webhook.stripe","actions":[{"type":"add_tag","params":{"tagId":"PAID_TAG"}}]}'

# 4. Stripeのwebhook URLに設定:
# https://line-crm-worker.line-crm-api.workers.dev/api/webhooks/incoming/{IN_WH}/receive
```

## ソースコード参照

- LINE Webhook処理: `apps/worker/src/routes/webhook.ts`
- Webhook CRUD: `apps/worker/src/routes/webhooks.ts`
- 通知CRUD: `apps/worker/src/routes/notifications.ts`
- イベントバス: `apps/worker/src/services/event-bus.ts`
- DB Webhook: `packages/db/src/webhooks.ts`
- DB 通知: `packages/db/src/notifications.ts`
- マイグレーション: `packages/db/migrations/002_round3.sql` (1-30行目, 183-210行目)
