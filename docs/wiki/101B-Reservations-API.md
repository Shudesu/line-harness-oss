# 101B. 予約システム: API Contract

## 認証方針

管理者APIは既存APIと同じ Bearer Token を必須にする。

公開LIFF APIは API Key を要求しない。ただし、予約一覧、予約詳細取得、キャンセルは `lineUserId` だけで認可しない。LIFF ID token から発行した短命署名tokenを使う。

公開APIで使うセッショントークンには以下を含める。

```text
lineUserId
friendId
lineAccountId
exp
scope = reservations:read
```

キャンセルトークンには以下を含める。

```text
reservationId
lineUserId or friendId
exp
scope = reservation:cancel
```

`detailToken` と `cancelToken` は分ける。`detailToken` は `reservation:read` 専用で、キャンセルには使えない。`cancelToken` は `reservation:cancel` 専用で、対象予約IDを含める。

## 公開LIFF API

### 予約メニュー一覧

```http
GET /api/public/reservation-resources/:resourceId/menus
```

レスポンスには、人数区分ごとの価格と在庫消費ルールを含める。

```json
{
  "success": true,
  "data": [
    {
      "id": "menu_picking_60",
      "resourceId": "res_blueberry",
      "name": "ブルーベリー摘み取り体験 60分",
      "durationMinutes": 60,
      "minPeople": 1,
      "maxPeople": 8,
      "priceAdult": 2000,
      "priceChild": 1000,
      "priceInfant": 0,
      "priceUnderThree": 0,
      "capacityCountAdult": true,
      "capacityCountChild": true,
      "capacityCountInfant": true,
      "capacityCountUnderThree": false
    }
  ]
}
```

Phase 1では公開APIも管理APIも `underThreeCount` を受け付ける。`underThreeCount` は人数には含まれるが、枠を消費するかはMenuの `capacityCountUnderThree` で決まる。

### 空き枠取得

```http
GET /api/public/reservation-resources/:resourceId/slots?date=2026-06-01&menuId=menu_picking_60&people=3
```

人数区分を使う場合:

```http
GET /api/public/reservation-resources/:resourceId/slots?date=2026-06-01&menuId=menu_picking_60&adultCount=2&childCount=0&infantCount=1&underThreeCount=1
```

レスポンス:

```json
{
  "success": true,
  "data": [
    {
      "slotId": "slot_20260601_0900_blueberry",
      "resourceId": "res_blueberry",
      "date": "2026-06-01",
      "startAt": "2026-06-01T09:00:00+09:00",
      "endAt": "2026-06-01T10:00:00+09:00",
      "remainingCapacity": 12,
      "lineRemainingCapacity": 4,
      "available": true
    }
  ]
}
```

`people` は後方互換のため残すが、3区分対応後は以下のqueryを優先する。

```http
GET /api/public/reservation-resources/:resourceId/slots?date=2026-06-01&menuId=menu_picking_60&adultCount=2&childCount=1&infantCount=1
```

サーバーは `menu.capacity_count_*` から `requestedCapacityPeople` を計算し、`lineRemainingCapacity >= requestedCapacityPeople` の時だけ `available=true` にする。

### 予約作成

```http
POST /api/public/reservations
Authorization: Bearer LIFF_SESSION_TOKEN
Content-Type: application/json
```

リクエスト:

```json
{
  "resourceId": "res_blueberry",
  "menuId": "menu_picking_60",
  "slotId": "slot_20260601_0900_blueberry",
  "adultCount": 2,
  "childCount": 1,
  "infantCount": 1,
  "customer": {
    "name": "山田太郎",
    "phone": "09000000000",
    "email": "yamada@example.com"
  },
  "formData": {
    "note": "ベビーカーあり"
  }
}
```

サーバー側の必須検証:

