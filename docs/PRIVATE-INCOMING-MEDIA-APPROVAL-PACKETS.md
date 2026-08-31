# #5229/#5230 approval packets

These packets separate read-only production inspection from every later write.
Filling a template is not approval. KEN must approve the exact packet, and any
changed head, resource ID, count, digest, or expiry invalidates that approval.

## Packet A0 — current-state discovery, awaiting KEN approval

This is the only packet currently ready for approval. It discovers the exact
production IDs and aggregate candidate count needed to create Packet A1; it
does not read R2 object bodies, issue a credential, or probe a route that is not
deployed. Approval expires two hours after KEN's explicit approval.

```text
Approval ID: 5229-A0-20260831
Mode: CF-AND-RUNTIME-READ-ONLY-DISCOVERY
Issues/PR: #5229 / #5230 / Draft PR #5244

Immutable implementation anchors:
- Accounting: 63635fa00a992301daa8422d9401c6479de13246
- Harness: 07c4f27a5694ed50fe07bb09c48f28820d7c4833
- migration 071 SHA-256: c65203ce28e750b6cf612ad17029bc195fd2e6253a379cf62e642e3c5a8ae5d6
- migration 072 SHA-256: be4b1730fadd497d0a0d9677bda8626d174aaa08946d1c27e9e68e1549049937
- migration helper SHA-256: 5ffb00be36ec92402b7e28725f7e450a424e627acbd6a81b64ac02b13fce117a
- credential helper SHA-256: d87802aff96447ddc484bf4e349f44a6f81b46e788e68f5a036079dca4f9cc5f
- accounting client SHA-256: 8107debd9ad0eea27a81e43d42cb271a6b71b09422d21cf75ad3fa363039ff7f

Targets, each require exactly one match or STOP:
- GitHub fork deployment metadata for the accounting Line Harness: count=1 repo
- Cloudflare account referenced by that deployment metadata: count=1
- production Worker referenced by WORKER_NAME: count=1
- Worker DB binding named DB: count=1 D1 database
- Worker IMAGES binding: count=1 R2 bucket
- accounting receiver runtime configuration: count=1 process/service

Allowed command invocations and maxima:
- GitHub Actions variable names/values and secret names only: 2 read commands
- Cloudflare authenticated identity/account discovery: 1 read command
- Worker deployment/version/settings/binding/secret-name metadata: 4 read commands
- D1 database inventory: 1 read command
- D1 read-only schema/migration/candidate aggregate queries: 6 statements
- R2 bucket inventory: 1 read command
- R2 lifecycle configuration: 1 read command
- accounting consumer credential status: 1 local boolean-only check
- R2 object HEAD/content GET: 0/0
- private Worker HEAD/GET and negative auth probes: 0/0/0

Expected current state from the last verified evidence:
- production migration 071: UNVERIFIED; record present/absent/checksum then STOP on drift
- production migration 072: expected ABSENT; if present, record drift and STOP
- account-scoped credential/runtime fingerprint: expected ABSENT; no creation or probe
- public-block gate: must be false/unset; true is drift and STOP

Required sanitized output:
- actual account/Worker/deployment/D1/R2 IDs and Worker origin
- binding names/types; secret values remain unavailable and unprinted
- migration ledger names/checksums and table/index/column/FK state
- aggregate historical candidate count, exclusion count, total bytes, per-account counts
- R2 lifecycle rule count, canonical ruleset digest, incoming-prefix collision result
- accounting credential present/format/fingerprint-match booleans only
- exact query/command counts, timestamps, and sanitized provider request IDs

Writes authorized: 0. Deploy, migration, D1 write, backup creation, secret
put/delete, credential issue/revoke, R2 mutation, content GET, cache purge,
feature enablement, process restart, LINE send, PR merge are all forbidden.
```

A0 cannot prove that seven or any other exact objects are intact. On successful
A0 readback, create a separate Packet A1 with the actual resource IDs, immutable
manifest hashes, `N/E/B` counts, and exact `N` HEAD/GET/auth-probe maxima. If
072 or the service credential is absent, A1 records `ABSENT -> STOP`; post-write
functional readback belongs to B0/B1/B2, not to A0 or A1.

## Packet A — Cloudflare read-only preflight only

