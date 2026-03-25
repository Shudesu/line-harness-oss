# 16. チャット & 自動応答 (Chat and AutoReply)

## 概要

LINE Harnessのチャット機能は、オペレーター（人間）が友だちと1対1でやり取りするための仕組みを提供する。自動応答機能と連携し、キーワードマッチによる自動返信と人間による手動対応をシームレスに統合する。

L社の「個別トーク」「自動応答」に相当する機能。

## アーキテクチャ

```
友だちがメッセージ送信
    ↓
LINE Platform → POST /webhook
    ↓
1. メッセージログ記録 (messages_log)
2. チャット作成/更新 (chats) ← upsertChatOnMessage
3. 自動応答チェック (auto_replies)
   → マッチ → replyMessage で即時返信
   → 不一致 → オペレーター対応待ち
4. イベントバス発火 (message_received)
```

## データモデル

### operators テーブル

```sql
CREATE TABLE operators (
  id TEXT PRIMARY KEY,        -- UUID
  name TEXT NOT NULL,         -- オペレーター名
  email TEXT NOT NULL UNIQUE, -- メールアドレス
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### chats テーブル

```sql
CREATE TABLE chats (
  id TEXT PRIMARY KEY,                                          -- UUID
  friend_id TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  operator_id TEXT REFERENCES operators (id) ON DELETE SET NULL, -- 担当オペレーター
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'in_progress', 'resolved')),
  notes TEXT,                  -- 内部メモ
  last_message_at TEXT,        -- 最終メッセージ日時
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_chats_friend ON chats (friend_id);
CREATE INDEX idx_chats_operator ON chats (operator_id);
CREATE INDEX idx_chats_status ON chats (status);
```

### auto_replies テーブル

```sql
CREATE TABLE auto_replies (
  id TEXT PRIMARY KEY,        -- UUID
  keyword TEXT NOT NULL,      -- マッチキーワード
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'contains')) DEFAULT 'exact',
  response_type TEXT NOT NULL DEFAULT 'text',  -- text, image, flex
  response_content TEXT NOT NULL,              -- レスポンス内容
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### messages_log テーブル

```sql
CREATE TABLE messages_log (
  id TEXT PRIMARY KEY,                                               -- UUID
  friend_id TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_type TEXT NOT NULL,    -- text, image, flex 等
  content TEXT NOT NULL,         -- メッセージ内容
  broadcast_id TEXT REFERENCES broadcasts (id) ON DELETE SET NULL,
  scenario_step_id TEXT REFERENCES scenario_steps (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_log_friend_id ON messages_log (friend_id);
CREATE INDEX idx_messages_log_created_at ON messages_log (created_at);
```

## チャットステータスライフサイクル

```
                      新規メッセージ受信
                           ↓
                      ┌─────────┐
                      │ unread  │ ← 初期状態
                      └────┬────┘
                           │ オペレーターが返信 or アサイン
                           ↓
                    ┌──────────────┐
                    │ in_progress  │ ← 対応中
                    └──────┬───────┘
                           │ 対応完了
                           ↓
                      ┌──────────┐
                      │ resolved │ ← 解決済み
                      └────┬─────┘
                           │ 友だちが新たにメッセージ送信
                           ↓
                      ┌─────────┐
                      │ unread  │ ← 再オープン
                      └─────────┘
```

### upsertChatOnMessage の動作

友だちからメッセージ受信時に自動実行:

1. 既存チャットがある場合:
   - `resolved` → `unread` に戻す
   - それ以外 → ステータスそのまま
   - `last_message_at` を更新
2. 既存チャットがない場合:
   - 新規チャットを `unread` で作成

## LINE APIメッセージ送信

### replyMessage（自動応答で使用）

自動応答は `replyMessage` を使用する。

- **無料**（メッセージ通数にカウントされない）
- replyTokenは約1分間のみ有効
- 1つのreplyTokenで1回しか使えない
- 最初にマッチしたルールで返信したら終了（`break`）

### pushMessage（オペレーター送信で使用）

