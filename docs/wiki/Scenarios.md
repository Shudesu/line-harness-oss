# Scenarios — ステップ配信（シナリオ）

## 概要

ステップ配信（シナリオ）は、LINE Harness のコア機能です。友だち追加やタグ付与などのトリガーに応じて、事前に定義したメッセージを遅延配信します。条件分岐、ステルス配信、即時配信にも対応しています。

## データモデル

### scenarios テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | TEXT (UUID) | 主キー |
| `name` | TEXT | シナリオ名 |
| `description` | TEXT | 説明 |
| `trigger_type` | TEXT | `friend_add` / `tag_added` / `manual` |
| `trigger_tag_id` | TEXT | tag_added 時のタグID |
| `is_active` | INTEGER | 有効: 1 / 無効: 0 |
| `created_at` | TEXT | 作成日時 (JST) |
| `updated_at` | TEXT | 更新日時 (JST) |

### scenario_steps テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | TEXT (UUID) | 主キー |
| `scenario_id` | TEXT | 親シナリオID |
| `step_order` | INTEGER | ステップ順序（1始まり） |
| `delay_minutes` | INTEGER | 前ステップからの遅延（分） |
| `message_type` | TEXT | `text` / `image` / `flex` |
| `message_content` | TEXT | メッセージ内容（text or JSON文字列） |
| `condition_type` | TEXT | 条件タイプ（null = 無条件） |
| `condition_value` | TEXT | 条件値（JSON文字列） |
| `next_step_on_false` | INTEGER | 条件不一致時のジャンプ先 step_order |
| `created_at` | TEXT | 作成日時 (JST) |

### friend_scenarios テーブル（進行状況）

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | TEXT (UUID) | 主キー |
| `friend_id` | TEXT | 友だちID |
| `scenario_id` | TEXT | シナリオID |
| `current_step_order` | INTEGER | 現在完了済みのステップ順序 |
| `status` | TEXT | `active` / `paused` / `completed` |
| `started_at` | TEXT | 登録日時 (JST) |
| `next_delivery_at` | TEXT | 次回配信予定日時 (JST) |
| `updated_at` | TEXT | 更新日時 (JST) |

## トリガータイプ

| トリガー | 値 | 発火タイミング |
|---------|-----|--------------|
| 友だち追加 | `friend_add` | Webhook follow イベント受信時 |
| タグ追加 | `tag_added` | `POST /api/friends/:id/tags` 実行時（trigger_tag_id と一致） |
| 手動 | `manual` | `POST /api/scenarios/:id/enroll/:friendId` 実行時 |

## 配信メカニズム

### 初回登録時の即時配信

`delay_minutes=0` の最初のステップは、Cron を待たずに **即座に** 配信されます:

```
友だち追加 → enrollFriendInScenario()
  └─ 最初のステップが delay_minutes=0 ?
     ├─ YES → pushMessage() で即時配信
     │         → 2番目のステップがあれば next_delivery_at を計算
     │         → なければ completeFriendScenario()
     └─ NO  → next_delivery_at を計算して Cron に委ねる
```

### Cron 配信フロー（5分毎）

```
processStepDeliveries(db, lineClient)
  │
  ├─ getFriendScenariosDueForDelivery(db, jstNow())
  │   WHERE status = 'active' AND next_delivery_at <= NOW
  │
  └─ for each friend_scenario:
      ├─ ステルス遅延: sleep(addJitter(50, 200)) ms
      ├─ getScenarioSteps(scenarioId)
      ├─ 次ステップ検索: step_order > current_step_order
      │   └─ 見つからない → completeFriendScenario()
      ├─ 条件チェック: evaluateCondition()
      │   ├─ 一致 → メッセージ送信
      │   └─ 不一致 → next_step_on_false にジャンプ or スキップ
      ├─ buildMessage() → LINE メッセージ構築
      ├─ lineClient.pushMessage() → 送信
      ├─ messages_log に記録
      └─ advanceFriendScenario() or completeFriendScenario()
          └─ ステルス: jitterDeliveryTime(±5分)
```

## 条件分岐

### condition_type の種類

