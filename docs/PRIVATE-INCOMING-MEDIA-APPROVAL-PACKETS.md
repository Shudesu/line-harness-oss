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

### A0-R1 execution receipt — STOP

KEN explicitly approved `5229-A0-R1-20260831` for Harness
`2dfc0e5f705765084d27360a0d004e564499cc3d` at
`2026-08-31T22:22:15+09:00` (expiry `2026-09-01T00:22:15+09:00`). Heads and
packet SHA-256 matched. The one allowed Wrangler identity command resolved the
exact Cloudflare account and fixed `T0_R2=2026-08-31T13:23:43Z` /
`T0_D1=2026-08-31T22:23:43`.

Before that provider call, one local launcher attempt failed with a Python
syntax error. It made no network request and created no file; it is not counted
as a provider command.

The first Worker metadata invocation then failed before returning deployment
metadata. Wrangler made an implicit `/memberships` request and Cloudflare
returned authentication error code 10000. That path was not in A0-R1's direct
REST allowlist, and provider error/unexpected-path are STOP conditions. No retry
or alternative endpoint was attempted under the same approval.

```text
Cloudflare identity command: 1 successful
Worker metadata command: 1 failed; deployment metadata unverified
Known unexpected internal path: /memberships
D1 inventory/query requests: 0/0
R2 bucket/lifecycle/LIST requests: 0/0/0
accounting consumer boolean-only checks: 0
R2 object HEAD/content GET: 0/0
private Worker probes: 0
provider writes/deploys/migrations/token changes/purges/restarts/LINE sends/merges: 0
local evidence directories/files created: 1/0
```

The empty mode-0700 directory
`/Users/kensmba/.line-harness-5229-A0-R1-20260831` is retained unchanged. Its
deletion, reuse, or permission change was not authorized. No A1 was created.

## Packet A0-R2 — direct account-scoped REST discovery, awaiting KEN approval

This replacement removes Wrangler from every provider operation so no implicit
membership/account discovery can occur. It inherits A0-R1's exact locators,
service target, D1 statement definitions, `U/H/N/E/B/C/P` definitions,
validator order, snapshot/double-read rules, canonical serialization, secret
redaction, and STOP conditions. Approval expires two hours after KEN's explicit
approval.

Official schema authorities retrieved 2026-08-31:

- `https://developers.cloudflare.com/api/resources/accounts/methods/get/`
- `https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/`
- `https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/`
- `https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/`
- `https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/list/`
- `https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/`
- `https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/get/`
- `https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/`
- `https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/`
- `https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/get/`
- `https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/lifecycle/methods/get/`
- `https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/`

