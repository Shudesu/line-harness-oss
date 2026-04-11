# 12. リマインダー配信 (Reminders)

## 概要

リマインダー機能は、特定の日時（ターゲット日）を基準に、前後の任意のタイミングでメッセージを自動配信する仕組み。セミナーのリマインド通知、誕生日メッセージ、予約確認など「日付ベース」の配信に使用する。

L社の「リマインダ配信」に相当する機能。

シナリオ配信が「登録時点からの経過時間」で配信するのに対し、リマインダーは「ターゲット日時からのオフセット」で配信する点が異なる。

## データモデル

### reminders テーブル（リマインダー定義）

```sql
CREATE TABLE reminders (
  id TEXT PRIMARY KEY,           -- UUID
  name TEXT NOT NULL,            -- リマインダー名（例: 「3月セミナーリマインド」）
  description TEXT,              -- 説明文
  is_active INTEGER NOT NULL DEFAULT 1,  -- 有効/無効
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### reminder_steps テーブル（配信ステップ）

```sql
CREATE TABLE reminder_steps (
  id TEXT PRIMARY KEY,                                            -- UUID
  reminder_id TEXT NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  offset_minutes INTEGER NOT NULL,   -- ターゲット日時からのオフセット（分単位）
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex')),
  message_content TEXT NOT NULL,     -- メッセージ内容
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_reminder_steps_reminder ON reminder_steps (reminder_id);
```

### friend_reminders テーブル（友だち登録）

```sql
CREATE TABLE friend_reminders (
  id TEXT PRIMARY KEY,                                             -- UUID
  friend_id TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  reminder_id TEXT NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  target_date TEXT NOT NULL,          -- ターゲット日時（ISO 8601）
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_friend_reminders_status ON friend_reminders (status);
CREATE INDEX idx_friend_reminders_friend ON friend_reminders (friend_id);
```

### friend_reminder_deliveries テーブル（配信ログ）

```sql
CREATE TABLE friend_reminder_deliveries (
  id TEXT PRIMARY KEY,
  friend_reminder_id TEXT NOT NULL REFERENCES friend_reminders (id) ON DELETE CASCADE,
  reminder_step_id TEXT NOT NULL REFERENCES reminder_steps (id) ON DELETE CASCADE,
  delivered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (friend_reminder_id, reminder_step_id)  -- 同じステップは1回のみ配信
);
```

## offset_minutes の解説

`offset_minutes` はターゲット日時からのオフセットを「分単位」で指定する。

### 重要: 符号の意味

マイグレーションファイルのコメント（`002_round3.sql` 80行目）によると:

> 負数: 前（-1440 = 1日前）、正数: 後

ただし実際のコードの配信判定ロジック（`packages/db/src/reminders.ts` 144行目）は:

```typescript
const targetTime = new Date(fr.target_date).getTime() + step.offset_minutes * 60_000;
return targetTime <= new Date(now).getTime();
```

つまり `target_date + offset_minutes` が現在時刻以前なら配信される。

### offset_minutes 早見表

| offset_minutes | 意味 | 用途例 |
|---|---|---|
| `-4320` | 3日前 | 事前告知 |
| `-1440` | 1日前 | 前日リマインド |
| `-60` | 1時間前 | 直前リマインド |
| `0` | 当日（ターゲット日時ちょうど） | 当日メッセージ |
| `60` | 1時間後 | フォローアップ |
| `1440` | 1日後 | 翌日フォローアップ |
| `4320` | 3日後 | アフターフォロー |

### 例: セミナーリマインダー

ターゲット日時: `2026-03-25T19:00:00+09:00`（セミナー開催日時）

| ステップ | offset_minutes | 配信日時 | メッセージ |
|---|---|---|---|
| 1 | -4320 | 3/22 19:00 | 「セミナーまであと3日！」 |
| 2 | -1440 | 3/24 19:00 | 「明日はセミナーです。お忘れなく！」 |
| 3 | -60 | 3/25 18:00 | 「あと1時間で開始です。URL: ...」 |
| 4 | 0 | 3/25 19:00 | 「セミナーが始まりました！」 |
| 5 | 1440 | 3/26 19:00 | 「昨日はありがとうございました。アンケート: ...」 |

## 配信メカニズム

### Cron Trigger

Workers Cron Trigger（5分毎）が `processReminderDeliveries` を実行する。

### 配信判定ロジック

1. `friend_reminders` で `status = 'active'` かつリマインダーが `is_active = 1` のレコードを取得
2. 各レコードの `reminder_steps` を取得
3. 既に配信済みのステップ（`friend_reminder_deliveries` に存在）を除外
4. `target_date + offset_minutes` が現在時刻以前のステップを抽出
5. 該当ステップのメッセージをLINE Messaging APIで配信
6. `friend_reminder_deliveries` に配信記録を追加
7. 全ステップ配信済みなら `friend_reminders.status` を `completed` に更新

### ステルス配信

バースト送信を避けるため、友だち間に50-200msのランダム遅延（ジッター）を挿入する。

### メッセージ形式

| message_type | message_content の形式 |
|---|---|
| `text` | プレーンテキスト文字列 |
| `image` | JSON: `{"originalContentUrl":"...","previewImageUrl":"..."}` |
| `flex` | JSON: Flex Messageの `contents` オブジェクト |

---

## APIエンドポイント

### リマインダー一覧取得

```bash
curl -X GET "https://your-worker.your-subdomain.workers.dev/api/reminders" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "id": "reminder-uuid-1",
      "name": "3月セミナーリマインド",
      "description": "AI活用セミナーのリマインダー",
      "isActive": true,
      "createdAt": "2026-03-20T10:00:00.000",
      "updatedAt": "2026-03-20T10:00:00.000"
    }
  ]
}
```

### リマインダー詳細取得（ステップ付き）

```bash
curl -X GET "https://your-worker.your-subdomain.workers.dev/api/reminders/REMINDER_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": {
    "id": "reminder-uuid-1",
    "name": "3月セミナーリマインド",
    "description": "AI活用セミナーのリマインダー",
    "isActive": true,
    "createdAt": "2026-03-20T10:00:00.000",
    "updatedAt": "2026-03-20T10:00:00.000",
    "steps": [
      {
        "id": "step-uuid-1",
        "reminderId": "reminder-uuid-1",
        "offsetMinutes": -1440,
        "messageType": "text",
        "messageContent": "明日はセミナーです！お忘れなく。",
        "createdAt": "2026-03-20T10:05:00.000"
      },
      {
        "id": "step-uuid-2",
        "reminderId": "reminder-uuid-1",
        "offsetMinutes": -60,
        "messageType": "text",
        "messageContent": "あと1時間でセミナー開始です！\nURL: https://zoom.us/j/123",
        "createdAt": "2026-03-20T10:10:00.000"
      }
    ]
  }
}
```

### リマインダー作成

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/reminders" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "4月勉強会リマインド", "description": "月次勉強会用" }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": { "id": "new-reminder-uuid", "name": "4月勉強会リマインド", "createdAt": "2026-03-22T10:00:00.000" }
}
```

