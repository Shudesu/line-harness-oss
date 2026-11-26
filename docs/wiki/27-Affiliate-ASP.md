# 27. アフィリエイト ASP（セルフサーブ計測）

L Harness に内蔵されたセルフサーブ型アフィリエイト計測機能のリファレンスです。リンク発行からクリック・友だち追加・コンバージョンまでを時系列で計測し、帰属計算からレポート出力まで一気通貫で処理します。

---

## 1. 機能概要

```
アフィリエイター
  ↓  LIFF (?page=affiliate) でセルフ登録
  ↓  媒体別リンクを最大 20 本発行
  ↓
ユーザー
  ↓  短縮リンクをクリック → ref_tracking に記録
  ↓  LINE 友だち追加
  ↓  コンバージョン発生
  ↓
システム
  ↓  last-touch / 90日窓でアフィリエイターに帰属
  ↓  CV 時点のレートでコミッション確定（後から不変）
  ↓
管理者
     /affiliates 画面でレポート確認・重複フラグ確認
```

主な特徴:

- **セルフサーブ**: アフィリエイターが管理者の手を借りずに LIFF から登録・リンク発行・実績確認
- **ref_code ベース追跡**: 6〜8 文字の base62 スラグ。リンク毎に独立した計測
- **スナップショット CV**: コンバージョン発生時にアフィリエイター・レートを確定。後からレートを変更しても過去レポートは変わらない
- **重複検知**: `identity_key`（電話番号・UID 等の複合キー）が同一の友だちが複数帰属した場合に⚠フラグ

---

## 2. アフィリエイター向け: LIFF でのセルフサーブ操作

### 2-1. 登録

LIFF アプリを `?page=affiliate` 付きで開くとアフィリエイト登録フローが起動します。

```
https://liff.line.me/<YOUR_LIFF_ID>?page=affiliate
```

初回アクセス時に LINE ログイン（LIFF SDK が自動実行）が走り、取得した `lineAccessToken` をサーバーに送信して登録が完了します。すでに登録済みの場合は既存のデータを返す（冪等）。

登録時に最初のリンクが自動発行されます。

### 2-2. リンク発行（媒体別ラベル付き）

1. LIFF 上の「リンクを追加」ボタンをクリック
2. 媒体を表すラベルを入力（例: `Instagram`, `YouTube`, `Twitter`）
3. `https://go.example.com/<ref_code>` 形式の短縮 URL が発行される

**上限: アフィリエイター 1 人あたり 20 本**。21 本目の発行は 400 エラー。

リンクの形式（`LINK_BASE_URL` 設定時）:

```
https://go.example.com/Ab3XyZ
```

`LINK_BASE_URL` 未設定時は Worker 組み込みのリダイレクトルートを使用:

```
https://<your-worker>/r/Ab3XyZ
```

### 2-3. 実績確認

LIFF の自分のダッシュボードで以下が確認できます:

| 項目 | 説明 |
|------|------|
| クリック数 | リンク毎の `click_count`（リダイレクトヒット数） |
| 友だち追加数 | 追加時点で last-touch 帰属されたユニーク人数 |
| コンバージョン数 | 帰属された CV イベント数 |
| コミッション（参考） | `revenue × commissionRate`（支払い確定は管理者側） |

---

## 3. 帰属ルール

### 3-1. last-touch / 90 日窓

友だちの `ref_tracking` テーブルを参照し、**友だち追加日時から遡って 90 日以内**の最新タッチ（`julianday` 比較）を持つアフィリエイトリンクの所有者が帰属先になります。

```
帰属先 = argmax_{t ∈ touches} julianday(t.created_at)
         where julianday(friend.created_at) - 90 <= julianday(t.created_at)
               AND julianday(t.created_at) <= julianday(friend.created_at)
               AND t.ref_code → affiliate_link が存在する
```

参照実装: `packages/db/src/affiliate-attribution.ts` `resolveAffiliateAttribution()`

### 3-2. 自己クリック除外

アフィリエイター自身の LINE 友だち UUID（`affiliates.friend_id`）と `ref_tracking.friend_id` が一致するタッチは帰属から除外されます。自分のリンクを自分で踏んでも成果にはなりません。

```sql
AND (a.friend_id IS NULL OR a.friend_id != rt.friend_id)
```

### 3-3. CV 時スナップショット

コンバージョン発生時、`conversion_events` テーブルに以下を書き込みます:

- `affiliate_id`: 帰属先アフィリエイター
- `attributed_ref_code`: 帰属元 ref_code
- コンバージョンポイントの `value`（CV 時点の値）

