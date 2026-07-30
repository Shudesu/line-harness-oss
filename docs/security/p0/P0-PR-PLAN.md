# P0 PR Plan

## Rules

- 1 PRは1 security invariantまたは1 migration境界だけを扱う。
- test-onlyの失敗PRは作らない。回帰テストと最小封じ込めを同じPRでGREENにする。
- schemaとauthorization enforceを分ける。
- feature flagまたはadditive schemaでcode rollback可能にする。
- LINE送信、Webhook変更、本番D1、deployをPR作業中に実行しない。
- test skip、assertion削除、coverage弱体化は禁止する。

## Phase 0: Immediate containment

| PR | Scope | Commit構成 | Acceptance | Rollback |
|---|---|---|---|---|
| P0-01 | users 9 handlerをOwner/Adminへ暫定限定。Staff PII操作拒否、sanitized error log | 1. regression tests 2. minimal containment 3. P0 docs | unauth=401、Staff=403、Owner/Admin成功、cookie mutation CSRF必須、全test GREEN | role guardだけrevert可能。DB変更なし |
| P0-02 | public route policyをmethod+path allowlist化 | test + policy fix + docs | form PUT/DELETE unauth=401、public GET維持 | policy versionを戻す。DB変更なし |
| P0-03 | `/api/meet-callback` service auth/replay/idempotency | test + callback guard + docs | invalid/stale/replay/account swap拒否 | routeを503停止。publicへ戻さない |
| P0-04 | canonical schema verifier | verifier + CI + docs | 69 table、FK target、checksum drift検出 | warn-onlyへ戻す |
| P0-05 | 327 handler permission catalog | catalog + CI + docs | mounted 321、unmounted 6、未登録/重複0 | runtime enforce前はCIだけrevert |
| P0-06 | secret response/log hardening | regression + mask/write-only + docs | response/log/error/CSVにsecret 0 | masked compatibility responseのみ。平文再表示禁止 |

P0-01の対象:

1. `GET /api/users`
2. `POST /api/users`
3. `GET /api/users/:id`
4. `PUT /api/users/:id`
5. `DELETE /api/users/:id`
6. `POST /api/users/:id/link`
7. `GET /api/users/:id/accounts`
8. `POST /api/users/match`
9. `GET /api/users-grouped`

P0-01実装状況:

- branch: `agent/contain-users-api-permissions`
- commit 1: `dbe1bc5` 回帰テスト追加
- commit 2: `99e6813` Owner/Admin限定とerror log縮退
- commit 3: 本P0成果物更新
- users permission regression 32/32 GREEN
- Worker 724/724 GREEN、typecheck/build成功
- DB migration、LINE API、本番D1、deployなし
- cross-account target setとauditはP1-07へ分離

## Phase 1: LINE account scope

| PR | Scope | Migration | Acceptance | Rollback |
|---|---|---|---|---|
| P1-01 | server-side `LineAccountContext` resolver | none | forged selector/header/bodyでcontext不変、shadow only | flag OFF |
| P1-02 | core direct tables: friends/messages/chats/bookings/staff/menus | nullable keys/index/backfill | unscoped/orphan/mismatch 0、N-1互換 | old read/write維持 |
| P1-03 | campaign tables: scenarios/reminders/automations/tags/templates/forms | nullable keys/index/backfill | derived parent account一致 | dual-write OFF |
| P1-04 | integration tables: Webhook/calendar/ad/conversion/Stripe | nullable keys/index/backfill | callback/account owner一致 | integration flag OFF |
| P1-05 | line_account read enforcement | none | non-selected account row 0、account index使用 | read flag OFF |
| P1-06 | line_account write/delete enforcement | none | role×action×account負テスト | resource flag OFF |
| P1-07 | cross-account target model for pool/duplicates/users/broadcasts/events | additive target/snapshot tables | Owner/Admin、explicit target set、audit、snapshot不変 | cross-account action停止 |
| P1-08 | line_account constraints | table group別rebuild | NOT NULL/FK/composite unique、N-1 smoke | backupから新D1 restore/forward fix |

実装しないもの:

- organizations
- organization memberships
- organization-to-account relation
- business tableのorganization_id
- enterprise tenant migration

## Phase 2: Side-effect safety

| PR | Scope | Migration | Acceptance | Rollback |
|---|---|---|---|---|
| P2-01 | common idempotency/replay ledger | additive | parallel 10 requestでside effect 1 | claim OFF、ledger保持 |
| P2-02 | transactional outbox/lease/dead-letter | additive | crash/retry recovery、重複0 | dispatcher停止、pending保持 |
| P2-03 | broadcast/event recipient snapshot | additive | preview=claim count、target不変 | new send停止 |
| P2-04 | booking/reminder/scenario delivery outbox | additive | unique delivery、cron retry重複0 | domain dispatcher停止 |
| P2-05 | Webhook/Stripe/LIFF replay hardening | replay indexes | duplicate event副作用0 | integration処理pause |
| P2-06 | CSV/PII export service | audit/job metadata | Owner/Admin、target set、column allowlist、formula escape、TTL | export OFF |
| P2-07 | emergency action framework | approval/audit tables | preview、step-up、confirmation、kill switch | high-risk action停止 |
| P2-08 | automated restore rehearsal | isolated D1 only | restore、N-1 smoke、LINE call 0 | tooling revert |
| P2-09 | contract cleanup | destructive stepを小分け | compatibility window、old reader 0、backup成功 | restore/forward fix |

## Merge order

```text
P0-01 -> P0-02 -> P0-03 -> P0-04 -> P0-05 -> P0-06
      -> P1-01 -> P1-02 -> P1-05
      -> P1-03 -> P1-05 update
      -> P1-04 -> P1-05 update
      -> P1-06 -> P1-07 -> P1-08
      -> P2-01 -> P2-02 -> P2-03 -> P2-04 -> P2-05
      -> P2-06 -> P2-07 -> P2-08 -> P2-09
```

## Required PR metadata

1. security invariant
2. target routes/tables
3. data/schema impact
4. precheck and expected counts
5. role×line_account negative tests
6. idempotency/side-effect test
7. deploy order and feature flag
8. observation and stop conditions
9. code rollback
10. restore boundary
11. secret/PII/LINE call declaration
12. start HEAD and final commits

P0-01はtest、containment、documentationの3 commitで作成し、最終状態だけをGREENでPRにする。
