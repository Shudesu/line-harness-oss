# Friends — 友だち管理

## 概要

LINE Harness の友だち管理は、LINE公式アカウントのフォロワー（友だち）を自動的に追跡・管理するシステムです。Webhook で友だち追加イベントを受信すると自動的にプロフィール情報を取得してDBに登録します。

## データモデル

### friends テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | TEXT (UUID) | 内部ID（主キー） |
| `line_user_id` | TEXT | LINE userId (U + 32文字hex) |
| `display_name` | TEXT | LINE 表示名 |
| `picture_url` | TEXT | LINE プロフィール画像URL |
| `status_message` | TEXT | LINE ステータスメッセージ |
| `is_following` | INTEGER | フォロー中: 1 / ブロック: 0 |
| `metadata` | TEXT (JSON) | カスタムメタデータ |
| `created_at` | TEXT | 初回登録日時 (JST) |
| `updated_at` | TEXT | 最終更新日時 (JST) |

### API レスポンス形式（camelCase）

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "lineUserId": "U1234567890abcdef1234567890abcdef",
  "displayName": "田中太郎",
  "pictureUrl": "https://profile.line-scdn.net/...",
  "statusMessage": "よろしくお願いします",
  "isFollowing": true,
  "metadata": {
    "email": "tanaka@example.com",
    "phone": "090-1234-5678",
    "plan": "premium"
  },
  "tags": [
    { "id": "tag-uuid-1", "name": "VIP", "color": "#EF4444", "createdAt": "..." },
    { "id": "tag-uuid-2", "name": "アクティブ", "color": "#22C55E", "createdAt": "..." }
  ],
  "createdAt": "2026-03-21T10:30:00.000+09:00",
  "updatedAt": "2026-03-21T14:00:00.000+09:00"
}
```

## Webhook 自動登録フロー

ユーザーが LINE 公式アカウントを友だち追加すると:

1. LINE Platform → `POST /webhook` (follow イベント)
2. `verifySignature()` で署名検証
3. `lineClient.getProfile(userId)` でプロフィール取得
4. `upsertFriend()` で friends テーブルに INSERT（既存なら UPDATE + is_following=1）
5. `trigger_type='friend_add'` のアクティブシナリオを検索
6. 該当シナリオに `enrollFriendInScenario()` で登録
7. `fireEvent('friend_add', ...)` でイベントバス発火

ブロック（unfollow）時:
1. `updateFriendFollowStatus(db, userId, false)` で `is_following=0` に更新

## API エンドポイント

### GET /api/friends — 友だち一覧

ページネーション付きの友だち一覧を取得。各友だちにタグ情報も含まれます。

```bash
# 基本取得（デフォルト: limit=50, offset=0）
curl -s "https://your-worker.your-subdomain.workers.dev/api/friends" \
  -H "Authorization: Bearer YOUR_API_KEY" | jq

# ページネーション
curl -s "https://your-worker.your-subdomain.workers.dev/api/friends?limit=20&offset=40" \
  -H "Authorization: Bearer YOUR_API_KEY" | jq

# タグで絞り込み
curl -s "https://your-worker.your-subdomain.workers.dev/api/friends?tagId=TAG_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" | jq
```

クエリパラメータ:

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `limit` | number | 50 | 取得件数 |
| `offset` | number | 0 | オフセット |
| `tagId` | string | — | タグIDで絞り込み |

レスポンス:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "friend-uuid",
        "lineUserId": "U...",
        "displayName": "田中太郎",
        "pictureUrl": "https://...",
        "statusMessage": null,
        "isFollowing": true,
        "metadata": {},
        "tags": [{ "id": "tag-uuid", "name": "VIP", "color": "#EF4444", "createdAt": "..." }],
        "createdAt": "2026-03-21T10:30:00.000+09:00",
        "updatedAt": "2026-03-21T10:30:00.000+09:00"
      }
    ],
    "total": 150,
    "page": 1,
    "limit": 50,
    "hasNextPage": true
  }
}
```

