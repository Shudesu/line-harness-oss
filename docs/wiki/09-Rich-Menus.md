# 9. リッチメニュー (Rich Menus)

## 概要

LINE Harnessのリッチメニュー機能は、LINE Bot APIのリッチメニューエンドポイントを直接ラップする形で提供される。D1にリッチメニューデータを保持するのではなく、LINE Platform側のリッチメニューを管理する。作成・削除・デフォルト設定・ユーザー別アサイン・画像アップロードの全操作がAPI経由で行える。

## アーキテクチャ

```
管理者/AI → LINE Harness API → LINE Messaging API → LINE Platform
                                                       ↓
                                                友だちのLINEアプリに表示
```

リッチメニューの実体はLINE Platform上に存在する。LINE Harnessはプロキシとして機能し、LINE Messaging APIの`richmenu-*`エンドポイントを呼び出す。

## データモデル

リッチメニューはLINE Platform上で管理されるため、D1テーブルは存在しない。APIレスポンスのデータ構造は以下の通り。

### RichMenu オブジェクト

| フィールド | 型 | 説明 |
|---|---|---|
| `richMenuId` | string | LINE Platformが発行するリッチメニューID |
| `size` | object | `{ width: number, height: number }` |
| `selected` | boolean | デフォルトでメニューを開いた状態にするか |
| `name` | string | 管理用名前（ユーザーには非表示） |
| `chatBarText` | string | チャット画面下部に表示されるテキスト |
| `areas` | RichMenuArea[] | タップ領域とアクションの配列 |

### サイズオプション

LINE Platformが許可するリッチメニューサイズは2種類のみ:

| サイズ名 | width | height | 用途 |
|---|---|---|---|
| フルサイズ | 2500 | 1686 | 6分割メニュー（標準） |
| ハーフサイズ | 2500 | 843 | 3分割メニュー（コンパクト） |

### RichMenuArea

```json
{
  "bounds": {
    "x": 0,
    "y": 0,
    "width": 833,
    "height": 843
  },
  "action": {
    "type": "uri",
    "uri": "https://example.com",
    "label": "詳細を見る"
  }
}
```

### アクションタイプ

| type | 必須パラメータ | 説明 |
|---|---|---|
| `postback` | `data`, `displayText?` | ポストバックイベントを送信 |
| `message` | `text` | ユーザーがテキストメッセージを送信 |
| `uri` | `uri` | URLを開く |
| `datetimepicker` | `data`, `mode` | 日時選択ダイアログ表示。modeは `date`/`time`/`datetime` |
| `richmenuswitch` | `richMenuAliasId`, `data` | 別のリッチメニューに切り替え |

## デフォルト vs ユーザー別アサイン

### デフォルトリッチメニュー

全友だちに適用されるリッチメニュー。個別アサインがない友だちに表示される。

```
POST /api/rich-menus/:id/default
```

### ユーザー別アサイン

特定の友だちに個別のリッチメニューをアサインする。デフォルトメニューより優先される。

```
POST /api/friends/:friendId/rich-menu   — アサイン
DELETE /api/friends/:friendId/rich-menu  — アサイン解除（デフォルトに戻る）
```

### 優先順位

1. ユーザー別にアサインされたリッチメニュー（最優先）
2. デフォルトリッチメニュー
3. なし（リッチメニュー非表示）

## タグベースのメニュー切替

LINE Harnessのオートメーション機能（14-Automation.md参照）と連携して、タグに基づくメニュー自動切替が可能。

### 実現方法

オートメーションルールで `tag_change` イベントに `switch_rich_menu` アクションを設定:

```json
{
  "eventType": "tag_change",
  "conditions": { "tag_id": "vip-tag-uuid" },
  "actions": [
    { "type": "switch_rich_menu", "params": { "richMenuId": "richmenu-xxx" } }
  ]
}
```

これにより、友だちに「VIP」タグが付与された瞬間にリッチメニューが自動的にVIP用に切り替わる。

## 画像アップロード

リッチメニュー作成後、画像をアップロードする必要がある。2つの方法をサポート。

### 方法1: Base64 JSON

```
POST /api/rich-menus/:id/image
Content-Type: application/json

{ "image": "base64エンコードされた画像データ", "contentType": "image/png" }
```

`data:image/png;base64,...` 形式のData URIプレフィックスは自動的に除去される。

### 方法2: バイナリアップロード

```
POST /api/rich-menus/:id/image
Content-Type: image/png

[バイナリデータ]
```

### 画像要件

- フォーマット: PNG または JPEG
- フルサイズ: 2500x1686px
- ハーフサイズ: 2500x843px
- ファイルサイズ: 1MB以下

---

## APIエンドポイント

### 全リッチメニュー一覧取得

