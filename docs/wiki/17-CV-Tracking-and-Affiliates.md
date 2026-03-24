# 17. CV (コンバージョン) トラッキング & アフィリエイト

LINE Harness のコンバージョン計測・アフィリエイト管理・流入経路追跡の完全リファレンス。

---

## アーキテクチャ概要

```
[友だち] --click--> [アフィリエイトリンク] --record--> affiliate_clicks
    |
    v
[CV ポイント] --track--> conversion_events
    |                         |
    v                         v
[CV レポート]          [アフィリエイトレポート]
                              |
                              v
                       [Stripe 決済連携]
```

CVトラッキングは3つの柱で構成される:
1. **コンバージョンポイント** -- 計測対象の定義 (例: 「LINE友だち追加」「商品購入」)
2. **コンバージョンイベント** -- 実際の発生記録
3. **アフィリエイト** -- 紹介元の追跡とコミッション管理

---

## データモデル

### conversion_points テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | CV ポイント名 (例: "商品A購入") |
| event_type | TEXT NOT NULL | イベント種別 (例: "purchase", "signup") |
| value | REAL | CV あたりの金額 (円) |
| created_at | TEXT | JST タイムスタンプ |

### conversion_events テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT PK | UUID |
| conversion_point_id | TEXT FK | 紐づくCVポイント |
| friend_id | TEXT FK | CVした友だち |
| user_id | TEXT | UUID ユーザー (オプション) |
| affiliate_code | TEXT | アフィリエイトコード (オプション) |
| metadata | TEXT | JSON 形式の追加データ |
| created_at | TEXT | JST タイムスタンプ |

インデックス: `conversion_point_id`, `friend_id`, `affiliate_code`

### affiliates テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | アフィリエイター名 |
| code | TEXT UNIQUE NOT NULL | 紹介コード (例: "partner-a") |
| commission_rate | REAL DEFAULT 0 | コミッション率 (0.0-1.0) |
| is_active | INTEGER DEFAULT 1 | 有効フラグ |
| created_at | TEXT | JST タイムスタンプ |

### affiliate_clicks テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT PK | UUID |
| affiliate_id | TEXT FK | アフィリエイトID |
| url | TEXT | クリック元URL |
| ip_address | TEXT | CF-Connecting-IP |
| created_at | TEXT | JST タイムスタンプ |

### entry_routes テーブル (流入経路)

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT PK | UUID |
| ref_code | TEXT NOT NULL | 参照コード (例: "lp-a", "instagram") |
| name | TEXT NOT NULL | 経路名 |
| tag_id | TEXT FK | 自動付与タグ |
| scenario_id | TEXT FK | 自動エンロールシナリオ |
| redirect_url | TEXT | リダイレクト先 |
| is_active | INTEGER DEFAULT 1 | 有効フラグ |
| created_at, updated_at | TEXT | JST タイムスタンプ |

### ref_tracking テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT PK | UUID |
| ref_code | TEXT | 参照コード |
| friend_id | TEXT FK | 友だちID |
| entry_route_id | TEXT FK | 流入経路ID |
| source_url | TEXT | 流入元URL |
| created_at | TEXT | JST タイムスタンプ |

---

## API エンドポイント

### CV ポイント管理

#### CV ポイント一覧取得
```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/conversions/points" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

レスポンス:
```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "商品A購入",
      "eventType": "purchase",
      "value": 9800,
      "createdAt": "2026-03-20T10:30:00.000+09:00"
    }
  ]
}
```

#### CV ポイント作成
```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/conversions/points" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "商品A購入",
    "eventType": "purchase",
    "value": 9800
  }'
```

必須フィールド: `name`, `eventType`
オプション: `value` (null可)

#### CV ポイント削除
```bash
curl -X DELETE "https://line-crm-worker.line-crm-api.workers.dev/api/conversions/points/{id}" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### CV イベント記録・取得

#### コンバージョン記録
```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/conversions/track" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "conversionPointId": "550e8400-e29b-41d4-a716-446655440000",
    "friendId": "friend-uuid-here",
    "userId": "user-uuid-optional",
    "affiliateCode": "partner-a",
    "metadata": {"productId": "prod_001", "source": "lp-a"}
  }'
```

必須: `conversionPointId`, `friendId`
オプション: `userId`, `affiliateCode`, `metadata` (JSON オブジェクト)

レスポンス (201):
```json
{
  "success": true,
  "data": {
    "id": "event-uuid",
    "conversionPointId": "550e8400-...",
    "friendId": "friend-uuid",
    "userId": "user-uuid",
    "affiliateCode": "partner-a",
    "metadata": "{\"productId\":\"prod_001\"}",
    "createdAt": "2026-03-20T10:30:00.000+09:00"
  }
}
```

#### CV イベント一覧取得 (フィルタ付き)
```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/conversions/events?\
conversionPointId=550e8400-...&\
friendId=friend-uuid&\
affiliateCode=partner-a&\
startDate=2026-03-01&\
endDate=2026-03-31&\
limit=50&offset=0" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

全クエリパラメータはオプション。デフォルト: limit=100, offset=0

#### CV レポート取得 (集計)
```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/conversions/report?\
startDate=2026-03-01&endDate=2026-03-31" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

