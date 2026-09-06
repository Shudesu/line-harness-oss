# P0 Migration Runbook

## 対象

顧客ごとに独立したCloudflare deploymentを移行する。企業共有DBや企業間tenant migrationは行わない。本書は設計であり、本番migration、backup、deployは未実施である。

## Principles

1. deployment resource IDを固定し、別顧客resourceへの誤接続を防ぐ。
2. **expand -> backfill -> dual read/write -> enforce -> contract** の順にする。
3. schema PRとauthorization切替PRを分ける。
4.旧Worker N-1がadditive schemaで動く期間を設ける。
5. destructive down migrationに依存しない。
6. line_accountを推測できないrowはquarantineし、default accountへ無条件移送しない。
7. backupではなくrestore rehearsal成功を開始条件にする。

## M0: Migration前検査

### Resource固定

- git commit、Worker version、bundle hash
- Cloudflare account、Worker、D1、R2、Queue、Pages、Webhookのresource ID
- Wrangler version、compatibility date
- schema hash、migration ledger最大version
- secretは名前と存在有無だけ。値は出力しない
- current/N-1 Worker artifact

placeholder IDを含むconfigや、承認票とresource IDが一致しない環境では開始しない。

### Schema検査

```sql
SELECT name, type, sql
FROM sqlite_schema
WHERE name NOT LIKE 'sqlite_%'
ORDER BY type, name;

PRAGMA foreign_key_check;
PRAGMA integrity_check;
```

Gate:

- canonical 69 tableとの差分が説明済み
- missing table/column/FK target 0
- `foreign_key_check` 0
- migration checksum欠落/重複0
- applicationが参照するschemaのmissing 0

現行開発D1は53/69 table、16 table欠落、`pool_accounts -> traffic_pools`のmissing targetがあるため未達である。

### Line account整合性

tableごとに記録する。

- `unscoped`: line_account keyがNULL/空
- `orphan`: line_account FKの親なし
- `cross_account_mismatch`: 複数の親が異なるline_account
- `duplicate`: line_account scopeを加えるとunique conflict
- `ambiguous`: 複数account候補があり自動backfill不可

```sql
SELECT COUNT(*) AS unscoped
FROM friends
WHERE line_account_id IS NULL OR line_account_id = '';

SELECT COUNT(*) AS orphan
FROM friends f
LEFT JOIN line_accounts a ON a.id = f.line_account_id
WHERE f.line_account_id IS NOT NULL AND a.id IS NULL;

SELECT COUNT(*) AS cross_account_mismatch
FROM friend_scenarios fs
JOIN friends f ON f.id = fs.friend_id
JOIN scenarios s ON s.id = fs.scenario_id
WHERE f.line_account_id <> s.line_account_id;
```

全69 tableについて件数とrow ID hashだけを保存し、PII値は出力しない。

### Route検査

- canonical HTTP handler 327
- route files 322 + `index.ts` 5
- mounted 321、unmounted 6
- duplicate route/method 0
- public routeはmethod+path完全一致
- line_account routeはcontext必須
- cross_account routeはOwner/Admin、target set、audit必須

## M1: Backup

本番window直前にD1 full/schema exportまたは利用可能なpoint-in-time復旧手段を取得する。当日のCloudflare仕様と保持期間を確認する。

保存物:

1. D1 full exportとschema-only export
2. migration ledger、row count、table checksum
3. Worker current/N-1 artifactとversion
4. Pages deployment ID
5. R2 object inventory
6. Queue consumer/config snapshot
7. Webhook URL/config metadata
8. secret名/rotation metadata。値は保存しない

隔離した新規D1へrestoreし、integrity/FK/count/checksum、test Worker smokeを実行する。LINE outbound kill switchをONにし、LINE APIは呼ばない。restore rehearsal失敗時はNo-Go。

## M2: Staged migration

### Stage 1: Canonical schema回復

- 欠落16 tableをadditive作成
- `traffic_pools`を`pool_accounts`より先に作成
- migration version/checksum/start/end/resultを記録
- application writeは切り替えない

Gate: canonical schema存在、missing FK target 0、N-1 smoke成功。

### Stage 2: Direct line_account key

`P0-DATA-SCOPE-MAP.csv`の`direct`/`missing` tableへnullable keyとaccount-prefixed indexを追加する。既存global uniqueは直ちに削除せず、line_account-scoped uniqueを並行追加する。

Backfill順序:

1. direct parent
2. unambiguous friend/account relation
3. unambiguous resource parent
4. deploymentにLINE accountが1件だけと証明できる場合のlegacy fallback
5. その他はquarantine

batchごとに`last_id`, `examined`, `updated`, `quarantined`, `checksum`を記録する。

### Stage 3: Derived and cross_account

- derived tableの親line_account一致を検査
- mismatchは自動修正せずquarantine
- composite FK、trigger、repository invariantを追加
- cross_account operationへtarget account relation/snapshotを追加
- `broadcasts/events/users`の対象集合を正規化またはimmutable snapshot化

企業tenant keyや`organization_id`は追加しない。

Gate: unscoped/orphan/mismatch 0または承認済みquarantineのみ。

### Stage 4: Application shadow/dual path

1. `LineAccountContext`を解決しshadow log
2. new keyへdual-write
3. old/new read結果比較
4. readをnew pathへ切替
5. low-risk readからauthorization enforce
6. write/send/deleteを最後にenforce

cross-accountはtarget setとactor roleをshadow比較してからenforceする。

### Stage 5: Side-effect control

- idempotency/replay ledger
- outboxとclaim lease
- recipient/target snapshot
- provider request/event ID
- duplicate時は保存済みresponseを返し副作用0

### Stage 6: Constraint enforce

SQLite/D1でtable rebuildが必要な場合:

1. canonical new table作成
2. explicit column listでcopy
3. row count/checksum照合
4. FK/mismatch検査
5. atomic rename
6. index再作成
7. repository smoke

大規模copyはtable groupごとの独立PRに分ける。

### Stage 7: Contract

最低1 releaseのcompatibility window後に、独立PRでold index/column/fallbackを削除する。直前backupとrestore rehearsalを再実施する。

## Stop conditions

- resource ID不一致
- backup/restore checksum不一致
- missing schema/FK target
- unscoped/orphan/mismatch増加
- 5xx、D1 error、authorization shadow mismatchが閾値超過
- outbox/recipient count差
- N-1 smoke失敗
- migration checksum不一致

## Rollback

### Code rollback

additive schemaかつN-1互換時だけ、enforcement/dual-write flagをOFFにしてN-1 Workerへ戻す。new columns/tableは削除しない。

### Backfill rollback

cursorを停止し、new writeをOFFにする。backfill済みrowを無条件DELETEせず、ledgerとchecksumを保存してforward fix後に再開する。

### Constraint後

旧Workerが非互換ならcode rollbackを禁止しforward fixを優先する。データ破損時はwrite/sendを停止し、backupを新規D1へrestoreして検査後にbindingを切り替える。既存DBへ上書きしない。

## Go/No-Go

Go条件:

- restore rehearsal成功
- users/role/CSRFとroute permission負テスト成功
- dry-run不整合0または承認済みquarantine
- N-1 compatibility成功
- kill switchとrollback owner確認
- test LINE環境だけで必要なsmoke成功

一つでも欠ければNo-Goとする。
