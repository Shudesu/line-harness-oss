# P0 Validation

## 確定した運用境界

- 顧客ごとにL Harnessを完全に別deploymentとして構築する。
- D1、Worker、R2、Queue、Webhook、secretはdeploymentごとに分離する。
- 1 deployment内で複数のLINE公式アカウントを扱う。
- 初期roleはOwner / Admin / Staffとする。
- 複数企業が同一DBへ入る共有SaaSは対象外とする。

このため企業間tenant keyはDBへ追加しない。security boundaryは、Cloudflare resourceで分離する`deployment`と、deployment内の`line_account`である。

## P0-01再定義

| 項目 | 内容 |
|---|---|
| 分類 | **CONFIRMED_SECURITY_ISSUE** |
| 問題1 | users APIの権限不足 |
| 問題2 | StaffによるPII参照・変更 |
| 問題3 | Admin UIのLINEアカウント選択とAPI scopeの不一致 |
| 問題4 | cross-account users機能の対象集合・権限・監査定義不足 |
| 基準HEAD | `e224f3a8a6955daffc98bbc2652290c83d5cc7f4` |

これはdeployment間の分離不備を指摘するものではない。1 deployment内の複数LINEアカウントを横断するusers機能について、Staffへ許可すべきPII操作範囲と、選択中LINEアカウントとの関係が定義・強制されていない問題である。

## 合成ユーザー再現

開発D1だけにOwner、Admin、Staffの合成認証主体と合成user rowsを一時作成し、GETだけで確認した。LINE API、Webhook、配信、本番D1、deployは使用していない。

| 主体 | Request | 結果 | 判定 |
|---|---|---:|---|
| 未認証 | `GET /api/users/{id}` | 401 | authenticationは動作 |
| Owner | `GET /api/users/{id}` | 200 | 現行許可 |
| Admin | `GET /api/users/{id}` | 200 | 現行許可 |
| Staff | `GET /api/users/{id}` | 200 | PII read権限不足 |
| Owner | `GET /api/staff` | 200 | 対照route |
| Admin | `GET /api/staff` | 403 | role差を確認 |
| Staff | `GET /api/staff` | 403 | role差を確認 |

`/api/staff` の対照結果により、合成roleが同一権限として誤認証された可能性は除外できる。検証後、合成prefixの`users`、`staff_members`、`notifications` rowがすべて0であることを確認した。

## 暫定封じ込め

次の9 handlerをOwner/Adminだけへ限定し、Staffを403にした。cross-account usersの最終仕様が確定するまでの暫定措置であり、DB migrationやline_account filterはこのPRへ含めていない。

1. `GET /api/users`
2. `POST /api/users`
3. `GET /api/users/:id`
4. `PUT /api/users/:id`
5. `DELETE /api/users/:id`
6. `POST /api/users/:id/link`
7. `GET /api/users/:id/accounts`
8. `POST /api/users/match`
9. `GET /api/users-grouped`

受入条件:

- 未認証は401
- StaffはPII read/write/link/match/deleteを403
- Owner/Adminの既存成功応答を維持
- cookie認証のPOST/PUT/DELETEは有効なCSRF header/cookie pairが必須
- response、log、errorにcredential/secretを出さない
- LINE API呼び出し、DB migration、本番D1操作、deployなし

実装:

- branch: `agent/contain-users-api-permissions`
- regression test commit: `dbe1bc5`
- containment commit: `99e6813`
- 9 handlerすべてへ`requireRole('owner', 'admin')`を追加
- users routeのraw error loggingをroute名とerror typeだけへ縮退
- 既存のglobal authとcookie mutation CSRF middlewareを維持
- LINE API呼び出し、DB migration、本番D1操作、deployは未実施

未解決:

- UIの選択中LINEアカウントとusers APIの対象集合はまだ結び付いていない。
- cross-account usersの明示target set、snapshot、auditはP1-07で実装する。

## DB scope補正

全69 tableを次の4 scopeへ再分類した。

| Scope | 意味 |
|---|---|
| `deployment` | 顧客deployment全体の設定・role・運用データ |
| `line_account` | 1つのLINE公式アカウントに帰属 |
| `cross_account` | deployment内の明示した複数LINEアカウントを横断 |
| `system` | update履歴・runtime metadata等の運用system |

実装対象外:

- `organizations`
- `organization_memberships`
- `organization_line_accounts`
- 各業務tableの`organization_id`
- 企業間tenant migration

