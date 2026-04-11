# 10. トラッキングリンク (Tracked Links)

## 概要

トラッキングリンクは、URLクリック計測機能を提供する。オリジナルURLをラップした短縮トラッキングURLを生成し、クリック時に以下を自動実行できる:

1. クリックを記録（誰が・いつクリックしたか）
2. 友だちにタグを自動付与
3. 友だちをシナリオに自動登録

L社の「URLクリック計測」に相当する機能。

## アーキテクチャ (v0.4.0)

```
[LINEアプリ内]
友だち → /t/:linkId → User-Agent検知(LINE) → LIFF経由 → ?lu=lineUserId付与
  → /t/:linkId?lu=xxx → friendId解決 → 302リダイレクト → オリジナルURL
                          ↓ (waitUntil非同期)
                     クリック記録(ユーザー特定済み)
                     タグ付与 / シナリオ登録

[PCブラウザ]
友だち → /t/:linkId → User-Agent検知(PC) → 302リダイレクト → オリジナルURL
                          ↓ (waitUntil非同期)
                     クリック記録(friendId=null)
```

- **LINEアプリ**: LIFF SDK でユーザーを自動特定、`friendDisplayName` 付きで記録
- **PCブラウザ**: ログイン不要で直リダイレクト、クリック数のみ記録
- リダイレクトは即座に返し、副作用は `waitUntil` で非同期実行

### URL自動追跡 (v0.4.0)

`send_message` / `broadcast` / ステップ配信で送信するメッセージ中の URL は自動的にトラッキングリンクに変換される。テキストメッセージの場合は Flex メッセージ（ボタン付き）に自動変換され、長いURLが表示されない。

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
https://your-worker.your-subdomain.workers.dev/t/{linkId}?f={friendId}
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
  "trackingUrl": "https://your-worker.your-subdomain.workers.dev/t/550e8400-e29b-41d4-a716-446655440000",
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
  "trackingUrl": "https://your-worker.your-subdomain.workers.dev/t/550e8400-...",
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
curl -X GET "https://your-worker.your-subdomain.workers.dev/api/tracked-links" \
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
      "trackingUrl": "https://your-worker.your-subdomain.workers.dev/t/uuid-1",
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
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/tracked-links" \
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
    "trackingUrl": "https://your-worker.your-subdomain.workers.dev/t/new-uuid",
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
curl -X GET "https://your-worker.your-subdomain.workers.dev/api/tracked-links/LINK_UUID" \
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
    "trackingUrl": "https://your-worker.your-subdomain.workers.dev/t/LINK_UUID",
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
curl -X DELETE "https://your-worker.your-subdomain.workers.dev/api/tracked-links/LINK_UUID" \
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
curl -L "https://your-worker.your-subdomain.workers.dev/t/LINK_UUID?f=FRIEND_UUID"

# 匿名（リッチメニューやWebページに配置）
curl -L "https://your-worker.your-subdomain.workers.dev/t/LINK_UUID"
```

レスポンス: `302 Found` → `Location: https://example.com/seminar` にリダイレクト

---

## 活用パターン

### パターン1: メッセージ内でクリック計測

シナリオのテキストメッセージ内にトラッキングURLを埋め込む:

