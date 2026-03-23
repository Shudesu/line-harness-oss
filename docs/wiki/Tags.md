# Tags — タグ管理

## 概要

タグは LINE Harness の友だちセグメンテーションの基本単位です。友だちに複数のタグを付与することで、配信対象の絞り込み、シナリオトリガー、リッチメニュー切り替えなど様々な用途に使用できます。

## データモデル

### tags テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | TEXT (UUID) | 主キー |
| `name` | TEXT | タグ名 |
| `color` | TEXT | 表示色（hex、デフォルト: `#3B82F6`） |
| `created_at` | TEXT | 作成日時 (JST) |

### friend_tags テーブル（多対多リレーション）

| カラム | 型 | 説明 |
|--------|-----|------|
| `friend_id` | TEXT | 友だちID |
| `tag_id` | TEXT | タグID |
| `assigned_at` | TEXT | 付与日時 (JST) |

主キー: `(friend_id, tag_id)` の複合キー。`INSERT OR IGNORE` で重複付与を防止。

### API レスポンス形式

```json
{
  "id": "tag-uuid",
  "name": "VIP",
  "color": "#EF4444",
  "createdAt": "2026-03-21T10:00:00.000+09:00"
}
```

## タグの用途

### 1. 配信対象の絞り込み

```bash
# タグ指定で一斉配信
curl -X POST .../api/broadcasts \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "VIP限定",
    "messageType": "text",
    "messageContent": "VIP会員限定のご案内です",
    "targetType": "tag",
    "targetTagId": "VIP_TAG_UUID"
  }'
```

### 2. シナリオトリガー

`trigger_type: 'tag_added'` のシナリオを作成すると、特定のタグが付与されたときに自動的にシナリオが開始:

```bash
# タグ追加でトリガーされるシナリオ
curl -X POST .../api/scenarios \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "購入者フォローアップ",
    "triggerType": "tag_added",
    "triggerTagId": "PURCHASED_TAG_UUID"
  }'
```

### 3. セグメント配信の条件

```bash
# タグ存在/不在をセグメント条件に使用
curl -X POST .../api/broadcasts/BROADCAST_UUID/send-segment \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "conditions": {
      "operator": "AND",
      "rules": [
        { "type": "tag_exists", "value": "ACTIVE_TAG_UUID" },
        { "type": "tag_not_exists", "value": "PURCHASED_TAG_UUID" }
      ]
    }
  }'
```

### 4. ステップ配信の条件分岐

```bash
# タグの有無で配信内容を分岐
curl -X POST .../api/scenarios/SCENARIO_UUID/steps \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "stepOrder": 3,
    "delayMinutes": 1440,
    "messageType": "text",
    "messageContent": "ご購入ありがとうございました！",
    "conditionType": "tag_exists",
    "conditionValue": "PURCHASED_TAG_UUID",
    "nextStepOnFalse": 4
  }'
```

### 5. IF-THEN オートメーション

タグ追加をトリガーにアクションを自動実行:

```json
{
  "name": "VIP自動リッチメニュー切替",
  "trigger_event": "tag_change",
  "conditions": { "tag_id": "VIP_TAG_UUID" },
  "actions": [
    { "type": "switch_rich_menu", "params": { "richMenuId": "richmenu-vip-xxx" } }
  ]
}
```

### 6. 友だち一覧のフィルタリング

```bash
# 特定タグの友だちだけを取得
curl -s ".../api/friends?tagId=VIP_TAG_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" | jq
```

## API エンドポイント

### GET /api/tags — タグ一覧

全タグを名前順で取得:

```bash
curl -s "https://your-worker.your-subdomain.workers.dev/api/tags" \
  -H "Authorization: Bearer YOUR_API_KEY" | jq
```

レスポンス:

```json
{
  "success": true,
  "data": [
    { "id": "tag-uuid-1", "name": "VIP", "color": "#EF4444", "createdAt": "2026-03-21T10:00:00.000+09:00" },
    { "id": "tag-uuid-2", "name": "アクティブ", "color": "#22C55E", "createdAt": "2026-03-21T10:05:00.000+09:00" },
    { "id": "tag-uuid-3", "name": "フォーム回答済み", "color": "#3B82F6", "createdAt": "2026-03-21T10:10:00.000+09:00" }
  ]
}
```

### POST /api/tags — タグ作成

```bash
# 色指定あり
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/tags" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "VIP", "color": "#EF4444"}'

# 色指定なし（デフォルト: #3B82F6）
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/tags" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "新規"}'
```

リクエストボディ:

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `name` | string | 必須 | タグ名 |
| `color` | string | 任意 | hex カラーコード（デフォルト: `#3B82F6`） |

レスポンス (201):

```json
{
  "success": true,
  "data": {
    "id": "new-tag-uuid",
    "name": "VIP",
    "color": "#EF4444",
    "createdAt": "2026-03-23T15:00:00.000+09:00"
  }
}
```

### DELETE /api/tags/:id — タグ削除

```bash
curl -X DELETE "https://your-worker.your-subdomain.workers.dev/api/tags/TAG_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

レスポンス:

```json
{ "success": true, "data": null }
```

注意: タグを削除すると、friend_tags テーブルの関連レコードも削除されます。

### POST /api/friends/:id/tags — 友だちにタグ付与

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/friends/FRIEND_UUID/tags" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tagId": "TAG_UUID"}'
```

