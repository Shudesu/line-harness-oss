# 101. 予約システム設計 (Reservations)

LINE Harness に、ブルーベリー農園の摘み取り体験・カフェ予約・将来追加される予約メニューを扱う予約ドメインを追加する。

予約機能は Google Calendar 依存の機能ではなく、LINE Harness 本体の CRM 拡張として設計する。Google Calendar、Gmail/じゃらん、Claude/MCP は予約DBの外部連携先として扱う。

## 分割ドキュメント

このページは入口として使う。詳細は責務ごとに分ける。

| ドキュメント | 責務 |
|---|---|
| [101A. Data Model](101A-Reservations-Data-Model.md) | 既存DB再利用方針、DBテーブル、在庫計算、状態遷移 |
| [101B. API Contract](101B-Reservations-API.md) | 公開LIFF API、管理者API、じゃらん取り込みAPI、エラー契約 |
| [101C. Client, SDK, MCP](101C-Reservations-Clients.md) | LIFF画面、Web管理画面、SDK、MCP、作るべきファイル |
| [101D. Tests and Operations](101D-Reservations-Tests.md) | テスト方針、運用不変条件、実装順序、MVP完成条件 |

## 現在の実装進捗

最終更新: 2026-05-03

全体進捗の目安は **約94%**。

「予約DBに安全に保存し、在庫を増減し、LIFF予約画面から予約を作る」中核は動いている。バックエンド不変条件テスト（Phase 1）、Worker API（Phase 2）、SDK（Phase 3）、MCP（Phase 4）、Web管理画面MVP（Phase 5）が完了した。Phase 6はGAS/Gmail raw取り込み口、安全な本文parser、GAS側スクリプトまで追加済み。LIFF予約画面は、人数・連絡先入力、1週間/1か月の空き枠表示、確認、完了、自分の予約一覧、予約詳細、キャンセル導線まで実装済み。実機での予約確認も完了している。

未実装の設計変更として、大人/子ども/幼児の3区分化が残っている。現行DBは `adult_count`, `child_count`, `total_people` の2区分+合計で、幼児を独立保存できない。今後は `infant_count` と `capacity_people` を追加し、表示上の合計人数と予約枠を消費する人数を分離する。

### テスト状況

`pnpm --filter @line-crm/db test` — **51テスト 全グリーン**（2026-05-03確認）

| ファイル | 種別 | テスト数 | 概要 |
|---|---|---|---|
| `reservations-logic.test.ts` | Layer 1: 純粋ロジック | 14 | D1不要、高速 |
| `reservations-d1.test.ts` | Layer 2: D1統合 | 37 | miniflare直接使用 |

Layer 2 内訳:

| テストグループ | 件数 | 検証している不変条件 |
|---|---|---|
| 予約作成・容量確保 | 11 | 条件付きUPDATEで在庫先確保、channel別カウンタ、バッファ、menu検証 |
| キャンセル・容量解放 | 7 | confirmed/pending→cancelled のみ在庫解放、冪等性 |
| ステータス遷移 | 4 | completed/no_show/cancelled から再キャンセルは拒否 |
| 外部インポート | 7 | じゃらん連携、同一externalId冪等、cancel/updated/dedupeKey |
| スロット生成 | 1 | generateReservationSlots の日時計算 |
| 顧客プロファイル再計算 | 2 | 予約後→reserved、一部キャンセル後もreserved維持 |

テスト基盤:

- vitest v2 + miniflare 直接使用（`@cloudflare/vitest-pool-workers` 不使用）
- upstream `line-harness-oss` のマージに耐える構成
- D1スキーマは `db.batch()` で単文ずつ適用（`exec()` のmulti-line制限を回避）

修正済みの不具合:

- `importExternalReservation` の `findExternalSource` 早期リターンを修正した。同じ `externalId` で `created` ソースが既存でも、`eventType=cancelled` は既存予約をキャンセルし、`eventType=updated` は予約本体を変えず `needs_review` に進む。再キャンセルしても在庫は二重に戻らない。

### 実装済み

