# 107. Web予約流入URL・LINE連携・メール確認 設計

## 目的

Google Map、公式Webサイト、Instagram、広告、QRコードなど、LINE外からの予約流入を扱えるようにする。

既存のLIFF予約画面はLINEユーザーの `idToken` を前提にしている。Web流入ではLINE IDがないため、予約作成時点ではLINE友だちに紐づかない。  
そのため、Web予約はメールアドレスを必須にし、予約後にメールで確認・キャンセル・LINE連携を行う。

## 結論

- 顧客向け予約画面は Worker 側に寄せる。
- LINE予約とWeb予約は同じ予約UIを使う。
- Web予約は `guest session` で予約作成する。
- Web予約では `氏名 / 電話番号 / メール` を必須にする。
- 流入元はMVPでは `reservations.metadata.entry` の `channel / ref / utm_*` として保存する。
- Web管理画面で、媒体別の予約URLを作成できるようにする。
- 予約完了メールには `予約詳細URL / キャンセルURL / LINE連携URL` を入れる。
- LINE連携は `claimToken` を使い、予約IDだけでは紐づけない。

## 実装状況

2026-05-19時点:

- `?page=book&mode=web` または `?page=book&channel=...` で LIFF ログインなしのWeb予約画面を開ける。
- `POST /api/public/reservation-session/guest` で guest session を発行する。
- Web予約ではメールアドレスを必須にする。
- 予約作成時に `metadata.entry` へ `mode/channel/ref/utm/url` を保存する。
- `POST /api/public/reservations/lookup` で `reservationId + email` による予約確認・キャンセルトークン再発行ができる。
- Resend未設定時は予約完了メール送信をスキップする。設定後はWeb予約完了時に受付メールを送る。

未実装:

- Web管理画面での予約導線URL作成UI。
- 予約完了メール内の詳細URL・キャンセルURL・LINE連携URL。
- `claimToken` によるLINE友だちへの後付け予約紐づけ。

## 用語

| 用語 | 意味 |
| --- | --- |
| source | 予約の発生元。例: `line`, `web`, `google_map`, `instagram`, `website`, `qr`, `admin`, `jalan` |
| capacity_channel | どの在庫カウンタを消費するか。例: `line`, `external`, `manual` |
| channel | UI/流入チャネル。URL上の `channel`。例: `google_map`, `instagram` |
| ref | 管理画面で作る流入URLの短い識別子。例: `gmaps_2026`, `insta_bio` |
| utm_* | 広告・分析用パラメータ |
| claimToken | Web予約をLINE友だちに後から紐づけるための期限付き署名token |

## 予約URL設計

### URL形式

```text
https://line-harness-reservation.yongtae-hurdle0930.workers.dev/?page=book&channel=google_map&ref=gmaps_2026
https://line-harness-reservation.yongtae-hurdle0930.workers.dev/?page=book&channel=instagram&ref=insta_bio
https://line-harness-reservation.yongtae-hurdle0930.workers.dev/?page=book&channel=website&ref=official_site
```

広告用にはUTMを付けられる。

```text
...?page=book&channel=web&ref=summer_ad&utm_source=instagram&utm_medium=cpc&utm_campaign=blueberry_2026
```

### Web管理画面で作るもの

`/reservations` または専用の `予約導線URL` 設定画面に、以下を作る。

```text
名前
予約対象 resourceId
メニュー menuId（任意）
channel
ref
utm_source
utm_medium
utm_campaign
有効/無効
生成URL
コピー
QRコード表示（後続）
```

MVPでは既存の `entry_routes` を流用してよい。  
ただし予約向けには `resourceId/menuId/channel/ref/utm` を明示して扱う。

## source と capacity_channel

Web予約の理想方針:

```text
source = URLのchannelに応じて web / google_map / instagram / website / qr
capacity_channel = line
```

理由:

- Web予約は自社予約枠として扱う。
- じゃらんやGmail取り込みは `capacity_channel=external`。
- `source` と `capacity_channel` は別概念として維持する。

MVP実装では既存D1の `reservations.source` CHECK制約を壊さないため、`source` の enum拡張は行わない。  
実際の流入元は `reservations.metadata.entry.channel/ref/utm*` に保存する。将来、DBを安全に再構築できるタイミングで `source` enum または専用カラムに移す。

## 予約作成時に保存する情報

`reservations.metadata` に以下を保存する。

```json
{
  "entry": {
    "channel": "google_map",
    "ref": "gmaps_2026",
    "utmSource": "google",
    "utmMedium": "profile",
    "utmCampaign": "blueberry_2026",
    "landingUrl": "https://...",
    "createdFrom": "web"
  }
}
```

将来的に検索性を上げる場合、`reservations` に専用カラムを追加する。