```text
Approval ID: 5229-A0-R2-20260831
Mode: CF-DIRECT-REST-AND-RUNTIME-READ-ONLY-DISCOVERY
Issues/PR: #5229 / #5230 / Draft PR #5244

Immutable anchors:
- Accounting PR head: ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- Accounting implementation: 63635fa00a992301daa8422d9401c6479de13246
- Harness implementation: 07c4f27a5694ed50fe07bb09c48f28820d7c4833
- A0-R1 packet/result commit: 2dfc0e5f705765084d27360a0d004e564499cc3d
- migration/helper/client and local-locator SHA-256 values: exactly as A0-R1

Exact base and targets:
- API base: https://api.cloudflare.com/client/v4
- Cloudflare account ID: 67907592fdf596376bc2097e14a6563a
- Worker: line-harness
- expected workers.dev origin: https://line-harness.family8office.workers.dev
- D1 name/ID: line-harness / c19584d7-e9f1-4d46-83c5-6c0ba96561d1
- R2 bucket: line-harness-images
- accounting service/config/executable: exactly as A0-R1

Transport contract for every provider request:
- direct HTTPS only; no Wrangler/SDK, redirect, retry, cookie, proxy override,
  request-body logging, or Authorization logging
- parse only one exact `CLOUDFLARE_API_TOKEN=` assignment from the mode-0600
  ignored/untracked `/Users/kensmba/.line-harness/.env.local`; never source or
  execute the file, and STOP on a duplicate, missing, empty, or malformed value
- connect timeout 10 seconds, total timeout 30 seconds per request
- accept only HTTP 200 plus JSON `success=true`; otherwise record sanitized
  status/error codes/request ID and STOP
- allowed response fields are parsed in memory and only field-allowlisted
  evidence enters the three authorized files
- raw provider bodies never enter stdout, stderr, shell tracing, logs, temporary
  files, or evidence files; only the in-memory parser may inspect them
- application-controlled request headers are exactly `Authorization: Bearer
  <redacted>` and `Accept: application/json`, plus `Content-Type:
  application/json` only for D1 query POST. The HTTP transport may generate
  only required `Host` and `Content-Length`; suppress defaults such as Cookie,
  User-Agent, Accept-Encoding, and all custom/jurisdiction headers
- every metadata request uses GET. The sole non-GET exception is the enumerated
  D1 query POST; its JSON body contains exactly one prevalidated A0-R1
  SELECT/PRAGMA statement and optional parameters, never `batch`
- immediately before request 1, record one fresh immutable cutoff as `T0_R2`
  and its equivalent `T0_D1`. The A0-R1 cutoff is receipt-only and must not be
  reused

Exact provider request allowlist and maxima, in order:
1. GET /accounts/67907592fdf596376bc2097e14a6563a — exactly 1
2. Worker GETs — maximum 6, no other Worker path:
   a. /accounts/67907592fdf596376bc2097e14a6563a/workers/scripts/line-harness/deployments
   b. /accounts/67907592fdf596376bc2097e14a6563a/workers/scripts/line-harness/versions/<active-version-id>
   c. /accounts/67907592fdf596376bc2097e14a6563a/workers/scripts/line-harness/settings
   d. /accounts/67907592fdf596376bc2097e14a6563a/workers/scripts/line-harness/secrets
   e. /accounts/67907592fdf596376bc2097e14a6563a/workers/subdomain
   f. /accounts/67907592fdf596376bc2097e14a6563a/workers/scripts/line-harness/subdomain
   Each a-f may execute at most once; b-f execute only after every preceding
   required validation succeeds.
   Cloudflare defines the first returned deployment as the latest deployment
   actively serving traffic. It must contain exactly one version at 100%;
   otherwise record drift and STOP before request b. Request b may use only that
   returned UUID. Bindings must resolve DB and IMAGES exactly once. Retain only
   compatibility date/flags, binding names/types, exact D1/R2 identifiers,
   deployment/version IDs/timestamps, secret names/types, and subdomain enabled
   booleans plus `workers_dev_origin_matches` only. The account subdomain is
   compared with the expected origin in memory and never retained. Discard all
   binding values and unrelated settings. If the secrets
   response contains `text`, `key_base64`, `key_jwk`, or any other value-bearing
   field, discard the body and STOP without writing it; secret values are never
   authorized output.
3. GET /accounts/67907592fdf596376bc2097e14a6563a/d1/database/c19584d7-e9f1-4d46-83c5-6c0ba96561d1
   — exactly 1; require exact database ID and name `line-harness`.
4. POST /accounts/67907592fdf596376bc2097e14a6563a/d1/database/c19584d7-e9f1-4d46-83c5-6c0ba96561d1/query
   — maximum 7 requests, one A0-R1 SELECT/PRAGMA statement per request, no
   batching/retry. Require meta.changed_db=false and changes/rows_written=0
   when those fields are returned; any write signal, truncation, or unexpected
   shape is STOP.
5. GET /accounts/67907592fdf596376bc2097e14a6563a/r2/buckets/line-harness-images
   — exactly 1; require the exact bucket name.
6. GET /accounts/67907592fdf596376bc2097e14a6563a/r2/buckets/line-harness-images/lifecycle
   — exactly 1.
7. GET /accounts/67907592fdf596376bc2097e14a6563a/r2/buckets/line-harness-images/objects
   with only prefix=incoming-, per_page=1000, and provider-returned cursor —
   A0-R1's two-pass maximum 10 requests/pass and 20 total.

Total provider ceiling: 30 GET requests plus 7 D1 query POST requests = 37.
The local accounting boolean-only read ceiling is 1 and provider writes remain
0. A dynamic `<active-version-id>` is allowed only when it came from request 2a
and matches UUID grammar. A pagination cursor is allowed only when it came from
the immediately preceding response, is nonempty and previously unseen, and is
URL-encoded exactly once. Any method, host, path, query key, header, dynamic
value, implicit retry, SDK/discovery call, or additional request outside this
allowlist is an immediate STOP.

Forbidden provider paths include `/memberships`, `/accounts` collection list,
object-key GET, Worker content download, audit logs, and every endpoint not
listed above. R2 object HEAD/content GET and private Worker probes remain 0.

Local runtime read:
- one A0-R1 accounting consumer boolean-only check, same field allowlist

Secret-value limitation:
- Worker request 2d can establish only each deployed secret's name/type
  presence. It cannot establish that a secret value is nonempty, non-placeholder,
  current, or usable. A0-R2 must report those value properties as `unknown`,
  never infer them from presence, and cannot satisfy that portion of the wider
  production preflight. Any later value/readback proof requires a separately
  designed and separately approved boundary; private Worker probes remain
  forbidden here.

Local evidence writes explicitly authorized:
- leave `/Users/kensmba/.line-harness-5229-A0-R1-20260831` untouched
- create exactly one new mode-0700 directory with exclusive-create semantics:
  /Users/kensmba/.line-harness-5229-A0-R2-20260831
- create exactly three new mode-0600 exclusive files named
  `d1-candidates.json`, `r2-incoming-metadata.json`, and
  `sanitized-summary.json`, with the exact A0-R1 field/retention rules

The management credential is still potentially deployment-capable and exposed.
Approval accepts one-time use only for the exact request allowlist above. Token
rotation/revocation/replacement, provider mutation, deployment, migration,
object HEAD/GET, purge, restart, feature enablement, LINE send, and PR merge are
all forbidden and expected count=0.
```