- DBスキーマを追加した。
- `reservation_resources`, `reservation_menus`, `reservation_schedules`, `reservation_slots`, `reservations`, `reservation_items`, `reservation_events`, `visits`, `external_reservation_sources`, `external_sync_tasks` を追加した。
- `capacity_channel` を追加し、`source` と在庫消費チャネルを分離した。
- `slot_id` は `NOT NULL` とし、予約が存在するslotは削除しない方針にした。
- 外部ID・dedupe key は部分ユニークインデックスで扱う設計にした。
- DB helper `packages/db/src/reservations.ts` を追加した。
- 予約作成は、slotの条件付き `UPDATE` で在庫確保してから `reservations` を作る。
- キャンセルは状態遷移表を通し、在庫戻しは `pending` / `confirmed` から `cancelled` へ変わった時だけ行う。
- `source` ではなく `capacity_channel` で `line_reserved_count` / `external_reserved_count` / `reserved_count` を増減する。
- 顧客ステータスは単一予約で直接上書きせず、予約全体と来園履歴から再計算する。
- 管理者APIを追加した。
- 公開LIFF APIを追加した。
- 公開LIFF APIは `lineUserId` 直指定を信用せず、LINE ID token 検証後に発行する短命 `LIFF_SESSION_TOKEN` を使う。
- `detailToken` と `cancelToken` を分離した。
- LIFF sessionから本人予約の `detailToken` / `cancelToken` を再発行する公開APIを追加した。
- じゃらん取り込みAPIの土台を追加した。
- `eventType='updated'` は自動反映せず `needs_review` にする。
- `eventType='cancelled'` は既存予約を検索し、状態遷移表に従ってキャンセルする。
- LIFF予約画面 `apps/worker/src/client/booking.ts` を旧Google Calendar予約APIから新予約APIへ切り替えた。
- LIFF予約画面に、メニュー選択、人数入力、電話番号、メール、備考、1週間/1か月の空き枠表示、予約確認、予約完了を追加した。
- LIFF予約画面に、自分の予約一覧、予約詳細、予約作成時に保存した `cancelToken` によるキャンセル導線を追加した。
- 予約機能をLINE Harness本体更新に耐えやすくするため、予約専用ファイルへ分離した。
- 予約APIのrequest validation helperを `apps/worker/src/routes/reservations/requests.ts` に分離した。
- 予約APIのエラーレスポンスを `apps/worker/src/routes/reservations/responses.ts` に分離し、`code` 付きの契約にした。
- 予約APIレスポンス型を `packages/shared` に追加した。
- `ReservationSchedule`, `ReservationSlotWithAvailability`, `PublicReservationSlot`, `ReservationSessionResponse`, `ReservationImportResponse` を共有型に追加した。
- `packages/sdk/src/resources/reservations.ts` を追加し、管理者API、公開LIFF API、じゃらん取り込みAPIをSDKから呼べるようにした。
- `LineHarness` に `client.reservations` を追加した。
- SDKの予約resourceテストを追加した。
- Google Calendar OAuth開始URLを `client.reservations.startGoogleCalendarOAuth()` で生成できるようにした。
- `packages/mcp-server/src/tools/reservations.ts` を追加し、MCPから予約確認・予約作成・キャンセル・slot生成・じゃらん取り込みをSDK経由で呼べるようにした。
- MCPの予約書き込み系toolは `execute=true` がない限りdry-runで止める安全設計にした。
- Web管理画面MVP `/?page=admin-reservations` と `/admin/reservations` を追加した。
- Web管理画面MVPでは、予約一覧、1週間/1か月のslot残数カレンダー、日別slot残数、slot生成、slot状態・容量・メモ更新、予約詳細、管理者キャンセル、外部取り込み `needs_review` 確認済み更新、resource/menu/schedule作成・更新・停止、Google Calendar接続開始導線を操作できる。
- Web管理画面の枠カレンダーは、LIFFと同じ `◎ / △ / × / -` 表示を使い、LINE枠の残数を視覚的に確認できる。
- Google Calendar接続開始は、管理画面が `GET /api/reservations/google-calendar/oauth-url` をAPIキー付きで呼び、返されたGoogle OAuth URLを開く。
- Web管理画面のAPIキーは `sessionStorage` にだけ保存し、永続保存しない。
- `GET /api/external-reservation-sources` と `PUT /api/external-reservation-sources/:id/parse-status` を追加した。
- `GET /api/reservations/google-calendar/oauth-url` を追加した。
- `PUT /api/reservation-slots/:id` を追加し、slotの状態、総枠、LINE枠、外部枠、バッファ、メモを更新できるようにした。
- `PUT /api/reservation-resources/:resourceId`、`PUT /api/reservation-resources/:resourceId/menus/:menuId`、`PUT /api/reservation-resources/:resourceId/schedules/:scheduleId` を追加した。
- SDKから `client.reservations.listExternalSources()` と `client.reservations.updateExternalSourceParseStatus()` を呼べるようにした。
- `POST /api/integrations/jalan/gmail/import` を追加した。GAS/Gmailから `gmailMessageId` と `rawText` を送ると、Worker側でじゃらんメール本文を解析して既存の外部取り込み不変条件へ流す。
- じゃらんメールparser `apps/worker/src/services/jalan-mail-parser.ts` を追加した。
- SDKから `client.reservations.importJalanGmail()` を呼べるようにした。
- GASサンプル `docs/gas/jalan-gmail-import.gs` を追加した。
- GAS運用手順 `docs/gas/README.md` を追加した。
- Google Calendar連携用に `reservation_resources.google_calendar_connection_id` を追加した。
- 予約作成時にGoogle Calendar同期用の `calendar_bookings` を作る。
- Google Calendar `access_token` がある場合はGoogle Calendarイベント作成を試みる。
- キャンセル時は `calendar_bookings.status='cancelled'` にし、Google CalendarイベントIDがあれば削除を試みる。
- Google OAuthの認可開始URLとcallbackを追加した。
- Google OAuth callbackで `refresh_token` を `google_calendar_connections` に保存できる。
- ローカルseed `packages/db/seeds/reservations.local.sql` を追加した。
- `pnpm db:seed:reservations:local` でローカル予約データを投入できる。

