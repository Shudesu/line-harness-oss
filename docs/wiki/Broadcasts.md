# Broadcasts — 一斉配信

## 概要

一斉配信（ブロードキャスト）は、友だち全員またはタグ/セグメントで絞り込んだ対象にメッセージを一括送信する機能です。下書き保存、予約配信、セグメント配信に対応しています。ステルスモードにより、バッチ間遅延やメッセージバリエーションで自然な送信パターンを実現します。

## データモデル

### broadcasts テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | TEXT (UUID) | 主キー |
| `title` | TEXT | 配信タイトル（管理用） |
| `message_type` | TEXT | `text` / `image` / `flex` |
| `message_content` | TEXT | メッセージ内容 |
| `target_type` | TEXT | `all` / `tag` |
| `target_tag_id` | TEXT | tag 指定時のタグID |
| `status` | TEXT | `draft` / `scheduled` / `sending` / `sent` |
| `scheduled_at` | TEXT | 予約配信日時 (JST, null = 即時) |
| `sent_at` | TEXT | 実際の配信完了日時 (JST) |
| `total_count` | INTEGER | 配信対象数 |
| `success_count` | INTEGER | 配信成功数 |
| `created_at` | TEXT | 作成日時 (JST) |

### API レスポンス形式

```json
{
  "id": "broadcast-uuid",
  "title": "3月キャンペーンのお知らせ",
  "messageType": "text",
  "messageContent": "本日限定！全品30%OFF！",
  "targetType": "tag",
  "targetTagId": "vip-tag-uuid",
  "status": "sent",
  "scheduledAt": null,
  "sentAt": "2026-03-23T14:00:00.000+09:00",
  "totalCount": 250,
  "successCount": 248,
  "createdAt": "2026-03-23T13:50:00.000+09:00"
}
```

## ステータスライフサイクル

```
draft ──────────────────────────┐
  │                              │
  │ scheduledAt を設定           │ POST /:id/send
  ▼                              │
scheduled ──────────────────────┤
  │                              │
  │ Cron: scheduled_at <= now    │
  ▼                              ▼
sending ───────────────────────►
  │
  │ 全バッチ完了
  ▼
sent
```

| ステータス | 意味 | 編集可 | 削除可 |
|-----------|------|--------|--------|
| `draft` | 下書き | はい | はい |
| `scheduled` | 予約済み | はい | はい |
| `sending` | 配信中 | いいえ | いいえ |
| `sent` | 配信完了 | いいえ | いいえ |

- `scheduledAt` を設定すると自動的に `scheduled` になる
- `scheduledAt` を null に戻すと `draft` に戻る
- 配信失敗時は `draft` にリセットされ、再試行可能

## バッチ送信メカニズム

### target_type: 'all'

LINE の `broadcast` API を使用（全フォロワーに送信）:

```typescript
await lineClient.broadcast([message]);
```

- LINE Messaging API のブロードキャスト機能を使用
- 正確な送信数は取得不可（total_count = 0）
- 最もシンプルで高速

### target_type: 'tag'

`multicast` API を使用（500件ずつバッチ送信）:

```typescript
const MULTICAST_BATCH_SIZE = 500;

for (let i = 0; i < friends.length; i += 500) {
  const batch = friends.slice(i, i + 500);
  const lineUserIds = batch.map(f => f.line_user_id);

  // ステルス遅延
  if (batchIndex > 0) {
    const delay = calculateStaggerDelay(totalMessages, batchIndex);
    await sleep(delay);
  }

  // メッセージバリエーション（テキストのみ）
  if (message.type === 'text' && totalBatches > 1) {
    batchMessage = { ...message, text: addMessageVariation(message.text, batchIndex) };
  }

  await lineClient.multicast(lineUserIds, [batchMessage]);
}
```

### ステルス遅延計算

| 対象人数 | バッチ間遅延 |
|---------|------------|
| ~100人 | 100〜600ms |
| ~1,000人 | ~2分間に均等分散 + 2sジッター |
| 1,000人以上 | ~5分間に均等分散 + 5sジッター |

### メッセージバリエーション

テキストメッセージの場合、バッチごとにゼロ幅文字を挿入して微妙に異なるメッセージにします:

```typescript
// ゼロ幅スペース群（視覚的に見えない）
'\u200B'  // zero-width space
'\u200C'  // zero-width non-joiner
'\u200D'  // zero-width joiner
'\uFEFF'  // zero-width no-break space
```

## セグメント配信

タグだけでなく、複数条件の組み合わせで対象を絞り込む高度な配信:

### SegmentCondition 構造