### A0-R2 execution receipt — STOP

KEN explicitly approved `5229-A0-R2-20260831` for Harness
`1412bcfa926c7a63347b940aa320156282f5d6fc` and packet SHA-256
`630ee67f1cfe596f96465770d593d60f11951ebd65779358ccf0aa577e57d29b`
at `2026-08-31T23:08:08+09:00` (expiry
`2026-09-01T01:08:08+09:00`). All local anchors, modes, and hashes matched.

Direct REST reads for the exact account, all six Worker endpoints, the exact D1
database, four read-only D1 statements, the exact R2 bucket, and R2 lifecycle
all returned HTTP 200 and passed their preceding field validations. The first
R2 collection LIST also returned HTTP 200, but its JSON omitted the optional
`result_info` object. A0-R2 required that object and therefore stopped with
`r2_result_info_shape`. The response body and the in-memory cutoff were
discarded; no object metadata, raw provider body, or T0 value was persisted.
There was no retry or second R2 pass.

```text
Provider GET requests: 11
D1 read-only query POST requests: 4
Provider total: 15
Successful R2 collection LIST requests: 1; result_info absent
Second R2 pass / D1 second snapshot read: 0/0
accounting consumer boolean-only checks: 0
R2 object HEAD/content GET: 0/0
private Worker probes: 0
provider writes/deploys/migrations/token changes/purges/restarts/LINE sends/merges: 0
local evidence directories/files created: 1/1
```

The mode-0700 directory
`/Users/kensmba/.line-harness-5229-A0-R2-20260831` contains only the mode-0600
`sanitized-summary.json` STOP receipt (SHA-256
`50d1845f7613c4512072ddd314e3f2a5739f588223049b478b91fff432780f15`).
It must remain unchanged. No A1 was created.

## Packet A0-R3 — optional pagination-envelope recovery, awaiting KEN approval

This is a new approval boundary, not an A0-R2 retry. It repeats A0-R2's full
current-state discovery with a fresh T0 because A0-R2 intentionally retained no
provider metadata. It inherits A0-R2's immutable locators and code hashes,
direct-REST transport, endpoint order, request/header/response field allowlists,
D1 statements, `U/H/N/E/B/C/P` definitions, double reads, canonical digests,
secret-value `unknown` boundary, total request ceiling, STOP rules, and all
write prohibitions except for the pagination and evidence-path changes below.
Approval expires two hours after KEN's explicit approval.

Cloudflare's List Objects schema marks `result_info` optional:
`https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/`

```text
Approval ID: 5229-A0-R3-20260831
Mode: CF-DIRECT-REST-AND-RUNTIME-READ-ONLY-DISCOVERY
Issues/PR: #5229 / #5230 / Draft PR #5244

Immutable anchors:
- Accounting PR head: ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- Accounting implementation: 63635fa00a992301daa8422d9401c6479de13246
- Harness implementation: 07c4f27a5694ed50fe07bb09c48f28820d7c4833
- A0-R2 packet/result parent: 1412bcfa926c7a63347b940aa320156282f5d6fc
- A0-R2 packet SHA-256: 630ee67f1cfe596f96465770d593d60f11951ebd65779358ccf0aa577e57d29b
- migration/helper/client and local-locator SHA-256 values: exactly as A0-R2

Fresh snapshot:
- immediately before the exact account GET, record a new immutable T0_R2 and
  equivalent T0_D1; do not reuse or infer A0-R1/A0-R2 cutoffs

R2 LIST pagination rule replacing A0-R2's result_info requirement:
- each pass starts with no cursor and uses prefix=incoming-, per_page=1000
- require result to be an array of at most 1000 unique, field-valid objects
- if result_info is present, it must be an object with boolean is_truncated;
  false is terminal, while true requires one nonempty, unseen provider cursor
  that is URL-encoded once and used only by the immediately following request
- if result_info is absent, accept the page as terminal only when result length
  is strictly less than 1000; length 1000 is ambiguous and immediate STOP
- null/non-object result_info, a cursor without is_truncated=true, pagination
  response headers, or any other pagination shape is immediate STOP
- inspect response headers in memory only for pagination indicators such as
  Link/Cursor/X-Cursor; retain neither their names nor values, and STOP if any
  is present
- run exactly two complete passes, at most 10 pages/pass and 20 LIST GETs total;
  require the same cutoff-filtered canonical digest

Provider ceilings unchanged:
- GET maximum 30, D1 query POST maximum 7, provider total maximum 37
- local accounting boolean-only read maximum 1
- provider writes, R2 object HEAD/GET, and private Worker probes: 0

Local evidence writes:
- leave both prior A0-R1 and A0-R2 evidence directories unchanged
- exclusively create one mode-0700 directory:
  /Users/kensmba/.line-harness-5229-A0-R3-20260831
- exclusively create the same three mode-0600 evidence files and no others;
  field/retention rules are exactly A0-R2

The potentially deployment-capable management credential remains exposed.
Approval accepts one-time use only within this two-hour window and exact
allowlist. Token mutation, deploy, migration, purge, restart, feature enablement,
LINE send, PR merge, and every unlisted request remain forbidden.
```

