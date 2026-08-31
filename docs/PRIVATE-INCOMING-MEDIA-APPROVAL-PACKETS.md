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

### A0 execution receipt — STOP

KEN explicitly approved `5229-A0-20260831` at
`2026-08-31T21:31:51+09:00` (expiry `2026-08-31T23:31:51+09:00`). The first
provider read attempted the locally inferred fork
`Keninvestment/line-harness-oss`; the GitHub Actions variables endpoint returned
HTTP 404. This failed the packet's exactly-one target requirement, so execution
stopped immediately.

Sanitized counts at STOP:

```text
GitHub Actions variables reads: 1 (HTTP 404)
GitHub Actions secret-name reads: 0
Cloudflare identity/account reads: 0
Worker metadata reads: 0
D1 inventory reads/statements: 0/0
R2 bucket/lifecycle reads: 0/0
accounting consumer boolean-only checks: 0
R2 object HEAD/content GET: 0/0
private Worker probes: 0
writes/deploys/migrations/token changes/purges/restarts/LINE sends/merges: 0
```

No A1 was created because A0 did not establish provider-backed resource IDs or
`N/E/B`. Local inspection found the installed non-secret locator below and no
local evidence of a deploy fork. It also found a Cloudflare credential-shaped
plaintext in the user's mode-0600 shell history; a local diagnostic surfaced
that value to the agent tool output, so it must be treated as exposed even
though the value is intentionally not copied into this document or the user
report. `.line-harness/.env.local` is mode 0600, ignored, and untracked.
Credential mutation remains forbidden; any future production write packet must
treat rotation/revocation as a separate approval boundary.

## Packet A0-R1 — locator-bound current-state discovery, awaiting KEN approval

This replacement removes the unverified GitHub-fork assumption. The local
installer config is only a locator; every target must still resolve exactly once
from Cloudflare readback or STOP. Approval expires two hours after KEN's explicit
approval.