```text
Approval ID:
Expires at:
Mode: CF-READ-ONLY-PREFLIGHT-ONLY
Issues/PR: #5229 / #5230 / Draft PR #5244

Immutable code anchors:
- Accounting head:
- Harness head:
- Deployed Worker version/deployment ID:
- migration 071 SHA-256:
- migration 072 SHA-256:
- migration helper SHA-256:
- raw manifest SHA-256:
- canonical manifest SHA-256:

Exact targets:
- Cloudflare account label + ID: count=1
- Worker service/environment/origin: count=1
- D1 binding/name/ID: count=1
- R2 binding/bucket: count=1
- service credential ID and bound LINE account ID: count=1 each
- secure manifest locator: count=1
- candidates=N, excluded=E, total bytes=B

Allowed reads and exact maxima:
- identity/account GET: Q1
- Worker version/settings/bindings GET: Q2
- secret-binding metadata GET: Q3
- D1 SELECT/PRAGMA/migration-ledger queries: Q4
- R2 lifecycle list: 1
- R2 HEAD: N
- approved R2 content GET/hash checks: G
- private Worker HEAD: H
- private Worker GET: G
- anonymous/invalid/cross-account/wrong-method probes: X

Writes explicitly forbidden and expected count=0:
- deploy, D1 migration/INSERT/UPDATE, backup creation, R2 mutation,
  secret put/delete, credential creation/revocation, cache purge,
  feature enablement, process restart, LINE send, PR merge

Required sanitized readback:
- exact Worker version and public-block gate (must not equal true)
- binding names/types and presence; secret plaintext remains unavailable
- migration ledger for 071 and 072, table/index/column/FK/CHECK state
- R2 lifecycle rule count, canonical ruleset digest, incoming-prefix collision=0
- manifest digests/counts and exact D1 preimage/existing-ledger state
- R2 existence/MIME/bytes/metadata/content digest as approved
- credential ID/account/scope/active-window only; never its value or hash
- correct-account HEAD/GET=200; anonymous/invalid=401; cross-account=404;
  unrelated route=401; MIME/length/SHA agreement
- timestamps, provider request IDs, sanitized receipt locators

Stop on any drift, absent migration, lifecycle collision, placeholder/malformed
consumer credential, auth-matrix failure, manifest mismatch, or unexpected write.
Read-only rollback is none; retain/delete policy for local sensitive artifacts
must still be named.
```

Provider secret metadata proves only binding name/type/presence. It cannot prove
that a value is nonempty or not a placeholder. Prove those separately without
printing the value: consumer-side format/denylist checks plus a successful
correct-account runtime probe and negative auth matrix. If the credential code
or migration is not deployed, record `ABSENT -> STOP`; Packet A does not create it.

## Future write packets — never bundle

| Packet | Exact mutation | Required readback | Rollback boundary |
|---|---|---|---|
| B0 credential issue/rotation | D1 hash row 1; accounting runtime secret 1; account 1 | new ID/account/scope; correct HEAD/GET; old/invalid/cross-account/unrelated denial | keep old row active until new runtime readback, then revoke under a new approval |
| B1 Worker deploy | Worker 1; exact artifact/head/version; gate remains off | deployment ID, routes, bindings, gate, negative auth matrix | exact previous Worker version; do not change D1/secrets |
| B2 migrations | D1 1; migration 071 then 072; exact checksums | migration ledger and table/index/FK/CHECK readback after each | additive tables remain; no automatic DROP |
| B3 manifest backfill | candidate N; ledger inserts N; exact JSON rewrites N; R2 writes/deletes 0 | changes N/N, preimage/replacement digests, R2 HEAD/GET, conflicts 0 | conditionally restore only exact replacement JSON; keep ledger/R2 |
| B4 gate deploy | Worker 1; gate false/unset -> true | deployed version, gate true, private route healthy, old origin URL 404 | reopening public evidence needs a new approval |
| B5 exact purge | URLs N in K batches; exact purge artifact digest | receipts for N; every old URL 404 | purge is irreversible; wildcard/prefix/purge-all forbidden |
| B6 credential revoke | old credential row 1 | old=401, new correct account=200, cross-account=404 | only possible during the approved overlap window |
| B7 accounting feature enable | exact company/account allowlist and mode before/after | target enabled, all non-targets off, kill switch/readback | return to off; LINE/Drive UAT remains separate |

Every B packet must state exact before/after, resource IDs, head/artifact hashes,
expected mutation counts, maintenance impact, stop conditions, readback, approval
expiry, rollback feasibility, and operations not authorized. PR merge and LINE
send always remain separate approvals.