```sql
ALTER TABLE reservations ADD COLUMN entry_channel TEXT;
ALTER TABLE reservations ADD COLUMN entry_ref TEXT;
ALTER TABLE reservations ADD COLUMN utm_source TEXT;
ALTER TABLE reservations ADD COLUMN utm_medium TEXT;
ALTER TABLE reservations ADD COLUMN utm_campaign TEXT;
```

MVPでは `metadata` 保存で開始し、管理画面集計が必要になったらカラム化する。

## 認証・セッション

### LINE予約

```text
LIFF idToken
↓
POST /api/public/reservation-session
↓
LINE用 reservation session
```

### Web予約

```text
通常ブラウザ
↓
POST /api/public/reservation-session/guest
↓
guest reservation session
```

guest sessionは予約作成だけ許可する。

```text
scope = reservations:read
sessionType = guest
channel = web/google_map/instagram/website
exp = 1時間
```

注: 現在のtoken実装は `reservations:read` をLINE予約一覧と予約作成セッションで共用している。  
将来は `reservation:create` に分離する。

## 入力必須項目

### LINE予約

```text
氏名: 必須
電話番号: 必須
メール: 任意
備考: 任意
```

### Web予約

```text
氏名: 必須
電話番号: 必須
メール: 必須
備考: 任意
```

Web予約でメール必須にする理由:

- 予約確認メールを送るため。
- キャンセルURLを送るため。
- LINE連携URLを送るため。
- 予約ID検索時の本人確認に使うため。

## 予約完了メール

Resendを使う。

必要なSecrets:

```text
RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_FROM_NAME
```

メールに含める内容:

```text
予約ID
予約日時
メニュー
人数
料金
予約詳細URL
キャンセルURL
LINE連携URL
問い合わせ先
```

URL例:

```text
詳細URL:
https://worker.dev/?page=book&screen=detail&token=DETAIL_TOKEN

キャンセルURL:
https://worker.dev/?page=book&screen=cancel&token=CANCEL_TOKEN

LINE連携URL:
https://worker.dev/?page=book&screen=claim&token=CLAIM_TOKEN
```

## LINE連携

### 正常導線

```text
Web予約完了
↓
予約完了メールを送信
↓
ユーザーが「LINEで予約確認する」を押す
↓
LIFF起動
↓
LIFF idTokenでLINEユーザー確認
↓
claimTokenで予約確認
↓
reservations.friend_id / user_id を紐づけ
↓
予約確認画面に表示
```

### LINE追加だけした場合の救済

ユーザーがLINE連携URLを押さず、普通に公式LINEを友だち追加した場合:

```text
LIFF予約確認画面
↓
予約がありません
↓
「Web予約を連携する」
↓
予約ID + メールアドレスを入力
↓
該当予約があればメールにLINE連携URLを送信
↓
メール内リンクからclaim
```

重要:

- 予約IDだけで予約詳細を返さない。
- 予約ID + メール一致でも画面に詳細を直接返さない。
- 該当なしでも同じレスポンスを返す。
- メールに届いたリンクを踏んだ人だけ連携できる。

## API契約案

### guest session作成

```http
POST /api/public/reservation-session/guest
```

Request:

```json
{
  "channel": "google_map",
  "ref": "gmaps_2026",
  "utmSource": "google",
  "utmMedium": "profile",
  "utmCampaign": "blueberry_2026"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "token": "GUEST_SESSION_TOKEN",
    "expiresIn": 3600
  }
}
```

### 予約作成

既存APIを拡張する。

```http
POST /api/public/reservations
Authorization: Bearer GUEST_SESSION_TOKEN
```

Web予約では `customer.email` 必須。

Request:

```json
{
  "resourceId": "res_blueberry",
  "menuId": "menu_blueberry_60",
  "slotId": "slot_xxx",
  "adultCount": 2,
  "childCount": 1,
  "infantCount": 0,
  "underThreeCount": 0,
  "customer": {
    "name": "山田 太郎",
    "phone": "09012345678",
    "email": "taro@example.com"
  },
  "formData": {
    "note": "犬連れです"
  }
}
```

### LINE claim

```http
POST /api/public/reservations/:id/claim
Authorization: Bearer LIFF_SESSION_TOKEN
```

Request:

```json
{
  "claimToken": "CLAIM_TOKEN"
}
```

### 予約ID + メールで連携メール再送

```http
POST /api/public/reservations/lookup
```

Request:

```json
{
  "reservationId": "RESERVATION_ID",
  "email": "taro@example.com"
}
```

Response:

```json
{
  "success": true
}
```

該当なしでも同じレスポンスにする。

## DB設計案

### email_messages

```sql
CREATE TABLE IF NOT EXISTS email_messages (
  id TEXT PRIMARY KEY,
  reservation_id TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_email_messages_reservation ON email_messages (reservation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages (status, created_at);
```

### reservation_entry_routes

既存 `entry_routes` を予約用に拡張してもよいが、予約導線専用に分けるなら以下。