`P0-DATA-SCOPE-MAP.csv` はcanonical `packages/db/bootstrap.sql` をin-memory SQLiteへ適用し、各tableの`PRAGMA foreign_key_list`からFKを再取得した。

| 検査 | 結果 |
|---|---:|
| canonical tables | 69 |
| scope map rows | 69 |
| scope不正 | 0 |
| `undefined` FK参照 | **0** |
| 開発D1 present tables | 53 |
| 開発D1 missing tables | 16 |
| 開発D1 declared FK violation | 0 |
| 開発D1 row-level scope不整合 | `friends` 1件 |

開発D1の`friends` 1件はremote schemaに`line_account_id`がなく、LINEアカウントへ帰属できない。`pool_accounts`の参照先`traffic_pools`もremoteで欠落している。これはdeployment間問題ではなく、開発D1のschema driftである。

## Route件数訂正

旧監査の366件は誤集計で、正しいHTTP handler数は327件である。取りこぼしはない。

| 集計要素 | 件数 |
|---|---:|
| 旧regex: route files内の`.get/.post/.put/.patch/.delete(` | 366 |
| Hono route registration in route files | 322 |
| 旧regexの偽陽性 | 44 |
| `index.ts`で旧集計から漏れたHono handlers | 5 |
| canonical total | **327** |
| 差 `366 - 327` | 39 |

偽陽性44件の内訳:

- Hono context accessor: 12
- HTTP headers accessor: 3
- Map/cache/collection accessor: 22
- URL/search params accessor: 7

TypeScript ASTで`new Hono()`のreceiverだけをroute registrationとして抽出した。327件はroute/method重複0、dynamic path 0、Honoを生成する全source fileの欠落0である。うち321件がmounted、`notifications.ts`の6件がunmountedである。

旧報告書の366件表記も327件へ訂正した。

## Permission基準

- `deployment`: Owner/Admin/Staffのrole policyで制御し、企業tenant membershipは設けない。
- `line_account`: server-sideで必須のline_account contextを解決し、すべてのquery/writeへ適用する。
- `cross_account`: Owner/Adminを基本とし、対象LINEアカウント集合をrequest/operation単位で明示・snapshot・監査する。
- `system`: service credentialまたは高権限operatorだけに限定し、変更を監査する。

Admin UIの選択中LINEアカウントは表示contextであり、それだけを認可根拠にしない。cross-account usersでは「全LINEアカウント」または明示的なtarget setをserverへ渡し、Owner/Admin権限と対象集合を監査する。

署名検証で単一LINEアカウントを解決する`POST /webhook`は`cross_account`ではなく`line_account`へ再分類した。公開redirectなどcross-accountの例外は、callerが対象集合を拡張できないserver-resolved targetとauditを必要条件にした。

## 検証状況

- `P0-DATA-SCOPE-MAP.csv`: 69 rows、undefined参照0
- `P0-ROUTE-PERMISSION-MATRIX.csv`: 327 rows、organization membership記載0
- line_account routes without required context: 0
- cross_account routes without Owner/Admin target-set policy or explicit public capability exception: 0
- users permission regression: 32/32 GREEN
- Worker tests: 724/724 GREEN
- Worker build: success
- all defined workspace typechecks: 8/8 packages/apps success
- Web tests: 8/8 GREEN
- create-line-harness tests: 49/49 GREEN
- update-engine tests: 157/157 GREEN
- SDK tests: 51/51 GREEN（明示includeで実行）
- DB tests excluding既存bootstrap drift: 112/112 GREEN
- root script tests excluding既存Windows tar issue: 34/34 GREEN
- secret/email/private-key形式scan: 0

リポジトリ全体の一括testには今回の差分外の既存失敗がある。

1. `packages/sdk`はpackage固有Vitest configがなく、通常の`pnpm --filter @line-harness/sdk test`がrootの`scripts/**/*.test.ts`を継承して0 testで終了する。`tests/**/*.test.ts`を明示すると51件すべてGREEN。
2. `packages/db/test/bootstrap.test.ts`は`bootstrap.sql`または`bootstrap-meta.json`が生成元と同期していないため1件失敗する。今回のPRではDB変更禁止のため再生成しない。
3. `scripts/release/build-bundle.test.ts`はWindowsでsingle-quote shell escapingが機能せず3件失敗する。PR必須のWorker CIはLinuxで、今回変更したWorkerのtest、typecheck、buildはすべてGREEN。
