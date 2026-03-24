# 19. SDK リファレンス

`@line-harness/sdk` -- LINE Harness の AI ネイティブ TypeScript SDK。全リソースへのプログラムアクセスとワークフローヘルパーを提供。

---

## インストール

```bash
# npm
npm install @line-harness/sdk

# pnpm
pnpm add @line-harness/sdk

# GitHub から直接
npm install github:your-org/line-harness#main --workspace=packages/sdk
```

パッケージ名: `@line-harness/sdk`
バージョン: 0.1.0
ライセンス: MIT
エクスポート形式: ESM (`.mjs`) + CJS (`.cjs`) + TypeScript 型定義 (`.d.ts`)

---

## 設定 (LineHarness コンストラクタ)

```typescript
import { LineHarness } from '@line-harness/sdk'

const lh = new LineHarness({
  apiUrl: 'https://line-crm-worker.line-crm-api.workers.dev',
  apiKey: 'your-api-key-here',
  timeout: 30000,  // オプション。デフォルト: 30000ms
})
```

### LineHarnessConfig

| プロパティ | 型 | 必須 | デフォルト | 説明 |
|-----------|------|------|-----------|------|
| apiUrl | string | Yes | - | API のベース URL |
| apiKey | string | Yes | - | Bearer トークン認証キー |
| timeout | number | No | 30000 | リクエストタイムアウト (ms) |

---

## リソースクラス

### friends (FriendsResource)

#### list(params?)

友だち一覧をページネーション付きで取得。

```typescript
const result = await lh.friends.list({ limit: 50, offset: 0, tagId: 'tag-uuid' })
// result: PaginatedData<Friend>
// { items: Friend[], total: number, page: number, limit: number, hasNextPage: boolean }
```

| パラメータ | 型 | 説明 |
|-----------|------|------|
| limit | number | 取得件数 (デフォルト 50) |
| offset | number | オフセット (デフォルト 0) |
| tagId | string | タグIDでフィルタ |

#### get(id)

友だち詳細取得 (タグ含む)。

```typescript
const friend = await lh.friends.get('friend-uuid')
// friend: Friend
```

#### count()

友だち総数を取得。

```typescript
const count = await lh.friends.count()
// count: number
```

#### addTag(friendId, tagId)

友だちにタグを追加。tag_added トリガーのシナリオに自動エンロールされる。

```typescript
await lh.friends.addTag('friend-uuid', 'tag-uuid')
```

#### removeTag(friendId, tagId)

友だちからタグを削除。

```typescript
await lh.friends.removeTag('friend-uuid', 'tag-uuid')
```

#### sendMessage(friendId, content, messageType?)

LINE メッセージを送信。

```typescript
// テキスト
const result = await lh.friends.sendMessage('friend-uuid', 'こんにちは！')
// result: { messageId: string }

// Flex メッセージ
await lh.friends.sendMessage('friend-uuid', JSON.stringify(flexContent), 'flex')

// 画像
await lh.friends.sendMessage('friend-uuid', JSON.stringify({
  originalContentUrl: 'https://example.com/image.jpg',
  previewImageUrl: 'https://example.com/image-preview.jpg'
}), 'image')
```

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|-----------|------|
| friendId | string | - | 友だちID |
| content | string | - | メッセージ内容 |
| messageType | 'text' \| 'image' \| 'flex' | 'text' | メッセージタイプ |

#### setMetadata(friendId, fields)

友だちのメタデータをマージ更新。既存のキーは上書き、新しいキーは追加。

```typescript
const friend = await lh.friends.setMetadata('friend-uuid', {
  name: '田中太郎',
  plan: 'premium',
  purchaseCount: 3
})
```

#### setRichMenu(friendId, richMenuId)

友だちにリッチメニューをリンク。

```typescript
await lh.friends.setRichMenu('friend-uuid', 'richmenu-xxxx')
```

#### removeRichMenu(friendId)

友だちのリッチメニューを解除。

```typescript
await lh.friends.removeRichMenu('friend-uuid')
```

---

### tags (TagsResource)