オペレーターからのメッセージ送信は `pushMessage` を使用する。

- メッセージ通数にカウント（月間の無料枠あり）
- いつでも送信可能（replyToken不要）

## 自動応答ルール

### マッチタイプ

| match_type | 動作 | 例 |
|---|---|---|
| `exact` | 完全一致 | keyword=`料金` → 「料金」のみマッチ、「料金プラン」は不一致 |
| `contains` | 部分一致 | keyword=`料金` → 「料金プランを教えて」もマッチ |

### レスポンスタイプ

| response_type | response_content の形式 | 送信方法 |
|---|---|---|
| `text` | プレーンテキスト | `{ type: 'text', text: content }` |
| `image` | JSON: `{"originalContentUrl":"...","previewImageUrl":"..."}` | `{ type: 'image', ... }` |
| `flex` | JSON: Flex Messageの `contents` オブジェクト | `{ type: 'flex', altText: 'Message', contents: ... }` |

### マッチング順序

`auto_replies` テーブルの `created_at ASC` 順に評価される。最初にマッチしたルールで返信し、以降のルールは評価しない。

### メッセージログ

自動応答の送信もメッセージログ (`messages_log`) に `direction: 'outgoing'` で記録される。

---

## APIエンドポイント

### オペレーターCRUD

#### オペレーター一覧取得

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/operators" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "id": "op-uuid-1",
      "name": "山田花子",
      "email": "yamada@example.com",
      "role": "admin",
      "isActive": true,
      "createdAt": "2026-03-20T10:00:00.000",
      "updatedAt": "2026-03-20T10:00:00.000"
    },
    {
      "id": "op-uuid-2",
      "name": "佐藤太郎",
      "email": "sato@example.com",
      "role": "operator",
      "isActive": true,
      "createdAt": "2026-03-20T10:05:00.000",
      "updatedAt": "2026-03-20T10:05:00.000"
    }
  ]
}
```

#### オペレーター作成

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/operators" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "鈴木一郎", "email": "suzuki@example.com", "role": "operator" }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": { "id": "new-op-uuid", "name": "鈴木一郎", "email": "suzuki@example.com", "role": "operator" }
}
```

#### オペレーター更新

```bash
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/operators/OP_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "role": "admin", "isActive": true }'
```

#### オペレーター削除

```bash
curl -X DELETE "https://line-crm-worker.line-crm-api.workers.dev/api/operators/OP_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### チャット管理

#### チャット一覧取得

```bash
# 全チャット
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/chats" \
  -H "Authorization: Bearer YOUR_API_KEY"

# 未読のみ
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/chats?status=unread" \
  -H "Authorization: Bearer YOUR_API_KEY"

# 特定オペレーター担当
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/chats?operatorId=OP_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"

# 組み合わせ
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/chats?status=in_progress&operatorId=OP_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "id": "chat-uuid-1",
      "friendId": "friend-uuid-1",
      "friendName": "田中太郎",
      "friendPictureUrl": "https://profile.line-scdn.net/...",
      "operatorId": "op-uuid-1",
      "status": "in_progress",
      "notes": "VIP候補。次回セミナー案内済み。",
      "lastMessageAt": "2026-03-22T15:30:00.000",
      "createdAt": "2026-03-21T10:00:00.000",
      "updatedAt": "2026-03-22T15:30:00.000"
    }
  ]
}
```

#### チャット詳細取得（メッセージ履歴付き）

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/chats/CHAT_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": {
    "id": "chat-uuid-1",
    "friendId": "friend-uuid-1",
    "friendName": "田中太郎",
    "friendPictureUrl": "https://profile.line-scdn.net/...",
    "operatorId": "op-uuid-1",
    "status": "in_progress",
    "notes": "VIP候補",
    "lastMessageAt": "2026-03-22T15:30:00.000",
    "createdAt": "2026-03-21T10:00:00.000",
    "messages": [
      {
        "id": "msg-uuid-1",
        "direction": "incoming",
        "messageType": "text",
        "content": "料金について教えてください",
        "createdAt": "2026-03-22T14:00:00.000"
      },
      {
        "id": "msg-uuid-2",
        "direction": "outgoing",
        "messageType": "text",
        "content": "料金プランをご案内します...",
        "createdAt": "2026-03-22T14:05:00.000"
      },
      {
        "id": "msg-uuid-3",
        "direction": "incoming",
        "messageType": "text",
        "content": "ありがとうございます！検討します",
        "createdAt": "2026-03-22T15:30:00.000"
      }
    ]
  }
}
```