### 実操作テスト済み

ローカルWorker API経由で以下を確認済み。

```text
slotId: slot_blueberry_20260503_0900
reservationId: f55e8cc7-cea0-4c2b-bdfe-5c6b85ce0dfd

予約作成前 reserved_count       0
予約作成後 reserved_count       1
キャンセル後 reserved_count     0

予約作成前 line_reserved_count  0
予約作成後 line_reserved_count  1
キャンセル後 line_reserved_count 0

予約ステータス confirmed -> cancelled
```

Google Calendar連携のD1側記録も確認済み。

```text
calendar_bookings.connection_id = gcal_reservation_default
calendar_bookings.status = cancelled
calendar_bookings.metadata.reservationId = f55e8cc7-cea0-4c2b-bdfe-5c6b85ce0dfd
calendar_bookings.event_id = null
```

`event_id = null` の理由は、ローカルseedの `gcal_reservation_default` にGoogleの `access_token` を入れていないため。D1側の同期記録は作られているが、本物のGoogle Calendarイベント作成は未確認。

2026-05-03 追加スモークテスト:

```text
date: 2026-05-04
slotId: slot_blueberry_20260504_0900
reservationId: d639739f-b709-4978-9920-a252525bb4ca

確認済み:
- resource isActive=false では予約作成が拒否される
- menu isActive=false では予約作成が拒否される
- slot totalCapacity=0 は拒否される
- slot status=closed では予約作成が拒否される
- 予約済みLINE枠を下回る lineCapacity 変更は拒否される
- 作成したテスト予約は cancelled に戻せる
- schedule は停止・再有効化できる
```

2026-05-03 管理画面APIスモークテスト:

```text
URL:
- http://localhost:8787/admin/reservations
- http://localhost:8787/api/reservation-resources
- http://localhost:8787/api/reservation-slots
- http://localhost:8787/api/reservations

確認済み:
- 管理画面ページは 200 で配信される
- API_KEY 付きで resource 一覧を取得できる
- 2026-05-04 の slot を 6件取得できる
- 管理APIから予約作成できる
- 予約作成で reserved_count / line_reserved_count が 0 -> 3 になる
- lineReservedCount=3 の状態で lineCapacity=1 へ下げる更新は 400 で拒否される
- 管理APIからキャンセルできる
- キャンセルで reserved_count / line_reserved_count が 3 -> 0 に戻る

テスト予約:
- reservationId: 5a94c305-7a38-40ad-b3ad-768c460c83a2
- slotId: slot_blueberry_20260504_0900
- menuId: menu_blueberry_60
```

### 追加・変更した主なファイル

```text
packages/db/migrations/029_reservations.sql
packages/db/migrations/030_reservation_google_calendar_connection.sql
packages/db/seeds/reservations.local.sql
packages/db/src/reservations.ts
packages/db/schema.sql
packages/db/src/index.ts
packages/shared/src/types.ts
apps/worker/src/routes/reservations.ts
apps/worker/src/routes/reservations/auth.ts
apps/worker/src/routes/reservations/serializers.ts
apps/worker/src/services/reservation-tokens.ts
apps/worker/src/services/reservation-google-calendar.ts
apps/worker/src/client/booking.ts
apps/worker/src/client/reservations-admin.ts
apps/worker/src/middleware/auth.ts
packages/sdk/src/resources/reservations.ts
packages/sdk/tests/resources/reservations.test.ts
packages/mcp-server/src/tools/reservations.ts
package.json
```

### 検証済みコマンド