レポート計算は `conversion_events.affiliate_id` を参照するため、**後からアフィリエイターの `commission_rate` を変更しても過去のレポート数値は不変**です。

参照実装: `packages/db/src/affiliate-report.ts` `getAffiliateReportV2()`

---

## 4. 管理者向け: /affiliates 画面

### 4-1. 一覧画面の列

| 列 | 内容 |
|----|------|
| 名前 / コード | アフィリエイター名と識別コード |
| リンク数 | 発行済み ref_code の本数 |
| クリック（RT） | `ref_tracking` カウント（実タッチ数） |
| リンククリック | `click_count` 合計（リダイレクトヒット） |
| 友だち追加 | 追加時点 last-touch で帰属されたユニーク友だち数 |
| CV 数 | `conversion_events` 帰属件数 |
| 売上 | CV ポイント `value` の合計 |
| 推定コミッション | 売上 × `commission_rate` |
| ステータス | active / paused |

### 4-2. 詳細画面

- **CV 内訳**: CV ポイント別の件数・売上を表示
- **ジャーニー**: 帰属友だちの一覧（追加日時 / ref_code / タッチ数 / フォーム数 / CV 数 / 最終イベント）。カーソルページネーション（最大 200 件/ページ）
- **リンク一覧**: 各 ref_code の URL・ラベル・クリック数

### 4-3. ⚠ 重複フラグ（`duplicateFlags`）

レポートに `duplicateFlags` フィールドがあります。これは**帰属友だちのうち `identity_key` が同一の友だちが 2 人以上存在する**場合に表示されます。

`identity_key` は LINE UID・電話番号・メールアドレス等を組み合わせた複合キーで、実質的に同一人物を示します。同じ人が複数のアカウントで友だち追加して CV を水増ししているサインです。

```json
"duplicateFlags": [
  { "friendId": "<uuid-A>", "identityKey": "<hashed-key>" },
  { "friendId": "<uuid-B>", "identityKey": "<hashed-key>" }
]
```

参照実装: `packages/db/src/affiliate-report.ts` `getAffiliateReportV2()` の `duplicateFlags` ブロック

### 4-4. ジャーニー API（管理者向け）

友だち単体のタイムライン（タッチ → 友だち追加 → フォーム → CV）を取得できます:

```bash
GET /api/friends/:id/journey
```

イベント種別は `touch` / `friend_add` / `form` / `conversion` の 4 種類。同一友だちの複数 ref_code タッチの順序やどの時点でどの ref_code が last-touch になったかを確認するのに使います。

---

## 5. 短縮 URL 設定

### 5-1. アカウント設定（管理画面）

管理画面の「アカウント設定」→「リンクベース URL」に独自ドメインを入力します。

```
https://go.example.com
```

- `https://` で始まること（バリデーション必須）
- 末尾スラッシュは自動除去
- 空文字で保存するとリセット（Worker 組み込みの `/r` に戻る）

内部的には `account_settings` テーブルの `link_base_url` キー（`accountId = '__global__'`）に保存されます。

### 5-2. ドメイン側 Redirect Rule の設定

独自ドメイン（例: `go.example.com`）でリンクを受け取り、Worker のリダイレクトルートに転送します。Cloudflare の「Redirect Rules」を使う場合の設定例:

| 項目 | 値 |
|------|-----|
| If (URL path) | matches `/*` |
| Then (Redirect to) | `https://<your-worker>/r/${path}` |
| Status code | 301 |

`${path}` はマッチしたパス部分（スラッシュ含む）に展開されます。

**例**:  
`https://go.example.com/Ab3XyZ` → 301 → `https://<your-worker>/r/Ab3XyZ`

Worker の `/r/:ref` ルートが ref_code を解決し、LINE 公式アカウントへのリンクを含むランディングページにリダイレクトします。

---

## 6. Phase 2: 案件（オファー）

Phase 2 では**案件（affiliate offer）**という概念が追加されます。案件は「固定額報酬/件」で計測する広告キャンペーン単位です。アフィリエイターは LIFF から好きな案件に参加し、案件専用リンクを取得します。

### 6-1. 案件の構成

| フィールド | 内容 |
|-----------|------|
| `name` | 案件名（例: 「セミナー集客キャンペーン」） |
| `rewardAmount` | 固定報酬額（円/成約）。整数値、0 以上 |
| `tagId` | 参加者に自動付与するタグの ID（任意） |
| `scenarioId` | 参加者に自動適用するシナリオの ID（任意） |
| `lineAccountId` | 紐づけるアカウント（省略時は汎用） |
| `isActive` | `true` の案件のみ LIFF に表示・参加可能 |