```typescript
interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
}

interface SegmentRule {
  type: 'tag_exists' | 'tag_not_exists' | 'metadata_equals' | 'metadata_not_equals' | 'ref_code' | 'is_following'
  value: string | boolean | { key: string; value: string }
}
```

### ルールタイプ一覧

| type | value | 説明 |
|------|-------|------|
| `tag_exists` | タグID (string) | そのタグを持つ友だち |
| `tag_not_exists` | タグID (string) | そのタグを持たない友だち |
| `metadata_equals` | `{key, value}` | metadata.key == value |
| `metadata_not_equals` | `{key, value}` | metadata.key != value |
| `ref_code` | ref_code (string) | 流入元コード一致 |
| `is_following` | boolean | フォロー中かどうか |

### SQL 生成

`buildSegmentQuery()` が条件をSQLに変換:

```sql
-- AND の場合
SELECT f.id, f.line_user_id FROM friends f
WHERE EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)
  AND json_extract(f.metadata, '$.plan') = ?
  AND f.is_following = 1

-- OR の場合
SELECT f.id, f.line_user_id FROM friends f
WHERE EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)
  OR json_extract(f.metadata, '$.plan') = ?
```

## API エンドポイント

### GET /api/broadcasts — 配信一覧

```bash
curl -s "https://line-crm-worker.line-crm-api.workers.dev/api/broadcasts" \
  -H "Authorization: Bearer YOUR_API_KEY" | jq
```

レスポンス:

```json
{
  "success": true,
  "data": [
    {
      "id": "broadcast-uuid-1",
      "title": "VIPセール告知",
      "messageType": "text",
      "messageContent": "VIP限定30%OFF！",
      "targetType": "tag",
      "targetTagId": "vip-tag-uuid",
      "status": "sent",
      "scheduledAt": null,
      "sentAt": "2026-03-23T14:00:00.000+09:00",
      "totalCount": 50,
      "successCount": 50,
      "createdAt": "2026-03-23T13:50:00.000+09:00"
    },
    {
      "id": "broadcast-uuid-2",
      "title": "来週のイベント案内",
      "messageType": "flex",
      "messageContent": "{...}",
      "targetType": "all",
      "targetTagId": null,
      "status": "scheduled",
      "scheduledAt": "2026-03-25T10:00:00.000+09:00",
      "sentAt": null,
      "totalCount": 0,
      "successCount": 0,
      "createdAt": "2026-03-23T12:00:00.000+09:00"
    }
  ]
}
```

### GET /api/broadcasts/:id — 配信詳細

```bash
curl -s "https://line-crm-worker.line-crm-api.workers.dev/api/broadcasts/BROADCAST_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" | jq
```

### POST /api/broadcasts — 配信作成

```bash
# テキスト配信（下書き — 全員向け）
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/broadcasts" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "お知らせ",
    "messageType": "text",
    "messageContent": "こんにちは！本日のお知らせです。",
    "targetType": "all"
  }'

# タグ指定 + 予約配信
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/broadcasts" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "VIPセール告知",
    "messageType": "text",
    "messageContent": "VIP会員限定！本日限り30%OFF！",
    "targetType": "tag",
    "targetTagId": "VIP_TAG_UUID",
    "scheduledAt": "2026-03-24T10:00:00.000+09:00"
  }'

# Flex メッセージ配信
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/broadcasts" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "カルーセル商品紹介",
    "messageType": "flex",
    "messageContent": "{\"type\":\"carousel\",\"contents\":[{\"type\":\"bubble\",\"body\":{\"type\":\"box\",\"layout\":\"vertical\",\"contents\":[{\"type\":\"text\",\"text\":\"商品A\"}]}}]}",
    "targetType": "all"
  }'
```

リクエストボディ:

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `title` | string | 必須 | 管理用タイトル |
| `messageType` | string | 必須 | `text` / `image` / `flex` |
| `messageContent` | string | 必須 | メッセージ内容 |
| `targetType` | string | 必須 | `all` / `tag` |
| `targetTagId` | string | 条件付き | targetType=tag の場合必須 |
| `scheduledAt` | string | 任意 | 予約日時 (JST)。null = draft |

レスポンス (201):

```json
{
  "success": true,
  "data": {
    "id": "new-broadcast-uuid",
    "title": "お知らせ",
    "messageType": "text",
    "messageContent": "こんにちは！",
    "targetType": "all",
    "targetTagId": null,
    "status": "draft",
    "scheduledAt": null,
    "sentAt": null,
    "totalCount": 0,
    "successCount": 0,
    "createdAt": "2026-03-23T15:00:00.000+09:00"
  }
}
```