```bash
pnpm --filter @line-crm/db typecheck
pnpm --filter @line-crm/shared typecheck
pnpm --filter worker build
pnpm --filter @line-harness/sdk test
pnpm --filter @line-crm/db test
pnpm db:migrate:local
pnpm db:seed:reservations:local
```

`pnpm --filter worker typecheck` は既存の別ファイルエラーで失敗する。予約追加由来の型エラーは解消済み。

既存エラーの例:

```text
apps/worker/src/routes/friends.ts: URLSearchParams.entries
apps/worker/src/routes/liff.ts: URLSearchParams iterator
apps/worker/src/routes/webhook.ts: c is not defined
apps/worker/src/services/event-bus.ts: unknown/object type handling
apps/worker/src/services/*.test.ts: vitest type not found
```

### 未実装

- じゃらん実メールサンプルに合わせたparser調整。
- 実GmailアカウントでのDRY_RUN確認。
- 本物のGoogle Calendarイベント作成・削除の結合テスト。
- 予約完了後のLINE通知メッセージ。
- LIFF実機でのID token/session/cancelToken再発行動作確認。

### 外部サービスから取得・設定が必要なもの

Google Calendarへ実イベントを作成するには、Google側の認証情報が必要。

MVPで手動設定するなら、最低限必要なのは以下。

```text
Google Calendar ID
Google OAuth access_token
```

`refresh_token` から `access_token` を更新する処理は実装済み。継続運用には以下が必要。

```text
Google OAuth client_id
Google OAuth client_secret
Google OAuth refresh_token
```

現在の `google_calendar_connections` には `access_token`, `access_token_expires_at`, `refresh_token`, `api_key` を保存できる。`GOOGLE_OAUTH_CLIENT_ID` と `GOOGLE_OAUTH_CLIENT_SECRET` が環境変数にあり、DBに `refresh_token` が保存されていれば、予約同期時に `access_token` を更新する。

Google OAuth接続を作る管理者向けURL:

```text
GET /api/integrations/google-calendar/oauth/start?calendarId=primary
Authorization: Bearer ADMIN_API_KEY
```

Google Cloud ConsoleのOAuth redirect URIには以下を登録する。

```text
https://your-worker.your-subdomain.workers.dev/api/integrations/google-calendar/oauth/callback
```

ローカルで試す場合は以下。

```text
http://localhost:8787/api/integrations/google-calendar/oauth/callback
```

callback成功後、`google_calendar_connections` に新しい接続が作成される。表示された connection ID を `reservation_resources.google_calendar_connection_id` に設定すると、その予約対象の予約作成・キャンセルがGoogle Calendarへ同期される。

じゃらん/Gmail取り込みを実運用するには、以下が必要。

```text
Gmail API OAuth client_id / client_secret / refresh_token
または Google Apps Script 側の実行権限
Gmail messageId
じゃらん予約番号 externalId
じゃらん新規・変更・キャンセルメールのサンプル本文
```

GAS側スクリプト:

```text
docs/gas/jalan-gmail-import.gs
docs/gas/README.md
```

GASのScript Propertiesに設定する値:

```text
WORKER_URL
WORKER_API_KEY
RESOURCE_ID
MENU_ID
GMAIL_QUERY
PROCESSED_LABEL
REVIEW_LABEL
MAX_THREADS
DRY_RUN
```

GASからWorkerへ送る最小payload:

```json
{
  "gmailMessageId": "gmail-message-id",
  "receivedAt": "2026-06-01T08:30:00+09:00",
  "rawText": "じゃらん予約メール本文",
  "resourceId": "res_blueberry",
  "menuId": "menu_picking_60"
}
```

送信先:

```text
POST /api/integrations/jalan/gmail/import
Authorization: Bearer <Worker API_KEY>
```

`resourceId` と `menuId` は自動予約作成したい場合に指定する。本文から日付と開始時刻が取れ、同日のslotが一致した場合だけ予約作成へ進む。足りない場合、または `updated` 系メールの場合は `needs_review` として保存し、管理画面で確認する。

LINE LIFFの公開予約APIを本物の端末で通すには、以下が必要。

```text
LINE LIFF ID
LINE Login Channel ID
LINE Login Channel Secret
LINE Bot Channel Access Token
LINE Bot Channel Secret
```

ローカルのAPIスモークテストは管理者APIで通っているが、LIFFの本物の `idToken` はLINEアプリ内でしか取得できないため、端末でのLIFF実機確認が別途必要。

## 前提