```text
slot.resource_id === resourceId
menu.resource_id === resourceId
slot.status === 'open'
menu.is_active === true
resource.is_active === true
slot duration === menu.duration_minutes
adultCount + childCount + infantCount === totalPeople
capacityPeople = adultCount * menu.capacity_count_adult + childCount * menu.capacity_count_child + infantCount * menu.capacity_count_infant
capacityPeople > 0
totalPeople >= menu.min_people
menu.max_people があれば totalPeople <= menu.max_people
```

`reservationDate`, `startAt`, `endAt` はクライアント入力を信用しない。サーバーが `slotId` から確定する。

レスポンス:

```json
{
  "success": true,
  "data": {
    "id": "reservation_001",
    "status": "confirmed",
    "reservationDate": "2026-06-01",
    "startAt": "2026-06-01T09:00:00+09:00",
    "endAt": "2026-06-01T10:00:00+09:00",
    "adultCount": 2,
    "childCount": 1,
    "infantCount": 1,
    "totalPeople": 4,
    "capacityPeople": 4,
    "menuName": "ブルーベリー摘み取り体験 60分",
    "customerName": "山田太郎",
    "detailToken": "SIGNED_DETAIL_TOKEN",
    "cancelToken": "SIGNED_CANCEL_TOKEN"
  }
}
```

### 自分の予約一覧

```http
GET /api/public/me/reservations?status=active
Authorization: Bearer LIFF_SESSION_TOKEN
```

### 予約詳細

```http
GET /api/public/reservations/:id?token=SIGNED_TOKEN
```

### 予約キャンセル

```http
POST /api/public/reservations/:id/cancel
```

リクエスト:

```json
{
  "token": "SIGNED_TOKEN",
  "reason": "customer_requested"
}
```

キャンセルは冪等にする。すでに `cancelled` の場合は成功として既存予約を返す。在庫は戻さない。

## 管理者API

### 予約対象

```http
GET  /api/reservation-resources
POST /api/reservation-resources
GET  /api/reservation-resources/:id
PUT  /api/reservation-resources/:id
```

予約が存在する resource は物理削除しない。非表示にする場合は `isActive=false`。

### 予約メニュー

```http
GET  /api/reservation-resources/:resourceId/menus
POST /api/reservation-resources/:resourceId/menus
PUT  /api/reservation-menus/:id
```

予約が存在する menu は物理削除しない。非表示にする場合は `isActive=false`。

### 基本営業時間

```http
GET    /api/reservation-resources/:resourceId/schedules
POST   /api/reservation-resources/:resourceId/schedules
PUT    /api/reservation-schedules/:id
DELETE /api/reservation-schedules/:id
```

既に生成済みの slot は schedule 変更だけでは自動変更しない。日別 slot は管理者が再生成する。

### 日別予約枠

```http
GET  /api/reservation-slots?resourceId=res_blueberry&date=2026-06-01
POST /api/reservation-slots/generate
PUT  /api/reservation-slots/:id
```

予約が存在する slot は削除禁止。閉じる場合は `status='closed'`、管理画面から隠す場合は `status='hidden'`。

### 予約一覧

```http
GET /api/reservations?date=2026-06-01&resourceId=res_blueberry&status=confirmed&source=line
```

### 予約詳細

```http
GET /api/reservations/:id
```

### 管理者予約作成

```http
POST /api/reservations
```

管理者予約作成でも、公開LIFF APIと同じ在庫確保ロジックを使う。

管理者予約では `capacityChannel` を指定できる。未指定時は `line` とする。

```json
{
  "resourceId": "res_blueberry",
  "menuId": "menu_picking_60",
  "slotId": "slot_20260601_0900_blueberry",
  "source": "admin",
  "capacityChannel": "line",
  "adultCount": 2,
  "childCount": 1,
  "infantCount": 0
}
```

### ステータス更新

```http
PUT /api/reservations/:id/status
```

リクエスト:

```json
{
  "status": "completed",
  "reason": "visited",
  "confirm": true
}
```

状態遷移は [101A. Data Model](101A-Reservations-Data-Model.md) の状態遷移表に従う。