```bash
curl -X GET "https://your-worker.your-subdomain.workers.dev/api/rich-menus" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "richMenuId": "richmenu-xxxxxxxxxxxxxxxxx",
      "size": { "width": 2500, "height": 1686 },
      "selected": true,
      "name": "メインメニュー",
      "chatBarText": "メニューを開く",
      "areas": [
        {
          "bounds": { "x": 0, "y": 0, "width": 833, "height": 843 },
          "action": { "type": "uri", "uri": "https://example.com/page1", "label": "ページ1" }
        },
        {
          "bounds": { "x": 833, "y": 0, "width": 833, "height": 843 },
          "action": { "type": "message", "text": "料金プラン", "label": "料金" }
        },
        {
          "bounds": { "x": 1666, "y": 0, "width": 834, "height": 843 },
          "action": { "type": "postback", "data": "action=contact", "label": "お問い合わせ" }
        }
      ]
    }
  ]
}
```

### リッチメニュー作成

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/rich-menus" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "size": { "width": 2500, "height": 1686 },
    "selected": true,
    "name": "VIPメニュー",
    "chatBarText": "VIPメニュー",
    "areas": [
      {
        "bounds": { "x": 0, "y": 0, "width": 1250, "height": 843 },
        "action": { "type": "uri", "uri": "https://example.com/vip", "label": "VIP特典" }
      },
      {
        "bounds": { "x": 1250, "y": 0, "width": 1250, "height": 843 },
        "action": { "type": "message", "text": "VIPサポート", "label": "サポート" }
      },
      {
        "bounds": { "x": 0, "y": 843, "width": 1250, "height": 843 },
        "action": { "type": "uri", "uri": "https://example.com/shop", "label": "限定ショップ" }
      },
      {
        "bounds": { "x": 1250, "y": 843, "width": 1250, "height": 843 },
        "action": {
          "type": "richmenuswitch",
          "richMenuAliasId": "richmenu-alias-basic",
          "data": "switch_to_basic",
          "label": "通常メニューに戻る"
        }
      }
    ]
  }'
```

**レスポンス:**

```json
{
  "success": true,
  "data": { "richMenuId": "richmenu-xxxxxxxxxxxxxxxxx" }
}
```

### リッチメニュー画像アップロード（Base64）

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/rich-menus/richmenu-xxx/image" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "image": "/9j/4AAQSkZJRg...(base64)...", "contentType": "image/jpeg" }'
```

### リッチメニュー画像アップロード（バイナリ）

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/rich-menus/richmenu-xxx/image" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: image/png" \
  --data-binary @menu-image.png
```

**レスポンス:**

```json
{ "success": true, "data": null }
```

### デフォルトリッチメニュー設定

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/rich-menus/richmenu-xxx/default" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{ "success": true, "data": null }
```

### 友だちにリッチメニューをアサイン

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/friends/FRIEND_UUID/rich-menu" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "richMenuId": "richmenu-xxx" }'
```

**レスポンス:**

```json
{ "success": true, "data": null }
```

### 友だちのリッチメニューアサイン解除

```bash
curl -X DELETE "https://your-worker.your-subdomain.workers.dev/api/friends/FRIEND_UUID/rich-menu" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{ "success": true, "data": null }
```

### リッチメニュー削除

```bash
curl -X DELETE "https://your-worker.your-subdomain.workers.dev/api/rich-menus/richmenu-xxx" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{ "success": true, "data": null }
```

---

## 典型的な運用フロー

### 1. メニュー作成 → 画像アップロード → デフォルト設定

```bash
# 1. メニュー構造を作成
MENU_ID=$(curl -s -X POST ".../api/rich-menus" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "size":{"width":2500,"height":1686}, "selected":true, "name":"Main", "chatBarText":"Menu", "areas":[...] }' \
  | jq -r '.data.richMenuId')

# 2. 画像をアップロード
curl -X POST ".../api/rich-menus/$MENU_ID/image" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: image/png" \
  --data-binary @main-menu.png

# 3. デフォルトに設定
curl -X POST ".../api/rich-menus/$MENU_ID/default" \
  -H "Authorization: Bearer $KEY"
```

### 2. VIP用メニューの自動切替

オートメーションAPI（14-Automation.md参照）と組み合わせて設定:

```bash
# VIPタグ付与時にVIPメニューに自動切替するオートメーション作成
curl -X POST ".../api/automations" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "VIPメニュー切替",
    "eventType": "tag_change",
    "conditions": { "tag_id": "VIP_TAG_ID" },
    "actions": [
      { "type": "switch_rich_menu", "params": { "richMenuId": "richmenu-vip-xxx" } }
    ]
  }'
```

## ソースコード参照

- Worker APIルート: `apps/worker/src/routes/rich-menus.ts`
- SDK リソース: `packages/sdk/src/resources/rich-menus.ts`
- SDK 型定義: `packages/sdk/src/types.ts` (RichMenu, RichMenuArea, RichMenuAction, CreateRichMenuInput)
