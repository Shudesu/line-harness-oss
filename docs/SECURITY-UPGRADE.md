# 認証強化のアップグレード手順

Workers＋D1で動作します。有料サービス追加、`workers_dev`の無効化、公開パス全体へのAccess設定は行いません。[English / 詳細仕様](SECURITY-UPGRADE.en.md)も参照してください。今回の段階移行設定とロールバック条件は本書を参照してください。

## 既存セルフホスト環境の移行

以下の設定変更・コマンドは手順例です。**すべて対象環境を確認し、オーナーの承認後にのみ実行してください。** この変更では実行しません。

1. **074適用直前のD1 Time Travel bookmarkと取得時刻・対象DBを非公開の運用記録に保存**し、復元可能期間を確認します。既存の手順でD1をバックアップし、各クライアントの秘密情報ストアに**元のAPIキー**を保持します。移行後はDBや管理画面からキーを復元できません。既に紛失している場合は再発行し、利用先を個別に更新してください。ハッシュ値や`hashed:<id>`は認証用キーではありません。

   ```sh
   # 読み取り例：オーナー承認後のみ。出力を公開・コミットしないこと。
   pnpm exec wrangler d1 time-travel info YOUR_DATABASE --json
   ```

2. 通常の未適用マイグレーションを先に適用した場合はbookmarkを再取得し、`packages/db/migrations/074_security_hardening.sql`を**新Workerのデプロイ前に一度だけ**適用します。このブランチでは明示的にファイルを指定できます。

   ```sh
   pnpm exec wrangler d1 execute YOUR_DATABASE --remote --file=packages/db/migrations/074_security_hardening.sql
   ```

   074のSQLは列・索引・テーブル追加のみです。075（`075_ig_link_token_uses.sql`）も対象リリースの手順に従って適用します。075自体はスタッフキーの変換ではありません。**SQL適用だけでは平文キーの変換は完了しません。** Web Cryptoによる後続処理が必要です。既存DBへの更新に`schema.sql` / `bootstrap.sql`を代用しないでください。途中失敗時は実際に適用された列・テーブルを調べて復旧します。ALTER文の単純再実行はできません。
3. 下記の2設定を決め、対応するWorkerと管理画面を通常の方法で更新します。旧Cookieを引き継ぐ場合は`ADMIN_LEGACY_COOKIE_UPGRADE_STARTED_AT`に承認済みの切替開始日時を設定し、`STAFF_API_KEY_LAZY_HASH_ENABLED`は未設定または`false`のままにします。管理画面の`GET /api/auth/session`で旧資格情報を再検証して新Cookieへ交換します。互換期間を有効にしなければ再ログインが必要です。`API_KEY` / `LEGACY_API_KEY`は引き続きサーバー側のCloudflare Secretsとして扱います。今回ハッシュ化するのはスタッフ認証キーであり、LINEチャネルトークン、OAuth秘密情報、Webhook署名鍵は対象外です。
4. ログイン・SDK/MCP・既存連携とロールバック条件を確認し、**旧Workerへ戻す必要がなくなったとオーナーが判断してから**`STAFF_API_KEY_LAZY_HASH_ENABLED=true`にします。この時点以降の旧キー認証は平文を削除するため、フラグを戻すだけでは元に戻りません。未使用・無効化済みキーは残るため、オーナー承認後に**全キーの明示的な不可逆移行**を行います。バックフィル中は旧Workerによるキー書き込みを止め、信頼できるシェルで以下を実行します。移行API・スクリプトはフラグがOFFでも変換を実行するため、検証期間には実行しないでください。

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
6. ログイン・ログアウト・キー再発行・スコープ・受信画像・Webhook・LIFF/フォーム・`/t`・`/r`・workers.devを確認します。[ADMIN-AUTH.md](ADMIN-AUTH.md)の`ADMIN_ORIGIN`とクロスサイトCookie設定は維持してください。ロールバック条件と復旧手順は下記を参照してください。

## 段階移行の2設定

| 環境変数 | 既定値・動作 | 有効化の条件 |
| --- | --- | --- |
| `ADMIN_LEGACY_COOKIE_UPGRADE_STARTED_AT` | 未設定・空・不正値はOFF。UTC ISO日時（`YYYY-MM-DDTHH:mm:ssZ`またはミリ秒3桁付き）を指定すると、開始時刻以上・開始から14日未満だけON。開始前・終了時刻以降は拒否 | 切替開始日時を明示して承認。再デプロイ時も同じ値を保ち、現在時刻で自動生成しない |
| `STAFF_API_KEY_LAZY_HASH_ENABLED` | 未設定・`false`はOFF。文字列`true`のみON | ロールバック確認完了後、平文削除をオーナーが承認 |