メッセージ履歴は最大200件、`created_at ASC` 順で返される。

#### チャット作成

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/chats" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "friendId": "friend-uuid-1", "operatorId": "op-uuid-1" }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": { "id": "new-chat-uuid", "friendId": "friend-uuid-1", "status": "unread" }
}
```

#### チャット更新（アサイン/ステータス/ノート）

```bash
# オペレーターアサイン + 対応中に変更
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/chats/CHAT_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "operatorId": "op-uuid-1", "status": "in_progress" }'

# 対応完了
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/chats/CHAT_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "status": "resolved", "notes": "料金プラン説明完了。来週フォローアップ予定。" }'

# アサイン解除
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/chats/CHAT_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "operatorId": null }'
```

#### オペレーターからメッセージ送信

```bash
# テキストメッセージ送信
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/chats/CHAT_UUID/send" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "content": "お問い合わせありがとうございます！料金プランの詳細をお送りします。" }'

# Flexメッセージ送信
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/chats/CHAT_UUID/send" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messageType": "flex",
    "content": "{\"type\":\"bubble\",\"body\":{\"type\":\"box\",\"layout\":\"vertical\",\"contents\":[{\"type\":\"text\",\"text\":\"料金プラン\",\"weight\":\"bold\",\"size\":\"xl\"}]}}"
  }'
```

**レスポンス:**

```json
{ "success": true, "data": { "sent": true, "messageId": "log-uuid-xxx" } }
```

送信処理の内部フロー:
1. チャットIDからfriendIdを取得
2. friendIdからline_user_idを取得
3. LINE Messaging APIでpushMessage送信
4. messages_logに `direction: 'outgoing'` で記録
5. チャットステータスを `in_progress` に更新、`last_message_at` を更新

---

## 運用パターン

### パターン1: FAQ自動応答 + エスカレーション

```
自動応答ルール:
  keyword="料金"    → 料金ページURLを返信
  keyword="営業時間" → 営業時間テキストを返信
  keyword="解約"    → 解約手順テキストを返信

マッチしない場合:
  → チャットが "unread" で作成される
  → オペレーターが管理画面で確認して対応
```

### パターン2: オペレーターのワークフロー

```bash
# 1. 未読チャットを確認
CHATS=$(curl -s ".../api/chats?status=unread" -H "Authorization: Bearer $KEY")

# 2. チャットを自分にアサイン
curl -X PUT ".../api/chats/$CHAT_ID" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"operatorId":"MY_OP_ID","status":"in_progress"}'

# 3. メッセージ履歴を確認
curl -s ".../api/chats/$CHAT_ID" -H "Authorization: Bearer $KEY" | jq '.data.messages'

# 4. 返信
curl -X POST ".../api/chats/$CHAT_ID/send" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"content":"ご質問ありがとうございます！..."}'

# 5. 対応完了
curl -X PUT ".../api/chats/$CHAT_ID" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"status":"resolved","notes":"対応完了"}'
```

## ソースコード参照

- オペレーター/チャットAPI: `apps/worker/src/routes/chats.ts`
- LINE Webhook処理（自動応答含む）: `apps/worker/src/routes/webhook.ts`
- DB オペレーター/チャット: `packages/db/src/chats.ts`
- 自動応答テーブル: `packages/db/schema.sql` (auto_replies, 131-141行目)
- メッセージログテーブル: `packages/db/schema.sql` (messages_log, 116-128行目)
- マイグレーション: `packages/db/migrations/002_round3.sql` (156-181行目)
