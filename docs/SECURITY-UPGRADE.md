# 認証強化のアップグレード手順

Workers＋D1で動作します。有料サービス追加、`workers_dev`の無効化、公開パス全体へのAccess設定は行いません。[English / 詳細仕様](SECURITY-UPGRADE.en.md)も参照してください。

## 既存セルフホスト環境の移行

1. 既存の手順でD1をバックアップし、各クライアントの秘密情報ストアに**元のAPIキー**を保持します。移行後はDBや管理画面からキーを復元できません。既に紛失している場合は再発行し、利用先を個別に更新してください。ハッシュ値や`hashed:<id>`は認証用キーではありません。
2. 通常の未適用マイグレーションを先に適用し、`packages/db/migrations/074_security_hardening.sql`を**新Workerのデプロイ前に一度だけ**適用します。このブランチでは明示的にファイルを指定できます。

   ```sh
   pnpm exec wrangler d1 execute YOUR_DATABASE --remote --file=packages/db/migrations/074_security_hardening.sql
   ```

   SQLは列・索引・テーブル追加のみです。**SQL適用だけでは平文キーの変換は完了しません。** Web Cryptoによる後続処理が必要です。既存DBへの更新に`schema.sql` / `bootstrap.sql`を代用しないでください。途中失敗時は実際に適用された列・テーブルを調べて復旧します。ALTER文の単純再実行はできません。
3. 対応するWorkerと管理画面を通常の方法で更新し、再ログインします。旧Cookie内の生APIキーは認証されません。バックフィル中は旧Workerによるキー書き込みを止めてください。`API_KEY` / `LEGACY_API_KEY`は引き続きサーバー側のCloudflare Secretsとして扱います。今回ハッシュ化するのはスタッフ認証キーであり、LINEチャネルトークン、OAuth秘密情報、Webhook署名鍵は対象外です。
4. **無効化済みスタッフを含む全キー**を変換します。旧キーによるログインでもその1件を変換しますが、未使用・無効化済みキーは残るため、信頼できるシェルで以下を実行します。

   ```sh
   export HARNESS_WORKER_URL=https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev
   # HARNESS_OWNER_API_KEYを安全に環境へ設定してください。シェル履歴に残さないでください。
   node scripts/migrate-staff-keys.mjs
   unset HARNESS_OWNER_API_KEY
   ```

   オーナー専用`POST /api/auth/migrate-keys`を1回25件まで実行します。0件、最大1,000バッチ、またはエラーで停止し、自動再試行はしません。同時再発行の上書きを条件付き更新で防ぎます。0件は競合でも起こり得るため、旧書き込みを停止した上で最後に次の索引付きクエリが空であることを確認してください。

   ```sql
   SELECT id FROM staff_members INDEXED BY idx_staff_members_plaintext
   WHERE api_key NOT GLOB 'hashed:*' ORDER BY id LIMIT 1;
   ```

   元の生キーはSDK/MCP/公式アカウント呼び出し元で引き続き使えます。ハッシュや置換文字列をクライアントへ配布しないでください。旧バックアップ・Time Travel履歴には過去の平文が残り得ます。保持規則に従い、漏えいしたキーは再発行してください。
5. `NEXT_PUBLIC_ADMIN_API_KEY`をビルド・設定から除去し、管理画面を再ビルドします。公開済み秘密情報は失効・ローテーションし、`API_KEY`等に使い回していた場合も更新します。`/admin/update/*`は**オーナーのCookieセッション**、更新操作はさらにCSRFが必要です。旧`x-admin-api-key`およびBearerだけの更新APIは拒否します。SSEにもCookieを送ります。CLIのCloudflare直接更新は利用できます。
6. ログイン・ログアウト・キー再発行・スコープ・受信画像・Webhook・LIFF/フォーム・`/t`・`/r`・workers.devを確認します。[ADMIN-AUTH.md](ADMIN-AUTH.md)の`ADMIN_ORIGIN`とクロスサイトCookie設定は維持してください。変換後に平文専用Workerへ戻すとスタッフ認証が失敗します。原則は前進修正です。完全な旧DB/codeの組み合わせを戻す場合は、その後のデータを失うため保守時間を設けて判断してください。

## 変更後の仕様

- スタッフキーはランダム生成し、作成・再発行時だけ生キーを返します。DBはSHA-256、末尾4文字、秘密でない一意の置換文字列を保存します。パスワードのような短い文字列は使用しないでください。
- `apiScopes: null`は従来のロール権限を維持、`[]`は拒否です。`messages:read`は友だち・チャット・メッセージ・受信箱・受信画像の閲覧、`messages:send`は個別送信・画像アップロードを許可します。ロールと併用し、ownerでもスコープを超えられません。不正なスコープJSONは拒否します。スコープ付きキーは管理画面ログイン、セッション発行、広範なLINEプロキシには使えません。
- Cookieは256bitランダムの`lhs_…`のみ、D1にそのハッシュと利用者・発行時ロール・資格情報の指紋・期限・失効状態を保存します。HttpOnly/Secure/SameSiteを維持し、期限は7日固定です。ログアウトで失効、`POST /api/auth/sessions/revoke`で本人の全セッションを失効できます。スタッフの無効化・削除、現在のロール/スコープ変更、キー再発行でも旧セッションを拒否します。環境ownerは発行元のprimary/legacyキーが構成に残る間のみ有効です。
- 受信画像は新旧URLとも認証必須・`private, no-store`です。公開送信用・リッチメニュー画像は公開を維持します。旧公開ヘッダーでキャッシュ済みの画像は、可能な範囲でCDNから削除してください。既に取得されたコピーは取り戻せません。
- Stripeは署名鍵未設定を503、署名不足・不正を401で拒否します。LINE署名はWeb Crypto検証、キー・CSRF・SSO・OAuth state/nonce・署名トークンはタイミング差に配慮した比較を使用します。