日数は14日固定で延長用の設定はありません。日時設定を残しても期限で必ず終了し、`true`だけでは有効になりません。早期に終了するには空文字にします。設定値を後日の日時へ変更すると別の期間が始まるため、延長を目的とする変更もオーナー承認の対象です。

これらは秘密情報ではないため、使用環境のWrangler設定の`[vars]`（名前付き環境なら`[env.YOUR_ENV.vars]`）で管理できます。`apps/worker/wrangler.toml`には無効な既定値を掲載しています。varsは名前付き環境へ継承されないので、対象環境に明示してください。次は**オーナー承認後に使う例**で、日時のプレースホルダーは実際の承認済みUTC日時へ置き換えます。

```toml
[vars]
ADMIN_LEGACY_COOKIE_UPGRADE_STARTED_AT = "YYYY-MM-DDTHH:mm:ssZ"
STAFF_API_KEY_LAZY_HASH_ENABLED = "false"
```

Secretsで管理する運用なら、同名のvarsを削除してから次の対話入力を使えます。名前付き環境には`--env YOUR_ENV`を付け、必ず正しいWorker設定を指定してください。Secretsの変更も本番設定変更です。**以下は例のみで、オーナー承認なしに実行しません。**

```sh
pnpm exec wrangler secret put ADMIN_LEGACY_COOKIE_UPGRADE_STARTED_AT
# 対話入力：承認済みUTC切替開始日時
pnpm exec wrangler secret put STAFF_API_KEY_LAZY_HASH_ENABLED
# 対話入力：検証中は false。ロールバック確認完了・平文削除承認後だけ true
```

旧Cookie交換はGET/HEAD/OPTIONSのみです。POST/PUT/PATCH/DELETE等の保護APIは、CSRFヘッダーがあっても旧Cookieのままでは通常の`{success:false,error:"Unauthorized"}`・401になります。管理画面の共通APIクライアントは401でログイン画面へ戻り、変更要求を自動再送しません。まず`GET /api/auth/session`で新しいCookieとCSRFトークンを取得し、その後の変更要求にCSRFヘッダーを送ります。既存`lhs_`セッション（期限切れ・失効・不正形式を含む）を生キーとして再解釈しません。staffキー・環境`API_KEY`・ローテーション用`LEGACY_API_KEY`はBearerと同じ経路で検証し、スコープ付きキーは拒否します。Access必須設定とCookie配置設定も維持します。旧SSO Cookieの環境キーも交換できますが、以前のSSO利用者情報は復元できず、交換時は`api_key`方式のenv-ownerセッションになります。

遅延変換OFFでは既存平文行のハッシュ列・末尾4桁も書き換えません。既にハッシュ化済みの行は引き続き使えます。平文キーから発行済みのセッションの`credential_fp`は生キーのSHA-256で、遅延変換ON後や`migrate-keys`後のdigestと一致し、保存形式の変換だけでは失効しません。環境ownerのセッションは引き続き現在の`API_KEY`/`LEGACY_API_KEY`と照合し、発行元キーを両方のスロットから除くと失効します。**新規作成・再発行はフラグに関係なくハッシュ専用保存**を維持します。新たな平文保管を増やさず変更範囲を抑えるためです。ただし、そのキーは旧Workerでは認証できません。戻せる期間にはスタッフキーの新規作成・再発行を控え、必要になった場合はその利用者がロールバック時に認証できなくなることを含めて判断してください。スコープ付きキーは旧Workerにスコープ検証がないため、旧版へ戻しての利用を前提に発行しないでください。

## ロールバック手順

1. **遅延変換を一度もONにしておらず、`POST /api/auth/migrate-keys` / 移行スクリプトも未実行**なら、既存平文キーはそのまま旧Workerで使えます。074/075の追加スキーマを残して、承認済みの旧Workerと対応する管理画面へ戻します。通常この段階でDBの復元は不要です。新規・再発行したハッシュ専用キーは対象外なので、実施履歴を確認してください。
2. 交換済みの`lhs_` Cookieは旧Workerで使えません。旧版に戻すと管理画面への再ログイン（または旧SSO）が必要です。これはAPIキーが保持されていても避けられません。互換設定は無効にし、再切替時も開始日時を無断でリセットしないでください。
3. 遅延変換ONで認証済み、または明示的な移行実行後は、OFFに戻しても削除した平文を復元できません。移行API・スクリプトは意図的な「後戻りできない工程」です。原則は新Workerの前進修正とし、旧Workerへの復旧が必要ならオーナーがデータ損失・停止時間を承認してから、書き込みを停止し、074直前のTime Travel bookmarkへDB全体を戻して対応する旧Worker/管理画面を復旧します。保持期間外なら事前バックアップが必要です。
4. DB復元はキーだけでなく**bookmark以降の顧客データ・処理記録・失効や再発行も巻き戻します**。旧キーの復活や処理の重複を含めて差分を照合し、認証・連携を確認してから再開します。旧キーの復活はフラグ変更では防げません。DB復元を自動化・自動再試行しないでください。