### A0-R3 execution receipt — STOP

KEN explicitly approved `5229-A0-R3-20260831` for Harness
`709ef490a286f7d34e2dfc402e05aaf4c95468aa` and packet SHA-256
`bdd7b68261155809ef95fd683c60d00e48fe1d3f0276becbef7e50b13fb6cfff`
at `2026-08-31T23:51:14+09:00` (expiry
`2026-09-01T01:51:14+09:00`). All local anchors, modes, and hashes matched.

Every authorized provider phase completed successfully: exact account, all six
Worker endpoints, exact D1 database, first D1 schema/candidate snapshot, exact
R2 bucket/lifecycle, two terminal one-page R2 LIST passes under A0-R3's optional
envelope rule, and the second D1 snapshot. The final local accounting check then
stopped with `accounting_env_duplicate` because its parser rejected a duplicate
key outside the approved Harness field set. No accounting values or usable
boolean result were emitted. Provider data remained in memory and was discarded
rather than reused after STOP.

```text
Fresh T0_R2 / T0_D1: 2026-08-31T14:58:00Z / 2026-08-31T23:58:00
Provider GET requests: 12
D1 read-only query POST requests: 5
Provider total: 17
R2 LIST passes/pages: 2 / 1+1
D1 first/second candidate snapshot reads: 1/1
accounting consumer check attempts/usable results: 1/0
R2 object HEAD/content GET: 0/0
private Worker probes: 0
provider writes/deploys/migrations/token changes/purges/restarts/LINE sends/merges: 0
local evidence directories/files created: 1/1
```

The mode-0700 directory
`/Users/kensmba/.line-harness-5229-A0-R3-20260831` contains only the mode-0600
`sanitized-summary.json` STOP receipt (SHA-256
`56e8572c5b08fee2389f869042dcd129142d133bdbb2136c3553245d9e901b10`).
It must remain unchanged. No A1 was created.

## Packet A0-R4 — target-key-only local precheck, awaiting KEN approval

This is a new approval boundary, not an A0-R3 retry. It repeats A0-R3's full
provider discovery with a fresh T0 because A0-R3 intentionally retained no
provider metadata. It inherits A0-R3's immutable resource/code hashes,
direct-REST endpoint and header allowlists, D1 statements, optional R2
pagination-envelope rule, double reads, canonical digests, `U/H/N/E/B/C/P`,
secret-value `unknown` boundary, request ceilings, STOP rules, and all write
prohibitions. Only the local precheck order/parser and evidence path change.
Approval expires two hours after KEN's explicit approval.

```text
Approval ID: 5229-A0-R4-20260901
Mode: LOCAL-PRECHECK-THEN-CF-DIRECT-REST-READ-ONLY-DISCOVERY
Issues/PR: #5229 / #5230 / Draft PR #5244

Immutable anchors:
- Accounting PR head: ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- Accounting implementation: 63635fa00a992301daa8422d9401c6479de13246
- Harness implementation: 07c4f27a5694ed50fe07bb09c48f28820d7c4833
- A0-R3 packet/result parent: 709ef490a286f7d34e2dfc402e05aaf4c95468aa
- A0-R3 packet SHA-256: bdd7b68261155809ef95fd683c60d00e48fe1d3f0276becbef7e50b13fb6cfff
- migration/helper/client and local-locator SHA-256 values: exactly as A0-R3

Local accounting check runs once before any provider request:
- confirm the exact config file is a real mode-0600 non-symlink and inspect the
  exact launchd label/executable in memory
- parse only these eight exact keys:
  LINE_ACCOUNTING_HARNESS_BASE_URL,
  LINE_ACCOUNTING_HARNESS_ACCOUNT_ID,
  LINE_ACCOUNTING_HARNESS_MEDIA_READ_CREDENTIAL,
  LINE_ACCOUNTING_HARNESS_MEDIA_READ_CREDENTIAL_SHA256,
  LINE_ACCOUNTING_HARNESS_INTERNAL_TOKEN,
  LINE_ACCOUNTING_HARNESS_FALLBACK_MODE,
  LINE_ACCOUNTING_HARNESS_FALLBACK_KILL_SWITCH,
  LINE_ACCOUNTING_HARNESS_FALLBACK_COMPANY_ALLOWLIST
- ignore every non-target key/line and all duplication among non-target keys;
  never retain or count them
- accept one unexported single-line KEY=VALUE assignment per target key, with an
  optional matching single/double quote pair around the whole value; duplicate
  target assignments, unmatched quotes, NUL/newline, or malformed target lines
  are immediate STOP before provider access
- absent target keys are valid discovery results, not parser errors
- emit only A0-R3's approved boolean/enum/count field allowlist; never emit an
  account ID, credential, fingerprint, allowlist value, launchd body, or other
  environment data
- if the local check cannot produce the complete allowlisted result, STOP with
  provider request count 0

Provider phase after successful local precheck:
- exclusively create a new evidence directory, then record a fresh T0
  immediately before the exact account GET
- repeat A0-R3's endpoint order and validation without retry
- ceilings remain GET <= 30, D1 query POST <= 7, provider total <= 37;
  local accounting check <= 1; provider writes/object HEAD/GET/probes = 0

Local evidence writes:
- leave A0-R1/A0-R2/A0-R3 evidence directories unchanged
- exclusively create one mode-0700 directory:
  /Users/kensmba/.line-harness-5229-A0-R4-20260901
- exclusively create the same three mode-0600 files and no others, under the
  inherited field and retention rules

The potentially deployment-capable management credential remains exposed.
Approval permits one-time use only for this exact target-key precheck and REST
allowlist during the two-hour window. Token mutation, deploy, migration, purge,
restart, feature enablement, LINE send, PR merge, and every unlisted request are
forbidden.
```