```sql
CREATE TABLE IF NOT EXISTS reservation_entry_routes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  resource_id TEXT REFERENCES reservation_resources(id) ON DELETE SET NULL,
  menu_id TEXT REFERENCES reservation_menus(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  ref TEXT NOT NULL UNIQUE,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
```

MVPではテーブル追加を避け、既存 `entry_routes` に寄せてもよい。

## Web管理画面要件

### 予約導線URL作成画面

配置候補:

```text
/reservations の予約設計タブ
または
/reservation-ops の設定モーダル
```

MVPでは `/reservations` に置く。

機能:

```text
導線名を入力
Resourceを選択
Menuを選択（任意）
channelを選択
refを入力または自動生成
utm_source / utm_medium / utm_campaign を入力
URLを生成
URLをコピー
有効/無効
```

生成URL:

```text
{WORKER_URL}/?page=book&channel={channel}&ref={ref}&resourceId={resourceId}&menuId={menuId}&utm_source=...&utm_medium=...&utm_campaign=...
```

## 管理画面で見る集計

将来対応:

```text
媒体別予約数
媒体別キャンセル数
媒体別来園済み数
媒体別売上
媒体別LINE連携率
```

最初は予約一覧に以下を表示する。

```text
source
channel
ref
utm_campaign
```

## テスト設計

### DB / backend

1. guest sessionを作成できる。
2. guest sessionは予約作成に使える。
3. guest sessionでは予約作成以外のLINE専用APIを使えない。
4. Web予約では `customer.email` が空なら400。
5. LINE予約では `customer.email` が空でも予約できる。
6. Web予約では `source` がURL `channel` から保存される。
7. Web予約では `metadata.entry.channel/ref/utm_*` が保存される。
8. Web予約でも在庫確保は条件付きUPDATEで行われる。
9. Web予約の `capacity_channel` はMVPでは `line` になる。
10. Web予約完了後に `email_messages` が作成される。
11. Resend送信成功時に `email_messages.status='sent'` になる。
12. Resend送信失敗時に予約は作成済みのまま、`email_messages.status='failed'` になる。
13. claimTokenが有効ならLINE friend/userに予約が紐づく。
14. claimTokenが期限切れなら紐づかない。
15. claimTokenのreservationIdとURLのreservationIdが違う場合は拒否。
16. 既に別friendにclaim済みの予約は、再claimを拒否または冪等成功にする。
17. `/api/public/reservations/lookup` は該当あり/なしで同じレスポンスを返す。
18. lookup該当ありの場合だけメールが送信される。
19. lookup該当なしの場合はメール送信されない。
20. 予約IDだけでは予約詳細を取得できない。

### frontend / LIFF booking

1. `channel=line` かつLIFF idTokenありならLINE予約モードになる。
2. `channel=google_map` かつLIFF idTokenなしならWeb予約モードになる。
3. Web予約モードではメール欄に必須バッジが出る。
4. LINE予約モードではメール欄は任意表示になる。
5. Web予約でメール空欄のまま確認するとエラー表示。
6. Web予約完了画面に「確認メールを送信しました」が出る。
7. Web予約完了画面に「LINEで予約確認する」導線が出る。
8. `screen=claim&token=...` でLIFF起動した場合、claim処理後に予約詳細へ遷移する。
9. 予約確認画面で予約がない場合、「Web予約を連携する」導線が出る。
10. 予約ID + メール入力後、詳細を画面に出さず「確認メールを送信しました」と表示する。

### Web管理画面

1. Resource/Menuを選択して予約URLを生成できる。
2. `channel/ref/utm` がURLに入る。
3. `ref` が空なら自動生成される。
4. 生成URLをコピーできる。
5. 無効化した導線URLでは予約画面に警告を出す、または予約作成時に拒否する。
6. 予約一覧に `source/channel/ref` が表示される。
7. 媒体別集計で予約数が正しく出る。

## 実装順序

1. この設計を `101B/101D/103` に反映するか、本ページから参照する。
2. `RESEND_*` を `.env.example` と CI/CD Secrets Store binding に追加する。
3. `email_messages` テーブルを追加する。
4. Resend送信サービスを追加する。
5. guest session APIを追加する。
6. `POST /api/public/reservations` をguest session対応する。
7. Web予約時のメール必須バリデーションを追加する。
8. Web予約完了メールを送る。
9. claimToken発行・claim APIを追加する。
10. LIFF/Worker予約画面をWeb予約モード対応する。
11. Web管理画面に予約導線URL作成UIを追加する。
12. 予約ID + メール lookup APIを追加する。
13. テストを追加する。

## 実装時の禁止事項

- 予約IDだけで予約詳細を返さない。
- 電話番号一致だけでLINE友だちに紐づけない。
- `source` で在庫カウンタを判断しない。
- Web予約のメール送信失敗で在庫だけ確保され、予約が消える状態にしない。
- 管理画面のAPI_KEYを顧客向け予約画面に埋め込まない。