- 予約対象は、当初は「ブルーベリー摘み取り体験」と「カフェ予約」。
- 今後、摘み取り + カフェセット、団体予約、イベント、ワークショップ、テイクアウト受取などが増える。
- 予約枠は原則 1時間単位。
- 受付時間は 9:00-15:00。最終枠は 14:00-15:00。
- 予約メニューごとに、所要時間、受付人数、受付曜日、受付可能時間を変えられるようにする。
- LINE予約とじゃらん予約を同じ予約DB上で扱う。
- じゃらん予約は Gmail/GAS から取り込む。
- LINE予約からじゃらん側への即時反映は、MVPでは手動/半自動タスクとして扱う。

## 設計方針

### 1. 予約の顧客IDは既存 users を使う

新規 `customers` テーブルは作らない。既存の `users` は「Internal UUID Cross-Account System」で、メール、電話、外部ID、表示名を持つため、予約の顧客統合IDとして再利用する。

ただし、予約固有の状態を `users.ts` に直接混ぜすぎない。予約固有の状態、メモ、初回来園日、最終来園日などは `reservation_customer_profiles` に分ける。

```text
users = 顧客の統合ID
friends = LINE上の友だち接点
reservation_customer_profiles = 予約・来園ドメイン固有の顧客状態
reservations = 予約本体
reservation_items = 予約メニュー明細
visits = 来園履歴
```

この方針により、LINE予約者、じゃらん予約者、電話予約者、Gmailから取り込んだ予約者、来園済み顧客、将来のEC購入者を同じ `users.id` に統合できる。

### 2. line_accounts は顧客接点として再利用しない

`line_accounts` は LINE公式アカウントの接続設定であり、顧客との接点ではない。予約者のLINE情報として再利用してはいけない。

顧客のLINE接点は既存の `friends` を使う。将来、`friends` に `line_account_id` が必要な場合は、`friends` を拡張するか、`line_contacts` を別途追加する。MVPでは既存 `friends` と `users` の `user_id` リンクを優先する。

### 3. 予約メニューと予約枠を分ける

`reservation_resources` は大きなカテゴリとして扱う。

例:

- ブルーベリー摘み取り
- カフェ席
- イベント枠

実際に予約フォームで選ばせる商品・プランは `reservation_menus` に持つ。

例:

- 摘み取り体験 60分
- 摘み取り + カフェセット
- カフェ席予約
- 団体摘み取り

### 4. 予約枠は在庫として持つ

MVPでも `reservation_slots` を明示的に持つ。

理由:

- 9:00-15:00の1時間枠を管理画面で開閉したい。
- 日別にキャパを変えたい。
- 雨天、繁忙日、スタッフ都合で枠を閉じたい。
- LINE枠、外部枠、バッファ枠をMVPから計算に使いたい。
- D1/SQLiteで同時予約時の在庫制御を少しでも安全にしたい。

### 5. 外部取り込みは冪等にする

じゃらん予約メールは `external_reservation_sources` に元メール、解析結果、重複判定結果を保存する。

同じ `externalId` の再取り込みは `409` だけにしない。既存予約を返す idempotent success とする。Gmail/GAS は再送される前提で設計する。

## 壊してはいけない不変条件

- `reservation_slots.reserved_count` は `0` 未満にしない。
- `reservation_slots.reserved_count` は `pending` / `confirmed` の合計人数だけを表す。
- `remaining_capacity <= 0` の枠は `status = 'open'` でも満席扱いにする。
- `sold_out` はMVPでは自動管理しない。満席判定は残数計算で行う。
- 予約が存在する slot は物理削除しない。閉じたい場合は `status = 'closed'` または `hidden` にする。
- 予約作成は条件付き `UPDATE` で在庫を先に確保する。
- 在庫カウンタは `source` ではなく `capacity_channel` で判断する。
- キャンセルで在庫を戻すのは `pending` / `confirmed` から `cancelled` へ遷移した時だけ。
- `completed`, `no_show`, `cancelled` から `cancelled` にしても在庫は戻さない。
- 外部取り込みは `source + external_id` または `dedupe_key` で冪等にする。
- じゃらんキャンセルメールも取り込み対象にし、既存予約を `cancelled` に遷移させる。
- 顧客ステータスは単一予約で直接上書きせず、予約全体と来園履歴から再計算する。

## 実装時の必須ルール

以下は実装時に必ず守る。仕様判断に迷った場合も、このルールを優先する。