```sh
# 復元例のみ。データ損失の確認とオーナーの明示承認後に限る。
pnpm exec wrangler d1 time-travel restore YOUR_DATABASE --bookmark YOUR_PRE_074_BOOKMARK
```

## 変更後の仕様

- スタッフキーはランダム生成し、作成・再発行時だけ生キーを返します。DBはSHA-256、末尾4文字、秘密でない一意の置換文字列を保存します。パスワードのような短い文字列は使用しないでください。
- `apiScopes: null`は従来のロール権限を維持、`[]`は拒否です。`messages:read`は友だち・チャット・メッセージ・受信箱・受信画像の閲覧、`messages:send`は個別送信・画像アップロードを許可します。ロールと併用し、ownerでもスコープを超えられません。不正なスコープJSONは拒否します。スコープ付きキーは管理画面ログイン、セッション発行、広範なLINEプロキシには使えません。
- 新規発行するCookieは256bitランダムの`lhs_…`のみ（上記互換期間だけ旧Cookieを交換）、D1にそのハッシュと利用者・発行時ロール・資格情報の指紋・期限・失効状態を保存します。HttpOnly/Secure/SameSiteを維持し、期限は7日固定です。ログアウトで失効、`POST /api/auth/sessions/revoke`で本人の全セッションを失効できます。スタッフの無効化・削除、現在のロール/スコープ変更、キー再発行でも旧セッションを拒否します。環境ownerは発行元のprimary/legacyキーが構成に残る間のみ有効です。
- 受信画像は新旧URLとも認証必須・`private, no-store`です。公開送信用・リッチメニュー画像は公開を維持します。旧公開ヘッダーでキャッシュ済みの画像は、可能な範囲でCDNから削除してください。既に取得されたコピーは取り戻せません。
- Stripeは署名鍵未設定を503、署名不足・不正を401で拒否します。LINE署名はWeb Crypto検証、キー・CSRF・SSO・OAuth state/nonce・署名トークンはタイミング差に配慮した比較を使用します。

## 任意のCloudflare Access

既定は無効です。`ACCESS_REQUIRED=true`、`ACCESS_TEAM_DOMAIN=YOUR_TEAM.cloudflareaccess.com`、`ACCESS_AUD=YOUR_APPLICATION_AUDIENCE`を設定すると、保護API/更新API/プロキシ/ログイン/SSOでHarness認証に加え`Cf-Access-Jwt-Assertion`の検証を必須にします。RS256署名・発行者・audience・exp/iat/nbf・emailを検証し、設定不備でも拒否します。emailからownerを発行するSSO機能ではありません。

エッジ側のAccess設定は非公開パスだけを対象にしてください。ホスト全体を対象にすると、Workerへ到達する前にLINE Webhook・画像・`/auth`・LIFF・フォーム・リダイレクトが止まります。workers.devは有効なままですが、直接アクセスでも保護パスのJWT検証は働きます。APIクライアントにもJWTが必要です。移行スクリプトはJWTを取得しないため、Access有効化前に移行するか、正規JWTとownerキー付きで移行APIを呼び出してください。[Cloudflare公式の検証手順](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)。

## D1共有レート制限・監査ログ

固定時間窓でログイン/SSOはIPごとに5分10回、キー・セッション認証の失敗はIP・資格情報ごとに毎分1,000回です。LINEプロキシも対象です。通常のキー・`lhs_`セッション認証成功時は制限用SQLを発行せず、IP上限に達しても正しい認証を止めません。旧Cookie交換は専用の`legacy_upgrade`枠を使い、5分あたり資格情報ごと30回・IPごと300回に制限します。資格情報の枠は名前空間と生キーからSHA-256で生成し、生キーを保存しません。同じ資格情報はIPを変えても30回が上限です。ログイン/SSO枠とは独立しており、交換上限時も通常ログインで復旧できます。上限時は429とRetry-Afterを返します。固定窓なので境界前後では最大2窓分のバーストが可能です。通常のキー・セッション認証は失敗時だけ認証後に集計します。共有NATや時間窓境界の連続バーストに注意してください。信頼するIPはCloudflareの`CF-Connecting-IP`のみで、不明時は`unknown`共通枠です。429にRetry-Afterを付け、ストレージ障害時は認証を拒否します。従来のインメモリ制限は補助です。

