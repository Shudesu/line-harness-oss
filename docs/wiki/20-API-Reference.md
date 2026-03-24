# 20. API リファレンス

LINE Harness REST API の完全なエンドポイント一覧。

---

## 認証

全ての保護エンドポイントは Bearer トークン認証を必要とする。

```
Authorization: Bearer YOUR_API_KEY
```

API キーは環境変数 `API_KEY` で設定 (`wrangler secret put API_KEY`)。

### 公開エンドポイント (認証不要)

| パス | 説明 |
|------|------|
| `POST /webhook` | LINE Messaging API Webhook (署名検証) |
| `GET /docs` | Swagger UI ドキュメント |
| `GET /openapi.json` | OpenAPI 3.1 スペック |
| `POST /api/affiliates/click` | アフィリエイトクリック記録 |
| `GET /t/:linkId` | トラッキングリンクリダイレクト |
| `GET/POST /api/liff/*` | LIFF エンドポイント |
| `GET/POST /auth/*` | LINE OAuth 認証 |
| `POST /api/integrations/stripe/webhook` | Stripe Webhook |
| `POST /api/webhooks/incoming/:id/receive` | 受信 Webhook |
| `POST /api/forms/:id/submit` | フォーム送信 |
| `GET /api/forms/:id` | フォーム定義取得 |

---

## ベース URL

```
https://line-crm-worker.line-crm-api.workers.dev
```

---

## レスポンス形式

### 成功時
```json
{ "success": true, "data": { ... } }
```

### エラー時
```json
{ "success": false, "error": "エラーメッセージ" }
```

### ページネーション
```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 150,
    "page": 1,
    "limit": 50,
    "hasNextPage": true
  }
}
```

クエリパラメータ: `limit` (デフォルト 50), `offset` (デフォルト 0)

---

## エンドポイント一覧

### /api/friends/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/friends` | 友だち一覧 (ページネーション) | query: `limit`, `offset`, `tagId` |
| GET | `/api/friends/count` | 友だち総数 | - |
| GET | `/api/friends/:id` | 友だち詳細 (タグ含む) | - |
| POST | `/api/friends/:id/tags` | タグ追加 | `{ tagId }` |
| DELETE | `/api/friends/:id/tags/:tagId` | タグ削除 | - |
| PUT | `/api/friends/:id/metadata` | メタデータ更新 (マージ) | `{ key: value, ... }` |
| POST | `/api/friends/:id/messages` | メッセージ送信 | `{ content, messageType? }` |
| POST | `/api/friends/:id/rich-menu` | リッチメニューリンク | `{ richMenuId }` |
| DELETE | `/api/friends/:id/rich-menu` | リッチメニュー解除 | - |
| GET | `/api/friends/:id/score` | スコア取得 | - |
| POST | `/api/friends/:id/score` | 手動スコア加算 | `{ scoreChange, reason? }` |
| GET | `/api/friends/:friendId/reminders` | 友だちのリマインダー一覧 | - |

### /api/tags/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/tags` | タグ一覧 | - |
| POST | `/api/tags` | タグ作成 | `{ name, color? }` |
| DELETE | `/api/tags/:id` | タグ削除 | - |

### /api/scenarios/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/scenarios` | シナリオ一覧 (stepCount含む) | - |
| GET | `/api/scenarios/:id` | シナリオ詳細 (steps含む) | - |
| POST | `/api/scenarios` | シナリオ作成 | `{ name, triggerType, description?, triggerTagId?, isActive? }` |
| PUT | `/api/scenarios/:id` | シナリオ更新 | `{ name?, triggerType?, description?, triggerTagId?, isActive? }` |
| DELETE | `/api/scenarios/:id` | シナリオ削除 | - |
| POST | `/api/scenarios/:id/steps` | ステップ追加 | `{ stepOrder, delayMinutes?, messageType, messageContent, conditionType?, conditionValue?, nextStepOnFalse? }` |
| PUT | `/api/scenarios/:id/steps/:stepId` | ステップ更新 | 同上 (全フィールドオプション) |
| DELETE | `/api/scenarios/:id/steps/:stepId` | ステップ削除 | - |
| POST | `/api/scenarios/:id/enroll/:friendId` | 手動エンロール | - |

triggerType: `friend_add`, `tag_added`, `manual`
messageType: `text`, `image`, `flex`

### /api/broadcasts/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/broadcasts` | 配信一覧 | - |
| GET | `/api/broadcasts/:id` | 配信詳細 | - |
| POST | `/api/broadcasts` | 配信作成 | `{ title, messageType, messageContent, targetType, targetTagId?, scheduledAt? }` |
| PUT | `/api/broadcasts/:id` | 配信更新 (draft/scheduled のみ) | 同上 (全フィールドオプション) |
| DELETE | `/api/broadcasts/:id` | 配信削除 | - |
| POST | `/api/broadcasts/:id/send` | 即時配信 | - |
| POST | `/api/broadcasts/:id/send-segment` | セグメント配信 | `{ conditions: { operator, rules[] } }` |

