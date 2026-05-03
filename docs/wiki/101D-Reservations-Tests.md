# 101D. 予約システム: Tests and Operations

## テスト方針

予約は在庫と状態遷移を壊すと業務事故になる。実装前にテストを書く。

## DB helper tests

対象:

- `packages/db/src/reservations.ts`

必須ケース:

- 既存 `users` を顧客IDとして使い、電話番号で同一ユーザーを再利用できる。
- `friends.user_id` と予約 `user_id` を結べる。
- 予約対象を作成できる。
- 予約メニューを作成できる。
- 9:00-15:00の1時間枠を6件生成できる。
- 既存枠がある場合、`overwrite=false` で上書きしない。
- 予約が存在する slot は削除できない。
- `status='open'` でも `remaining_capacity <= 0` なら満席扱いにできる。
- `line_capacity` を超えるLINE予約は拒否する。
- `external_capacity` を超える外部予約は自動作成しない。
- 人数予約で `reserved_count` と `line_reserved_count` が増える。
- じゃらん予約で `reserved_count` と `external_reserved_count` が増える。
- `source=admin`, `capacity_channel=line` の予約をキャンセルすると `line_reserved_count` が戻る。
- `source=mcp`, `capacity_channel=external` の予約をキャンセルすると `external_reserved_count` が戻る。
- `capacity_channel=manual` の予約は `reserved_count` だけ増減する。
- キャパ超過時に予約作成を拒否する。
- `pending -> cancelled` で在庫が戻る。
- `confirmed -> cancelled` で在庫が戻る。
- `pending -> confirmed` で在庫数は変化せず、`confirmed` event が残る。
- `cancelled -> cancelled` はno-opで在庫が二重に戻らない。
- `completed -> cancelled` は通常拒否される。
- `no_show -> cancelled` は通常拒否され、在庫が戻らない。
- 来園済み更新で `visits` が1件だけ作成される。
- 同じ `externalId` の再取り込みは既存予約を返す。
- 同じ `dedupeKey` の再取り込みは既存予約を返す。
- `external_id` と `dedupe_key` が両方 `NULL` の外部取り込みは400相当で拒否される。
- `external_id` が同じで `eventType=cancelled` の再取り込みは idempotent success になる。
- `externalId` が空文字の場合は `NULL` に正規化される。
- `dedupeKey` の衝突疑いは `needs_review` にできる。
- 同一ユーザーが複数予約を持つ場合、1件キャンセルしても active 予約があれば profile status は `reserved` のまま。
- 2時間menuを1時間slotに入れようとすると `invalid_slot` になる。
- `menu.resource_id` と `slot.resource_id` が一致しない予約作成は拒否される。

## Worker API integration tests

対象:

- `apps/worker/src/routes/reservations.ts`
- `apps/worker/src/routes/public-reservations.ts`
- `apps/worker/src/routes/integrations-jalan.ts`

必須ケース:

- 管理APIはBearer Tokenなしで401。
- 公開APIは必要項目不足で400。
- 空き枠取得は9:00-15:00の6枠を返す。
- 人数がLINE残数を超えた場合409。
- 人数が総残数を超えた場合409。
- 予約作成後、同じ枠のLINE残数が減る。
- 予約作成後、profile status 再計算により `reservation_customer_profiles.status` が `reserved` になる。
- 完了更新後、profile status 再計算により `reservation_customer_profiles.status` が `visited` になり visit が作成される。
- キャンセル後、残数が1回だけ戻る。
- 他人の予約詳細取得は403。
- `/api/public/me/reservations` は `lineUserId` query ではなく署名済みtokenで認可される。
- じゃらん同一 `externalId` の二重取り込みは200で既存予約を返す。
- じゃらんキャンセルメール取り込みで既存予約が `cancelled` になり、`external_reserved_count` が戻る。
- じゃらん `eventType=updated` は既存予約を直接変更せず `needs_review` になる。
- じゃらん枠超過は予約を自動作成せず要確認にする。
- LINE予約キャンセル時、`reduce_capacity` done 済みなら `restore_capacity` タスクが作成される。
- `startAt` / `endAt` をクライアントが送っても、slot由来の値で予約が作成される。
- `detailToken` ではキャンセルできず、`cancelToken` だけキャンセルできる。

## LIFF/UI tests

対象:

- `apps/worker/src/client/reservation.ts`

必須ケース:

- メニュー一覧を表示できる。
- 日付選択後、空き枠を取得できる。
- 満席枠を選択不可にする。
- `lineRemainingCapacity < people` の枠を選択不可にする。
- 名前/電話番号/人数のバリデーションが効く。
- 予約完了画面に日時、人数、予約IDを表示する。

## Web UI tests

対象:

- `apps/web/src/app/reservations/page.tsx`

必須ケース:

- 予約一覧の空状態/エラー状態/ローディングを表示できる。
- 日付、予約対象、ステータス、予約元で絞り込める。
- slotごとの総残数、LINE残数、外部残数を表示できる。
- 来園済みボタンで status が completed になる。
- キャンセル処理後に一覧が再取得される。
- じゃらん取り込み要確認を表示できる。

## MCP tests

対象:

- `packages/mcp-server/src/tools/*reservation*.ts`

必須ケース:

- list/get/listSlots は読み取りとして動く。
- create/cancel/status update は zod validation される。
- 破壊的操作は `confirm: true` がないと拒否する。
- AI経由の更新は `reservation_events.actor_type='mcp'` を残す。

## 実装順序

実装は、在庫と状態遷移を先に固めてから画面へ進む。

### Phase 1: 型とDBの土台

1. `packages/shared` に予約型、ステータス、`capacity_channel`、外部取り込み型を追加する。
2. `packages/db/migrations/029_reservations.sql` を作る。
3. seed 方針を決め、ブルーベリー摘み取り・カフェの初期 resource/menu/schedule を作れるようにする。

### Phase 2: DB helper と安全性テスト

4. `packages/db/src/reservations.ts` を作る。
5. slot生成、残数計算、条件付き `UPDATE` による在庫確保を実装する。
6. 状態遷移表に基づく status update と在庫戻しを実装する。
7. `capacity_channel` 別の在庫増減テストを通す。
8. キャンセル二重戻し防止、`pending -> confirmed`、`completed/no_show -> cancelled` 拒否のテストを通す。

### Phase 3: 外部取り込みと顧客状態

9. 外部取り込みの `externalId` / `dedupeKey` 冪等処理を実装する。
10. じゃらん `created` / `cancelled` / `updated` の処理を実装する。
11. `updated` は自動反映せず `needs_review` にする。
12. `recomputeReservationCustomerProfileStatus(userId)` を実装し、予約作成・キャンセル・来園済み・no-show・外部取り込み後に呼ぶ。
13. `restore_capacity` タスク作成条件を実装する。

### Phase 4: Worker API

14. `apps/worker/src/routes/reservations.ts` に管理APIを追加する。
15. `apps/worker/src/routes/public-reservations.ts` に公開LIFF APIを追加する。
16. `apps/worker/src/routes/integrations-jalan.ts` にじゃらん取り込みAPIを追加する。
17. 公開APIは `lineUserId` query を信用せず、LIFF ID token 由来の短命署名tokenで認可する。
18. 予約作成APIでは `resourceId` / `menuId` / `slotId` の整合性を必ず検証する。

### Phase 5: UI

19. LIFF予約フォームを新APIへ接続する。
20. Web管理画面で予約一覧、日別slot、来園済み、キャンセル、じゃらん要確認を実装する。
21. 予約済みリッチメニュー切替をイベント化する。

### Phase 6: SDK / MCP / 外部連携

22. `packages/sdk` に `ReservationsResource` を追加する。
23. `packages/mcp-server` に予約参照・作成・キャンセル・外部取り込みツールを追加する。
24. Google Calendar連携を外部同期として再接続する。

## MVP完成条件

- 管理者が「ブルーベリー摘み取り」「カフェ」の予約対象を登録できる。
- 管理者が9:00-15:00の1時間枠を生成できる。
- LIFFから日付、時間、人数、メニューを選んで予約できる。
- 予約人数に応じて総残数とLINE残数が減る。
- 満席枠は予約できない。
- 自分の予約を確認できる。
- 管理画面で予約一覧を見られる。
- 管理画面で来園済み・キャンセルにできる。
- キャンセルで在庫が1回だけ戻る。
- 予約作成、キャンセル、来園済みのイベントログが残る。
- じゃらん予約メールの取り込み先APIがある。
- 同じ外部予約の再取り込みは既存予約を返す。
- Claude/MCPから日別予約一覧と空き枠を参照できる。

## 運用不変条件

- 予約の中心IDは `reservations.id`。
- 顧客の中心IDは `users.id`。
- LINE userIdを顧客IDにしない。
- `line_accounts` を顧客接点として使わない。
- じゃらん予約はLINE userIdを持たない前提で設計する。
- `reservation_slots.reserved_count` を持つため、予約作成/キャンセル時の更新漏れテストを必ず書く。
- 15:00まで営業で「14:00-15:00が最終枠」なら schedule の `end_time` は `15:00`。
- 「15:00開始枠」も取りたいなら `end_time` は `16:00`。
- 公開予約詳細/キャンセルは `lineUserId` だけで認可しない。短命署名tokenを使う。