### A0-R4 execution receipt — COMPLETED

KEN explicitly approved `5229-A0-R4-20260901` for Harness
`dd73798c9c3e251f4221fa1b33533311b357cc7a` and packet SHA-256
`b29f7fc63e6ca441711cd907425e4f9cfbb0b03451269c84fccc074d8142df00`
at `2026-09-01T08:04:48+09:00` (expiry
`2026-09-01T10:04:48+09:00`). All local anchors, modes, and hashes matched.
The target-key-only accounting precheck completed before any provider request,
then the bounded direct-REST discovery completed without drift or a write.

```text
Fresh T0_R2 / T0_D1: 2026-08-31T23:08:08Z / 2026-09-01T08:08:08
Worker latest deployment / active version:
  7b3bb319-e618-4f57-a520-cd33f43115e5 /
  c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7
D1 schema objects/details/index details for 071/072: 0/0/0
D1 migration presence: absent
R2 lifecycle rules/enabled/delete-or-expire/incoming collision: 1/1/0/0
R2 LIST passes/pages: 2 / 1+1
D1 first/second candidate snapshot reads: 1/1 (canonical digests equal)
U/H/N/E/B: 77/77/77/0/27,625,839 bytes
C count/bytes; P count/bytes; private invalid: 0/0; 0/0; 0
MIME: image/jpeg=77
D1 canonical digest: 7f2a46441c5308295266b37549d325363b8d46959394bd3f079be7256da599a2
R2 canonical digest: 8a99cacbf50951a4e2d8a6d4a5bdb197cab2d1d06776378e4dbce6d41f35fc7
Provider GET / D1 read-only POST / provider total: 12/5/17
Local accounting boolean reads: 1
R2 object HEAD/content GET; private Worker probes: 0/0; 0
Provider writes/deploys/migrations/token changes/purges/restarts/LINE sends/merges: 0
```

The mode-0700 directory
`/Users/kensmba/.line-harness-5229-A0-R4-20260901` contains exactly these three
mode-0600 files and remains immutable:

```text
d1-candidates.json
  06998bb58bd04fe1d64b437c9770c6a7ee9d85684c5a3b6791dd4e6a372e2cf9
r2-incoming-metadata.json
  d330d16e8b6d7aab19a08fc4c91d09789b1282e4b74e9f49831d9a7399a4dab8
sanitized-summary.json
  d6c6394e606ce60282d5a0c3442c534704208d2af5b3eed4f23b0119e3bc24fd
```

The accounting consumer remains fail-closed: service running and mode 0600,
but base URL, account ID, credential, and expected fingerprint are absent;
fallback is off, the kill switch is on, and the allowlist is empty. Secret
binding metadata proves names/types only. Secret values remain `unknown`.
Migration 071/072 and `incoming_media_service_credentials` are absent, so the
generic Packet A below would stop before private-route or credential readback.

## Packet C0 — exact historical R2 content evidence, awaiting KEN approval

This is an independent content-evidence packet, not generic Packet A or A1.
Existing A0 requires A1 to record `ABSENT -> STOP` when migration 072 or the
service credential is absent; A0-R4 confirmed both absent. C0 does not override
or satisfy that gate. It authorizes only one content read of each of the 77
exact historical objects frozen by A0-R4 and records first-observed content
digests. It does not infer LINE source provenance or create a helper-ready
backfill manifest. Approval expires two hours after KEN's explicit approval.

