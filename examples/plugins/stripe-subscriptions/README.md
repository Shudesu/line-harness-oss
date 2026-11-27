# Stripe定期便販売プラグイン

LINEの本人確認→Stripe Checkout→入金Webhook→配送管理プラグイン、を独立したWorkerで動かします。
既存の定期便販売処理から抽出し、商品名・価格・年額固定・本体D1への依存を設定/APIに置き換えました。
本体v0.24.3のHTTP APIを使用します。SDKには依存しません。

## ローカルで動作確認

本体の外へこのフォルダをコピーし、別リポジトリとして管理してください。

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run db:local
# .dev.vars と wrangler.jsonc を設定してから
npm run dev
```

テストは実WorkerとD1を起動し、LINE本人確認・並行購入・署名検証・入金反映・配送失敗と復旧・
再送・別アカウント拒否を確認します。外部のLINE/Stripe/L HarnessはHTTP境界でスタブします。
配送プラグインも取得済みの場合、次でその実Worker/D1まで通せます。

```sh
DELIVERY_PLUGIN_ROOT=/absolute/path/to/subscription-delivery npm test
```

実サービスとの接続は別途Stripeテストモードと自分のLINEテストアカウントで確認してください。
この切り出し後のコードで実決済・実LINEログインを実行したという意味ではありません。

## 設定

`wrangler.jsonc`の接続先とIDを自分の環境に置き換えます。WorkerとD1は専用に作り、
`schema.sql`をそのD1に適用します。本体DBの変更や本体用デプロイコマンドは使いません。

- `PUBLIC_URL`: このWorkerのHTTPS origin（末尾パスなし）。
- `LINE_HARNESS_URL` / `LINE_ACCOUNT_ID`: 接続するL Harnessと、友だちを持つ公式アカウント。
- `LINE_LOGIN_CHANNEL_ID` / `LIFF_ID`: その公式アカウントと同じLINE ProviderにあるLoginチャネルとLIFF。
  LIFFのエンドポイントをこのWorkerの`/store`にし、openidスコープを有効にします。
- `DELIVERY_URL`: subscription-deliveryプラグインのHTTPS origin。
- `SHOP_TITLE` / `SALES_TERMS_URL`: 店名と、販売元が確定した価格・配送・自動更新・解約・返金・特商法表記。
- `CATALOG_JSON`: `id,name,stripePriceId,amount,interval,deliveryCount`の配列。JPY・毎月または毎年・間隔1のみ。
  amountは税込の請求総額。初回割引・無料トライアル・日割・送料後加算・複数商品は未対応です。
  Checkout開始時にStripeのPriceを照会し、表示価格・請求周期と一致することを検査します。
- `PAID_TAG_ID`: 任意。支払済みの友だちに付ける既存タグのID。

次を`wrangler secret put <名前>`で登録します（ローカルは無視対象の`.dev.vars`）。

- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
- `LINE_HARNESS_API_KEY`: 友だち取得と、設定時だけタグ追加ができるキー。
- `DELIVERY_API_TOKEN`: 配送プラグインと同じ32文字以上の秘密値。
- `PLUGIN_ADMIN_TOKEN`: 管理API専用、上記と異なる32文字以上の秘密値。

LINEには`/store?friendId=<L Harness内部の友だちID>`を案内します。URLのIDだけでは購入者を信用せず、
LIFFのIDトークンをLINEで検証し、`GET /api/friends/:id`の`lineUserId`と`lineAccountId`を照合します。
チャネルが別Providerの場合は照合できません。秘密値はブラウザへ返しません。

## 入金と配送

Stripeに`https://<このWorker>/webhooks/stripe`を登録し、次を購読します。

```text
invoice.paid
customer.subscription.updated
customer.subscription.deleted
```

Stripe APIバージョンは`2024-06-20`に固定しています。受信イベントは生本文・署名・5分の時刻幅を検証し、
請求書と契約をStripeへ再照会します。自アプリのCheckout予約に紐付いた全額入金だけを処理します。
配送期間は**支払った請求書の明細**から取得するので、遅れて届いた前年度のイベントを今年度扱いしません。
Checkoutの配送先をスナップショットとして保存し、同じ入金での再送に使います。

配送プラグインには商品IDが一致する配送枠を先に登録します。枠不足などで配送APIが200 ready以外を返すと、
ジョブはpendingのままWebhookに503を返します。Stripeの再送、任意cron、管理APIから再実行できます。
配送だけを再実行し、請求APIを呼びません。タグ追加も成功するまでジョブを完了扱いしません。
LINEメッセージの直接送信はありません。

管理APIは`Authorization: Bearer <PLUGIN_ADMIN_TOKEN>`が必要です。

| API | 用途 |
| --- | --- |
| `GET /admin/jobs` | pending/done・試行回数・エラー、最大100件 |
| `POST /admin/reconcile` | pendingジョブを最大20件再処理 |
| `POST /admin/purchases/:purchaseId/release` | 未完了CheckoutをStripe側でexpireして購入予約を解放 |

並行Checkoutは一つの予約とStripe Idempotency-Keyを共有します。結果不明の予約は自動期限切れにしません。
購入者は同じ申込を再試行し、運用者は必要に応じてStripeと突合してreleaseします。
作成から23時間を過ぎてもセッションIDを取得できなかった予約は、新しいCheckoutを自動作成しません。
StripeのIdempotency-Key保持期限を越えて重複申込を作らないため、運用者がStripe側の状態を照合してください。
契約の解約・返金はStripe Dashboardで行い、Webhookでローカル状態を同期します。
支払い済み期間の配送は保持します。返金に伴う未配送取消は運用者が配送プラグインで行います。

## 利用データ・停止・検証範囲

LINEトークンは検証のためLINEにだけ送ります。L Harnessへ友だちIDと任意のタグID、Stripeへ価格IDと
プラグイン内の購入予約IDを送ります。配送プラグインへ友だち/アカウントID・契約・入金・配送先を送ります。
住所はこのWorkerのD1と配送WorkerのD1に保存します。Webhook本文全体やカード情報は保存しません。

停止時は新規購入を停止し、Stripe側の定期契約を運用方針に沿って停止・解約した上で、
Webhookと任意cronを止めます。このWorkerを止めるだけではStripeの請求は停止しません。
復旧時は既存D1を保持し、pendingジョブを再処理します。別販売元には別Worker・DB・キーを使います。

本番の決済、実LINE、管理画面UI拡張、税・送料の複雑な計算、Customer PortalはこのPRの検証範囲外です。
MIT License（本体LICENSEを適用）。