```text
Approval ID: 5229-A0-R1-20260831
Mode: CF-AND-RUNTIME-READ-ONLY-DISCOVERY
Issues/PR: #5229 / #5230 / Draft PR #5244

Immutable implementation anchors:
- Accounting PR head: ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- Accounting implementation: 63635fa00a992301daa8422d9401c6479de13246
- Harness implementation: 07c4f27a5694ed50fe07bb09c48f28820d7c4833
- A0 packet/result parent: 0089b70bd5cc90dd27cff530d63766c136a24eea
- migration 071 SHA-256: c65203ce28e750b6cf612ad17029bc195fd2e6253a379cf62e642e3c5a8ae5d6
- migration 072 SHA-256: be4b1730fadd497d0a0d9677bda8626d174aaa08946d1c27e9e68e1549049937
- migration helper SHA-256: 5ffb00be36ec92402b7e28725f7e450a424e627acbd6a81b64ac02b13fce117a
- credential helper SHA-256: d87802aff96447ddc484bf4e349f44a6f81b46e788e68f5a036079dca4f9cc5f
- accounting client SHA-256: 8107debd9ad0eea27a81e43d42cb271a6b71b09422d21cf75ad3fa363039ff7f
- local locator: /Users/kensmba/.line-harness/.line-harness-config.json
- local locator SHA-256: d2b20da221393e74c694aabb30abe60dbecdc6d3e9e7b9cbeed95b13d54f5887
- expected locator mode/deploy mode: 0644 / bundle
- expected locator githubRepo field: absent

Exact locator-bound targets, each require exactly one match or STOP:
- Cloudflare account ID: 67907592fdf596376bc2097e14a6563a
- production Worker name: line-harness
- Worker origin: https://line-harness.family8office.workers.dev
- Worker DB binding: DB
- D1 database name/ID: line-harness / c19584d7-e9f1-4d46-83c5-6c0ba96561d1
- Worker R2 binding/bucket: IMAGES / line-harness-images
- accounting receiver launchd label: com.kensmba.line-accounting-webhook
- accounting receiver config locator:
  /Users/kensmba/scripts/260107_orchestrator/.env
- accounting receiver executable/port:
  /Users/kensmba/scripts/260107_orchestrator/.venv/bin/python -m
  agents.agent_accounting.line_receiver --port 8444

Allowed command invocations and maxima:
- GitHub reads: 0
- Cloudflare authenticated identity/account discovery: 1 read command
- Worker deployment/version/settings/binding/secret-name metadata: 4 read commands
- D1 database inventory: 1 read command
- D1 read-only schema/migration/candidate queries: maximum 7 provider requests,
  exactly one statement per request, no automatic retry, in this exact order
  and scope:
  1. `sqlite_schema` SELECT limited to `_migrations`,
     `_line_harness_migrations`, `incoming_media`,
     `incoming_media_service_credentials`, and their indexes;
  2. `_migrations` name/applied_at SELECT only if statement 1 found that exact
     table, otherwise consume 0 statements;
  3. `_line_harness_migrations` name/checksum/applied_at SELECT only if
     statement 1 found that exact table, otherwise consume 0 statements;
  4. one tagged UNION SELECT over `pragma_table_info` and
     `pragma_foreign_key_list` for only the two incoming-media tables;
  5. one tagged UNION SELECT over `pragma_index_list` for only the two
     incoming-media tables;
  6. one tagged UNION SELECT containing only all `line_accounts.id` values and
     U-row `messages_log` id/friend_id/line_account_id/content/created_at plus
     the joined authoritative `friends.line_account_id` and
     `friends.line_user_id`. Apply `created_at <= T0_D1` and `LIMIT 10001`;
     result count 10001 means overflow and STOP.
  7. repeat statement 6 after both R2 LIST passes and require the same canonical
     digest; otherwise STOP on snapshot drift.
  Every statement must begin with SELECT or PRAGMA after comment stripping;
  table-name interpolation is limited to the two exact ledger names above.
  STOP on any provider error, incomplete/truncated response, or unexpected
  result shape; no retry is authorized.
- R2 bucket inventory: 1 read command
- R2 lifecycle configuration: 1 read command
- R2 object metadata LIST: Cloudflare REST
  GET /client/v4/accounts/67907592fdf596376bc2097e14a6563a/r2/buckets/
  line-harness-images/objects?prefix=incoming-&per_page=1000. Run exactly two
  complete passes, maximum 10 requests per pass and 20 total. Each pass starts
  without a cursor and follows only `result_info.cursor`; STOP on a missing,
  repeated, or previously seen cursor while `is_truncated=true`, and STOP if a
  pass is still truncated after request 10. Reject duplicate object keys within
  either pass. Filter canonical comparison to `last_modified <= T0_R2` and
  require identical pass digests, otherwise STOP on snapshot drift. Response
  bodies are metadata JSON only; GET by object key is forbidden.
  Schema authority retrieved 2026-08-31:
  https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/
  The collection response includes key,
  size, etag, last_modified, storage_class, http_metadata, custom_metadata,
  `result_info.cursor`, and `result_info.is_truncated`; no include-metadata
  query option exists. Missing required fields are drift, never inferred.
- accounting consumer credential status: 1 local boolean-only check. It may
  read the exact config locator after confirming mode 0600 and the launchd
  label has exactly one running instance. Output only:
  `service_running`, `env_mode_0600`, `base_url_matches`,
  `account_id_present`, `account_id_safe`, `credential_present`,
  `credential_format_valid`, `expected_fingerprint_present`,
  `expected_fingerprint_format_valid`, `fingerprint_matches`,
  `legacy_internal_token_absent`, `fallback_mode`, `kill_switch`, and
  `allowlist_count`; never output the account ID, credential, fingerprint,
  allowlist values, or other environment variables.
- R2 object HEAD/content GET: 0/0
- private Worker HEAD/GET and negative auth probes: 0/0/0

Candidate and aggregate definitions:
- Before the first provider read, record one immutable cutoff instant as both
  UTC `T0_R2` and the equivalent JST timestamp string `T0_D1`. D1 statements 6
  and 7 include only rows created at or before T0_D1; both R2 pass digests
  include only objects last modified at or before T0_R2. Later rows/objects are
  excluded from N/E/B/C; later R2 objects are count-only in the summary.
- U is every D1 `messages_log` row at or before T0 with
  `direction='incoming'` and `message_type='image'`.
- H is the potential historical subset of U: raw content contains the exact
  approved Worker origin and `/images/incoming-`, or parsed equal URLs point to
  an extension-bearing `/images/incoming-*.(jpg|jpeg|png|gif|webp)` path.
- A historical row is eligible only when `content` is valid JSON,
  original/preview URLs are
  equal, both URLs have the exact approved Worker origin with no query or
  fragment, the path is exactly `/images/<legacy-key>`, the key matches
  `incoming-<authoritative account id>-<safe message id>.<jpg|jpeg|png|gif|webp>`.
  The account comes only from the joined `friends.line_account_id` and must
  resolve exactly once in `line_accounts`; never derive the account by splitting
  the key. Only after fixing that account prefix may the message ID suffix be
  parsed. A non-null `messages_log.line_account_id` must agree. IDs must satisfy
  the private-route safe-identifier grammar.
- N is the number of eligible H rows that map one-to-one to exactly one legacy
  extension-bearing R2 LIST
  object with the same key, positive size, supported `http_metadata.contentType`,
  extension/MIME agreement, and no duplicate D1 identity, log ID, URL, or key.
- E is `count(H) - N`. Report exclusion counts by reason; overlapping reasons
  are assigned to the first matching reason in this exact order so their sum is
  E: invalid/non-object JSON; missing/non-text URL; unequal URLs;
  origin/path/query/fragment mismatch; legacy-key grammar mismatch; zero or
  ambiguous account-prefix match; unsafe account/message identifier; duplicate
  D1 log/identity/URL/key; missing or duplicate R2 key; non-positive/missing
  size; missing/unsupported MIME; extension/MIME mismatch.
- B is the sum of the R2 LIST `size` field for exactly the N matched objects.
- P is the count/bytes of valid new private keys matching exactly
  `incoming-[0-9a-f]{64}`; P is reported separately and excluded from C.
- C is the count of extension-bearing legacy R2 keys not matched to exactly one
  eligible H row plus unknown `incoming-` key shapes. Any duplicate, missing
  key, unsupported/missing metadata, or C > 0 is drift: record N/E/B/C/P and
  STOP before A1.

Required sanitized output and STOP/write boundaries are otherwise identical to
A0. Report only aggregate `U/H/N/E/B/C/P`, MIME counts from the exact R2 LIST
`http_metadata.contentType` field, exclusion reason counts, page/request count,
and canonical D1/R2 manifest digests in the review packet. This LIST is
necessary because D1 historical URL rows do not carry byte sizes; it does not
establish content SHA-256. Exact content hashes remain a separately approved A1
GET boundary.

Canonical digest serialization is UTF-8 compact JSON with no trailing newline.
D1 arrays are sorted by `(record_type,id)` and objects use this fixed field
order: `record_type,id,friend_id,messages_log_line_account_id,
authoritative_line_account_id,line_user_id,content,created_at`. R2 arrays are
sorted by key and objects use: `key,size,etag,last_modified,storage_class,
content_type,custom_sha256,custom_byte_size`. Missing optional values serialize
as JSON null. SHA-256 is lowercase hex over those exact bytes.

Local evidence writes explicitly authorized by this packet:
- create exactly one new mode-0700 directory, with exclusive-create semantics:
  /Users/kensmba/.line-harness-5229-A0-R1-20260831
- create exactly three new mode-0600 files, never overwrite or append:
  `d1-candidates.json`, `r2-incoming-metadata.json`, and
  `sanitized-summary.json`
- `d1-candidates.json` may retain exact IDs and the exact two-URL JSON preimage
  only for eligible rows; excluded rows retain IDs, a content SHA-256, and the
  first exclusion reason but not raw content
- `r2-incoming-metadata.json` is field-allowlisted to key, size, etag,
  last_modified, storage_class, HTTP contentType, and only custom `sha256` /
  `byteSize` when present; discard originalFilename and every other custom or
  HTTP metadata field before any file/stdout write
- the first two never contain credentials, request headers, image bytes,
  message text, or non-image message content; `sanitized-summary.json` contains
  aggregates, sanitized request IDs/timestamps, and digests only
- retain all three unchanged until A1/B3 is completed or abandoned; deletion,
  relocation, permission broadening, and upload require a separate approval

Provider writes remain 0. The authenticated management credential may be
deployment-capable and the shell-history finding means it must be treated as
exposed. By approving this packet KEN accepts its one-time use only for the exact
enumerated read commands during this two-hour window. The direct R2 collection
request must use GET; D1's provider transport may use its documented request
method but its SQL is limited to the SELECT/PRAGMA contract above. Any other API
path, write-capable Wrangler subcommand, token mutation, or unexpected target is
an immediate STOP. Never print the credential value, hash, or Authorization
material.
```

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