監査はactor ID・固定action/outcome・Unix時刻・IPのみです。キー、Cookie、署名、本文、URL、User-Agentは記録しません。ログイン/ログアウト/SSO、旧Cookie交換（`legacy_cookie_upgrade`の`attempted`/`denied`）、キー・Access拒否、スタッフ変更、移行、セッション失効、更新試行を記録します。変更操作は`attempted`であり、後段の権限確認や業務処理の成功を意味しません。レート制限済みの大量拒否は1件ずつ監査記録しません。完全なコンプライアンス監査ではなく最小限の履歴です。IPは個人情報としてDBアクセスを制限してください。

オーナー用`POST /api/auth/maintenance`は期限切れrate/sessionと90日超のauditを各100件まで削除します。**Cron・通知先は追加しません。** 既存の承認済み保守処理へ組み込み、残件・容量を観測してください。90日は削除対象になる基準で、削除完了の保証期限ではありません。掃除前でも期限切れ資格情報は拒否します。

## Cloudflare処理量の設計メモ・未確認事項

入口はログイン、キー認証、Cookie要求、明示的な移行・保守です。ログインはrate UPSERT 1回×IPの1行、成功時はsession/audit各INSERT 1回。通常のキー・セッション認証成功時のrate書込は0回、失敗時は最大2回×bucketの各1行＋索引付きスタッフ照会（通常1回、未一致なら旧キー照会1回、旧キーも未一致なら並列変換確認のdigest再照会1回、旧キー一致かつ遅延変換ONなら条件付きUPDATE 1回＋競合時のみ索引再照会1回、OFFなら書込0回）。Cookieはsession PK照会1回＋staff PK照会最大1回、last_seen更新は5分ごと最大1回。監査は1件INSERT＋索引更新です。旧Cookie交換1要求は専用rate UPSERT最大2回×IP/資格情報それぞれ1行、スタッフ照会通常最大2回×索引一致1行（両方未一致なら並列変換確認のdigest再照会1回）、遅延変換ONのみUPDATE最大1回×本人1行、成功する交換時はaudit/session各INSERT 1回×1行です。遅延変換の競合で条件付きUPDATEが0件なら、同じdigestの索引照会を1回だけ追加し、同じスタッフが同じキーで変換済みの場合だけ受け入れます。再発行・無効化・古いdigestを残した平文書き込みは拒否します。期限外・不正な設定では資格情報の再検証もセッション発行も行いません。

移行はpending索引25件までの取得1回＋PK更新最大25回、保守は索引付きDELETE 3回×各100件まで。新たなポーリング・Cron・自動再試行はありません。日次の通常のキー・セッション認証失敗B件（旧Cookie交換を除く）・ログインL件・互換期間内の安全なメソッドによる旧Cookie交換U件ならrate SQLは最大`2B+L+2U`回です（交換時の拒否も専用枠を使用し、同一要求で通常の失敗枠を二重計上しません）。再試行も新しい要求として加算し、呼出し頻度・利用者数が増えればSQL回数と保存量は増えます。

100/10,000/100,000件の合成データで実helperのSQL回数・上限・索引使用、同時要求・失効・障害を検査します。遅延変換OFFでも同じ規模の平文キーで実helperが索引付きSELECT 2回・書込0回に収まることを検査します。管理画面はAuthGuardのセッション確認後に子画面をマウントし、ダッシュボードは6件のGETを並列実行します。画面遷移や複数タブでも安全なように、合成SQLiteで旧Cookieの6並列GET（遅延変換OFF/ON）と36並列GET（IPを変えても30件だけ発行）を検査します。各応答は独立したランダムセッションを持ち、どの応答のCookieが最後に届いても有効です。利用者数・要求頻度が100倍・1000倍なら総照会・交換発行回数も増えますが、同じ資格情報の発行は30件/5分、同じIPでは300件/5分で頭打ちです。24時間分の窓では同一資格情報につき最大8,640件、境界をまたぐ任意の24時間では最大289窓分です。拒否要求にもrate SQLがあり、要求総数や費用の上限ではありません。全体の保存量上限を保証しません。`pnpm check:cost`に追加し、既存のSQLite VM検査・索引欠落の負例も実行します。**SQLite VM命令数とD1課金rowsは別物です。**

本番D1課金rows、Workers CPU/遅延、実multi-isolate動作、実Access/JWKSローテーション、実ブラウザの第三者Cookie、CDNキャッシュ削除、実LINE/Stripe配送は未検証です。本番負荷試験・マイグレーション・公開・デプロイは行っていません。無料枠内に収まるか、月額いくらかは未測定で、0円とは扱いません。課金上限・顧客処理の自動停止・通知サービスは追加していません。

バックフィルは[Workers FreeのD1上限（1リクエスト50クエリ）](https://developers.cloudflare.com/d1/platform/limits/)内で認証用クエリの余裕を残すため25件に制限します。本人の全セッション失効はstaff/expiry索引のUPDATE 1回×本人の有効セッション全件で、その件数に比例します。発行レート制限はDB全体の保存容量上限ではありません。
