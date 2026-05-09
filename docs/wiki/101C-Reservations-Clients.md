# 101C. 予約システム: Client, SDK, MCP

## LIFF画面

実装済み:

- `apps/worker/src/client/booking.ts`

変更済み:

- `apps/worker/src/client/main.ts`
- `apps/worker/index.html`

URL:

```text
https://liff.line.me/{LIFF_ID}?page=book&resourceId={RESOURCE_ID}&menuId={MENU_ID}
```

画面フロー:

1. `resourceId` から予約対象を取得する。
2. メニュー一覧を取得する。
3. LIFF SDK で profile を取得する。
4. LINE ID tokenを `LIFF_SESSION_TOKEN` に交換する。
5. メニュー、大人/子ども/幼児の人数、1週間/1か月の空き枠を表示する。
6. `lineRemainingCapacity` を反映した空き枠を `◎ / △ / × / -` で表示する。
7. 名前、電話番号、メール、備考を入力する。
8. 確認画面を表示する。
9. 予約を作成する。
10. 完了画面に日時、人数、予約ID、詳細導線、キャンセル導線を表示する。
11. 自分の予約一覧と予約詳細を表示する。
12. 予約作成時に保存した `cancelToken` がある場合は、LIFF上でキャンセルできる。

制約:

- 公開APIでは `lineUserId` query指定を信用しない。
- 予約一覧は `LIFF_SESSION_TOKEN` で取得する。
- キャンセルは `reservation:cancel` scopeの `cancelToken` が必要。
- 別端末やlocalStorage消去後は、`POST /api/public/reservations/:id/tokens` で本人予約の `detailToken` / `cancelToken` を再発行する。

## Web管理画面

追加予定:

- `apps/web/src/app/reservations/page.tsx`
- `apps/web/src/app/reservations/settings/page.tsx`
- `apps/web/src/components/reservations/reservation-list.tsx`
- `apps/web/src/components/reservations/reservation-detail.tsx`
- `apps/web/src/components/reservations/reservation-slot-calendar.tsx`
- `apps/web/src/components/reservations/reservation-menu-settings.tsx`
- `apps/web/src/components/reservations/reservation-schedule-editor.tsx`
- `apps/web/src/components/reservations/external-import-status.tsx`

変更予定:

- `apps/web/src/lib/api.ts`
- `apps/web/src/components/layout/sidebar.tsx`

MVP画面:

- 日付フィルタ
- 予約対象フィルタ
- ステータスフィルタ
- 予約元フィルタ
- 予約一覧
- 予約詳細
- 来園済み
- キャンセル
- じゃらん取り込み要確認
- slotごとの `totalCapacity`, `lineCapacity`, `externalCapacity`, `bufferCapacity`, `reservedCount` 表示

## SDK

追加予定:

- `packages/sdk/src/resources/reservations.ts`
- `packages/sdk/tests/resources/reservations.test.ts`

変更予定:

- `packages/sdk/src/client.ts`
- `packages/sdk/src/index.ts`
- `packages/sdk/src/types.ts`

SDK API:

```typescript
const slots = await lh.reservations.listSlots('resource-id', {
  date: '2026-06-01',
  menuId: 'menu_picking_60',
  adultCount: 2,
  childCount: 1,
  infantCount: 1,
});

const reservation = await lh.reservations.create({
  resourceId: 'res_blueberry',
  menuId: 'menu_picking_60',
  slotId: 'slot_20260601_0900_blueberry',
  adultCount: 2,
  childCount: 1,
  infantCount: 1,
  customer: {
    name: '山田太郎',
    phone: '09000000000',
  },
});

const reservations = await lh.reservations.list({
  date: '2026-06-01',
  status: 'confirmed',
  source: 'line',
});

await lh.reservations.cancel('reservation-id', {
  reason: 'customer_requested',
  confirm: true,
});
```

## MCP Server

追加予定:

- `packages/mcp-server/src/tools/list-reservations.ts`
- `packages/mcp-server/src/tools/get-reservation.ts`
- `packages/mcp-server/src/tools/list-reservation-slots.ts`
- `packages/mcp-server/src/tools/manage-reservation.ts`
- `packages/mcp-server/src/tools/import-external-reservation.ts`

変更予定:

- `packages/mcp-server/src/tools/index.ts`
- `packages/mcp-server/src/resources/index.ts`

追加ツール:

| ツール | 説明 |
|---|---|
| `list_reservations` | 予約一覧を取得 |
| `get_reservation` | 予約詳細を取得 |
| `list_reservation_slots` | 指定日の空き枠を取得 |
| `manage_reservation` | 予約作成、キャンセル、ステータス更新 |
| `import_external_reservation` | Gmail/じゃらん予約取り込み |

破壊的操作は `confirm: true` を必須にする。

- キャンセル
- ステータス更新
- slot閉鎖
- 外部取り込みの手動確定

AI経由の更新は `reservation_events.actor_type = 'mcp'` を残す。

## Worker実装ファイル

追加予定:

- `apps/worker/src/routes/reservations.ts`
- `apps/worker/src/routes/public-reservations.ts`
- `apps/worker/src/routes/integrations-jalan.ts`
- `apps/worker/src/services/reservations.ts`
- `apps/worker/src/services/reservation-slots.ts`
- `apps/worker/src/services/reservation-events.ts`
- `apps/worker/src/services/reservation-rich-menu.ts`

変更予定:

- `apps/worker/src/index.ts`
- `apps/worker/src/services/event-bus.ts`

## DB / shared 実装ファイル

追加予定:

- `packages/db/migrations/029_reservations.sql`
- `packages/db/src/reservations.ts`
- `packages/db/tests/reservations.test.ts`

変更予定:

- `packages/db/schema.sql`
- `packages/db/src/index.ts`
- `packages/db/src/users.ts`
- `packages/shared/src/types.ts`
- `packages/shared/src/index.ts`

人数区分:

- LIFF入力は `adultCount`, `childCount`, `infantCount` の3つに分ける。
- 空き枠取得では、クライアントで単純に `adult + child + infant` を送るだけにしない。メニューごとの在庫消費ルールはサーバーが持つため、3区分を送ってサーバー側で `capacityPeople` を計算する。
- 表示上の合計人数は `totalPeople`、残数判定に使う人数は `capacityPeople` として区別する。

`packages/db/src/users.ts` には、予約専用の在庫・来園ロジックは入れない。予約側から必要な `createUser`, `getUserByPhone`, `linkFriendToUser` を使う。