### GET /api/friends/count — 友だち数

```bash
curl -s "https://your-worker.your-subdomain.workers.dev/api/friends/count" \
  -H "Authorization: Bearer YOUR_API_KEY" | jq
```

レスポンス:

```json
{
  "success": true,
  "data": { "count": 150 }
}
```

### GET /api/friends/:id — 友だち詳細

```bash
curl -s "https://your-worker.your-subdomain.workers.dev/api/friends/FRIEND_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" | jq
```

レスポンス: 友だちオブジェクト（タグ付き）。存在しない場合は 404。

### POST /api/friends/:id/tags — タグ追加

友だちにタグを追加します。`tag_added` トリガーのシナリオへの自動登録も行います。

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/friends/FRIEND_UUID/tags" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tagId": "TAG_UUID"}'
```

リクエストボディ:

```json
{ "tagId": "TAG_UUID" }
```

レスポンス: `{ "success": true, "data": null }` (201)

副作用:
- `trigger_type='tag_added'` かつ `trigger_tag_id=TAG_UUID` のシナリオに自動登録
- `fireEvent('tag_change', { tagId, action: 'add' })` 発火

### DELETE /api/friends/:id/tags/:tagId — タグ削除

```bash
curl -X DELETE "https://your-worker.your-subdomain.workers.dev/api/friends/FRIEND_UUID/tags/TAG_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

レスポンス: `{ "success": true, "data": null }`

副作用: `fireEvent('tag_change', { tagId, action: 'remove' })` 発火

### PUT /api/friends/:id/metadata — メタデータ更新

既存のメタデータにマージ（shallow merge）します。

```bash
curl -X PUT "https://your-worker.your-subdomain.workers.dev/api/friends/FRIEND_UUID/metadata" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "tanaka@example.com",
    "phone": "090-1234-5678",
    "plan": "premium",
    "interests": ["marketing", "ai"]
  }'
```

リクエストボディ: 任意のJSON。既存キーは上書き、新規キーは追加。

レスポンス: 更新後の友だちオブジェクト（タグ付き）。

### POST /api/friends/:id/messages — メッセージ送信

友だちに直接メッセージを送信します（pushMessage を使用、課金対象）。

```bash
# テキストメッセージ
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/friends/FRIEND_UUID/messages" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "こんにちは！"}'

# Flex メッセージ
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/friends/FRIEND_UUID/messages" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messageType": "flex",
    "content": "{\"type\":\"bubble\",\"body\":{\"type\":\"box\",\"layout\":\"vertical\",\"contents\":[{\"type\":\"text\",\"text\":\"Hello!\"}]}}"
  }'

# 画像メッセージ
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/friends/FRIEND_UUID/messages" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messageType": "image",
    "content": "{\"originalContentUrl\":\"https://example.com/image.jpg\",\"previewImageUrl\":\"https://example.com/image_preview.jpg\"}"
  }'
```

リクエストボディ:

| フィールド | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `content` | string | — | メッセージ内容（必須） |
| `messageType` | string | `"text"` | `"text"` / `"flex"` / `"image"` |

レスポンス:

```json
{
  "success": true,
  "data": { "messageId": "log-uuid" }
}
```

## UUID クロスアカウント連携

LINE userId は公式アカウントごとに異なるため、同一人物でもアカウントが異なれば別の userId になります。LINE Harness は内部 UUID (`users` テーブル) を用いて複数アカウント間のユーザーを紐づけます。

### ⚠️ 重要: 友だち追加方法による UUID 取得の違い

| 友だち追加方法 | UUID 自動取得 | 仕組み |
|---|---|---|
| **`/auth/line?ref=xxx` 経由**（推奨） | ✅ 自動 | LINE Login OAuth → `sub` 取得 → `createUser()` → `linkFriendToUser()` |
| QR コード直接スキャン | ❌ 取得不可 | Webhook `follow` イベントのみ → `friends` 登録だけ、`user_id` は NULL |
| LINE 検索から追加 | ❌ 取得不可 | 同上 |
| LIFF ログイン後 | ✅ 手動/自動 | `/api/liff/link` で ID トークン → UUID 紐づけ |