1. 予約作成は必ず slot の条件付き `UPDATE` で在庫を確保してから `reservations` を作る。
2. キャンセルは状態遷移表を通す。在庫戻しは `pending` / `confirmed` から `cancelled` に変わった時だけ、1回だけ行う。
3. 在庫カウンタは `source` ではなく `capacity_channel` で判断する。
4. 外部取り込みは必ず冪等にする。同じ `externalId` / `dedupeKey` の再取り込みは既存予約を返す。
5. じゃらん `updated` 系メールは自動反映しない。既存予約に紐づけて `needs_review` にする。
6. 公開APIは `lineUserId` 直指定を信用しない。LIFF ID token 由来の短命署名tokenで認可する。

## 実装開始前に確定すること

- じゃらんメールから安定して取得できる `externalId` の仕様。
- `externalId` が取れない場合の `dedupe_key` 生成ルール。
- 公開LIFF予約詳細・キャンセルで使う短命署名tokenの形式。
- `friends` に `line_account_id` を追加するか、MVPでは既存の `line_user_id` 一意制約を維持するか。
- `line_capacity` と `external_capacity` の初期値を管理画面で入力するか、slot生成時に resource/schedule からコピーするか。
- 2時間メニューや複数リソース消費をMVP対象外にする運用で問題ないか。
- 予約日時をDB内でUTC RFC3339に統一するか、JST `+09:00` 固定にするか。

## 次に実装すべきスケジュール

現時点では、Web管理画面より先にバックエンドとSDKを固める。

理由:

- UIを先に作ると、未確定のAPI契約に画面が引きずられる。
- SDKを先に作ると、Worker API、Web管理画面、MCPが同じ契約を使える。
- 予約は在庫ズレが重大なので、画面より先にDB helper、API、SDK、テストで不変条件を固定する。
- LINE Harness本体更新に耐えるには、予約ドメインの境界を `packages/db`, `packages/shared`, `packages/sdk`, `apps/worker/src/routes/reservations/*` に閉じる方がよい。

### Phase 1. バックエンド不変条件の固定 ✓ 完了

優先度: 最優先 → **2026-05-03 完了**

目的は「予約が壊れない」こと。

実装したこと:

- `packages/db/src/reservations-logic.test.ts` (14テスト): 純粋ロジックのLayer 1テストを追加した。
- `packages/db/src/reservations-d1.test.ts` (37テスト): miniflare D1統合テストのLayer 2テストを追加した。
- 予約作成で条件付き `UPDATE` が必ず先に走ることをテストした。
- `capacity_channel=line/external/manual` の在庫増減をテストした。
- `pending/confirmed -> cancelled` だけ在庫が戻ることをテストした。
- `cancelled -> cancelled` は冪等成功で在庫が戻らないことをテストした。
- `completed/no_show -> cancelled` は拒否され、在庫が戻らないことをテストした。
- 外部取り込みの `created/updated/cancelled` をテストした。
- 一度取り込み済みの同一 `externalId` に `cancelled` / `updated` が来るケースをテストした。
- `externalId/dedupeKey` の空文字NULL正規化をテストした。

未テスト（追加推奨）:

- Google Calendar同期失敗時に予約本体が壊れず、`external_sync_tasks` に失敗が残ることのテスト。

完了条件:

```text
✓ 予約作成・キャンセル・外部取り込みの主要ケースがテストで固定されている。
✓ 外部取り込みの同一externalId再処理でも、キャンセルと変更メールの分岐が壊れない。
△ Google Calendar同期失敗テストは未追加。
```

### Phase 2. Worker API契約の固定 ✓ 完了

優先度: 高 → **2026-05-03 完了**

目的は「SDKとUIが依存できるAPI」を作ること。

残りの実装:

- `apps/worker/src/routes/reservations.ts` をさらに分割する。→ **完了**
- `public.ts`, `admin.ts`, `integrations.ts`, `index.ts` に分ける。→ **完了**
- request validation helperを追加する。→ **完了**
- APIエラーコードを固定する。→ **完了**
- 公開API、管理者API、外部取り込みAPIのレスポンス形を `packages/shared` の型に寄せる。→ **完了**
- `openapi` またはAPI契約ドキュメントを更新する。→ **完了**

推奨ファイル構成:

```text
apps/worker/src/routes/reservations/
  index.ts
  public.ts
  admin.ts
  integrations.ts
  auth.ts
  requests.ts
  responses.ts
  serializers.ts
  validators.ts
```

完了条件:

```text
SDKがWorker APIを型安全に呼べる程度に、入力・出力・エラーが固定されている。
```

確認:

- `pnpm --filter worker build` は成功。
- `pnpm --filter @line-crm/shared typecheck` は成功。
- `pnpm --filter @line-crm/db test` は51テスト成功。
- `pnpm --filter worker typecheck` は既存の予約外エラーで失敗する。予約API関連の新規型エラーは解消済み。