```
セミナーの詳細はこちら:
https://your-worker.your-subdomain.workers.dev/t/LINK_UUID?f={friendId}
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

## キャンペーンメッセージ (v0.10+)

トラッキングリンクは、流入時 (intro) と特典送付時 (reward) のメッセージテンプレートを紐付けられる。これにより 1 つのフォームを複数キャンペーンで再利用しても、各キャンペーンが独自の文面を出せる。

### 追加カラム

| カラム | 用途 | マイグレーション |
|---|---|---|
| `intro_template_id` | 友だち追加直後（form push 直前）に届く push メッセージのテンプレ | `020_tracked_link_intro.sql` |
| `reward_template_id` | フォーム送信 + verify 通過後に届く特典メッセージのテンプレ | `021_tracked_link_reward.sql` |

両方とも `message_templates(id)` を参照。NULL の場合はデフォルト挙動（intro: ハードコード Flex / reward: フォームの `on_submit_message_*`）。

### intro メッセージ

`/r/:ref?form=FORM_ID` 経由で友だち追加 + LIFF 起動した直後に発火。テンプレ内に `{formUrl}` を含めると送信時に実 LIFF フォーム URL に置換される。

`{formUrl}` を含まないテンプレや壊れた Flex JSON は安全のためデフォルト Flex (`apps/worker/src/services/intro-message.ts:DEFAULT_FORM_LINK_FLEX`) にフォールバック。

### reward メッセージ — キャンペーン単位の解決 (v0.10.1+)

フォーム送信 + verify 通過後の reward は、**当該キャンペーンの tracked link** (= LIFF URL の `?ref=`) に紐付いた `reward_template_id` から解決される。LIFF クライアントが `?ref=` を読み取り、`/api/forms/:id/submit` の body に `trackedLinkId` として乗せる。

解決優先度 (`apps/worker/src/services/reward-resolver.ts`):

1. `body.trackedLinkId` が指定され、該当 link が DB に存在する場合
   - その link の `reward_template_id` を採用
   - `reward_template_id` が NULL なら `null` を返し、フォームの `on_submit_message_*` に委譲（**他キャンペーンに漏らさない**）
2. 上記が不発（`trackedLinkId` 不明 / link が見つからない）な場合
   - `friends.first_tracked_link_id` (first-touch attribution) にフォールバック
3. それも不発なら `null` を返し、フォームの `on_submit_message_*` を使う

テンプレ内 `{displayName}` は friend 表示名に置換される（JSON-escape 済みなので Flex でも壊れない）。

#### v0.10.0 → v0.10.1 の挙動差

| シナリオ | v0.10.0 | v0.10.1 |
|---|---|---|
| 既存友だちが新キャンペーンの link → 同じフォームを再 submit | 古い (first-touch) キャンペーンの reward | 新しいキャンペーンの reward |
| 新キャンペーンの link で `reward_template_id=NULL` → submit | 古いキャンペーンの reward が漏れる（バグ） | フォームの `on_submit_message_*` にフォールバック |
| `?ref=` なし（古いリンク経由） | first-touch reward | first-touch reward（後方互換） |

#### セキュリティモデルの変更

v0.10.0 は `friends.first_tracked_link_id` への 1 回 pin によって URL 改ざんによる reward 奪取を防いでいた。v0.10.1 はその境界を意図的に緩める：

- `/api/forms/:id/submit` の `body.trackedLinkId` を信用するため、攻撃者が手動でリクエストを書き換えると別キャンペーンの reward を取得し得る
- 本プロジェクトはオプトイン誘導が目的で、上流のエンゲージメントゲート (X Harness 連携など) が真のアンチフラウドを担う前提
- リプレイ防止層 (`link_clicks.reward_claimed_at` 等) は意図的に **追加していない**

### MCP からテンプレを紐付ける

```
manage_tracked_links action=update linkId=<id> introTemplateId=<msg-template-id> rewardTemplateId=<msg-template-id>
```

`introTemplateId` / `rewardTemplateId` を `null` に設定すれば紐付け解除。

## ソースコード参照

- Worker APIルート: `apps/worker/src/routes/tracked-links.ts`
- フォーム送信ハンドラ (reward 解決呼び出し): `apps/worker/src/routes/forms.ts`
- reward 解決サービス (純粋関数 + Vitest): `apps/worker/src/services/reward-resolver.ts`
- intro メッセージ生成: `apps/worker/src/services/intro-message.ts`
- reward メッセージ生成 (Flex 描画): `apps/worker/src/services/reward-message.ts`
- DB クエリ: `packages/db/src/tracked-links.ts`
- SDK リソース: `packages/sdk/src/resources/tracked-links.ts`
- マイグレーション: `packages/db/migrations/006_tracked_links.sql`, `020_tracked_link_intro.sql`, `021_tracked_link_reward.sql`, `022_friend_first_tracked_link.sql`