## 任意のCloudflare Access

既定は無効です。`ACCESS_REQUIRED=true`、`ACCESS_TEAM_DOMAIN=YOUR_TEAM.cloudflareaccess.com`、`ACCESS_AUD=YOUR_APPLICATION_AUDIENCE`を設定すると、保護API/更新API/プロキシ/ログイン/SSOでHarness認証に加え`Cf-Access-Jwt-Assertion`の検証を必須にします。RS256署名・発行者・audience・exp/iat/nbf・emailを検証し、設定不備でも拒否します。emailからownerを発行するSSO機能ではありません。

エッジ側のAccess設定は非公開パスだけを対象にしてください。ホスト全体を対象にすると、Workerへ到達する前にLINE Webhook・画像・`/auth`・LIFF・フォーム・リダイレクトが止まります。workers.devは有効なままですが、直接アクセスでも保護パスのJWT検証は働きます。APIクライアントにもJWTが必要です。移行スクリプトはJWTを取得しないため、Access有効化前に移行するか、正規JWTとownerキー付きで移行APIを呼び出してください。[Cloudflare公式の検証手順](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)。

## D1共有レート制限・監査ログ

固定時間窓でログイン/SSOはIPごとに5分10回、キー・セッション認証の失敗はIP・資格情報ごとに毎分1,000回です。LINEプロキシも対象です。成功時は制限用SQLを発行せず、IP上限に達しても正しい認証を止めません。失敗時だけ認証後に集計します。共有NATや時間窓境界の連続バーストに注意してください。信頼するIPはCloudflareの`CF-Connecting-IP`のみで、不明時は`unknown`共通枠です。429にRetry-Afterを付け、ストレージ障害時は認証を拒否します。従来のインメモリ制限は補助です。

監査はactor ID・固定action/outcome・Unix時刻・IPのみです。キー、Cookie、署名、本文、URL、User-Agentは記録しません。ログイン/ログアウト/SSO、キー・Access拒否、スタッフ変更、移行、セッション失効、更新試行を記録します。変更操作は`attempted`であり、後段の権限確認や業務処理の成功を意味しません。レート制限済みの大量拒否は1件ずつ監査記録しません。完全なコンプライアンス監査ではなく最小限の履歴です。IPは個人情報としてDBアクセスを制限してください。

オーナー用`POST /api/auth/maintenance`は期限切れrate/sessionと90日超のauditを各100件まで削除します。**Cron・通知先は追加しません。** 既存の承認済み保守処理へ組み込み、残件・容量を観測してください。90日は削除対象になる基準で、削除完了の保証期限ではありません。掃除前でも期限切れ資格情報は拒否します。

## Cloudflare処理量の設計メモ・未確認事項

入口はログイン、キー認証、Cookie要求、明示的な移行・保守です。ログインはrate UPSERT 1回×IPの1行、成功時はsession/audit各INSERT 1回。認証成功時のrate書込は0回、失敗時は最大2回×bucketの各1行＋索引付きスタッフ照会（通常1回、未一致なら旧キー照会1回、旧キー一致なら条件付きUPDATE 1回）。Cookieはsession PK照会1回＋staff PK照会最大1回、last_seen更新は5分ごと最大1回。監査は1件INSERT＋索引更新です。

移行はpending索引25件までの取得1回＋PK更新最大25回、保守は索引付きDELETE 3回×各100件まで。新たなポーリング・Cron・自動再試行はありません。日次のキー・セッション認証失敗B件・ログインL件ならrate SQLは最大`2B+L`回です。再試行も新しい要求として加算し、呼出し頻度・利用者数が増えればSQL回数と保存量は増えます。

100/10,000/100,000件の合成データで実helperのSQL回数・上限・索引使用、同時要求・失効・障害を検査します。`pnpm check:cost`に追加し、既存のSQLite VM検査・索引欠落の負例も実行します。**SQLite VM命令数とD1課金rowsは別物です。**

本番D1課金rows、Workers CPU/遅延、実multi-isolate動作、実Access/JWKSローテーション、実ブラウザの第三者Cookie、CDNキャッシュ削除、実LINE/Stripe配送は未検証です。本番負荷試験・マイグレーション・公開・デプロイは行っていません。無料枠内に収まるか、月額いくらかは未測定で、0円とは扱いません。課金上限・顧客処理の自動停止・通知サービスは追加していません。

バックフィルは[Workers FreeのD1上限（1リクエスト50クエリ）](https://developers.cloudflare.com/d1/platform/limits/)内で認証用クエリの余裕を残すため25件に制限します。本人の全セッション失効はstaff/expiry索引のUPDATE 1回×本人の有効セッション全件で、その件数に比例します。発行レート制限はDB全体の保存容量上限ではありません。