### Phase 3. SDK実装 ✓ 完了

優先度: 高 → **2026-05-03 完了**

目的は「Web管理画面、LIFF、MCPが同じ予約APIクライアントを使う」こと。

実装すること:

- `packages/sdk/src/resources/reservations.ts` を追加する。→ **完了**
- `packages/sdk/src/index.ts` からexportする。→ **完了**
- 管理者向けSDKメソッドを追加する。→ **完了**
- 公開LIFF向けSDKメソッドを追加する。→ **完了**
- じゃらん/Gmail取り込み向けSDKメソッドを追加する。→ **完了**
- `packages/shared` の予約型をSDKの戻り値に使う。→ **完了**

SDKに追加する主なメソッド:

```typescript
getReservationResources()
createReservationResource()
getReservationMenus(resourceId)
createReservationMenu(resourceId)
getReservationSchedules(resourceId)
createReservationSchedule(resourceId)
generateReservationSlots()
getReservationSlots()
getReservations()
getReservation(id)
createReservation()
updateReservationStatus()
createReservationSession()
getPublicReservationSlots()
createPublicReservation()
getMyReservations()
getPublicReservationDetail()
cancelPublicReservation()
importJalanReservation()
startGoogleCalendarOAuth()
```

実装済みメソッド:

```typescript
client.reservations.listResources()
client.reservations.createResource()
client.reservations.listMenus(resourceId)
client.reservations.createMenu(resourceId, input)
client.reservations.listSchedules(resourceId)
client.reservations.createSchedule(resourceId, input)
client.reservations.generateSlots(input)
client.reservations.listSlots(params)
client.reservations.list(params)
client.reservations.get(id)
client.reservations.create(input)
client.reservations.updateStatus(id, input)
client.reservations.createSession(input)
client.reservations.listPublicMenus(resourceId)
client.reservations.listPublicSlots(params)
client.reservations.createPublic(input)
client.reservations.listMine(params)
client.reservations.getPublicDetail(input)
client.reservations.cancelPublic(input)
client.reservations.importJalan(input)
client.reservations.startGoogleCalendarOAuth(input)
```

確認:

- `pnpm --filter @line-harness/sdk typecheck` は成功。
- `pnpm --filter @line-harness/sdk test` は56テスト成功。
- `pnpm --filter @line-harness/sdk build` は成功。

完了条件:

```text
Web管理画面とMCPは、直接fetchを書かずSDKを使えば予約機能を呼べる。
```

### Phase 4. MCP server実装 ✓ 完了

優先度: 中 → **2026-05-03 完了**

目的は「AI/Claudeから予約状況確認や管理操作を安全にできる」こと。

実装すること:

- `packages/mcp-server/src` に予約toolsを追加する。→ **完了**
- SDKを使ってWorker APIを呼ぶ。→ **完了**
- 危険操作は明示的に分ける。→ **完了**
- 予約作成、キャンセル、slot生成、じゃらん取り込みの権限境界を明確にする。→ **完了**

MCP tools候補:

```text
reservation.resources.list
reservation.menus.list
reservation.slots.list
reservation.reservations.list
reservation.reservations.get
reservation.reservations.create
reservation.reservations.cancel
reservation.slots.generate
reservation.external.import_jalan
```

実装済みtools:

```text
reservation_resources_list
reservation_menus_list
reservation_slots_list
reservations_list
reservation_get
reservation_slots_generate
reservation_create
reservation_cancel
reservation_external_import_jalan
```

安全ルール:

```text
読み取り系toolはそのまま実行する。
書き込み系toolは execute=true がない限りdry-runで止める。
MCPはDBを直接更新しない。
在庫確保、キャンセル時の在庫戻し、外部取り込みの冪等性は必ずWorker APIとSDKを通す。
```

確認:

- `pnpm --filter @line-harness/mcp-server build` は成功。
- `pnpm --filter @line-harness/sdk typecheck` は成功。
- `pnpm --filter @line-crm/db test` は51テスト成功。

完了条件:

```text
MCPから予約確認・予約作成・キャンセルができる。ただし在庫変更はWorker APIの状態遷移を必ず通る。
```

### Phase 5. Web管理画面

優先度: 中

目的は「人間が運用できる」こと。

進捗: MVP完了。

実装済み:

- `/?page=admin-reservations` と `/admin/reservations` を追加した。
- 管理APIキーを入力して、管理者APIをBearer認証で呼ぶ。
- 日付とresourceを選び、日別slot残数を確認できる。
- 日付範囲を指定してslot生成できる。
- slotの `open` / `closed` / `sold_out` / `hidden`、総枠、LINE枠、外部枠、バッファ、メモを更新できる。
- slot容量は既存予約数を下回れない。壊れる容量変更はDB helperで拒否する。
- resource/menu/scheduleを管理画面から作成できる。
- resource/menu/scheduleを管理画面から更新・停止できる。停止は既存予約を変更せず、新規予約や将来のslot生成だけを止める。
- Google Calendar接続開始ボタンを追加した。
- Google OAuth URLは管理APIで発行し、APIキーをGoogle側URLへ漏らさない。
- 日別予約一覧を確認できる。
- 予約詳細を確認できる。
- `pending` / `confirmed` の予約を管理画面からキャンセルできる。
- キャンセルは `PUT /api/reservations/:id/status` を通るため、DBの状態遷移表と在庫戻し不変条件を必ず通る。
- 外部取り込み `needs_review` を確認し、予約本体を自動変更せず `ignored` に更新できる。

残りの実装:

- slot削除UIはMVP対象外。予約が存在するslotは削除禁止のまま、閉じる運用を基本にする。
- AI/MCPチャットUI。自然文入力、dry-run、差分確認、execute=true実行の順にする。

AI/MCPチャットUIで必要な機能:

- 自然文入力欄。
- 利用モデル選択。Claude API / GPT API を切り替えられるようにする。
- MCP tool一覧の表示。予約確認、予約作成、キャンセル、slot生成、じゃらん取り込みを対象にする。
- dry-run結果の表示。DB更新前に、実行予定tool、payload、影響する予約・slotを表示する。
- execute確認。ユーザーが確認した場合だけ `execute=true` でMCP toolを呼ぶ。
- 操作ログ保存。誰が、どの自然文から、どのtoolを、どのpayloadで実行したかを残す。
- 権限境界。AI/MCPはDBを直接触らず、必ずWorker APIと状態遷移表を通す。

完了条件:

```text
農園側が予約状況、残数、キャンセル、外部取り込み要確認をWebで操作できる。
```

### Phase 6. Gmail/じゃらん実取り込み

優先度: 中

目的は「外部予約メールを安全にDBへ反映する」こと。

進捗: Worker側MVP完了。

実装済み:

- GAS/GmailからWorkerへPOSTする形式を固定した。
- GAS側のGmail検索・POSTスクリプトを追加した。
- `POST /api/integrations/jalan/gmail/import` を追加した。
- じゃらんメール本文parserを追加し、予約番号、イベント種別、日付、開始時刻、人数、氏名、電話、メール、プラン名を抽出する。
- 実メール例の `利用日時：2025/07/09(水) 11:00～12:00`、`人数：2名  (大人(中学生～):2名、小学生:0名...)`、`体験者氏名` の形式に対応した。
- プラン名はブレる前提で、menu自動判定の主キーにはしない。自動作成したい場合はGAS側設定または管理画面側対応表から `resourceId` / `menuId` を明示する。
- `created` は `resourceId` / `menuId` / slot解決が揃った場合だけ予約作成する。
- `cancelled` は既存予約に紐づく場合のみ状態遷移表を通してキャンセルする。
- `updated` は自動反映せず `needs_review` にする。
- Gmail messageIdをdedupeKeyとして優先する。

残りの実装:

- 実Gmailアカウントで `DRY_RUN=true` のpayloadを確認する。
- 実際のじゃらんメール本文サンプルを追加で集め、parserを調整する。
- Gmail再送・既読/ラベル管理の運用ルールを決める。

完了条件:

```text
新規予約・キャンセルメールは自動反映され、変更メールは要確認に残る。
```

## 保守性のための実装ルール

予約機能はLINE Harness本体の汎用機能に混ぜすぎない。

守ること:

- 予約固有ロジックは `packages/db/src/reservations.ts` と `apps/worker/src/routes/reservations/*` に寄せる。
- UI、SDK、MCPは直接DBを触らない。必ずWorker APIかSDKを通す。
- 在庫変更はDB helper以外に書かない。
- `reservation_slots` のカウンタを直接更新するSQLをrouteやUIに書かない。
- `source` で在庫カウンタを判断しない。必ず `capacity_channel` を使う。
- 公開APIで `lineUserId` を信用しない。必ずLIFF ID token由来の署名tokenを使う。
- 外部同期はベストエフォートにする。Google Calendarやじゃらん同期に失敗しても予約本体を壊さない。
- 同期失敗は `external_sync_tasks` に残す。
- SDKを先に固め、Web管理画面とMCPはSDK経由で実装する。