| condition_type | condition_value | 説明 |
|---------------|----------------|------|
| `tag_exists` | タグID文字列 | 友だちにそのタグがあれば true |
| `tag_not_exists` | タグID文字列 | 友だちにそのタグがなければ true |
| `metadata_equals` | `{"key":"plan","value":"premium"}` | メタデータが一致すれば true |
| `metadata_not_equals` | `{"key":"plan","value":"free"}` | メタデータが不一致なら true |
| `null` | `null` | 無条件（常に配信） |

### 条件不一致時の動作

1. `next_step_on_false` が設定されている → そのステップにジャンプ
2. `next_step_on_false` が null → 次の順序のステップにスキップ
3. 次のステップもない → シナリオ完了

### 条件分岐の例

```
Step 1 (delay: 0m)  → ウェルカムメッセージ
Step 2 (delay: 1d)  → 条件: tag_exists "purchased"
                       true  → 「ご購入ありがとう！」(Step 3)
                       false → 「購入はお済みですか？」(next_step_on_false: 4)
Step 3 (delay: 0m)  → 購入者向けフォローアップ
Step 4 (delay: 0m)  → 未購入者向けリマインド
Step 5 (delay: 3d)  → 全員共通のまとめ
```

## ステルスモード

### ジッター配信

ステップ配信の `next_delivery_at` に ±5分のランダムオフセットを追加:

```typescript
function jitterDeliveryTime(scheduledAt: Date): Date {
  const jitterMinutes = Math.floor(Math.random() * 10) - 5; // -5 to +5 min
  const result = new Date(scheduledAt);
  result.setMinutes(result.getMinutes() + jitterMinutes);
  return result;
}
```

### バッチ間遅延

複数の friend_scenario を処理する際、各配信間に 50〜250ms のランダム遅延:

```typescript
if (i > 0) {
  await sleep(addJitter(50, 200));
}
```

## API エンドポイント

### GET /api/scenarios — シナリオ一覧

```bash
curl -s "https://line-crm-worker.line-crm-api.workers.dev/api/scenarios" \
  -H "Authorization: Bearer YOUR_API_KEY" | jq
```

レスポンス:

```json
{
  "success": true,
  "data": [
    {
      "id": "scenario-uuid",
      "name": "新規友だちシナリオ",
      "description": "友だち追加後の自動フォローアップ",
      "triggerType": "friend_add",
      "triggerTagId": null,
      "isActive": true,
      "stepCount": 5,
      "createdAt": "2026-03-21T10:00:00.000+09:00",
      "updatedAt": "2026-03-21T10:00:00.000+09:00"
    }
  ]
}
```

### GET /api/scenarios/:id — シナリオ詳細（ステップ付き）

```bash
curl -s "https://line-crm-worker.line-crm-api.workers.dev/api/scenarios/SCENARIO_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" | jq
```

レスポンス:

```json
{
  "success": true,
  "data": {
    "id": "scenario-uuid",
    "name": "新規友だちシナリオ",
    "description": "友だち追加後の自動フォローアップ",
    "triggerType": "friend_add",
    "triggerTagId": null,
    "isActive": true,
    "createdAt": "...",
    "updatedAt": "...",
    "steps": [
      {
        "id": "step-uuid-1",
        "scenarioId": "scenario-uuid",
        "stepOrder": 1,
        "delayMinutes": 0,
        "messageType": "text",
        "messageContent": "友だち追加ありがとうございます！",
        "conditionType": null,
        "conditionValue": null,
        "nextStepOnFalse": null,
        "createdAt": "..."
      },
      {
        "id": "step-uuid-2",
        "scenarioId": "scenario-uuid",
        "stepOrder": 2,
        "delayMinutes": 1440,
        "messageType": "flex",
        "messageContent": "{\"type\":\"bubble\",\"body\":{...}}",
        "conditionType": "tag_exists",
        "conditionValue": "vip-tag-uuid",
        "nextStepOnFalse": 3,
        "createdAt": "..."
      }
    ]
  }
}
```

### POST /api/scenarios — シナリオ作成

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/scenarios" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "新規友だちシナリオ",
    "description": "友だち追加後のウェルカムフロー",
    "triggerType": "friend_add",
    "isActive": true
  }'