**運用ルール: 友だち追加 URL は必ず `/auth/line?ref=xxx` を使うこと。**

LP、SNS、広告、全ての導線で `/auth/line` を使えば:
- 友だち追加と同時に UUID が自動取得される（`bot_prompt=aggressive`）
- `ref` パラメータで流入経路も自動追跡される
- UTM パラメータ（`utm_source`, `utm_medium` 等）も記録される
- 広告クリック ID（`gclid`, `fbclid`）も記録される

```
# 友だち追加URL の例
https://your-worker.your-subdomain.workers.dev/auth/line?ref=instagram
https://your-worker.your-subdomain.workers.dev/auth/line?ref=youtube&utm_source=youtube&utm_medium=description
https://your-worker.your-subdomain.workers.dev/auth/line?ref=facebook-ad&gclid=xxx
```

### 紐づけ方法（`/auth/line` 以外の場合）

`/auth/line` を使わずに友だち追加された場合、以下で後から UUID を紐づけられる:

1. **LIFF ログイン** — LIFF アプリ内で `/api/liff/link` を呼び出し
2. **API 手動リンク** — `POST /api/users/:userId/link { friendId }`
3. **フォーム送信** — email マッチで自動リンク

### テーブル構造

- `users`: 内部UUID + email/phone 等の識別子
- `friends`: `line_user_id` + 内部データ
- `line_accounts`: LINE公式アカウント設定

## SDK 使用例

```typescript
import { LineHarness } from '@line-harness/sdk'

const client = new LineHarness({
  apiUrl: 'https://your-worker.your-subdomain.workers.dev',
  apiKey: 'YOUR_API_KEY',
})

// 友だち一覧取得（ページネーション）
const page1 = await client.friends.list({ limit: 20 })
console.log(page1.items)
console.log(`Total: ${page1.total}, HasNext: ${page1.hasNextPage}`)

// 特定タグの友だち一覧
const vipFriends = await client.friends.list({ tagId: 'vip-tag-uuid' })

// 友だち詳細取得
const friend = await client.friends.get('friend-uuid')

// 友だち数取得
const count = await client.friends.count()

// タグ追加
await client.friends.addTag('friend-uuid', 'tag-uuid')

// タグ削除
await client.friends.removeTag('friend-uuid', 'tag-uuid')

// メタデータ設定
const updated = await client.friends.setMetadata('friend-uuid', {
  email: 'user@example.com',
  plan: 'premium',
})

// テキストメッセージ送信
const result = await client.friends.sendMessage('friend-uuid', 'こんにちは！')
// または高レベルAPI
const result2 = await client.sendTextToFriend('friend-uuid', 'こんにちは！')

// Flex メッセージ送信
const flexJson = JSON.stringify({
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [{ type: 'text', text: 'Flex Message!' }],
  },
})
await client.sendFlexToFriend('friend-uuid', flexJson)

// リッチメニュー紐付け
await client.friends.setRichMenu('friend-uuid', 'richmenu-xxx')
await client.friends.removeRichMenu('friend-uuid')
```

## メタデータのユースケース

metadata フィールドは任意のJSONを格納できるため、様々な用途に使えます:

```json
{
  "email": "user@example.com",
  "phone": "090-1234-5678",
  "plan": "premium",
  "purchased_at": "2026-03-20",
  "interests": ["marketing", "ai"],
  "form_answers": {
    "budget": "50万円以上",
    "company_size": "10-50人"
  },
  "ref_source": "instagram"
}
```

metadata はセグメント配信の条件として使用可能:
- `metadata_equals`: `{"key": "plan", "value": "premium"}`
- `metadata_not_equals`: `{"key": "plan", "value": "free"}`

ステップ配信の条件分岐でも使用可能:
- `conditionType: "metadata_equals"`, `conditionValue: '{"key":"plan","value":"premium"}'`
