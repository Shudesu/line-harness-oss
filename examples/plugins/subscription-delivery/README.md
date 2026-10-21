# 定期便の配送管理プラグイン

商品ごとの配送日を登録し、**入金が確定した契約期間**から配送予定を作る独立したWorkerです。
商品名・価格・季節・配送回数を固定しません。お茶・米・季節便などに使えます。
元の定期便実装で使っていた「期間全体の日付検査」「重複作成防止」「入金後の配送復旧」を抽出しています。

## 起動・確認

このフォルダを本体の外にコピーして、別リポジトリで管理します。

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run db:local
# .dev.vars に DELIVERY_API_TOKEN="32文字以上のランダム値" を設定
npm run dev
```

`npm test`はMiniflareの実WorkerとD1 SQLiteを起動します。日付不足、再実行、並行要求、
支払期間境界、CSV数式、発送後の状態保護まで検証します。外部決済は呼びません。

配信する場合は**プラグイン専用**のD1を作り、`wrangler.jsonc`のIDを置き換え、
`schema.sql`をそのDBに適用してください。`wrangler secret put DELIVERY_API_TOKEN`で
秘密値を登録した後、このWorkerだけをデプロイします。本体DBへ適用しないでください。

## API契約

`GET /health`以外は全て`Authorization: Bearer <DELIVERY_API_TOKEN>`が必要です。
これは決済アダプターと運用者専用の秘密値です。購入者やブラウザには渡しません。

`POST /api/slots` — 商品ごとの到着日・発送日（UTC暦日、YYYY-MM-DD）。

```json
{"id":"tea-spring-2030","planId":"tea","arrivalDate":"2030-04-01","shippingDate":"2030-03-28"}
```

同一商品の同じ到着日は一枠です。登録済み枠の変更は409です。修正は未配送の支払期間と
突合してから運用者がDBで行います。既存配送の住所・日時スナップショットは自動変更しません。

`POST /api/periods` — 決済提供元が入金を確認した後だけ呼びます。提供元の成功画面への
リダイレクトだけでは呼びません。`[periodStart, periodEnd)`に含まれる枠数が
`deliveryCount`と一致すると、その期間の配送予定を一括作成します。

```json
{
  "provider":"stripe","paymentId":"invoice-example","subscriptionId":"subscription-example",
  "planId":"tea","friendId":"example-friend","lineAccountId":"example-account",
  "periodStart":"2030-01-01","periodEnd":"2031-01-01","deliveryCount":1,
  "shipping":{"name":"配送先氏名","phone":"0000000000","postalCode":"0000000",
    "region":"都道府県","city":"市区町村","line1":"番地","country":"JP"}
}
```

- 200 `ready`: 配送予定が揃っています。同じ内容の再送は200です。
- 202 `blocked`: 入金情報を保存しましたが日付不足です。部分的には作りません。
- 409: 同じ決済IDまたは同じ契約期間に異なる内容が届きました。決済側と突合してください。
- 400: 不正な入力。500: DB処理失敗。同じ入金内容で再試行できます。

不足日を登録後、`POST /api/reconcile`で配送だけを再作成します。決済APIを呼ぶコードはありません。
任意でwranglerのcronを有効にできます。発送日に達した予定は`preparing`になります。

| API | 用途 |
| --- | --- |
| `GET /api/blocked` | 日付不足の支払期間とエラー（最大100件） |
| `GET /api/orders?offset=0` | 配送一覧、1000件ごとのページ、hasMore/nextOffset |
| `GET /api/orders.csv` | 配送CSV。1000件超では409を返し、切り捨てません |
| `PATCH /api/orders/:id` | `{"status":"shipped","trackingNumber":"..."}`など |

状態遷移はscheduled→preparing→shipped→delivered、発送前のcanceledです。
発送済みの取り消しは拒否します。CSVは表計算ソフトの数式とCSV構文をエスケープします。

## 接続・権限・停止

- 対象: L Harness OSS v0.24.3と独立して動作するHTTPアダプター用。SDK/本体APIの権限は不要です。
- 決済提供元から受けた契約・友だち・アカウントIDと配送先を、このプラグインのD1だけに保存します。
- 複数販売元はWorker・DB・トークンを分けます。本体D1の外部キーやスキーマには依存しません。
- 外部送信、LINE送信、解約による配送取消、配送会社API接続は含みません。支払済み期間の配送を保持します。
- 停止: 決済アダプターからの呼び出しと任意cronを停止し、このWorkerのみ停止します。決済側の契約は別途管理します。
- 復旧: 同じ入金を再送、または`/api/reconcile`。支払情報・DBを消して請求し直さないでください。
- 実行環境: Node.js 22以上、Cloudflare Workers + 専用D1。MIT License（本体LICENSEを適用）。