```text
Approval ID: 5229-C0-20260901
Mode: CF-R2-EXACT-CONTENT-GET-AND-LOCAL-DIGEST-EVIDENCE-ONLY
Issues/PR: #5229 / #5230 / Draft PR #5244

Immutable anchors and source evidence:
- Accounting PR head: ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- Accounting implementation: 63635fa00a992301daa8422d9401c6479de13246
- Harness implementation: 07c4f27a5694ed50fe07bb09c48f28820d7c4833
- A0-R4 execution head: dd73798c9c3e251f4221fa1b33533311b357cc7a
- A0-R4 T0_R2 / T0_D1:
  2026-08-31T23:08:08Z / 2026-09-01T08:08:08
- A0-R4 d1-candidates.json SHA-256:
  06998bb58bd04fe1d64b437c9770c6a7ee9d85684c5a3b6791dd4e6a372e2cf9
- A0-R4 r2-incoming-metadata.json SHA-256:
  d330d16e8b6d7aab19a08fc4c91d09789b1282e4b74e9f49831d9a7399a4dab8
- A0-R4 sanitized-summary.json SHA-256:
  d6c6394e606ce60282d5a0c3442c534704208d2af5b3eed4f23b0119e3bc24fd
- source directory must be the existing real mode-0700 non-symlink
  /Users/kensmba/.line-harness-5229-A0-R4-20260901 and its three source files
  must remain real mode-0600 non-symlinks

Exact provider target:
- Cloudflare account ID: 67907592fdf596376bc2097e14a6563a
- R2 binding/bucket: IMAGES / line-harness-images
- candidates N=77; excluded E=0; exact total bytes B=27,625,839
- exact object keys, per-object sizes, MIME, and ETags come only from the two
  hash-bound A0-R4 evidence files; never derive, broaden, or print them

Allowed provider requests and hard maxima:
- maximum 77 sequential direct REST GET requests, no retry, maximum in-flight
  requests=1; COMPLETED requires exactly 77 successful requests:
  GET /client/v4/accounts/67907592fdf596376bc2097e14a6563a/r2/
      buckets/line-harness-images/objects/{exact-approved-key}
- each key must retain the approved legacy grammar and be encoded exactly once
  as the final path segment; keys containing slash are impossible and STOP
- application headers are exactly Authorization and Accept-Encoding: identity;
  transport supplies Host only. Cookie, User-Agent, Accept, Range, and every
  conditional/custom header are suppressed. No request header is logged
- R2 object HEAD: 0
- R2 LIST, bucket/lifecycle, D1, Worker, account, or other provider reads: 0
- provider writes and all non-GET methods: 0
- request body bytes: 0
- accepted success bytes per object: exactly its A0-R4 size
- accepted success bytes aggregate: exactly 27,625,839
- one-byte sentinel application-read ceiling per object: expected size + 1;
  largest expected object=785,458, so largest ceiling=785,459
- aggregate one-byte sentinel application-read ceiling: 27,625,840
- if an extra sentinel byte exists, abort immediately, do not hash or retain it,
  and STOP; raw object bytes written to disk/log/chat remain 0

Per-object verification before accepting completion:
- HTTP status is exactly 200; no redirect is followed
- 206, 304, and every other status are rejected
- Content-Encoding is absent or exactly identity
- Content-Type is exactly the A0-R4 MIME (all 77 are image/jpeg)
- when Content-Length is present it is a canonical non-negative decimal and
  exactly the A0-R4 size; absence is recorded and the streamed byte count
  remains authoritative
- quoted HTTP ETag, after removing exactly one surrounding quote pair, equals
  the A0-R4 raw ETag; weak, missing, or malformed ETags are rejected
- streamed byte count equals the exact A0-R4 size
- SHA-256 is computed over exactly the accepted bytes while streaming and
  retained only as lowercase hex
- JPEG bytes begin FF D8 FF and end FF D9; no decoding, OCR, visual display,
  thumbnail, temporary body file, or image/body logging is allowed
- all 77 A0 custom sha256/custom byteSize values are absent. Record
  custom_sha256_present=0, custom_byte_size_present=0, and
  sha256_source=observed_r2_content; never treat the ETag as a content SHA-256
- record only status, Content-Type, Content-Length presence/value, normalized
  ETag, computed SHA-256, magic-valid boolean, cf-ray when present, and byte
  count; discard all other response headers

Local content-evidence construction after all 77 GETs pass:
- one entry per exact approved object, sorted by key, with fixed field order:
  key,size,a0_etag,content_type,observed_sha256,sha256_source,
  custom_sha256_present,custom_byte_size_present,http_status,
  content_length_present,content_length,content_encoding,magic_valid,cf_ray
- sha256_source is exactly observed_r2_content; custom_sha256_present and
  custom_byte_size_present are false for every entry
- content-evidence canonical digest is SHA-256 over the entry array serialized
  as compact UTF-8 JSON in that field order with no trailing newline
- every missing optional value serializes as JSON null, never omitted or an
  empty string
- record the raw r2-content-digests.json SHA-256 separately
- do not set verified=true, choose incoming_media IDs/backfill timestamps,
  infer source_type/source_id/sender_user_id, copy messages_log preimages, call
  the migration helper, or generate SQL/purge/readback plans

Exclusive local evidence writes:
- leave every A0/A0-R1/A0-R2/A0-R3/A0-R4 evidence directory unchanged
- create only one new non-symlink mode-0700 directory with exclusive-create:
  /Users/kensmba/.line-harness-5229-C0-20260901
- on COMPLETED create exactly two non-symlink mode-0600 files with wx, in this
  order: first r2-content-digests.json, verify its mode/size/SHA-256, then write
  sanitized-summary.json and verify its mode/size/SHA-256
- r2-content-digests contains exact legacy keys that embed account/message
  identifiers, but no additional D1 fields, URLs, image bytes, credentials,
  authorization headers, cookies, or unallowlisted response headers; it must
  never enter Git, CI output, or chat
- keep per-object receipts/digests in memory until all 77 checks pass; temporary
  body/receipt/digest files always remain 0
- sanitized-summary contains only approval/timestamps, aggregate counts/bytes,
  MIME counts, request counts, custom_sha256_present=0,
  custom_byte_size_present=0, sha256_source=observed_r2_content,
  STOP/COMPLETED, canonical/raw file digests, and sanitized request IDs; it
  contains no customer/account IDs, keys, or URLs
- if the output path already exists, STOP before creating or changing anything
  and emit only the sanitized STOP reason/counts to the operator; local receipt
  file count remains 0
- on a provider/verification STOP before the completion writes, create only
  sanitized-summary.json with wx if that path is absent; canonical/raw content
  digest fields serialize as JSON null
- if serialization or either completion write/verification fails, retain every
  already-created file byte-for-byte without delete, overwrite, chmod repair,
  append, or rename. Report the actual directory/file count, names, modes,
  sizes, and any computable hashes in the sanitized operator receipt and mark
  every residual artifact unusable
- partial object receipts/digests are never reused. Any retry requires a new
  packet/evidence path and starts all 77 GETs again. Never delete or modify an
  A0-R4 source artifact
- retain the new owner-only evidence until #5229 migration and UAT complete;
  deletion or relaxation of permissions is outside this packet

Immediate STOP conditions:
- any anchor/source hash/mode/path mismatch, duplicate/missing/unexpected object,
  N/E/B mismatch, invalid legacy key grammar, D1-to-R2 approved-key-set mismatch,
  or A0 MIME/size/ETag inconsistency
- any unexpected request, redirect, retry, provider error, response/header/body
  mismatch, magic failure, byte-cap breach, or content SHA conflict
- any output path exists, mode/owner-only check fails, unexpected file appears,
  or a credential/header/body would be logged

Explicitly forbidden and expected count=0:
- deploy, migration, D1 query/write, backup creation, R2 HEAD/LIST/mutation,
  secret or token change, credential creation/revocation, Worker/private-route
  probe, cache purge, restart, feature enablement, LINE send, PR merge
```