レスポンス:
```json
{
  "success": true,
  "data": [
    {
      "conversionPointId": "550e8400-...",
      "conversionPointName": "商品A購入",
      "eventType": "purchase",
      "totalCount": 42,
      "totalValue": 411600
    }
  ]
}
```

### アフィリエイト管理

#### アフィリエイト一覧
```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/affiliates" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### アフィリエイト詳細
```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/affiliates/{id}" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### アフィリエイト作成
```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/affiliates" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "田中太郎",
    "code": "tanaka-01",
    "commissionRate": 0.1
  }'
```

必須: `name`, `code`
オプション: `commissionRate` (デフォルト 0)

#### アフィリエイト更新
```bash
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/affiliates/{id}" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "田中太郎（ゴールド）",
    "commissionRate": 0.15,
    "isActive": true
  }'
```

#### アフィリエイト削除
```bash
curl -X DELETE "https://line-crm-worker.line-crm-api.workers.dev/api/affiliates/{id}" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### アフィリエイトクリック記録

**認証不要** (公開エンドポイント)

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/affiliates/click" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "tanaka-01",
    "url": "https://example.com/lp?ref=tanaka-01"
  }'
```

必須: `code`
IPアドレスは `CF-Connecting-IP` / `X-Forwarded-For` ヘッダーから自動取得。

### アフィリエイトレポート

#### 個別レポート
```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/affiliates/{id}/report?\
startDate=2026-03-01&endDate=2026-03-31" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

レスポンス:
```json
{
  "success": true,
  "data": {
    "affiliateId": "aff-uuid",
    "affiliateName": "田中太郎",
    "code": "tanaka-01",
    "commissionRate": 0.1,
    "totalClicks": 150,
    "totalConversions": 12,
    "totalRevenue": 117600
  }
}
```

#### 全体レポート
```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/affiliates-report?\
startDate=2026-03-01&endDate=2026-03-31" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

レスポンス: `data` が `AffiliateReport[]` 配列。

---

## Stripe 決済連携

### データモデル (stripe_events テーブル)

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT PK | UUID |
| stripe_event_id | TEXT UNIQUE | Stripe イベントID |
| event_type | TEXT | イベント種別 (例: "payment_intent.succeeded") |
| friend_id | TEXT FK | 紐づく友だち (metadata.line_friend_id から取得) |
| amount | REAL | 金額 |
| currency | TEXT | 通貨コード (例: "jpy") |
| metadata | TEXT | JSON メタデータ |
| processed_at | TEXT | 処理日時 |

### Stripe イベント一覧取得
```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/integrations/stripe/events?\
friendId=friend-uuid&eventType=payment_intent.succeeded&limit=50" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Stripe Webhook レシーバー

**認証不要** (Stripe署名検証を使用)

```bash
# Stripe が自動送信するWebhook
POST /api/integrations/stripe/webhook
```

環境変数 `STRIPE_WEBHOOK_SECRET` が設定されている場合、`Stripe-Signature` ヘッダーで HMAC-SHA256 署名検証を行う。未設定の場合はバイパス (開発環境向け)。

**自動処理内容:**
1. 冪等性チェック (`stripe_event_id` の重複排除)
2. `payment_intent.succeeded` 時:
   - スコアリング加算 (`purchase` イベントタイプ)
   - `metadata.product_id` に基づく自動タグ付与 (`purchased_{productId}`)
   - イベントバス発火 (`cv_fire` イベント → 自動化ルール実行)
3. `customer.subscription.deleted` 時:
   - `subscription_cancelled` タグ自動付与

Stripe のメタデータに `line_friend_id` を設定することで、友だちとの自動紐付けが機能する。

---

## 流入経路トラッキング (Entry Routes)

流入経路は LIFF 認証フロー (`/auth/line`) と連携して動作する。`ref` クエリパラメータで経路を識別し、友だち追加時に自動でタグ付与・シナリオエンロールを行う。

### SDK からの利用

```typescript
const lh = new LineHarness({ apiUrl: '...', apiKey: '...' });
const authUrl = lh.getAuthUrl({ ref: 'instagram', redirect: 'https://example.com/thanks' });
// => https://line-crm-worker.line-crm-api.workers.dev/auth/line?ref=instagram&redirect=...
```

### 流入経路の仕組み

1. ユーザーが `ref=instagram` 付きURLでLINE友だち追加
2. LIFF認証完了時に `ref_tracking` テーブルに記録
3. `entry_routes` テーブルの設定に基づき:
   - 指定タグを自動付与
   - 指定シナリオに自動エンロール
   - 指定URLにリダイレクト

---

## 実装上の注意点

- CV レポートは `LEFT JOIN` で全CVポイントを返す (イベント0件のポイントも含む)
- アフィリエイトレポートのサブクエリは日付フィルタをインラインで適用 (SQLインジェクション対策としてISO 8601 バリデーション済み)
- `affiliate_clicks` の IP アドレスは Cloudflare の `CF-Connecting-IP` ヘッダーから取得
- タイムスタンプは全て JST (`+09:00`)
