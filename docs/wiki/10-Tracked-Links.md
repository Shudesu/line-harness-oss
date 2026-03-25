# 10. トラッキングリンク (Tracked Links)

## 概要

トラッキングリンクは、URLクリック計測機能を提供する。オリジナルURLをラップした短縮トラッキングURLを生成し、クリック時に以下を自動実行できる:

1. クリックを記録（誰が・いつクリックしたか）
2. 友だちにタグを自動付与
3. 友だちをシナリオに自動登録

L社の「URLクリック計測」に相当する機能。

## アーキテクチャ

```
友だち → /t/:linkId?f=friendId → 302リダイレクト → オリジナルURL
              ↓ (waitUntil非同期)
         クリック記録
         タグ付与
         シナリオ登録
```

リダイレクトは即座に返し、副作用（記録・タグ付与・シナリオ登録）は `waitUntil` で非同期実行される。友だちの体感レイテンシは最小限。

## データモデル

### tracked_links テーブル

```sql
CREATE TABLE tracked_links (
  id TEXT PRIMARY KEY,                                          -- UUID
  name TEXT NOT NULL,                                           -- 管理用名前
  original_url TEXT NOT NULL,                                   -- リダイレクト先URL
  tag_id TEXT REFERENCES tags (id) ON DELETE SET NULL,          -- クリック時に付与するタグ
  scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL, -- クリック時に登録するシナリオ
  is_active INTEGER NOT NULL DEFAULT 1,                         -- 有効/無効
  click_count INTEGER NOT NULL DEFAULT 0,                       -- 総クリック数キャッシュ
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### link_clicks テーブル

```sql
CREATE TABLE link_clicks (
  id TEXT PRIMARY KEY,                                                -- UUID
  tracked_link_id TEXT NOT NULL REFERENCES tracked_links (id) ON DELETE CASCADE,
  friend_id TEXT REFERENCES friends (id) ON DELETE SET NULL,          -- NULL=匿名クリック
  clicked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_link_clicks_link ON link_clicks (tracked_link_id);
CREATE INDEX idx_link_clicks_friend ON link_clicks (friend_id);
```

## クリック記録メカニズム

### トラッキングURL形式

```
https://line-crm-worker.line-crm-api.workers.dev/t/{linkId}?f={friendId}
```

- `linkId`: tracked_linksのID（UUID）
- `f`: friendsテーブルのID（オプション。メッセージ内で動的に埋め込む）

### 処理フロー

1. `GET /t/:linkId` にアクセス
2. DBからトラッキングリンク情報を取得
3. リンクが存在しないまたは無効 → 404
4. **即座に302リダイレクト**を返す
5. `waitUntil` で非同期に以下を実行:
   - `link_clicks` にクリック記録を挿入
   - `tracked_links.click_count` をインクリメント
   - `f` パラメータがある場合:
     - `tag_id` が設定されていればタグを付与
     - `scenario_id` が設定されていればシナリオに登録

### 匿名クリック vs 友だち紐付きクリック

| パターン | `f` パラメータ | クリック記録 | タグ付与 | シナリオ登録 |
|---|---|---|---|---|
| 匿名 | なし | `friend_id=NULL` で記録 | なし | なし |
| 友だち特定 | あり | `friend_id` 付きで記録 | 実行 | 実行 |

## APIレスポンス形式

### TrackedLink オブジェクト

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "セミナーLP",
  "originalUrl": "https://example.com/seminar",
  "trackingUrl": "https://line-crm-worker.line-crm-api.workers.dev/t/550e8400-e29b-41d4-a716-446655440000",
  "tagId": "tag-uuid-or-null",
  "scenarioId": "scenario-uuid-or-null",
  "isActive": true,
  "clickCount": 42,
  "createdAt": "2026-03-22T10:00:00.000",
  "updatedAt": "2026-03-22T10:00:00.000"
}
```

`trackingUrl` はAPIが自動生成する（`{baseUrl}/t/{id}` 形式）。

### TrackedLinkWithClicks オブジェクト（詳細取得時）

```json
{
  "id": "550e8400-...",
  "name": "セミナーLP",
  "originalUrl": "https://example.com/seminar",
  "trackingUrl": "https://line-crm-worker.line-crm-api.workers.dev/t/550e8400-...",
  "tagId": null,
  "scenarioId": null,
  "isActive": true,
  "clickCount": 3,
  "createdAt": "2026-03-22T10:00:00.000",
  "updatedAt": "2026-03-22T15:30:00.000",
  "clicks": [
    {
      "id": "click-uuid-1",
      "friendId": "friend-uuid-1",
      "friendDisplayName": "田中太郎",
      "clickedAt": "2026-03-22T15:30:00.000"
    },
    {
      "id": "click-uuid-2",
      "friendId": null,
      "friendDisplayName": null,
      "clickedAt": "2026-03-22T14:00:00.000"
    }
  ]
}
```

---

## APIエンドポイント

### トラッキングリンク一覧取得

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/tracked-links" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-1",
      "name": "セミナーLP",
      "originalUrl": "https://example.com/seminar",
      "trackingUrl": "https://line-crm-worker.line-crm-api.workers.dev/t/uuid-1",
      "tagId": "tag-uuid",
      "scenarioId": null,
      "isActive": true,
      "clickCount": 42,
      "createdAt": "2026-03-22T10:00:00.000",
      "updatedAt": "2026-03-22T15:00:00.000"
    }
  ]
}
```

### トラッキングリンク作成

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/tracked-links" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "3月セミナー申込LP",
    "originalUrl": "https://example.com/seminar-march",
    "tagId": "tag-uuid-seminar-interested",
    "scenarioId": "scenario-uuid-seminar-followup"
  }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": {
    "id": "new-uuid",
    "name": "3月セミナー申込LP",
    "originalUrl": "https://example.com/seminar-march",
    "trackingUrl": "https://line-crm-worker.line-crm-api.workers.dev/t/new-uuid",
    "tagId": "tag-uuid-seminar-interested",
    "scenarioId": "scenario-uuid-seminar-followup",
    "isActive": true,
    "clickCount": 0,
    "createdAt": "2026-03-22T10:00:00.000",
    "updatedAt": "2026-03-22T10:00:00.000"
  }
}
```