Cloudflare's current Object Get contract returns the object body with metadata
headers. This packet uses that single response for both metadata agreement and
streaming content verification, so a separate HEAD adds no approved value.
The C0 result proves only exact R2 byte evidence; migration 071/072, credential,
private-route auth, D1 source provenance/preimage/ledger state, and a backfill
manifest remain absent or unverified. Generic Packet A/A1 therefore still
cannot complete. Manifest assembly/helper execution, private-route auth tests,
and every production mutation remain separate later packets. The exposed
management credential may be used once only for these exact 77 GETs during the
two-hour window; rotation/revocation remains a separate mutation approval.

### C0 execution receipt — STOP before provider access

KEN explicitly approved `5229-C0-20260901` for Harness
`808d1d9305065af04ccee21236438de0c6815d4f` and packet SHA-256
`2522f10e84c50968c0b9c953961f8606e8b35efc4bc224c18dffe91df0da3841`.
The local executor stopped during its first source-path assertion because it
passed the label `source_directory` to a predicate that recognized only the
exact label `directory`; the real mode-0700 source directory was consequently
misclassified as a file. The predicate bug occurred before token parsing,
output-directory creation, or any provider request.

```text
Status: STOP
Stop reason: source_directory_type
Provider GET / successful GET / retry: 0/0/0
Accepted/application-read bytes: 0/0
Provider writes: 0
R2 HEAD/LIST; D1; Worker requests: 0/0; 0; 0
Local evidence directories/files created: 0/0
```

No C0 result may be reused. The path
`/Users/kensmba/.line-harness-5229-C0-20260901` remains absent. A new approval
and evidence path are required before the first R2 object GET.

## Packet C0-R1 — hash-bound content collector, awaiting KEN approval