### リマインダー更新

```bash
curl -X PUT "https://your-worker.your-subdomain.workers.dev/api/reminders/REMINDER_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "4月勉強会リマインド（更新）", "isActive": false }'
```

### リマインダー削除

```bash
curl -X DELETE "https://your-worker.your-subdomain.workers.dev/api/reminders/REMINDER_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### ステップ追加

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/reminders/REMINDER_UUID/steps" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "offsetMinutes": -1440,
    "messageType": "text",
    "messageContent": "明日はセミナーです！会場: 東京都渋谷区..."
  }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": {
    "id": "step-uuid",
    "reminderId": "REMINDER_UUID",
    "offsetMinutes": -1440,
    "messageType": "text",
    "createdAt": "2026-03-22T10:00:00.000"
  }
}
```

### ステップ削除

```bash
curl -X DELETE "https://your-worker.your-subdomain.workers.dev/api/reminders/REMINDER_UUID/steps/STEP_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 友だちをリマインダーに登録

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/reminders/REMINDER_UUID/enroll/FRIEND_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "targetDate": "2026-04-10T19:00:00+09:00" }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": {
    "id": "friend-reminder-uuid",
    "friendId": "FRIEND_UUID",
    "reminderId": "REMINDER_UUID",
    "targetDate": "2026-04-10T19:00:00+09:00",
    "status": "active"
  }
}
```

### 友だちのリマインダー一覧取得

```bash
curl -X GET "https://your-worker.your-subdomain.workers.dev/api/friends/FRIEND_UUID/reminders" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "id": "friend-reminder-uuid-1",
      "friendId": "FRIEND_UUID",
      "reminderId": "reminder-uuid-1",
      "targetDate": "2026-04-10T19:00:00+09:00",
      "status": "active",
      "createdAt": "2026-03-22T10:00:00.000"
    }
  ]
}
```

### 友だちリマインダーのキャンセル

```bash
curl -X DELETE "https://your-worker.your-subdomain.workers.dev/api/friend-reminders/FRIEND_REMINDER_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{ "success": true, "data": null }
```

---

## よくあるパターン

### パターン1: セミナーリマインダー

```bash
# 1. リマインダー作成
REMINDER_ID=$(curl -s -X POST ".../api/reminders" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"3月セミナー"}' | jq -r '.data.id')

# 2. ステップ追加（3日前、1日前、1時間前、翌日）
for OFFSET in "-4320 -1440 -60 1440"; do
  curl -X POST ".../api/reminders/$REMINDER_ID/steps" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"offsetMinutes\":$OFFSET,\"messageType\":\"text\",\"messageContent\":\"リマインドメッセージ\"}"
done

# 3. 申込者を登録
curl -X POST ".../api/reminders/$REMINDER_ID/enroll/$FRIEND_ID" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"targetDate":"2026-03-25T19:00:00+09:00"}'
```

### パターン2: 誕生日メッセージ

```bash
# 1. 誕生日リマインダー作成
REMINDER_ID=$(curl -s -X POST ".../api/reminders" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"誕生日メッセージ"}' | jq -r '.data.id')

# 2. 当日0時にメッセージ
curl -X POST ".../api/reminders/$REMINDER_ID/steps" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"offsetMinutes":0,"messageType":"text","messageContent":"お誕生日おめでとうございます！特別クーポンをプレゼント: BIRTHDAY2026"}'

# 3. 各友だちの誕生日を登録
curl -X POST ".../api/reminders/$REMINDER_ID/enroll/$FRIEND_ID" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"targetDate":"2026-05-15T00:00:00+09:00"}'
```

## ソースコード参照

- Worker APIルート: `apps/worker/src/routes/reminders.ts`
- DB クエリ: `packages/db/src/reminders.ts`
- 配信処理: `apps/worker/src/services/reminder-delivery.ts`
- マイグレーション: `packages/db/migrations/002_round3.sql` (65-109行目)
