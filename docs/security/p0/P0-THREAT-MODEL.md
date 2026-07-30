# P0 Threat Model

## Security boundary

最上位boundaryは顧客ごとのCloudflare deploymentである。D1、Worker、R2、Queue、Webhook、secretはdeployment間で共有しない。DB内部で企業tenantを分離する設計は対象外である。

deployment内部では複数のLINE公式アカウントを扱うため、`line_account`と、複数LINEアカウントを明示的に横断する`cross_account`を保護境界とする。

## Assets

- LINE channel token/secret、Login secret、Webhook secret、API key
- user/friendの氏名、email、phone、LINE user ID、画像、会話
- 配信対象、配信内容、予約、フォーム回答、タグ、score、conversion
- Worker/D1/R2/Queue/Pagesのversionとrollback可能性
- actor、role、対象LINEアカウント集合、操作結果の監査証跡

## Principals

| Principal | 基本権限 |
|---|---|
| Owner | deployment全体の管理。secret・Staff・緊急操作を含む |
| Admin | deployment運用と明示したcross-account操作 |
| Staff | 許可されたline_account業務。PII横断・高危険操作は禁止を基本とする |
| LINE user | 自分のLIFF操作のみ |
| External service | 署名済みcallbackと固定されたline_accountだけ |
| Scheduled Worker | 明示したaccount setとidempotent jobだけ |

## Invariants

1. deployment resourceは顧客ごとに物理分離する。
2. line_account resourceは必須のserver-side line_account contextでfilterする。
3. cross_account operationはOwner/Adminだけを基本とし、target LINE account setを明示・snapshot・監査する。
4. Staffはusers PIIのread/write/link/match/deleteを実行できない。
5. ID、query、body、UI selectorだけを認可根拠にしない。
6. send、publish、decide、callbackはretry/replayで副作用が増えない。
7. secretはresponse、log、CSV、errorへ出さない。
8. code rollbackとD1 schemaの互換範囲をdeploy前に証明する。

## Threats

| ID | 脅威 | 現在の証拠 / attack path | P0 control | 負テスト |
|---|---|---|---|---|
| T01 | 認証回避 | public除外がpathだけで判定され、`/api/forms/:id`のPUT/DELETEも対象。`/api/meet-callback`は署名なし | method+path allowlist、callback HMAC/timestamp/nonce | unauth mutation=401、public GET維持、stale/replay拒否 |
| T02 | ID差替え | path/body IDだけでresourceを取得するhandlerがある | line_account context付きquery、cross-account target set、404統一 | 非選択LINE accountのIDで404、write 0 |
| T03 | 他LINE account参照 | UI selectorとAPI scopeが一致しないrouteがある | server-side context、list/detail双方のfilter | selected account以外のrow 0 |
| T04 | 権限昇格 | users 9 handlerにrole guardがない | usersをOwner/Adminへ暫定限定、permission catalog | Staff=403、Owner/Admin成功 |
| T05 | 二重配信 | cron/manual/retry/multi-account処理が重複し得る | idempotency key、outbox、recipient snapshot、lease | 並列10 requestでside effect 1 |
| T06 | replay | LINE body signatureはfreshnessを示さず、incoming HMACにもnonceがない | provider event/replay ledger、timestamp window | 同一eventの2回目は副作用0 |
| T07 | secret露出 | LINE credentialsをD1に保存し、owner/admin detailで返すrouteがある | write-only secret、mask、sanitized log/error、rotation | response/log/error/CSVにsecret 0 |
| T08 | CSV/PII流出 | users/groupedはemail/phone/LINE user IDを横断集約する | Owner/Admin、target set、column allowlist、上限、formula escape、audit | Staff=403、非target account 0、formula無害化 |
| T09 | 緊急操作 | send、account disable/delete、token変更、self-updateが即時影響 | preview、step-up、typed confirmation、kill switch、audit | confirmation不足拒否、再実行無害 |
| T10 | rollback失敗 | remote devは16 table欠落、missing FK targetあり。旧Workerと新schemaが非互換になり得る | expand-contract、N-1 test、backup restore rehearsal | 中断再開、N-1 smoke、restore整合性 |

## P0 actions

1. users 9 handlerをOwner/Adminだけへ暫定限定し、同じPRに回帰テストを入れる。
2. public auth除外をmethod-awareにする。
3. unsigned callbackを閉じる。
4. 327 handlerのpermission catalogを固定する。
5. secret read responseとraw error loggingを除去する。

## P1 actions

1. `LineAccountContext`をserver-sideで解決する。
2. direct/derived tableのline_account keyとsame-account invariantを整備する。
3. line_account routeをcontext必須にする。
4. cross-account operationへtarget set、snapshot、auditを追加する。
5. usersのcross-account仕様をOwner/Admin、対象集合、PII列、export上限まで定義する。

## P2 actions

1. 共通idempotency/replay ledger
2. transactional outboxとrecipient snapshot
3. CSV/PII export service
4. emergency action framework
5. automated backup restore rehearsal

## Audit event

最低限、次を記録する。PII本文、message本文、secretは記録しない。

`request_id`, `operation_id`, `actor_id`, `actor_role`, `deployment_id_hash`, `line_account_ids`, `resource`, `resource_id`, `action`, `decision`, `reason_code`, `idempotency_key_hash`, `before_version`, `after_version`, `created_at`

## Release gate

- users 9 handlerのauthentication/role/CSRF testがGREEN
- 327 mounted/unmounted handlerのpolicy対応が一意
- line_account routeのcontext欠落0
- cross-account routeのtarget set・Owner/Admin・audit欠落0
- secret/PII scanner成功
- D1 backup restore rehearsalとN-1 compatibility成功