This is a new approval boundary, not a C0 retry under the old approval. It
inherits C0's exact account/bucket, A0-R4 source hashes, N/E/B, 77 sequential
GET/no-retry/in-flight-one rule, per-object size+1 and aggregate B+1 sentinel
ceilings, metadata/body verification, evidence schema, STOP rules, retention,
generic A/A1 separation, and every write prohibition. It changes only the
local executor from an inline predicate to the hash-bound tested collector and
uses a new exclusive evidence path. Approval expires exactly two hours after
KEN's explicit approval.

```text
Approval ID: 5229-C0-R1-20260901
Mode: CF-R2-EXACT-CONTENT-GET-AND-LOCAL-DIGEST-EVIDENCE-ONLY
Issues/PR: #5229 / #5230 / Draft PR #5244

Immutable anchors:
- Accounting PR head: ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- Accounting implementation: 63635fa00a992301daa8422d9401c6479de13246
- Harness implementation: 07c4f27a5694ed50fe07bb09c48f28820d7c4833
- C0 packet/result parent head: 808d1d9305065af04ccee21236438de0c6815d4f
- C0 packet SHA-256:
  2522f10e84c50968c0b9c953961f8606e8b35efc4bc224c18dffe91df0da3841
- collector path: scripts/r2-content-evidence-5229.ts
- collector SHA-256:
  db6901bd9e9da5919fcf99e6d9b451d7d694334af4895475ba908def32b5c1a2
- collector test SHA-256:
  88c9a698b0f6c79ef8845ac319e064d56885840b340609bb67b02787a5b2a1db
- all A0-R4 source paths/hashes/modes: exactly as C0

Fixed collector scope:
- exact account ID 67907592fdf596376bc2097e14a6563a
- exact bucket line-harness-images
- exact N=77, E=0, B=27,625,839; largest object=785,458
- token locator only:
  /Users/kensmba/.line-harness/.env.local, real mode-0600 non-symlink,
  exactly one nonempty CLOUDFLARE_API_TOKEN assignment
- token value, Authorization header, object bytes, and customer identifiers are
  never printed; preflight emits token_present boolean only
- source kind is now a closed `directory | file` enum and the A0-R4 source is
  asserted with the exact `directory` member before token parsing

Required local preflight before approval execution:
- focused Vitest: 12/12 pass, including source directory/file/symlink,
  approval half-open interval boundaries, pinned output identity/entry-set
  drift, strict GET headers, valid/oversize body ceilings, sequential STOP,
  preflight zero-write, 77-item completion, and STOP residual evidence
- standalone TypeScript no-emit check: pass
- collector --preflight-only result must be exactly:
  status=preflight_passed, source_count=77, total_bytes=27,625,839,
  token_present=true, provider_requests=0, local_writes=0
- preflight-only never creates the C0-R1 output path or opens/calls a provider
  connection/request

Approved execution after all hashes/heads are rechecked:
- derive approval_received from KEN's explicit approval and
  approval_expires=approval_received+2h; the collector rejects every other
  window length, rejects execution before approval_received, checks the active
  window before each GET, and aborts an in-flight GET on an absolute expiry
  timer; the response end callback rechecks expiry before accepting success
- invoke exactly once:
  pnpm exec tsx scripts/r2-content-evidence-5229.ts
    --approval-received <exact ISO-8601 approval instant>
    --approval-expires <exact instant plus two hours>
- exclusive output path changes to:
  /Users/kensmba/.line-harness-5229-C0-R1-20260901
- C0 and all A0 evidence paths remain unchanged

Collector/provider bounds:
- direct node:https only; application headers Authorization and
  Accept-Encoding: identity; transport-generated Host/Connection only
- exact once-encoded approved key path; no redirect handling and no automatic
  retry; one fresh connection per GET, maximum 77 total connections, and
  maximum one connection/request in flight
- response bodies stay in paused mode and use bounded read(n); the application
  receives at most the remaining per-object size+1 sentinel allowance rather
  than an arbitrary transport chunk
- the exclusive output directory is pinned by device/inode and its exact entry
  set is revalidated before and after every GET and completion write; identity,
  mode, symlink, or unexpected-entry drift is immediate STOP
- completion requires exactly 77 HTTP 200 responses and B accepted bytes
- C0's Content-Type, optional Content-Length, strong quoted ETag, identity
  encoding, byte count, SHA-256, JPEG SOI/EOI, null serialization, canonical
  digest, two-file wx/write-order/verification, and partial-write rules apply
- provider GET maximum=77; provider writes, R2 HEAD/LIST, D1/Worker/account
  reads, deploy, migration, token/secret/credential change, purge, restart,
  feature enablement, LINE send, PR merge remain exactly 0

STOP before provider access on any head/script/test/source/preflight/token/path
drift. STOP on the first provider/header/body/byte/write discrepancy with no
retry. Partial results and the old C0 approval are never reused.
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