### 6-2. LIFF での参加とリンク取得

アフィリエイターは登録済みの LIFF ページから案件一覧を確認し、参加ボタンで自分専用の案件リンクを取得します。

```
GET /api/liff/affiliate/offers?lineAccessToken=<token>
```

レスポンス:

```json
{
  "offers": [
    {
      "id": "<offer-uuid>",
      "name": "セミナー集客キャンペーン",
      "description": "登壇者紹介で1名あたり3,000円",
      "rewardAmount": 3000,
      "enrolled": false,
      "refCode": null,
      "url": null
    }
  ]
}
```

参加（enroll）すると案件スコープの専用リンクが発行されます（**冪等**: 2 回目以降は同じリンクを返す）:

```
POST /api/liff/affiliate/offers/<offer-id>/enroll
Body: { "lineAccessToken": "<token>" }
```

レスポンス:

```json
{
  "offerId": "<offer-uuid>",
  "link": {
    "refCode": "Ab3XyZ",
    "url": "https://go.example.com/Ab3XyZ",
    "offerName": "セミナー集客キャンペーン"
  }
}
```

参加後の一覧取得では `enrolled: true` かつ `refCode` / `url` が埋まった状態で返ります。

**非公開案件の参加**は 404 エラーになります（`isActive = false` の案件は LIFF から参加不可）。

### 6-3. 案件に紐づく流入後フロー（tag / シナリオ自動適用）

案件リンク経由で友だち追加が発生すると、`/api/liff/link` の帰属処理内で案件の `tagId` / `scenarioId` が自動適用されます。

| 条件 | 動作 |
|------|------|
| `tagId` が設定されている | 友だちにそのタグを即時付与 |
| `scenarioId` が設定されている | 友だちをそのシナリオに登録 |
| 案件が停止中（`isActive = 0`） | フローは**停止**（タグ付与・シナリオ登録は行わない）。ただし ref_tracking のクリック計測は継続 |
| 汎用リンク（案件なし）の場合 | 案件ルックアップをスキップ。Phase 1 の挙動そのまま |

ソース解決の優先順位は `entry_route > tracked_link > affiliate_offer` です。entry_route または tracked_link にヒットした場合、案件の tag/シナリオは適用されません。

参照実装: `apps/worker/src/routes/liff.ts` `applyRefAttribution()` の offer ブランチ

---

## 7. Phase 2: 成果承認フロー

案件経由でコンバージョンが発生すると、成果は即座に確定するのではなく **pending（保留）** 状態で登録されます。管理者が管理画面で内容を確認してから承認・却下を行います。

### 7-1. 帰属 CV が pending で発生する仕組み

コンバージョン発生時、`conversion_events` テーブルに `approval_status = 'pending'` / `approved_at = NULL` で行が書き込まれます。非帰属 CV（アフィリエイター帰属なし）は `approval_status` が NULL のまま変更されません。承認フローは**帰属 CV 専用**です。

### 7-2. 管理画面「案件・承認」タブ

`/api/conversions/approvals?status=pending` が承認キューのデータソースです。管理画面の「案件・承認」タブにリスト表示されます。

| 列 | 説明 |
|----|------|
| イベント日時 | CV 発生日時 |
| 友だち名 | 友だちの `display_name` |
| アフィリエイター名 | 帰属先アフィリエイターの名前 |
| 案件名 | リンクに紐づく案件の名前（汎用リンク経由は null） |
| CV ポイント名 | コンバージョンポイントの名称 |
| 金額 | CV ポイントの `value` |
| ステータス | `pending` / `approved` / `rejected` |
| ⚠ | 重複フラグ（後述） |

クエリパラメータ `status=approved` / `status=rejected` でタブ切り替えができます。`limit`（既定 200、上限 500）/ `offset` でページネーション。

### 7-3. 承認・却下

PATCH で approved / rejected の二択:

```
PATCH /api/conversions/events/<event-id>/approval
Body: { "status": "approved" }   // or "rejected"
```

- `status = pending` を送ると 400 エラー（pending への「差し戻し」は不可）
- 帰属なし CV を対象にすると 404 エラー（`affiliate_id IS NULL` 行はガード済み）
- 成功時レスポンス: `{ "data": { "id": "<event-id>", "approvalStatus": "approved" } }`

### 7-4. ⚠ 重複バッジの意味

承認キューの ⚠ バッジは `duplicateFlag: true` を示します。