```

リクエストボディ:

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `name` | string | 必須 | シナリオ名 |
| `description` | string | 任意 | 説明 |
| `triggerType` | string | 必須 | `friend_add` / `tag_added` / `manual` |
| `triggerTagId` | string | 条件付き | `tag_added` の場合に必須 |
| `isActive` | boolean | 任意 | デフォルト: true |

### PUT /api/scenarios/:id — シナリオ更新

```bash
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/scenarios/SCENARIO_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "更新後の名前",
    "isActive": false
  }'
```

### DELETE /api/scenarios/:id — シナリオ削除

```bash
curl -X DELETE "https://line-crm-worker.line-crm-api.workers.dev/api/scenarios/SCENARIO_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### POST /api/scenarios/:id/steps — ステップ追加

```bash
# テキストステップ（即時配信）
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/scenarios/SCENARIO_UUID/steps" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "stepOrder": 1,
    "delayMinutes": 0,
    "messageType": "text",
    "messageContent": "友だち追加ありがとうございます！"
  }'

# 1日後に Flex メッセージ（条件分岐付き）
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/scenarios/SCENARIO_UUID/steps" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "stepOrder": 2,
    "delayMinutes": 1440,
    "messageType": "flex",
    "messageContent": "{\"type\":\"bubble\",\"body\":{\"type\":\"box\",\"layout\":\"vertical\",\"contents\":[{\"type\":\"text\",\"text\":\"限定オファー！\"}]}}",
    "conditionType": "tag_exists",
    "conditionValue": "vip-tag-uuid",
    "nextStepOnFalse": 3
  }'
```

リクエストボディ:

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `stepOrder` | number | 必須 | ステップ順序（1始まり） |
| `delayMinutes` | number | 任意 | 遅延分数（デフォルト: 0） |
| `messageType` | string | 必須 | `text` / `image` / `flex` |
| `messageContent` | string | 必須 | メッセージ内容 |
| `conditionType` | string | 任意 | 条件タイプ |
| `conditionValue` | string | 任意 | 条件値（JSON文字列） |
| `nextStepOnFalse` | number | 任意 | 条件不一致時のジャンプ先 step_order |

delay_minutes の参考値:

| 時間 | delay_minutes |
|------|--------------|
| 即時 | 0 |
| 30分 | 30 |
| 1時間 | 60 |
| 3時間 | 180 |
| 1日 | 1440 |
| 3日 | 4320 |
| 1週間 | 10080 |

### PUT /api/scenarios/:id/steps/:stepId — ステップ更新

```bash
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/scenarios/SCENARIO_UUID/steps/STEP_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "delayMinutes": 2880,
    "messageContent": "更新されたメッセージ"
  }'
```

### DELETE /api/scenarios/:id/steps/:stepId — ステップ削除

```bash
curl -X DELETE "https://line-crm-worker.line-crm-api.workers.dev/api/scenarios/SCENARIO_UUID/steps/STEP_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### POST /api/scenarios/:id/enroll/:friendId — 手動登録

`manual` トリガーのシナリオに友だちを手動登録:

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/scenarios/SCENARIO_UUID/enroll/FRIEND_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

レスポンス:

```json
{
  "success": true,
  "data": {
    "id": "friend-scenario-uuid",
    "friendId": "friend-uuid",
    "scenarioId": "scenario-uuid",
    "currentStepOrder": 0,
    "status": "active",
    "startedAt": "2026-03-23T15:00:00.000+09:00",
    "nextDeliveryAt": "2026-03-23T15:00:00.000+09:00",
    "updatedAt": "2026-03-23T15:00:00.000+09:00"
  }
}
```

## SDK 使用例

```typescript
import { LineHarness } from '@line-harness/sdk'

const client = new LineHarness({
  apiUrl: 'https://line-crm-worker.line-crm-api.workers.dev',
  apiKey: 'YOUR_API_KEY',
})

// === 低レベルAPI ===

// シナリオ作成
const scenario = await client.scenarios.create({
  name: '新規友だちシナリオ',
  triggerType: 'friend_add',
})

// ステップ追加
await client.scenarios.addStep(scenario.id, {
  stepOrder: 1,
  delayMinutes: 0,
  messageType: 'text',
  messageContent: 'ようこそ！',
})

await client.scenarios.addStep(scenario.id, {
  stepOrder: 2,
  delayMinutes: 1440, // 1日後
  messageType: 'text',
  messageContent: '使い方はわかりましたか？',
})