### トラッキングリンク詳細取得（クリック履歴付き）

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/tracked-links/LINK_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": {
    "id": "LINK_UUID",
    "name": "セミナーLP",
    "originalUrl": "https://example.com/seminar",
    "trackingUrl": "https://line-crm-worker.line-crm-api.workers.dev/t/LINK_UUID",
    "tagId": "tag-uuid",
    "scenarioId": null,
    "isActive": true,
    "clickCount": 2,
    "createdAt": "2026-03-22T10:00:00.000",
    "updatedAt": "2026-03-22T15:00:00.000",
    "clicks": [
      {
        "id": "click-1",
        "friendId": "friend-uuid-1",
        "friendDisplayName": "佐藤花子",
        "clickedAt": "2026-03-22T15:00:00.000"
      },
      {
        "id": "click-2",
        "friendId": null,
        "friendDisplayName": null,
        "clickedAt": "2026-03-22T12:00:00.000"
      }
    ]
  }
}
```

### トラッキングリンク削除

```bash
curl -X DELETE "https://line-crm-worker.line-crm-api.workers.dev/api/tracked-links/LINK_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{ "success": true, "data": null }
```

### クリックトラッキング（リダイレクト）

認証不要。メッセージ内に埋め込むURL。

```bash
# 友だち特定（メッセージ内で動的にfriendIdを埋め込む）
curl -L "https://line-crm-worker.line-crm-api.workers.dev/t/LINK_UUID?f=FRIEND_UUID"

# 匿名（リッチメニューやWebページに配置）
curl -L "https://line-crm-worker.line-crm-api.workers.dev/t/LINK_UUID"
```

レスポンス: `302 Found` → `Location: https://example.com/seminar` にリダイレクト

---

## 活用パターン

### パターン1: メッセージ内でクリック計測

シナリオのテキストメッセージ内にトラッキングURLを埋め込む:

```
セミナーの詳細はこちら:
https://line-crm-worker.line-crm-api.workers.dev/t/LINK_UUID?f={friendId}
```

`{friendId}` はステップ配信時にシステムが自動で実際のfriendIdに置換する想定。

### パターン2: クリック→タグ→メニュー切替の連鎖

1. トラッキングリンク作成時に `tagId` を設定
2. オートメーションで `tag_change` イベントにリッチメニュー切替を設定
3. 友だちがリンクをクリック → タグ付与 → メニュー自動切替

### パターン3: クリック分析

```bash
# リンクの詳細を取得してクリック率を計算
curl -s ".../api/tracked-links/LINK_UUID" -H "Authorization: Bearer $KEY" | \
  jq '{clickCount: .data.clickCount, uniqueClickers: (.data.clicks | map(.friendId) | unique | length)}'
```

## ソースコード参照

- Worker APIルート: `apps/worker/src/routes/tracked-links.ts`
- DB クエリ: `packages/db/src/tracked-links.ts`
- SDK リソース: `packages/sdk/src/resources/tracked-links.ts`
- マイグレーション: `packages/db/migrations/006_tracked_links.sql`