### PUT /api/broadcasts/:id — 配信更新

draft または scheduled の配信のみ更新可能:

```bash
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/broadcasts/BROADCAST_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "更新後のタイトル",
    "messageContent": "更新後のメッセージ",
    "scheduledAt": "2026-03-25T18:00:00.000+09:00"
  }'
```

- `scheduledAt` を設定 → status は `scheduled` に自動変更
- `scheduledAt` を null に設定 → status は `draft` に自動変更
- `sending` / `sent` の配信は更新不可（400エラー）

### DELETE /api/broadcasts/:id — 配信削除

```bash
curl -X DELETE "https://line-crm-worker.line-crm-api.workers.dev/api/broadcasts/BROADCAST_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### POST /api/broadcasts/:id/send — 即時配信

下書きまたは予約中の配信を即座に実行:

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/broadcasts/BROADCAST_UUID/send" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

- `sending` / `sent` の場合は 400 エラー
- 配信失敗時は status が `draft` にリセット（再試行可）

### POST /api/broadcasts/:id/send-segment — セグメント配信

複数条件を組み合わせた対象に配信:

```bash
# VIPタグを持ち、かつ metadata.plan が "premium" の友だちに配信
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/broadcasts/BROADCAST_UUID/send-segment" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "conditions": {
      "operator": "AND",
      "rules": [
        { "type": "tag_exists", "value": "VIP_TAG_UUID" },
        { "type": "metadata_equals", "value": { "key": "plan", "value": "premium" } },
        { "type": "is_following", "value": true }
      ]
    }
  }'

# タグAまたはタグBを持つ友だちに配信
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/broadcasts/BROADCAST_UUID/send-segment" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "conditions": {
      "operator": "OR",
      "rules": [
        { "type": "tag_exists", "value": "TAG_A_UUID" },
        { "type": "tag_exists", "value": "TAG_B_UUID" }
      ]
    }
  }'
```

## 予約配信の仕組み

1. `scheduledAt` を JST 文字列で設定 → status が `scheduled` に
2. Cron (5分毎) で `processScheduledBroadcasts()` が実行
3. `status='scheduled' AND scheduled_at <= now` の配信を検出
4. `processBroadcastSend()` を実行

注意: Cron は5分間隔のため、予約時刻から最大5分の遅延が発生する可能性があります。

## SDK 使用例

```typescript
import { LineHarness } from '@line-harness/sdk'

const client = new LineHarness({
  apiUrl: 'https://line-crm-worker.line-crm-api.workers.dev',
  apiKey: 'YOUR_API_KEY',
})

// === 低レベルAPI ===

// 配信作成（下書き）
const broadcast = await client.broadcasts.create({
  title: '月間セール',
  messageType: 'text',
  messageContent: '今月のセール情報です！',
  targetType: 'all',
})

// 予約配信
const scheduled = await client.broadcasts.create({
  title: '朝の挨拶',
  messageType: 'text',
  messageContent: 'おはようございます！',
  targetType: 'all',
  scheduledAt: '2026-03-24T08:00:00.000+09:00',
})

// 配信更新
await client.broadcasts.update(broadcast.id, {
  messageContent: '更新：今月のセール情報です！',
})

// 即時配信
const result = await client.broadcasts.send(broadcast.id)
console.log(`Sent: ${result.successCount}/${result.totalCount}`)

// セグメント配信
const segResult = await client.broadcasts.sendToSegment(broadcast.id, {
  operator: 'AND',
  rules: [
    { type: 'tag_exists', value: 'vip-tag-uuid' },
    { type: 'is_following', value: true },
  ],
})

// === 高レベルAPI ===

// 全員にテキスト配信（作成+送信を1ステップで）
await client.broadcastText('全員へのお知らせ')

// タグ指定で配信
await client.broadcastToTag('vip-tag-uuid', 'text', 'VIP限定メッセージ')

// セグメント指定で配信
await client.broadcastToSegment('text', 'フィルタ済みメッセージ', {
  operator: 'AND',
  rules: [
    { type: 'tag_exists', value: 'active-tag-uuid' },
    { type: 'metadata_equals', value: { key: 'plan', value: 'premium' } },
  ],
})
```

## 配信失敗時の挙動

| 状況 | 挙動 |
|------|------|
| multicast バッチ失敗 | そのバッチはスキップ、次バッチを続行 |
| 全体的な失敗 | status を `draft` にリセット（再試行可） |
| friend が unfollow 済み | `is_following=0` の友だちはタグ配信時に自動除外 |

配信失敗ログは Workers のコンソールログに出力されます。