// シナリオ詳細取得（ステップ付き）
const detail = await client.scenarios.get(scenario.id)
console.log(detail.steps) // 2ステップ

// 手動登録
const enrollment = await client.scenarios.enroll(scenario.id, 'friend-uuid')

// === 高レベルAPI（createStepScenario）===

// 1行でシナリオ+ステップ作成
const scenario2 = await client.createStepScenario(
  'ウェルカムフロー',
  'friend_add',
  [
    { delay: '0m', type: 'text', content: '友だち追加ありがとう！' },
    { delay: '1h', type: 'text', content: '使い方ガイドはこちら...' },
    { delay: '1d', type: 'text', content: '何か質問はありますか？' },
    { delay: '3d', type: 'flex', content: '{"type":"bubble",...}' },
    { delay: '1w', type: 'text', content: '1週間経ちました！' },
  ],
)
```

### parseDelay フォーマット

`createStepScenario` の `delay` は以下のフォーマット:

| フォーマット | 意味 | delay_minutes |
|------------|------|--------------|
| `"30m"` | 30分 | 30 |
| `"1h"` | 1時間 | 60 |
| `"1d"` | 1日 | 1440 |
| `"1w"` | 1週間 | 10080 |

## よくあるパターン

### ウェルカムシーケンス

```typescript
await client.createStepScenario('ウェルカム', 'friend_add', [
  { delay: '0m', type: 'text', content: '友だち追加ありがとうございます！\n特別プレゼントをお送りしますね' },
  { delay: '1h', type: 'flex', content: JSON.stringify(特典Flexメッセージ) },
  { delay: '1d', type: 'text', content: 'プレゼントは受け取れましたか？' },
  { delay: '3d', type: 'text', content: '何かご不明点があればお気軽にどうぞ！' },
])
```

### 教育シーケンス

```typescript
await client.createStepScenario('教育ステップ', 'tag_added', [
  { delay: '0m', type: 'text', content: '【Day 1】AIマーケティングの基礎' },
  { delay: '1d', type: 'text', content: '【Day 2】自動化の第一歩' },
  { delay: '1d', type: 'text', content: '【Day 3】成功事例の紹介' },
  { delay: '1d', type: 'text', content: '【Day 4】実践ワーク' },
  { delay: '1d', type: 'flex', content: JSON.stringify(CTA付きFlexメッセージ) },
])
```

### セールスファネル（条件分岐付き）

```bash
# シナリオ作成
SCENARIO_ID=$(curl -s -X POST .../api/scenarios \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"セールスファネル","triggerType":"manual"}' | jq -r '.data.id')

# Step 1: 商品紹介
curl -X POST .../api/scenarios/$SCENARIO_ID/steps \
  -d '{"stepOrder":1,"delayMinutes":0,"messageType":"text","messageContent":"限定商品のご紹介です！"}'

# Step 2: 1日後に購入チェック（条件分岐）
curl -X POST .../api/scenarios/$SCENARIO_ID/steps \
  -d '{"stepOrder":2,"delayMinutes":1440,"messageType":"text","messageContent":"ご購入ありがとうございました！","conditionType":"tag_exists","conditionValue":"purchased-tag-uuid","nextStepOnFalse":3}'

# Step 3: 未購入者向けリマインド
curl -X POST .../api/scenarios/$SCENARIO_ID/steps \
  -d '{"stepOrder":3,"delayMinutes":0,"messageType":"text","messageContent":"お忘れではないですか？本日限定30%OFF！"}'

# Step 4: 3日後のフォローアップ
curl -X POST .../api/scenarios/$SCENARIO_ID/steps \
  -d '{"stepOrder":4,"delayMinutes":4320,"messageType":"text","messageContent":"最後のチャンスです！"}'
```

## メッセージタイプ別の content フォーマット

### text

```json
"messageContent": "こんにちは！\n改行も使えます"
```

### image

```json
"messageContent": "{\"originalContentUrl\":\"https://example.com/image.jpg\",\"previewImageUrl\":\"https://example.com/preview.jpg\"}"
```

### flex

```json
"messageContent": "{\"type\":\"bubble\",\"body\":{\"type\":\"box\",\"layout\":\"vertical\",\"contents\":[{\"type\":\"text\",\"text\":\"Hello!\",\"weight\":\"bold\",\"size\":\"xl\"}]}}"
```