targetType: `all`, `tag`
status: `draft`, `scheduled`, `sending`, `sent`

### /api/rich-menus/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/rich-menus` | リッチメニュー一覧 (LINE API) | - |
| POST | `/api/rich-menus` | リッチメニュー作成 | `{ size, selected, name, chatBarText, areas[] }` |
| DELETE | `/api/rich-menus/:id` | リッチメニュー削除 | - |
| POST | `/api/rich-menus/:id/default` | デフォルト設定 | - |
| POST | `/api/rich-menus/:id/image` | 画像アップロード | base64 JSON or raw binary |

### /api/tracked-links/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/tracked-links` | トラッキングリンク一覧 | - |
| GET | `/api/tracked-links/:id` | 詳細 (クリック履歴含む) | - |
| POST | `/api/tracked-links` | リンク作成 | `{ name, originalUrl, tagId?, scenarioId? }` |
| DELETE | `/api/tracked-links/:id` | リンク削除 | - |
| GET | `/t/:linkId` | リダイレクト (認証不要) | query: `f` (friendId) |

### /api/forms/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/forms` | フォーム一覧 | - |
| GET | `/api/forms/:id` | フォーム詳細 (認証不要) | - |
| POST | `/api/forms` | フォーム作成 | `{ name, description?, fields[], onSubmitTagId?, onSubmitScenarioId?, saveToMetadata? }` |
| PUT | `/api/forms/:id` | フォーム更新 | 同上 + `isActive?` |
| DELETE | `/api/forms/:id` | フォーム削除 | - |
| GET | `/api/forms/:id/submissions` | 回答一覧 | - |
| POST | `/api/forms/:id/submit` | フォーム送信 (認証不要) | `{ lineUserId?, friendId?, data? }` |

fields の type: `text`, `email`, `tel`, `number`, `textarea`, `select`, `radio`, `checkbox`, `date`

### /api/reminders/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/reminders` | リマインダー一覧 | - |
| GET | `/api/reminders/:id` | リマインダー詳細 (steps含む) | - |
| POST | `/api/reminders` | リマインダー作成 | `{ name, description? }` |
| PUT | `/api/reminders/:id` | リマインダー更新 | - |
| DELETE | `/api/reminders/:id` | リマインダー削除 | - |
| POST | `/api/reminders/:id/steps` | ステップ追加 | `{ offsetMinutes, messageType, messageContent }` |
| DELETE | `/api/reminders/:reminderId/steps/:stepId` | ステップ削除 | - |
| POST | `/api/reminders/:id/enroll/:friendId` | 友だち登録 | `{ targetDate }` |
| DELETE | `/api/friend-reminders/:id` | 友だちリマインダーキャンセル | - |

### /api/scoring-rules/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/scoring-rules` | ルール一覧 | - |
| GET | `/api/scoring-rules/:id` | ルール詳細 | - |
| POST | `/api/scoring-rules` | ルール作成 | `{ name, eventType, scoreValue }` |
| PUT | `/api/scoring-rules/:id` | ルール更新 | - |
| DELETE | `/api/scoring-rules/:id` | ルール削除 | - |

### /api/automations/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/automations` | 自動化ルール一覧 | - |
| GET | `/api/automations/:id` | 詳細 (ログ含む) | - |
| POST | `/api/automations` | ルール作成 | `{ name, eventType, actions[], description?, conditions?, priority? }` |
| PUT | `/api/automations/:id` | ルール更新 | - |
| DELETE | `/api/automations/:id` | ルール削除 | - |
| GET | `/api/automations/:id/logs` | 実行ログ | query: `limit` |

### /api/webhooks/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/webhooks/incoming` | 受信 Webhook 一覧 | - |
| POST | `/api/webhooks/incoming` | 受信 Webhook 作成 | `{ name, sourceType?, secret? }` |
| PUT | `/api/webhooks/incoming/:id` | 更新 | - |
| DELETE | `/api/webhooks/incoming/:id` | 削除 | - |
| POST | `/api/webhooks/incoming/:id/receive` | 受信 (認証不要) | any JSON |
| GET | `/api/webhooks/outgoing` | 送信 Webhook 一覧 | - |
| POST | `/api/webhooks/outgoing` | 送信 Webhook 作成 | `{ name, url, eventTypes[], secret? }` |
| PUT | `/api/webhooks/outgoing/:id` | 更新 | - |
| DELETE | `/api/webhooks/outgoing/:id` | 削除 | - |

### /api/notifications/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/notifications` | 通知一覧 | query: `status`, `limit` |
| GET | `/api/notifications/rules` | 通知ルール一覧 | - |
| GET | `/api/notifications/rules/:id` | ルール詳細 | - |
| POST | `/api/notifications/rules` | ルール作成 | `{ name, eventType, conditions?, channels? }` |
| PUT | `/api/notifications/rules/:id` | ルール更新 | - |
| DELETE | `/api/notifications/rules/:id` | ルール削除 | - |