レスポンス: `{ "success": true, "data": null }` (201)

副作用:
1. `friend_tags` に `INSERT OR IGNORE`（重複付与は無視）
2. `trigger_type='tag_added'` かつ `trigger_tag_id` が一致するシナリオに自動登録
3. `fireEvent('tag_change', { tagId, action: 'add' })` 発火
   - スコアリングルール適用
   - IF-THENオートメーション実行
   - 通知ルール処理
   - 送信Webhook通知

### DELETE /api/friends/:id/tags/:tagId — 友だちからタグ削除

```bash
curl -X DELETE "https://your-worker.your-subdomain.workers.dev/api/friends/FRIEND_UUID/tags/TAG_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

レスポンス: `{ "success": true, "data": null }`

副作用: `fireEvent('tag_change', { tagId, action: 'remove' })` 発火

## SDK 使用例

```typescript
import { LineHarness } from '@line-harness/sdk'

const client = new LineHarness({
  apiUrl: 'https://your-worker.your-subdomain.workers.dev',
  apiKey: 'YOUR_API_KEY',
})

// タグ一覧取得
const tags = await client.tags.list()
console.log(tags) // Tag[]

// タグ作成
const vipTag = await client.tags.create({ name: 'VIP', color: '#EF4444' })
const activeTag = await client.tags.create({ name: 'アクティブ', color: '#22C55E' })
const formTag = await client.tags.create({ name: 'フォーム回答済み' }) // デフォルト色

// タグ削除
await client.tags.delete('tag-uuid')

// 友だちにタグ付与
await client.friends.addTag('friend-uuid', vipTag.id)

// 友だちからタグ削除
await client.friends.removeTag('friend-uuid', vipTag.id)

// タグで友だちフィルタリング
const vipFriends = await client.friends.list({ tagId: vipTag.id })
console.log(`VIP会員: ${vipFriends.total}名`)
```

## よくあるタグ運用パターン

### ステータス管理タグ

```bash
# ステータスを示すタグ群
curl -X POST .../api/tags -d '{"name":"新規","color":"#3B82F6"}'
curl -X POST .../api/tags -d '{"name":"アクティブ","color":"#22C55E"}'
curl -X POST .../api/tags -d '{"name":"購入済み","color":"#EF4444"}'
curl -X POST .../api/tags -d '{"name":"VIP","color":"#F59E0B"}'
curl -X POST .../api/tags -d '{"name":"休眠","color":"#6B7280"}'
```

### 流入元トラッキングタグ

```bash
curl -X POST .../api/tags -d '{"name":"Instagram経由","color":"#E1306C"}'
curl -X POST .../api/tags -d '{"name":"広告経由","color":"#4267B2"}'
curl -X POST .../api/tags -d '{"name":"セミナー参加","color":"#7C3AED"}'
curl -X POST .../api/tags -d '{"name":"紹介","color":"#10B981"}'
```

### 興味・属性タグ

```bash
curl -X POST .../api/tags -d '{"name":"マーケティング興味","color":"#06B6D4"}'
curl -X POST .../api/tags -d '{"name":"AI興味","color":"#8B5CF6"}'
curl -X POST .../api/tags -d '{"name":"法人","color":"#F97316"}'
curl -X POST .../api/tags -d '{"name":"個人","color":"#14B8A6"}'
```

### 自動タグ付与の仕組み

タグは以下の方法で自動的に付与されます:

| 方法 | 説明 |
|------|------|
| フォーム送信 | フォーム定義の `onSubmitTagId` |
| トラッキングリンククリック | リンク定義の `tagId` |
| IF-THEN オートメーション | `add_tag` アクション |
| スコアリング閾値到達 | オートメーションと組み合わせ |

## DB操作関数一覧

| 関数 | 説明 |
|------|------|
| `getTags(db)` | 全タグ取得（name ASC） |
| `createTag(db, { name, color? })` | タグ作成 |
| `deleteTag(db, id)` | タグ削除 |
| `addTagToFriend(db, friendId, tagId)` | 友だちにタグ付与（INSERT OR IGNORE） |
| `removeTagFromFriend(db, friendId, tagId)` | 友だちからタグ削除 |
| `getFriendTags(db, friendId)` | 友だちのタグ一覧取得 |
| `getFriendsByTag(db, tagId)` | タグに紐づく友だち一覧取得 |

## カラーパレット参考

管理画面での視認性を考慮したカラー推奨:

| 色 | Hex | 用途例 |
|----|-----|--------|
| 赤 | `#EF4444` | VIP、重要、購入済み |
| 緑 | `#22C55E` | アクティブ、成功 |
| 青 | `#3B82F6` | 新規、デフォルト |
| 黄 | `#F59E0B` | 注意、要対応 |
| 紫 | `#8B5CF6` | 特別、イベント |
| グレー | `#6B7280` | 休眠、無効 |
| ピンク | `#EC4899` | SNS系 |
| オレンジ | `#F97316` | 警告、法人 |
| シアン | `#06B6D4` | 興味・カテゴリ |
| ティール | `#14B8A6` | 個人、サブカテゴリ |