`duplicateFlag` は**同一アフィリエイターに帰属した CV のうち、`identity_key`（LINE UID・電話番号・メール等の複合キー）が同一の友だちが 2 件以上存在する**場合に立ちます。

```json
{ "duplicateFlag": true }
```

同一人物が複数アカウントで友だち追加して CV を水増ししているサインです。フラグは承認済み/却下済みキューでも同様に表示されます（フラグ計算はステータスフィルタの外側で全帰属 CV を対象に行うため、タブを切り替えても値が変わりません）。

参照実装: `packages/db/src/affiliate-report.ts` `getConversionApprovalQueue()` の `dup_keys` CTE

### 7-5. 確定報酬の計算

確定報酬は管理者側の計算です（SDK は参考値として `estimatedCommission` を返しますが、承認ベースの確定額は別途集計してください）。

```
確定報酬 = 承認済み件数 × 案件の rewardAmount（固定額）
```

案件をまたいだ承認済み件数の内訳は、承認済みキュー（`status=approved`）を `offer_name` でグループ化して集計します。各案件の `rewardAmount` は `/api/affiliate-offers/:id` で取得できます。

---

## 8. API リファレンス

### 認証方式

| 種別 | 方式 |
|------|------|
| 管理者 API (`/api/affiliates/*`, `/api/affiliate-offers/*`, `/api/conversions/*`) | `Authorization: Bearer <API_KEY>` ヘッダー |
| セルフ API (`/api/liff/affiliate/*`) | リクエストボディまたはクエリの `lineAccessToken`（LIFF SDK 発行トークンをサーバー側で LINE OAuth API に検証） |
| クリック記録（公開） | 認証不要 |

### セルフ API（アフィリエイター向け）

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/api/liff/affiliate/register` | 登録（冪等）。未登録なら作成 + 1 本目リンクを自動発行 |
| `GET` | `/api/liff/affiliate/me` | 自分のプロフィール + リンク一覧 |
| `POST` | `/api/liff/affiliate/links` | リンクを 1 本追加（20 本上限）|
| `GET` | `/api/liff/affiliate/offers` | アクティブ案件一覧 + 自分の参加状態 |
| `POST` | `/api/liff/affiliate/offers/:id/enroll` | 案件に参加（冪等）。停止案件は 404 |

**POST /api/liff/affiliate/register**

```json
// リクエストボディ
{ "lineAccessToken": "<LIFF_ACCESS_TOKEN>" }

// レスポンス 200
{
  "affiliate": {
    "id": "<uuid>",
    "name": "<display_name>",
    "code": "<base62_code>",
    "commissionRate": 0.1,
    "isActive": true,
    "friendId": "<friend_uuid>"
  },
  "links": [
    {
      "refCode": "Ab3XyZ",
      "label": null,
      "url": "https://go.example.com/Ab3XyZ",
      "clickCount": 0,
      "friendAdds": 0,
      "conversions": 0
    }
  ]
}
```

**GET /api/liff/affiliate/me**

```
GET /api/liff/affiliate/me?lineAccessToken=<token>
```

レスポンス形式は `register` と同一。未登録の場合は 404。

**POST /api/liff/affiliate/links**

```json
// リクエストボディ
{ "lineAccessToken": "<LIFF_ACCESS_TOKEN>", "label": "Instagram" }

// レスポンス 200
{ "link": { "refCode": "Cd4WqR", "label": "Instagram", "url": "...", "clickCount": 0, "friendAdds": 0, "conversions": 0 } }
```

上限超過時は 400: `{ "error": "Link limit reached (max 20)" }`

### ジャーニー API

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/affiliates/:id/journeys` | アフィリエイターに帰属した友だちの一覧（カーソルページ） |
| `GET` | `/api/friends/:id/journey` | 友だち 1 人のタイムライン（全イベント時系列） |

**GET /api/affiliates/:id/journeys**

クエリパラメータ:

| パラメータ | 型 | 既定 | 説明 |
|-----------|-----|------|------|
| `limit` | integer | 50 | 最大 200 |
| `beforeAt` | ISO 8601 | — | カーソル（前ページの末尾 `addedAt`） |
| `beforeId` | string | — | カーソル（前ページの末尾 `friendId`） |

```json
// レスポンス
{
  "success": true,
  "data": [
    {
      "friendId": "<uuid>",
      "displayName": "山田太郎",
      "addedAt": "2026-07-01T10:00:00.000+09:00",
      "refCode": "Ab3XyZ",
      "touchCount": 3,
      "formCount": 1,
      "conversionCount": 1,
      "lastEventAt": "2026-07-05T14:30:00.000+09:00"
    }
  ],
  "nextCursor": { "beforeAt": "...", "beforeId": "..." }
}
```