### /api/chats/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/chats` | チャット一覧 | query: `status`, `operatorId` |
| GET | `/api/chats/:id` | チャット詳細 (メッセージ履歴含む) | - |
| POST | `/api/chats` | チャット作成 | `{ friendId, operatorId? }` |
| PUT | `/api/chats/:id` | ステータス/担当更新 | `{ operatorId?, status?, notes? }` |
| POST | `/api/chats/:id/send` | メッセージ送信 | `{ content, messageType? }` |
| GET | `/api/operators` | オペレーター一覧 | - |
| POST | `/api/operators` | オペレーター作成 | `{ name, email, role? }` |
| PUT | `/api/operators/:id` | オペレーター更新 | - |
| DELETE | `/api/operators/:id` | オペレーター削除 | - |

### /api/conversions/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/conversions/points` | CV ポイント一覧 | - |
| POST | `/api/conversions/points` | CV ポイント作成 | `{ name, eventType, value? }` |
| DELETE | `/api/conversions/points/:id` | CV ポイント削除 | - |
| POST | `/api/conversions/track` | CV 記録 | `{ conversionPointId, friendId, userId?, affiliateCode?, metadata? }` |
| GET | `/api/conversions/events` | CV イベント一覧 | query: `conversionPointId`, `friendId`, `affiliateCode`, `startDate`, `endDate`, `limit`, `offset` |
| GET | `/api/conversions/report` | CV レポート | query: `startDate`, `endDate` |

### /api/affiliates/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/affiliates` | アフィリエイト一覧 | - |
| GET | `/api/affiliates/:id` | 詳細 | - |
| POST | `/api/affiliates` | 作成 | `{ name, code, commissionRate? }` |
| PUT | `/api/affiliates/:id` | 更新 | `{ name?, commissionRate?, isActive? }` |
| DELETE | `/api/affiliates/:id` | 削除 | - |
| POST | `/api/affiliates/click` | クリック記録 (認証不要) | `{ code, url? }` |
| GET | `/api/affiliates/:id/report` | 個別レポート | query: `startDate`, `endDate` |
| GET | `/api/affiliates-report` | 全体レポート | query: `startDate`, `endDate` |

### /api/users/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/users` | ユーザー一覧 | - |
| GET | `/api/users/:id` | ユーザー詳細 | - |
| POST | `/api/users` | ユーザー作成 | `{ email?, phone?, externalId?, displayName? }` |
| PUT | `/api/users/:id` | ユーザー更新 | 同上 |
| DELETE | `/api/users/:id` | ユーザー削除 | - |
| POST | `/api/users/:id/link` | 友だちリンク | `{ friendId }` |
| GET | `/api/users/:id/accounts` | リンク済み友だち一覧 | - |
| POST | `/api/users/match` | メール/電話検索 | `{ email?, phone? }` |

### /api/line-accounts/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/line-accounts` | アカウント一覧 (シークレット省略) | - |
| GET | `/api/line-accounts/:id` | 詳細 (シークレット含む) | - |
| POST | `/api/line-accounts` | 登録 | `{ channelId, name, channelAccessToken, channelSecret }` |
| PUT | `/api/line-accounts/:id` | 更新 | `{ name?, channelAccessToken?, channelSecret?, isActive? }` |
| DELETE | `/api/line-accounts/:id` | 削除 | - |

### /api/accounts/* (ヘルス & 移行)

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/accounts/:id/health` | ヘルス状態取得 | - |
| GET | `/api/accounts/migrations` | 移行一覧 | - |
| GET | `/api/accounts/migrations/:migrationId` | 移行詳細 | - |
| POST | `/api/accounts/:id/migrate` | 移行開始 | `{ toAccountId }` |

### /api/templates/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/templates` | テンプレート一覧 | query: `category` |
| GET | `/api/templates/:id` | テンプレート詳細 | - |
| POST | `/api/templates` | テンプレート作成 | `{ name, messageType, messageContent, category? }` |
| PUT | `/api/templates/:id` | テンプレート更新 | - |
| DELETE | `/api/templates/:id` | テンプレート削除 | - |

### /api/integrations/*

| メソッド | パス | 説明 | リクエストボディ |
|---------|------|------|----------------|
| GET | `/api/integrations/stripe/events` | Stripe イベント一覧 | query: `friendId`, `eventType`, `limit` |
| POST | `/api/integrations/stripe/webhook` | Stripe Webhook (認証不要) | Stripe イベントペイロード |

### その他

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/webhook` | LINE Messaging API Webhook (署名検証) |
| GET | `/docs` | Swagger UI |
| GET | `/openapi.json` | OpenAPI 3.1 JSON スペック |

---

## HTTP ステータスコード

| コード | 意味 |
|--------|------|
| 200 | 成功 |
| 201 | 作成成功 |
| 302 | リダイレクト (トラッキングリンク) |
| 400 | リクエスト不正 |
| 401 | 認証失敗 |
| 404 | リソース未発見 |
| 500 | サーバー内部エラー |