#### list()

全タグ一覧。

```typescript
const tags = await lh.tags.list()
// tags: Tag[]
```

#### create(input)

タグ作成。

```typescript
const tag = await lh.tags.create({ name: '購入者', color: '#10B981' })
// tag: Tag
```

| フィールド | 型 | 必須 | 説明 |
|-----------|------|------|------|
| name | string | Yes | タグ名 |
| color | string | No | カラーコード (デフォルト: #3B82F6) |

#### delete(id)

タグ削除。

```typescript
await lh.tags.delete('tag-uuid')
```

---

### scenarios (ScenariosResource)

#### list()

シナリオ一覧 (ステップ数含む)。

```typescript
const scenarios = await lh.scenarios.list()
// scenarios: ScenarioListItem[] (Scenario + stepCount)
```

#### get(id)

シナリオ詳細 (ステップ含む)。

```typescript
const scenario = await lh.scenarios.get('scenario-uuid')
// scenario: ScenarioWithSteps (steps: ScenarioStep[])
```

#### create(input)

```typescript
const scenario = await lh.scenarios.create({
  name: 'ウェルカムシナリオ',
  triggerType: 'friend_add',
  description: '友だち追加時の挨拶',
  isActive: true
})
```

| フィールド | 型 | 必須 | 説明 |
|-----------|------|------|------|
| name | string | Yes | シナリオ名 |
| triggerType | 'friend_add' \| 'tag_added' \| 'manual' | Yes | トリガー種別 |
| description | string | No | 説明 |
| triggerTagId | string | No | tag_added 時の対象タグ |
| isActive | boolean | No | 有効フラグ (デフォルト true) |

#### update(id, input)

```typescript
await lh.scenarios.update('scenario-uuid', { name: '新名前', isActive: false })
```

#### delete(id)

```typescript
await lh.scenarios.delete('scenario-uuid')
```

#### addStep(scenarioId, input)

```typescript
const step = await lh.scenarios.addStep('scenario-uuid', {
  stepOrder: 1,
  delayMinutes: 0,
  messageType: 'text',
  messageContent: 'ようこそ！友だち追加ありがとうございます。'
})
```

| フィールド | 型 | 必須 | 説明 |
|-----------|------|------|------|
| stepOrder | number | Yes | ステップ順序 (1始まり) |
| delayMinutes | number | Yes | 前ステップからの遅延 (分) |
| messageType | 'text' \| 'image' \| 'flex' | Yes | メッセージタイプ |
| messageContent | string | Yes | メッセージ内容 |
| conditionType | string \| null | No | 条件タイプ |
| conditionValue | string \| null | No | 条件値 |
| nextStepOnFalse | number \| null | No | 条件不一致時の次ステップ |

#### updateStep(scenarioId, stepId, input)

```typescript
await lh.scenarios.updateStep('scenario-uuid', 'step-uuid', {
  delayMinutes: 60,
  messageContent: '更新されたメッセージ'
})
```

#### deleteStep(scenarioId, stepId)

```typescript
await lh.scenarios.deleteStep('scenario-uuid', 'step-uuid')
```

#### enroll(scenarioId, friendId)

友だちをシナリオに手動エンロール。

```typescript
const enrollment = await lh.scenarios.enroll('scenario-uuid', 'friend-uuid')
// enrollment: FriendScenarioEnrollment
```

---

### broadcasts (BroadcastsResource)

#### list() / get(id)

```typescript
const broadcasts = await lh.broadcasts.list()
const broadcast = await lh.broadcasts.get('broadcast-uuid')
```

#### create(input)

```typescript
const broadcast = await lh.broadcasts.create({
  title: '新機能のお知らせ',
  messageType: 'text',
  messageContent: '新機能がリリースされました！',
  targetType: 'all',
  // targetType: 'tag', targetTagId: 'tag-uuid',  // タグ指定時
  // scheduledAt: '2026-03-25T10:00:00+09:00',     // 予約配信時
})
```

#### update(id, input) / delete(id)

```typescript
await lh.broadcasts.update('broadcast-uuid', { title: '更新タイトル' })
await lh.broadcasts.delete('broadcast-uuid')
```

#### send(id)

即時配信実行。

```typescript
const result = await lh.broadcasts.send('broadcast-uuid')
```

#### sendToSegment(id, conditions)

セグメント条件に基づく配信。

```typescript
const result = await lh.broadcasts.sendToSegment('broadcast-uuid', {
  operator: 'AND',
  rules: [
    { type: 'tag_exists', value: 'tag-uuid' },
    { type: 'is_following', value: true }
  ]
})
```

SegmentRule の type:
- `tag_exists` -- 指定タグを持つ
- `tag_not_exists` -- 指定タグを持たない
- `metadata_equals` -- メタデータ一致 (`value: { key: 'plan', value: 'premium' }`)
- `metadata_not_equals` -- メタデータ不一致
- `ref_code` -- 流入経路コード
- `is_following` -- フォロー中かどうか

---

### richMenus (RichMenusResource)

```typescript
const menus = await lh.richMenus.list()

const result = await lh.richMenus.create({
  size: { width: 2500, height: 1686 },
  selected: true,
  name: 'メインメニュー',
  chatBarText: 'メニューを開く',
  areas: [{
    bounds: { x: 0, y: 0, width: 1250, height: 843 },
    action: { type: 'uri', uri: 'https://example.com', label: 'サイトへ' }
  }]
})

await lh.richMenus.setDefault('richmenu-xxxx')
await lh.richMenus.delete('richmenu-xxxx')
```

---

### trackedLinks (TrackedLinksResource)

```typescript
const links = await lh.trackedLinks.list()

const link = await lh.trackedLinks.create({
  name: 'LP-A リンク',
  originalUrl: 'https://example.com/lp-a',
  tagId: 'tag-uuid',         // クリック時に自動タグ付与
  scenarioId: 'scenario-uuid' // クリック時に自動エンロール
})
// link.trackingUrl => https://line-crm-worker.../t/{id}

const detail = await lh.trackedLinks.get('link-uuid')
// detail.clicks: LinkClick[]

await lh.trackedLinks.delete('link-uuid')
```

---

### forms (FormsResource)

```typescript
const forms = await lh.forms.list()
const form = await lh.forms.get('form-uuid')

const newForm = await lh.forms.create({
  name: 'アンケート',
  description: '利用者アンケート',
  fields: [
    { name: 'name', label: '氏名', type: 'text', required: true },
    { name: 'email', label: 'メール', type: 'email', required: true },
    { name: 'plan', label: 'プラン', type: 'select', options: ['basic', 'premium'] }
  ],
  onSubmitTagId: 'tag-uuid',
  onSubmitScenarioId: 'scenario-uuid',
  saveToMetadata: true
})

await lh.forms.update('form-uuid', { isActive: false })
await lh.forms.delete('form-uuid')

const submissions = await lh.forms.getSubmissions('form-uuid')
```

---

## ワークフローヘルパー

高レベルの操作を1行で実行するショートカットメソッド。

### createStepScenario(name, triggerType, steps)

シナリオ作成 + ステップ追加を一括実行。

```typescript
const scenario = await lh.createStepScenario(
  'ウェルカムシナリオ',
  'friend_add',
  [
    { delay: '0m', type: 'text', content: 'ようこそ！' },
    { delay: '1h', type: 'text', content: '1時間後のフォローアップです' },
    { delay: '1d', type: 'flex', content: JSON.stringify(flexJson) },
    { delay: '1w', type: 'text', content: '1週間後のリマインダーです' },
  ]
)
```

delay フォーマット: `{数値}{単位}` -- `m`(分), `h`(時間), `d`(日), `w`(週)

### broadcastText(text)

全友だちにテキスト一斉配信。

```typescript
const broadcast = await lh.broadcastText('お知らせ: 明日メンテナンスを実施します')
```

### broadcastToTag(tagId, messageType, content)

特定タグの友だちに配信。

```typescript
await lh.broadcastToTag('tag-uuid', 'text', 'タグ付き友だちへのメッセージ')
```

### broadcastToSegment(messageType, content, conditions)

セグメント条件で配信。

```typescript
await lh.broadcastToSegment('text', 'セグメント配信', {
  operator: 'AND',
  rules: [{ type: 'tag_exists', value: 'tag-uuid' }]
})
```

### sendTextToFriend(friendId, text)

個別テキスト送信。

```typescript
await lh.sendTextToFriend('friend-uuid', '個別メッセージです')
```

### sendFlexToFriend(friendId, flexJson)

個別 Flex メッセージ送信。

```typescript
await lh.sendFlexToFriend('friend-uuid', JSON.stringify(flexContent))
```

### getAuthUrl(options?)

友だち追加 + UUID 取得の URL 生成。

```typescript
const url = lh.getAuthUrl({ ref: 'instagram', redirect: 'https://example.com/thanks' })
```

---

## エラーハンドリング

### LineHarnessError

全 HTTP エラーは `LineHarnessError` としてスローされる。

```typescript
import { LineHarnessError } from '@line-harness/sdk'

try {
  await lh.friends.get('nonexistent')
} catch (err) {
  if (err instanceof LineHarnessError) {
    console.log(err.message)   // "Friend not found"
    console.log(err.status)    // 404
    console.log(err.endpoint)  // "GET /api/friends/nonexistent"
  }
}
```

| プロパティ | 型 | 説明 |
|-----------|------|------|
| message | string | エラーメッセージ (API の `error` フィールド or HTTP ステータス) |
| status | number | HTTP ステータスコード |
| endpoint | string | `{METHOD} {path}` 形式 |

---

## TypeScript 型リファレンス

主要エクスポート型:

```typescript
// 設定
LineHarnessConfig

// API レスポンス
ApiResponse<T>          // { success, data, error? }
PaginatedData<T>        // { items, total, page, limit, hasNextPage }

// Enum 型
ScenarioTriggerType     // 'friend_add' | 'tag_added' | 'manual'
MessageType             // 'text' | 'image' | 'flex'
BroadcastStatus         // 'draft' | 'scheduled' | 'sending' | 'sent'

// リソース型
Friend, FriendListParams
Tag, CreateTagInput
Scenario, ScenarioListItem, ScenarioWithSteps, ScenarioStep
CreateScenarioInput, CreateStepInput, UpdateScenarioInput, UpdateStepInput
FriendScenarioEnrollment
Broadcast, CreateBroadcastInput, UpdateBroadcastInput
SegmentRule, SegmentCondition
RichMenu, RichMenuBounds, RichMenuAction, RichMenuArea, CreateRichMenuInput
TrackedLink, LinkClick, TrackedLinkWithClicks, CreateTrackedLinkInput
Form, FormField, CreateFormInput, UpdateFormInput, FormSubmission
StepDefinition          // { delay, type, content }

// エラー
LineHarnessError
```

---

## 完全なコード例

### 友だち追加後の自動シナリオ構築

```typescript
import { LineHarness } from '@line-harness/sdk'

const lh = new LineHarness({
  apiUrl: 'https://line-crm-worker.line-crm-api.workers.dev',
  apiKey: process.env.LINE_HARNESS_API_KEY!,
})

// 1. タグ作成
const vipTag = await lh.tags.create({ name: 'VIP候補', color: '#F59E0B' })

// 2. ウェルカムシナリオ作成
const scenario = await lh.createStepScenario('VIPウェルカム', 'tag_added', [
  { delay: '0m', type: 'text', content: 'VIP候補に選ばれました！特別なご案内をお送りします。' },
  { delay: '1d', type: 'text', content: '限定コンテンツのご案内です。' },
  { delay: '3d', type: 'flex', content: JSON.stringify({
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: '特別オファー', weight: 'bold', size: 'xl' }
    ]}
  })},
])

// 3. 友だちにタグ付け（自動でシナリオ開始）
const friends = await lh.friends.list({ limit: 10 })
for (const friend of friends.items) {
  await lh.friends.addTag(friend.id, vipTag.id)
}
```
