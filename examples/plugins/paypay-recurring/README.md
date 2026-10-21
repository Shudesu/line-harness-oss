# PayPay継続課金の定期便プラグイン

既存のPayPay継続課金クライアントと認可・請求・解約フローを、商品設定と配送APIを使う独立Workerへ抽出しました。
LINEで本人確認→配送先入力→PayPay認可→初回請求→定期更新→配送予定、を実装しています。
本体のD1・デプロイ・LINE送信処理に変更を加えません。本体v0.24.3のHTTP APIを使用します。

## 起動と検証

本体の外へこのフォルダをコピーし、別リポジトリで管理します。

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run db:local
# 接続先と .dev.vars を設定してから
npm run dev
```

テストはMiniflareの実WorkerとD1を起動します。外部のLINE/PayPay/L HarnessはHTTP境界でスタブします。
HMAC署名を独立した実装で照合し、JWTのaudience/nonce・並行コールバック・残高不足・結果不明・
解約競合・認可解除失敗・配送復旧を検証します。配送プラグインも実Workerで接続する場合:

```sh
DELIVERY_PLUGIN_ROOT=/absolute/path/to/subscription-delivery npm test
```

**この抽出後のプラグインでPayPay実通信を実行したという意味ではありません。**
Sandboxで認可・初回・更新・失敗・解約を自分の契約と接続先で確認してから運用してください。
契約・継続課金の許可・セキュリティ要件の確認は単体/統合テストでは代替できません。

## 接続設定

Worker・D1は専用に作り、`wrangler.jsonc`のDB ID・接続先を変更して`schema.sql`をそのDBへ適用します。

- `PUBLIC_URL`: このWorkerのHTTPS origin。PayPayに`<PUBLIC_URL>/callback`を登録。
- `LINE_HARNESS_URL` / `LINE_ACCOUNT_ID`: 対象のL Harness本体と公式アカウント。
- `LINE_LOGIN_CHANNEL_ID` / `LIFF_ID`: 同じLINE ProviderのLoginチャネルとopenid対応LIFF。
  LIFFのエンドポイントはこのWorkerの`/store`。`/store?friendId=<内部友だちID>`をLINEから案内します。
- `DELIVERY_URL`: subscription-deliveryプラグインのHTTPS origin。同じ商品IDで配送枠を登録してください。
- `CATALOG_JSON`: `id,name,amount,billingMonths,deliveryCount`の配列。JPY税込固定総額、1〜12か月ごとの請求。
  送料もamountへ含めてください。割引・送料後加算・プラン変更・日割は対象外です。
- `SHOP_TITLE` / `SALES_TERMS_URL`: 確定済みの販売条件、販売元、自動更新、配送、解約、返金、特商法の表示。
- `PAID_TAG_ID`: 任意。配送予定の作成後に付ける既存のタグID。
- `ENVIRONMENT` / `PAYPAY_ENVIRONMENT`: 初期値はdevelopment/sandbox。

Secretsは`wrangler secret put <名前>`、ローカルは無視対象の`.dev.vars`へ設定します。

- `PAYPAY_API_KEY`, `PAYPAY_API_SECRET`, `PAYPAY_MERCHANT_ID`, `PAYPAY_CLIENT_ID`
- `PAYPAY_STORE_ID`: 契約で発行された場合のみ。
- `LINE_HARNESS_API_KEY`: 友だち取得と、設定した場合だけタグ追加に必要。
- `DELIVERY_API_TOKEN`: 配送プラグインと共有する32文字以上の秘密値。
- `PLUGIN_ADMIN_TOKEN`: 管理専用の別の32文字以上の秘密値。

LIFFのIDトークンをLINE側で検証し、L Harnessの友だち情報のLINEユーザーとアカウントを照合します。
URLのfriendIdだけでは購入者を信用しません。PayPayのコールバックはHS256署名・issuer・audience・
期限・セッションnonce・referenceIdを検証します。audienceは加盟店番号とは別のclient IDです。

## 請求・配送・解約

請求前にD1で試行を確保します。同一の契約・期間・再試行番号では1回しか請求しません。
確定した入金を保存した後、配送APIへその期間のスナップショットを送ります。
配送日不足や通信失敗は`completed / delivery_status=pending`として残し、**請求をせず配送だけを再実行**します。

5xx、タイムアウト、CREATED/AUTHORIZEDなどは`unknown`として次回請求と解約を停止します。
`POST /admin/reconcile`は取引照会と配送復旧だけを行い、追加請求はしません。
確定失敗だけを運用者が`retry`できます。残高不足からの自動再請求はありません。
まるごと過去になった未払期間は`overdue_review`として止め、自動でまとめて請求しません。

管理APIには`Authorization: Bearer <PLUGIN_ADMIN_TOKEN>`が必要です。

| API | 用途 |
| --- | --- |
| `GET /admin/attempts` | 決済状態・結果コード・配送連携状態（認可IDや住所は返さない） |
| `GET /admin/subscriptions` | 契約ID・次回請求・支払済み期限・認可解除の未完了状態 |
| `POST /admin/reconcile` | 不明決済の照会、決済済み配送の復旧、各最大20件 |
| `POST /admin/attempts/:id/reconcile` | 特定の決済を照会、またはその配送だけを復旧 |
| `POST /admin/subscriptions/:id/charge` | 期限到来の契約を請求。既存試行は再請求しない |
| `POST /admin/subscriptions/:id/retry` | 確定失敗だけを新しい試行番号で再請求 |
| `POST /admin/subscriptions/:id/cancel` | 次回請求をDBで停止してからPayPay認可を解除 |

解約時に不明/処理中の決済があると409です。認可解除に失敗してもDBの請求停止を維持し、
同じcancel APIで解除だけを再試行できます。解除未完了の認可IDを新規契約へ使い回しません。
解約後も支払い済み期間の配送は保持します。返金と未配送の取消は運用者が別途管理します。

任意cronを有効にすると、取引照会・配送復旧と、pending/activeの期限到来請求を毎時実行します。
初回請求は認可コールバック時です。月末は翌月末へ丸めます。日付はUTCで統一しています。

## 本番・利用データ・停止

本番では`ENVIRONMENT=production`と`PAYPAY_ENVIRONMENT=production`の一致に加え、
`PAYPAY_PRODUCTION_APPROVED=true`が必要です。このフラグは契約確認を自動で行うものではありません。
販売元の継続課金契約、`continuous_payments`権限、購入者認可の範囲/期限、要求されるセキュリティ要件、
確定した販売条件と配送日、失敗時の突合/復旧手順を運営者が確認してから設定します。
Sandbox鍵を本番Workerへ入れないでください。初期状態では本番・cronは有効ではありません。

LINEにはIDトークン、L Harnessには友だちIDと任意のタグID、PayPayには認可・金額・商品名を送ります。
配送先・認可ID・決済履歴をこの専用D1に保存し、入金後に配送先と契約/友だち/アカウントIDを配送Workerへ送ります。
コールバックJWTやAPI応答全文、カード情報は保存・ログ出力しません。LINEメッセージの送信はありません。

停止時は新規購入とcronを止め、未確定決済を突合し、契約の次回請求停止とPayPay認可解除を行ってから
このWorkerを停止します。復旧時にD1を消さず、既存試行を照会してください。別販売元はWorker/DB/キーを分けます。
MIT License（本体LICENSEを適用）。