`nextCursor` が `null` の場合は最終ページです。

### レポート API

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/affiliates/:id/report` | アフィリエイター 1 人の詳細レポート（v2） |
| `GET` | `/api/affiliates-report` | 全アフィリエイター一覧レポート |

**GET /api/affiliates/:id/report**

クエリパラメータ: `startDate` / `endDate`（ISO 8601 日付、省略可）

```json
// レスポンス
{
  "success": true,
  "data": {
    "affiliateId": "<uuid>",
    "affiliateName": "田中さん",
    "code": "<code>",
    "commissionRate": 0.1,
    "clicks": 80,
    "linkClicks": 95,
    "friendAdds": 12,
    "conversions": 4,
    "conversionsByPoint": [
      { "conversionPointId": "<uuid>", "name": "商品A購入", "count": 3, "value": 29400 },
      { "conversionPointId": "<uuid>", "name": "メルマガ登録", "count": 1, "value": 0 }
    ],
    "revenue": 29400,
    "estimatedCommission": 2940,
    "duplicateFlags": []
  }
}
```

`clicks` は `ref_tracking` の実タッチ数、`linkClicks` はリダイレクトヒット（`affiliate_links.click_count` 合計）です。両者はボットフィルタリング方法の違いにより一致しないことがあります。

### 案件 CRUD API（管理者向け）

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/affiliate-offers` | 案件一覧（`?activeOnly=true` でアクティブのみ） |
| `GET` | `/api/affiliate-offers/:id` | 案件 1 件取得 |
| `POST` | `/api/affiliate-offers` | 案件作成（201 返却） |
| `PUT` | `/api/affiliate-offers/:id` | 案件更新（部分更新可） |

**POST / PUT リクエストボディ**

```json
{
  "name": "セミナー集客キャンペーン",
  "description": "登壇者紹介で1名あたり3,000円",
  "rewardAmount": 3000,
  "lineAccountId": "<line-account-uuid>",
  "tagId": "<tag-uuid>",
  "scenarioId": "<scenario-uuid>",
  "isActive": true
}
```

- `rewardAmount` は非負整数（円）。省略時は 0
- `name` は必須（空文字は 400 エラー）
- `isActive` を `false` にすると LIFF への表示・参加が停止する。流入済みリンクの計測は継続

**レスポンス形式**

```json
{
  "success": true,
  "data": {
    "id": "<uuid>",
    "name": "セミナー集客キャンペーン",
    "description": "登壇者紹介で1名あたり3,000円",
    "rewardAmount": 3000,
    "lineAccountId": "<line-account-uuid>",
    "tagId": "<tag-uuid>",
    "scenarioId": "<scenario-uuid>",
    "isActive": true,
    "createdAt": "2026-07-07T10:00:00.000+09:00"
  }
}
```

### 承認 API（管理者向け）

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/conversions/approvals` | 帰属 CV の承認キュー取得 |
| `PATCH` | `/api/conversions/events/:id/approval` | CV を承認 / 却下 |

**GET /api/conversions/approvals**

クエリパラメータ:

| パラメータ | 型 | 既定 | 説明 |
|-----------|-----|------|------|
| `status` | `pending` \| `approved` \| `rejected` | `pending` | キューのフィルタ |
| `limit` | integer | 200 | 上限 500 |
| `offset` | integer | 0 | ページオフセット |

```json
// レスポンス
{
  "success": true,
  "data": [
    {
      "eventId": "<uuid>",
      "createdAt": "2026-07-07T10:00:00.000+09:00",
      "friendId": "<uuid>",
      "friendName": "山田太郎",
      "affiliateId": "<uuid>",
      "affiliateName": "田中さん",
      "offerName": "セミナー集客キャンペーン",
      "conversionPointName": "商品A購入",
      "value": 29800,
      "approvalStatus": "pending",
      "duplicateFlag": false
    }
  ]
}
```

**PATCH /api/conversions/events/:id/approval**

```json
// リクエストボディ
{ "status": "approved" }   // or "rejected"

// レスポンス 200
{ "success": true, "data": { "id": "<event-id>", "approvalStatus": "approved" } }
```

エラー一覧:
- `400`: `status` が `pending` / 無効値 / 欠落
- `404`: 対象 CV が存在しない、または帰属なし CV（`affiliate_id IS NULL`）