## Gmail/じゃらん取り込みAPI

```http
POST /api/integrations/jalan/reservations/import
```

リクエスト:

```json
{
  "eventType": "created",
  "externalId": "jalan_123456",
  "gmailMessageId": "gmail-message-id",
  "receivedAt": "2026-06-01T08:30:00+09:00",
  "rawText": "...",
  "parsed": {
    "reservationDate": "2026-06-10",
    "startTime": "10:00",
    "adultCount": 2,
    "childCount": 1,
    "infantCount": 0,
    "customerName": "山田太郎",
    "phone": "09000000000",
    "planName": "ブルーベリー摘み取り"
  }
}
```

### eventType

Gmail/じゃらん取り込みAPIは、新規予約だけでなく、キャンセル・変更メールも扱う。

`eventType` を必須とする。

| eventType | 動作 |
|---|---|
| `created` | 新規外部予約として取り込む |
| `updated` | 既存予約の変更として保存し、MVPでは要確認にする |
| `cancelled` | 既存予約をキャンセルする |
| `unknown` | 解析結果だけ保存し、要確認にする |

`eventType = 'cancelled'` の場合、`externalId` または `dedupeKey` で既存予約を検索し、`pending` / `confirmed` の予約のみ `cancelled` に更新する。このとき `capacity_channel = 'external'` の在庫を1回だけ戻し、`reservation_events.actor_type = 'gas'` を残す。

`eventType = 'updated'` の場合、自動で予約内容は変更しない。`externalId` または `dedupeKey` で既存予約を検索し、見つかった場合は `external_reservation_sources.reservation_id` に紐づけたうえで `parse_status = 'needs_review'` とする。見つからない場合も `reservation_id = null` のまま `needs_review` として保存し、管理画面で手動確認する。

### 冪等性

同じ `externalId` または `dedupeKey` の再取り込みは、既存予約を返す。

レスポンス:

```json
{
  "success": true,
  "data": {
    "reservation": { "id": "reservation_001" },
    "idempotent": true
  }
}
```

### dedupe_key

`externalId` が取得できない場合は、以下の優先順位で `dedupe_key` を作る。

```text
1. じゃらん予約番号 externalId
2. Gmail messageId
3. source + reservationDate + startTime + normalizedPhone + adultCount + childCount + infantCount + normalizedPlanName
```

電話番号は数字のみ、プラン名は空白除去・全角半角正規化後に使う。

`externalId` と `dedupeKey` は空文字を `NULL` に正規化する。外部取り込みでは `externalId`, `gmailMessageId`, `dedupeKey` のいずれかが必要。

自然キーの `dedupeKey` は衝突し得る。衝突疑いがある場合は idempotent success にせず、`needs_review` として保存する。

### 外部枠超過

じゃらん取り込みで `external_remaining < people` または `total_remaining < people` の場合、自動で予約を作らない。

`external_reservation_sources` には `parse_status='needs_review'` で保存し、管理画面で要確認にする。自動で `reserved_count` を超過させない。

## エラー契約

| HTTP | code | 条件 |
|---|---|---|
| 400 | `invalid_request` | JSON不正、必須不足 |
| 400 | `invalid_people_count` | 人数が0以下、またはメニュー上限超過 |
| 400 | `invalid_slot` | メニュー所要時間と枠が合わない |
| 401 | `unauthorized` | 管理APIの認証なし |
| 403 | `forbidden` | 他人の予約参照/キャンセル |
| 404 | `resource_not_found` | 予約対象なし |
| 404 | `slot_not_found` | 枠なし |
| 409 | `slot_not_available` | 枠が閉じている/満席 |
| 409 | `invalid_state_transition` | 許可されない状態遷移 |
| 422 | `form_validation_failed` | 入力項目エラー |
| 500 | `internal_error` | 想定外 |

同じ外部予約の再取り込みは `duplicate_external_reservation` ではなく、原則 `200 success` の idempotent response にする。
