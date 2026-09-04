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

## Packet C0-R1 execution receipt — COMPLETED

KEN explicitly approved `5229-C0-R1-20260901` for Harness
`8363d6be3595662e4c53a71303fec47255210e34` and packet SHA-256
`69c0a7fdbf73e1eef53a0c6f7189c09ef0cc40519cc68c4b9f92137783c32850`
at `2026-09-01T11:36:24+09:00` (expiry
`2026-09-01T13:36:24+09:00`). The committed collector/test hashes, both
worktree heads, all A0-R4 source hashes and modes, and exclusive output-path
absence matched before provider access. The focused collector tests passed
12/12, all script tests passed 64/64, the standalone TypeScript check passed,
and the final preflight reported 77 sources, 27,625,839 bytes, token present,
zero provider requests, and zero local writes.

The approved collector was invoked exactly once. It completed all 77 fresh,
sequential R2 content GETs without retry, redirect, overlapping request, or
write, and accepted every object only after its frozen metadata, byte count,
SHA-256, and JPEG boundary checks matched.

```text
Status: COMPLETED
Started/completed UTC:
  2026-09-01T02:38:08.245Z / 2026-09-01T02:39:31.446Z
N/E/B; completed: 77/0/27,625,839; 77
Accepted/application-read bytes: 27,625,839/27,625,839
MIME: image/jpeg=77
Provider GET / successful GET / retry: 77/77/0
Maximum in flight: 1
Provider writes: 0
R2 HEAD/LIST; D1; Worker requests: 0/0; 0; 0
Content-evidence canonical SHA-256:
  b897e6154ec47eb36d05874d70baed6cde951d50bc5b2e96c27d40ce2c13b50a
```

The mode-0700 directory
`/Users/kensmba/.line-harness-5229-C0-R1-20260901` contains exactly these two
mode-0600 files. The detailed object-level artifact remains private and its
contents were not printed:

```text
r2-content-digests.json
  db0146a9fc8dfe9bd576f57dafdf9e4d10c64acbfe92b6e84502e7cd5d5ba5f0
sanitized-summary.json
  c8134d393d9df4e48f7f0a60476995c681501e39c92b311e56187f93ed768769
```

No deploy, migration, token/secret/credential change, purge, restart, feature
enablement, LINE send, or PR merge was performed. C0-R1 proves byte-level
availability of the 77 A0-R4 historical objects only; it does not authorize or
perform any migration, backfill, URL rewrite, customer notification, or
production route readback.

An independent local audit passed with P1=0 and P2=0. It rechecked the exact
entry set, owner-only modes, file sizes and hashes, two-hour half-open approval
window, aggregate counts and bytes, request bounds, and raw-digest hash match
without reading the detailed digest contents or making any provider request.

## Packet P0 — frozen source-provenance aggregate, awaiting KEN approval

This packet resolves only the historical source-provenance join-health blocker
for the 77 A0-R4 rows. It does not create a backfill manifest and does not mark
any row verified. The historical code path proves that legacy image rows could
only be created for a 1:1 `user` source: group and room events returned before
the old R2 write and `messages_log` insert. Because the raw webhook source was
not persisted and `friends.line_account_id` is mutable, P0 describes the result
as `legacy_user_path_reconstruction`, never as a raw event snapshot.

```text
Approval ID: 5229-P0-20260901
Mode: CF-D1-FROZEN-SOURCE-PROVENANCE-AGGREGATE-ONLY
Issues/PR: #5229 / #5230 / Draft PR #5244
Approval lifetime: exactly two hours after KEN's explicit approval

Immutable anchors:
- Accounting PR head: ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- Accounting implementation: 63635fa00a992301daa8422d9401c6479de13246
- Harness implementation: 07c4f27a5694ed50fe07bb09c48f28820d7c4833
- C0-R1 receipt parent: dcd9b044ddc2f37ee68cc21c4e8f06808a2cc608
- historical release anchor: 900440558232790c50839f7416ac8db7b3133414
- historical webhook.ts SHA-256:
  b24e179a6ca688620e6083dfb6fd1a21f6b4d6a9e0c83272a4498a35ec434af8
- historical incoming-image.ts SHA-256:
  63119a36550fc63e1d1e2de877b47e857fe44d08b1b60779cc199d32b4cb27a6
- collector SHA-256:
  a1f6182e173c0da8333d71d27988cc61ee40cba6c74cb7e495174c76a2ee18db
- collector test SHA-256:
  9e8e0c368e00248d58ee572f31266c3386e0568604066186362f1608820aa75f
- A0-R4 d1-candidates.json SHA-256:
  06998bb58bd04fe1d64b437c9770c6a7ee9d85684c5a3b6791dd4e6a372e2cf9
- A0-R4 sanitized-summary.json SHA-256:
  d6c6394e606ce60282d5a0c3442c534704208d2af5b3eed4f23b0119e3bc24fd

Exact provider target:
- Cloudflare account: 67907592fdf596376bc2097e14a6563a
- D1 database: line-harness / c19584d7-e9f1-4d46-83c5-6c0ba96561d1
- endpoint: POST /client/v4/accounts/67907592fdf596376bc2097e14a6563a/
  d1/database/c19584d7-e9f1-4d46-83c5-6c0ba96561d1/query

Frozen input and query contract:
- source directory must remain real mode-0700 and both hash-bound sources real
  mode-0600; N/E/B must remain 77/0/27,625,839
- all 77 rows must remain record_type=message, carry nonempty log/friend/user/
  authoritative-account/content values, and retain historical log account null
- one CTE/SELECT statement only; no PRAGMA or write statement
- the 77 frozen tuples (log ID, friend ID, LINE user ID, authoritative account,
  exact JSON preimage) are encoded in one bound JSON parameter; they never
  appear in SQL, stdout, the packet, or the sanitized result
- SQL bytes=2,076; bound parameters=1; bound JSON bytes=39,348
- the one aggregate result must report exactly 77 for every field:
  frozen_rows, message_rows, message_shape_rows, source_user_rows,
  historical_account_null_rows, friend_rows, friend_identity_rows,
  account_fk_rows, fully_matched_rows
- every aggregate value must be a JSON integer number exactly equal to 77;
  string coercion is forbidden

Transport and ceilings:
- direct node:https, application headers Authorization, Content-Type,
  Accept-Encoding: identity, and Content-Length only; agent=false
- exactly one D1 query POST maximum, provider total=1, provider writes=0
- no retry, redirect, GET, R2, Worker, account, or other D1 request
- response status 200, application/json, identity/absent encoding, success=true,
  exactly one statement result and exactly one aggregate row
- application response-body ceiling=65,536 bytes with a one-byte sentinel;
  the response is consumed through bounded paused-mode reads
- the active half-open approval window is checked before the POST and after the
  response; an absolute expiry timer aborts an in-flight request

Required final local preflight before execution:
- focused tests 12/12; all script tests 76/76; standalone TypeScript check pass
- --preflight-only result exactly:
  status=preflight_passed, source_count=77, token_present=true,
  provider_requests=0, local_writes=0
- preflight-only must leave this output path absent:
  /Users/kensmba/.line-harness-5229-P0-20260901

Approved execution after all hashes/heads/modes are rechecked:
- derive approval_received from KEN's explicit approval and set
  approval_expires=approval_received+2h
- invoke exactly once:
  pnpm exec tsx scripts/d1-source-provenance-5229.ts
    --approval-received <exact ISO-8601 approval instant>
    --approval-expires <exact instant plus two hours>
- exclusively create one mode-0700 directory:
  /Users/kensmba/.line-harness-5229-P0-20260901
- write exactly one mode-0600 sanitized-summary.json on success or safe STOP;
  pin directory device/inode and exact entry set before and after the write
- retain the owner-only evidence unchanged until the backfill is completed or
  abandoned; relocation, permission broadening, upload, or deletion requires a
  separate approval

STOP before provider access on any head/script/test/source/token/path/preflight
drift. STOP after the first provider, response, aggregate, expiry, or local
write discrepancy with no retry. Customer identifiers, tuple values, SQL
parameters, token, token hash, Authorization header, and response error bodies
must never be printed.

Writes and actions not authorized: D1 migration/INSERT/UPDATE, manifest
verified=true, R2 HEAD/GET/LIST/mutation, Worker/account/secret reads, deploy,
token/secret/credential change, cache purge, restart, feature enablement,
Drive write, LINE send, PR merge.
```

## Packet P0 execution receipt — COMPLETED

KEN explicitly approved `5229-P0-20260901` for Harness
`47e64fd5810bbea6cfe65a09d7f3c67cd4f4760a` and packet SHA-256
`9a98060417cba6919b2a7bed1e4559584d6adcb92d7c7ab0391d2111b98103de`
at `2026-09-01T12:20:01+09:00` (expiry
`2026-09-01T14:20:01+09:00`). Exact-head/source/hash/mode checks, focused tests,
all script tests, standalone TypeScript, and the zero-write preflight passed
before the single approved D1 SELECT batch.

The request started at `2026-09-01T03:20:58.174Z` and completed at
`2026-09-01T03:20:58.688Z`. The result was `COMPLETED` with exactly one D1
query POST, one provider request total, zero provider writes, and zero retries.
All nine aggregate fields were integer 77: frozen/message/message-shape/user/
historical-account-null/friend/friend-identity/account-FK/fully-matched rows.
The result records `provenance_basis=legacy_user_path_reconstruction` and
`raw_event_snapshot=false`.

The retained owner-only evidence is:

- directory `/Users/kensmba/.line-harness-5229-P0-20260901`, mode `0700`;
- exactly one mode-`0600` `sanitized-summary.json`, 791 bytes;
- summary SHA-256
  `180bb410582445c3fc891c17a87be3ef6c6e58c734c59b9f85c1bb53abc854da`.

An independent audit passed with P1=0 and P2=0. No deploy, migration, token or
secret change, R2 access, cache purge, restart, feature enablement, Drive
write, LINE send, or PR merge occurred.

## M0 protected manifest and offline plan receipt — COMPLETED LOCALLY

After P0 completed, the fixed A0-R4, C0-R1, and P0 evidence was joined only
offline. The builder accepts exactly 77 unique historical user-path rows,
E=0, B=27,625,839, one account, and 77 JPEG content digests observed from R2.
It preserves each original `messages_log.created_at`, marks provenance as
reconstructed rather than raw, and refuses every count/byte/MIME/key/source/
URL/hash drift.

Hash-bound code:

- manifest builder SHA-256
  `82be4e2a4de58c5c33e842180f5e45e2a66e2af0f0dff39a3665e6ca28857621`;
- builder test SHA-256
  `7c78008b4d5f3b0eb16ba6995cbb45568f8a1bca7228c219df631d9e3afc61ee`;
- migration-plan builder SHA-256
  `7e911055348a6d10afa3a3e4b1072288387903ca841ba614392d2b56c51a4beb`;
- migration-plan test SHA-256
  `2801b79c1f24a0976aad1ec5307d1d8f937fa4805e5e3c89652a438b4864842c`.

Protected artifacts:

- manifest directory `/Users/kensmba/.line-harness-5229-M0-20260901`, mode
  `0700`, containing exactly one mode-`0600` manifest;
- raw manifest SHA-256
  `cf35a1045040a265019a5afad8c2cefb8994edba684eeaa5dd2fad0b17b1663e`;
- compact canonical manifest SHA-256 used by every plan artifact
  `e50d8a0f10b15fba61d98860bf761587e34958a5b07b2c0ea4cdac9cbd2afe69`;
- plan directory `/Users/kensmba/.line-harness-5229-M0-PLAN-20260901`, mode
  `0700`, containing exactly five mode-`0600` files;
- `preflight.json` SHA-256
  `cf6d513dc2712192f5739b90cf50212aae80d3cb5684b6065af6bae1921af077`;
- `apply.json` SHA-256
  `38d616248dfce3db08f4340817278758445d574b9d405e29b4def5e066e974ce`;
- `rollback.json` SHA-256
  `4b77fd9c7dfada52d2b6746f054d6205840bb3f1d8da7978e8e7bdab32dd785e`;
- `purge.json` SHA-256
  `3fb15f8bee9135e4459b82f69df04f1df2b0fb7933b83ea6dee8f876a66c65f1`;
- `readback.json` SHA-256
  `7716f07a95ac9aad488cc7fbe3602328599f9afd78b4769dafeaab7e0b1ed59e`.

The preflight plan has 154 exact SELECT checks. The apply plan has 308 ordered
operations: 77 ledger INSERTs and 77 exact-preimage JSON UPDATEs, each
immediately followed by a `changes()=1` assertion. They must be submitted as
one D1 transactional batch; one stale row or conflict raises an SQL error and
rolls back all 77 entries. The rollback plan similarly has 154 operations and
requires a new approval. Purge/readback plans contain exactly 77 URLs/checks.

Independent audits passed with P1=0 and P2=0, including a local transactional
proof that a stale preimage leaves zero ledger rows. All script tests passed
87/87. Manifest construction and plan generation made zero provider requests.
No D1 migration/write, deploy, token/secret/credential change, R2 mutation,
cache purge, restart, feature enablement, Drive write, LINE send, or PR merge
occurred.

## Packet B2 — exact D1 migrations 071/072, approved and completed

This packet authorizes only the two additive private-media schema migrations
and their two checksum-ledger rows. It does not authorize the 77-row manifest
backfill, a credential issue/rotation, deploy, gate change, purge, accounting
feature enablement, Drive write, or LINE send. Approval expires exactly two
hours after KEN's explicit approval.

```text
Approval ID: 5229-B2-20260901
Mode: CF-D1-EXACT-MIGRATIONS-071-072-ONLY
Issues/PR: #5229 / #5230 / Draft PR #5244
Approval lifetime: exactly two hours after KEN's explicit approval

Immutable anchors:
- Accounting PR head: ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- Accounting implementation: 63635fa00a992301daa8422d9401c6479de13246
- Harness implementation: 07c4f27a5694ed50fe07bb09c48f28820d7c4833
- M0 receipt parent: d846e1d5a1e580cc39a74d9db5cafb3d52c7ab22
- A0-R4 sanitized-summary SHA-256:
  d6c6394e606ce60282d5a0c3442c534704208d2af5b3eed4f23b0119e3bc24fd
- migration 071 SHA-256:
  c65203ce28e750b6cf612ad17029bc195fd2e6253a379cf62e642e3c5a8ae5d6
- migration 072 SHA-256:
  be4b1730fadd497d0a0d9677bda8626d174aaa08946d1c27e9e68e1549049937
- exact executor SHA-256:
  3cafd12fc29f39a95ecf105bb9cf37b5368754a6d51e6a4e13e5f18b19e8357b
- executor test SHA-256:
  558ca6ab9205c9a05b7bf72edb13a9ec1ceca85bf4d7a03fe51ce525d3966d83

Exact provider target:
- Cloudflare account: 67907592fdf596376bc2097e14a6563a
- D1 database: line-harness / c19584d7-e9f1-4d46-83c5-6c0ba96561d1
- endpoint: POST /client/v4/accounts/67907592fdf596376bc2097e14a6563a/
  d1/database/c19584d7-e9f1-4d46-83c5-6c0ba96561d1/query

Required final local preflight before provider access:
- recheck both worktree heads, exact executor/test/migration hashes, source
  modes, and that M0 artifacts remain unchanged
- focused executor tests and all script tests pass; standalone TypeScript pass
- invoke `pnpm exec tsx scripts/d1-migrations-5229.ts --preflight-only`
- result exactly: approval_id=5229-B2-20260901,
  status=preflight_passed, migration_count=2, token_present=true,
  provider_requests=0, provider_writes=0, local_writes=0
- `/Users/kensmba/.line-harness-5229-B2-20260901` remains absent

Approved write request — exactly one transactional D1 batch:
1. assert `_line_harness_migrations`, `incoming_media`,
   `idx_incoming_media_status_updated`,
   `incoming_media_service_credentials`, and
   `idx_incoming_media_service_credentials_account_active` are all absent
2. create the exact `_line_harness_migrations` checksum ledger
3. assert both exact migration ledger names are absent
4. execute the exact 071 CREATE TABLE then CREATE INDEX as separate statements
5. assert both 071 schema objects exist
6. insert exactly one 071 `sha256:<hash>` ledger row and assert changes()=1
7. execute the exact 072 CREATE TABLE then CREATE INDEX as separate statements
8. assert both 072 schema objects exist
9. insert exactly one 072 `sha256:<hash>` ledger row and assert changes()=1

The request body contains 13 ordered batch statements. Every absence/schema/
change assertion raises an SQL error on mismatch. Cloudflare D1 batch is
transactional; any statement failure aborts and rolls back the entire sequence.
Do not split, resume, retry, or run either migration separately.

Required immediate readback — exactly one read-only D1 batch:
- exactly four new sqlite_master objects with normalized SQL equal to the two
  hash-bound migration files
- exactly two checksum-ledger rows with their `sha256:<hash>` values
- exact ordered columns/defaults/PK flags for both tables
- exact line_accounts foreign keys and ON DELETE CASCADE
- exact explicit/automatic index sets and exact index column orders
- ten readback statements total; every mismatch is STOP

Transport and evidence limits:
- direct node:https POST only; Authorization, Content-Type,
  Accept-Encoding: identity, and Content-Length application headers only;
  agent=false, no redirect, no retry
- response body ceiling 65,536 bytes with one-byte sentinel
- provider request maximum=2: one transactional write batch and one read-only
  readback batch; provider write batches=1, retry=0
- recheck the active half-open approval interval before the first request,
  between requests, and after readback; abort in-flight requests at expiry
- create only `/Users/kensmba/.line-harness-5229-B2-20260901` mode 0700
  and exactly one mode-0600 sanitized-summary.json
- receipt may contain only approval/timestamps, migration names/checksums,
  sanitized schema/ledger readback, request counts, and cf-ray values; never
  token/header/error body/customer identifiers

STOP before provider access on any head/hash/source/token/output/preflight
drift. STOP with no retry on the first provider/response/assertion/readback/
expiry/evidence discrepancy. A failed transactional batch rolls back itself.
After a successful commit, the additive tables and ledger rows remain; no
automatic DROP is authorized.

Writes/actions not authorized: manifest backfill INSERT/UPDATE, credential
insert/revoke, deploy, Worker setting or secret change, R2 HEAD/GET/LIST/write/
delete, cache purge, restart, feature enablement, Drive write, LINE send, PR
merge. All have expected count zero.
```

### B2 execution receipt — COMPLETED

KEN approved the exact packet `5229-B2-20260901` at
`2026-09-01T16:57:09Z`, bound to Harness head
`2570670d7b17de76b9e48f01f4ae8e04381a3e43` and packet SHA-256
`c6ecb62753b2e7c180f75411a6b03bad577f20ed545e62b4851fc73bc4062c67`.
The half-open approval interval ended at `2026-09-01T18:57:09Z`.

Before provider access, both worktrees were clean at their approved heads, all
immutable hashes matched, the focused executor suite passed 6/6, the complete
script suite passed 93/93, and the exact local preflight returned
`status=preflight_passed` with provider/local write counts zero. The execution
started at `2026-09-01T16:57:34.778Z` and completed at
`2026-09-01T16:57:35.396Z`.

Exactly one transactional D1 write batch installed migrations 071 and 072 and
their two checksum-ledger rows. Exactly one immediate read-only D1 batch then
verified:

- tables `incoming_media` and `incoming_media_service_credentials`;
- indexes `idx_incoming_media_status_updated` and
  `idx_incoming_media_service_credentials_account_active`;
- normalized schema, columns, defaults, primary keys, foreign keys, CHECKs,
  index order, and both exact `sha256:<hash>` ledger values.

Provider request counts were exactly 2 D1 query POSTs: 1 transactional write
batch and 1 readback batch. Retry count was zero. The protected evidence
directory `/Users/kensmba/.line-harness-5229-B2-20260901` is mode 0700 and
contains exactly one non-symlink mode-0600 `sanitized-summary.json`, SHA-256
`5f393930c545582d656c0068ee1d854a01ef8d60e66e1d04e4dca49a0beda95f`.

An independent read-only receipt audit passed with P1=0 and P2=0. It confirmed
the exact head, approval interval, source/packet/receipt/ledger checksum
agreement, schema/value whitelist, evidence permissions, request counts, and
absence of credential or customer identifiers. It made no provider request and
created no artifact.

Deploy, manifest backfill, R2 access or mutation, secret/token/credential
change, cache purge, restart, feature enablement, Drive write, LINE send, and
PR merge all remained zero. The additive schema is retained; no rollback or
DROP was authorized or attempted.

## Packet B1 — exact v0.19 code-only Worker deploy, awaiting KEN approval

This packet authorizes one immediate Worker code change and the bounded reads
needed to prove that the active version changed while configuration and the
legacy public bridge did not. It deliberately uses Cloudflare's dedicated
script-content endpoint rather than the full Worker upload endpoint. Cloudflare
documents this endpoint as putting script content without touching config or
metadata; therefore the request does not reconstruct or resend bindings,
assets, compatibility settings, routes, or secrets.

Official authorities retrieved 2026-09-02:

- `https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/update/`
- `https://developers.cloudflare.com/changelog/post/2025-09-03-new-workers-api/`
- `https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/`
- `https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/`

```text
Approval ID: 5229-B1-20260902
Mode: CF-WORKER-EXACT-CODE-CONTENT-IMMEDIATE-DEPLOY
Issues/PR: #5229 / #5230 / Draft PR #5244
Approval lifetime: exactly two hours after KEN's explicit approval

Immutable source and artifact anchors:
- Accounting PR head:
  ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- Accounting implementation:
  63635fa00a992301daa8422d9401c6479de13246
- Harness planning parent:
  534ec2c980a01c7c09738cfdc9d9b236c351783e
- v0.19 backport source head:
  9f3c6c3ac98d0777f8e7354f807a6af4ab642b18
- exact executor SHA-256:
  d2d053b3cf472ba068d2381f63daa6175d9dd584901922ab4ce50b8c6c1da195
- executor test SHA-256:
  f21c9e30119d00a7ee184ca674f301d596c68a00855758bc5dec462950d5dcbd
- exact single-file artifact:
  /Users/kensmba/.line-harness-5229-B1-BUILD-20260902/
  apps/worker/dist-release-final/index.js
- artifact mode/bytes/SHA-256:
  0600 / 1,350,194 /
  1355c7bdffc73dd20bc082fd439a1750fd8b7d5831291c1635cd71396c946de4
- target runtime version:
  0.19.0-5229.b1.9f3c6c3
- target embedded Worker hash:
  sha256:6420c520444baa670973197f6c336b23a511e9dcd8fdbdf24082b61ce24c2b1e
- unchanged Admin hash:
  sha256:43e9888fa37af2db1ecdd2f135029ddb570279ebf07373b47d6cb5e62a25ac6c
- unchanged LIFF hash:
  sha256:350e651bacbede38ea9f197d0ae6e29903c5b3b219daccf4c62566310cc7ce17
- protected manifest SHA-256:
  cf35a1045040a265019a5afad8c2cefb8994edba684eeaa5dd2fad0b17b1663e
- completed B2 receipt SHA-256:
  5f393930c545582d656c0068ee1d854a01ef8d60e66e1d04e4dca49a0beda95f

Exact production target and expected before-state:
- Cloudflare account: 67907592fdf596376bc2097e14a6563a
- Worker script: line-harness
- Worker origin: https://line-harness.family8office.workers.dev
- latest active deployment:
  7b3bb319-e618-4f57-a520-cd33f43115e5
- single 100%-traffic active version:
  c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7
- compatibility date/flags: 2024-12-01 / [nodejs_compat]
- binding shape: exactly the 20 name/type pairs fixed by A0-R4; it includes
  DB, IMAGES, ASSETS, and the eight secret-name bindings, and does not include
  INCOMING_MEDIA_PUBLIC_BLOCK_ENABLED
- script workers.dev subdomain enabled=true
- migration ledger contains exact 071/072 names and sha256 checksums from B2
- pre-deploy /admin/version has the pinned Admin/LIFF hashes and is not already
  the target B1 version

Required final local preflight before any provider request:
- planning and backport worktrees are clean at the approved exact heads
- the executor itself obtains and compares the approved Harness head passed on
  the execution command, the exact v0.19 backport and Accounting heads, all
  three clean worktree states, executor/test modes, test hash, and B2 receipt
  entry set/modes/hash before it reads the artifact, token, or provider
- executor/test, artifact, manifest, and B2 receipt hashes/modes match
- focused executor tests 9/9, canonical `pnpm test:scripts` 102/102, strict standalone
  TypeScript check, and git diff check pass
- invoke exactly:
  pnpm exec tsx scripts/worker-b1-deploy-5229.ts
    --preflight-only
    --approved-harness-head <exact commit in KEN approval>
- result exactly includes status=preflight_passed,
  artifact_sha256=1355c7bd..., artifact_bytes=1350194,
  planning_head=<approved exact Harness head>, token_present=true,
  provider_requests=0, provider_writes=0, local_writes=0
- /Users/kensmba/.line-harness-5229-B1-20260902 remains absent

Approved pre-write reads, in exact order:
1. GET Worker deployments; require the exact prior deployment/version and one
   100% version
2. GET Worker settings; require exact compatibility and 20-binding name/type
   shape with the public-block gate absent; retain a canonical in-memory digest
3. GET Worker subdomain; require enabled=true; retain canonical digest
4. GET Worker schedules; retain canonical digest
5. GET the direct Worker /admin/version; require old version and pinned
   Admin/LIFF hashes
6. one D1 read-only query POST for the exact 071/072 ledger name/checksum rows

Approved mutation — exactly one request:
- PUT /client/v4/accounts/67907592fdf596376bc2097e14a6563a/
  workers/scripts/line-harness/content
- multipart metadata part is exactly {"main_module":"worker.js"}
- worker.js part name and filename are exactly worker.js, Content-Type is
  application/javascript+module, and bytes are the exact artifact above
- metadata contains no bindings, assets, keep_assets, keep_bindings,
  compatibility, migrations, settings, annotations, routes, or secrets
- Cloudflare immediately creates and activates a new version; there is no
  separate deploy request and no preview/canary stage
- approved execution command is exactly:
  pnpm exec tsx scripts/worker-b1-deploy-5229.ts
    --approval-received <exact ISO-8601 approval instant>
    --approval-expires <exact instant plus two hours>
    --approved-harness-head <exact commit in KEN approval>

Required immediate readback:
1. repeat deployments/settings/subdomain/schedules in the same order
2. require new deployment and version IDs, single 100% traffic, exact canonical
   settings/subdomain/schedules digests unchanged, exact binding shape
   unchanged, and public-block gate still absent
3. poll direct /admin/version at most 12 times, two seconds apart; require the
   exact target version/Worker hash and unchanged Admin/LIFF hashes
4. one unauthenticated HEAD to a fixed non-customer private-route probe must
   return 401 with an empty body
5. one HEAD to the first exact legacy image path derived only in memory from
   the protected 77-row manifest must return 200 with an empty body; its path,
   identifiers, and headers are never printed or written

Transport and request ceilings:
- direct node:https only, agent=false, no redirect and no automatic retry
- Cloudflare read maximum=9: eight management GETs plus one D1 read-only POST
- Worker content PUT exactly=1
- direct runtime reads minimum/maximum=4/15: pre-version 1, post-version polls
  1..12, private HEAD 1, legacy HEAD 1
- provider total minimum/maximum=14/25; retry=0; concurrent request maximum=1
- JSON response ceilings are 262,144 bytes for Worker management, 65,536 for
  D1, 8,192 for version, and 1,024 for each HEAD response
- active half-open approval interval is checked before every request and after
  all readback; in-flight requests abort at expiry

Evidence and STOP behavior:
- exclusively create one mode-0700 directory:
  /Users/kensmba/.line-harness-5229-B1-20260902
- write exactly one mode-0600 sanitized-summary.json on completion or STOP
- receipt may contain only approval/timestamps, artifact/version hashes,
  deployment/version IDs, canonical config digests, binding count, gate enum,
  status-only runtime probes, request counts, sanitized cf-ray values, and
  forbidden-action counters
- never retain token/header values, settings bodies, binding values, manifest
  identifiers, image path/body, D1 response bodies, or error bodies
- STOP before PUT on any head/hash/mode/token/output/prior-deployment/config/
  migration/runtime drift
- STOP after PUT on the first deployment/config/runtime/probe/expiry/evidence
  mismatch. Record rollback_required=true but do not roll back automatically.

Rollback boundary and maintenance impact:
- this is an immediate live code switch and may expose a brief global
  propagation interval; it does not restart the Worker or create planned
  downtime
- rollback requires a new exact approval that deploys prior version
  c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7 at 100%, then reads the new rollback
  deployment; force=true and automatic rollback are forbidden
- this packet does not authorize that rollback

Writes/actions explicitly forbidden and expected zero:
- full Worker upload, separate deployment POST, binding/secret/settings/assets/
  routes/schedules/domain change, D1 write/backfill, credential issue/revoke,
  R2 HEAD/GET/LIST/write/delete, cache purge, restart, gate change, feature
  enablement, Drive write, LINE send, PR merge, and rollback
```

The exact Harness commit containing this packet and executor must be included
in KEN's approval message. Any changed commit, source/artifact/packet digest,
prior deployment/version, request ceiling, or approval interval invalidates the
approval. B1 establishes only the deployed private-media code and negative
authorization behavior; it does not create a service credential or backfill
the 77 historical rows, so authenticated 200 private-media readback remains a
later packet.

### B1 execution receipt — STOP before mutation

KEN approved `5229-B1-20260902` for Harness
`90da72f145d8f7cdb293fcfcb087aae55720b62c` and packet SHA-256
`284471fdf5f003583d61cf8c306fcaf8c13a1d02f4a63ae85e56ec1acaafbcbb`.
The approval was recorded at `2026-09-02T22:51:43Z` and expires at
`2026-09-03T00:51:43Z`.

All local exact-head/hash/mode/clean-state checks passed. Focused tests passed
9/9, canonical script tests passed 102/102, strict standalone TypeScript and
diff checks passed, and the zero-write executor preflight returned the exact
approved artifact hash, byte count, and Harness head.

Execution then stopped at `pre_version_drift` after the four pre-write
Cloudflare metadata GETs and one public runtime `/admin/version` GET. The
deployed version's public build identity did not equal the packet's assumed
unchanged Admin/LIFF identity. The receipt deliberately does not say which
public field differed, so no value is inferred from this STOP.

```text
Status: STOP before mutation
Started/completed UTC:
  2026-09-02T22:52:14.194Z / 2026-09-02T22:52:15.565Z
Cloudflare metadata reads: 4
Runtime version reads: 1
Worker content PUT: 0
Provider total / retry: 5 / 0
Rollback required/performed: false / false
```

The owner-only evidence directory
`/Users/kensmba/.line-harness-5229-B1-20260902` is mode 0700 and contains
exactly one mode-0600 `sanitized-summary.json`, SHA-256
`af2e06bbcf1358d5128836cb5729b0b49e8a2eaa1a9cbcd54e08ca2f0361751b`.
It is retained unchanged. No deploy, D1 write/backfill, credential/secret
change, R2 operation, purge, restart, feature enablement, Drive write, LINE
send, PR merge, or rollback occurred. This approval is consumed and must not
be retried.

## Packet B1-D0 — one public runtime version read, completed below

This diagnostic packet resolves only the public build-identity field that
caused B1 to stop. It does not use a Cloudflare token or read settings,
bindings, D1, R2, customer identifiers, image paths, or content. Its result is
needed to stamp a truthful code-only B1-R1 artifact whose Admin/LIFF hashes
describe the assets that will actually remain deployed.

```text
Approval ID: 5229-B1-D0-20260903
Mode: PUBLIC-WORKER-VERSION-READ-ONLY
Issues/PR: #5229 / #5230 / Draft PR #5244
Approval lifetime: exactly two hours after KEN's explicit approval

Immutable anchors:
- Harness source/result parent:
  90da72f145d8f7cdb293fcfcb087aae55720b62c
- original B1 packet SHA-256:
  284471fdf5f003583d61cf8c306fcaf8c13a1d02f4a63ae85e56ec1acaafbcbb
- B1 STOP receipt SHA-256:
  af2e06bbcf1358d5128836cb5729b0b49e8a2eaa1a9cbcd54e08ca2f0361751b
- exact origin/path:
  https://line-harness.family8office.workers.dev/admin/version

Allowed request:
- exactly one unauthenticated HTTPS GET to the exact origin/path above
- headers explicitly set by the command: Accept: application/json and
  Accept-Encoding: identity; no Authorization, Cookie, conditional, or Range
  header
- TLS only, redirects=0, retry=0, connect timeout=10 seconds,
  total timeout=20 seconds, accepted body maximum=8,192 bytes
- require HTTP 200 and JSON object with exactly the five string fields:
  version, worker_hash, admin_hash, liff_hash, released_at
- version must be a nonempty printable version, all three hashes must match
  sha256:[0-9a-f]{64}, and released_at must parse as an ISO-8601 instant

Required sanitized output:
- the five public build fields above, request count=1, retry=0, and timestamp
- no response headers, request headers, cookies, token, settings, binding,
  D1/R2 value, customer identifier, image URL, or body beyond those fields
- no local evidence directory or file is created by this packet

STOP with no second request on timeout, redirect, non-200, body overflow,
invalid content type/encoding/JSON/schema/hash/time, or changed exact origin.
Writes/actions authorized: 0. Deploy, migration/backfill, credential/secret/
token change, R2 access, purge, restart, feature enablement, Drive write, LINE
send, PR merge, and rollback are forbidden.
```

After D0, build a new isolated B1-R1 artifact with its Admin/LIFF identity set
to the observed production values, repeat the deterministic two-build and
offline test/audit gates, and create a separately hash-bound B1-R1 deploy
packet. D0 itself never authorizes a deploy or reuse of the consumed B1 packet.

### B1-D0 execution receipt — COMPLETED read, legacy identity remains unknown

KEN approved `5229-B1-D0-20260903` for Harness
`f4f5ae28a1f4b6615b9cb2383803fb0cbb16c88e` and packet SHA-256
`963cbdecbb383e973f922c01dbcdbe85bcdeda1e4ea468e625e54971049e733e`.
The approval was recorded at `2026-09-02T23:19:05Z` and expires at
`2026-09-03T01:19:05Z`.

The exact unauthenticated GET began at `2026-09-02T23:20:22.512Z` and
completed at `2026-09-02T23:20:22.626Z`. It returned HTTP 200 with the exact
five-field JSON shape and passed the packet's type, format, size, encoding,
and timestamp checks. Request count was 1, retry was 0, and writes were 0.

```text
version: 0.0.0-dev
worker_hash: sha256:0000000000000000000000000000000000000000000000000000000000000000
admin_hash:  sha256:0000000000000000000000000000000000000000000000000000000000000000
liff_hash:   sha256:0000000000000000000000000000000000000000000000000000000000000000
released_at: 1970-01-01T00:00:00Z
```

These values are the repository's legacy source-build sentinels, not measured
Admin/LIFF asset hashes. The public endpoint returns embedded Worker constants;
it does not hash the currently served asset trees. D0 therefore completed its
approved request but did **not** establish production asset byte identity.
No local evidence file was created, as required by the approved packet. No
deploy, migration/backfill, credential/secret/token change, R2 access, Pages
asset access, purge, restart, feature enablement, Drive write, LINE send, PR
merge, or rollback occurred. B1-R1 is not yet authorized.

## Packet B1-D1 — exact asset-topology read-only attestation, awaiting KEN approval

This is a new approval boundary, not a D0 retry and not a B1 deploy approval.
It records only immutable/provider asset-topology identifiers needed to redesign
B1-R1 without presenting the legacy zero sentinels as asset-integrity hashes.
The request set follows Cloudflare's documented read-only Worker deployment,
version-detail, settings, and Pages project APIs. It deliberately does not
download Worker code or any Pages/Worker asset bytes.

```text
Approval ID: 5229-B1-D1-20260903
Mode: CF-WORKER-AND-PAGES-ASSET-TOPOLOGY-READ-ONLY
Issues/PR: #5229 / #5230 / Draft PR #5244
Approval lifetime: exactly two hours after KEN's explicit approval

Immutable anchors:
- Harness D0 execution/result parent:
  f4f5ae28a1f4b6615b9cb2383803fb0cbb16c88e
- D0 packet SHA-256:
  963cbdecbb383e973f922c01dbcdbe85bcdeda1e4ea468e625e54971049e733e
- B1 STOP receipt SHA-256:
  af2e06bbcf1358d5128836cb5729b0b49e8a2eaa1a9cbcd54e08ca2f0361751b
- v0.19 backport head:
  9f3c6c3ac98d0777f8e7354f807a6af4ab642b18
- Accounting PR head:
  ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- exact executor:
  scripts/worker-b1-d1-asset-topology-5229.ts
- executor SHA-256:
  9772920f12468b485edfab91286ed099b5da00b839df73b35bb94ec5c00a1dfb
- exact test:
  scripts/worker-b1-d1-asset-topology-5229.test.ts
- test SHA-256:
  5239776bafe52ace4f48cb80104ddf7953086aec04929645f9f0ef85a0fea8a6

Exact production target and required initial state:
- Cloudflare account: 67907592fdf596376bc2097e14a6563a
- Worker script: line-harness
- active deployment:
  7b3bb319-e618-4f57-a520-cd33f43115e5
- sole 100%-traffic active version:
  c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7
- existing local token file only; no token creation, permission change,
  replacement, rotation, or output is permitted

Required zero-provider preflight:
- planning, backport, and Accounting worktrees are clean at the approved exact
  heads before the token or provider is read
- the executor itself requires executor/test to be regular non-symlink
  mode-0644 files after the exact-head/clean-state checks and before token read;
  the offline preflight commands separately verify their exact hashes above
- focused tests pass 5/5, strict standalone TypeScript passes, canonical
  script tests pass, and git diff check passes
- invoke exactly:
  pnpm exec tsx scripts/worker-b1-d1-asset-topology-5229.ts
    --preflight-only
    --approved-harness-head <exact commit in KEN approval>
- require status=preflight_passed, token_present=true, and provider requests,
  provider writes, local writes all equal 0
- /Users/kensmba/.line-harness-5229-B1-D1-20260903 remains absent

Approved HTTPS GETs, in exact order, redirect=0 and retry=0:
1. Worker deployments; require the exact active deployment/version above and
   exactly one version at 100%
2. exact active Worker version detail; retain only the script etag, the
   canonical SHA-256 of the `ASSETS` binding object, and whether that object
   exposes any resource-identity field beyond name/type
3. Worker settings; read in memory only the exact `ADMIN_PAGES_PROJECT`,
   `LIFF_PAGES_PROJECT`, and `ASSETS` bindings; require exact types and safe
   project-name grammar
4. Admin Pages project derived from the exact settings binding; retain only a
   SHA-256 of the project name and its canonical production deployment ID
5. only if `LIFF_PAGES_PROJECT` is nonempty, the corresponding LIFF Pages
   project; retain the same two fields; otherwise record topology=worker_assets
6. repeat Worker deployments and require byte-equivalent sanitized active
   deployment/version identity to the first read

Transport and request ceilings:
- direct node:https to api.cloudflare.com only, TLS port 443, agent=false,
  Authorization: Bearer from the protected local token file,
  Accept: application/json, Accept-Encoding: identity
- status must be 200, content type application/json, content encoding absent or
  identity, each body at most 262,144 bytes, connect/total timeout at most 20s
- Cloudflare GET total is exactly 5 when LIFF topology is Worker Assets or
  exactly 6 when LIFF uses Pages; all other request counts are invalid
- no automatic retry, redirect, pagination, alternate endpoint, or fallback

Sanitized local evidence:
- create exclusively one mode-0700 directory:
  /Users/kensmba/.line-harness-5229-B1-D1-20260903
- create exclusively one mode-0600 regular non-symlink file:
  sanitized-summary.json
- retain only approval times/head, active deployment/version, script etag,
  ASSETS binding digests/identity-availability boolean, LIFF topology, hashed
  project names, canonical Pages deployment IDs, timestamps, request counts,
  and zero-valued forbidden-action counters
- never retain or print token/header, raw provider body, raw settings/version
  resource, project name/URL/domain/alias, build config, environment value,
  binding text, secret, customer identifier, image path, or asset content

STOP with no further request and no retry on any head/clean-state/mode/hash/
approval/token/status/type/encoding/schema/ID/topology/permission/size/time
failure, unexpected LIFF state, or active deployment drift. A partial discovery
does not authorize an inferred topology. A failed run creates no sanitized
success receipt and cannot be retried under the consumed approval.

Writes/actions authorized: 0. Worker content GET, Pages/Worker asset GET,
deploy, migration/backfill, credential/secret/token change, R2 operation,
purge, restart, feature enablement, Drive write, LINE send, PR merge, and
rollback are forbidden.
```

After a completed D1, B1-R1 may be rebuilt with Admin/LIFF fields explicitly
classified as inherited `legacy_unknown` sentinels, not byte hashes. Its
separate deploy packet must pin the exact Worker resource and Pages deployment
identities before and after the code-only PUT, preserve the full settings
digest, and keep every non-code action forbidden. D1 itself never authorizes
that artifact build to be deployed.

### B1-D1 execution receipt — COMPLETED

KEN approved `5229-B1-D1-20260903` for Harness
`e6be695c073cb90959ea6056699c9620d45d45eb` and packet SHA-256
`970508f8516ccd3d69ce10904c513bbfcb5f3fe1f9cd35cf424d4512a4435ffd`.
The approval was recorded at `2026-09-03T03:12:43Z` and expires at
`2026-09-03T05:12:43Z`.

The zero-provider preflight passed, including exact heads, clean worktrees,
file modes, protected token presence, and absent output path. The approved
read began at `2026-09-03T03:13:00.070Z` and completed at
`2026-09-03T03:13:01.427Z`.

```text
Status: completed
Stable active Worker deployment/version:
  7b3bb319-e618-4f57-a520-cd33f43115e5 /
  c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7
Worker script etag:
  1d9a88703ce2509f372740c140aa18699884b779a82108efdd863484555611b6
Version/settings ASSETS binding digest:
  8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6 /
  8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6
ASSETS resource identity beyond name/type: absent
LIFF topology: worker_assets; LIFF Pages project: absent
Admin project-name SHA-256:
  492123998ae432be97e93235fce10a2d5d118fd9eb8be802edd46ae8345ca9a2
Admin canonical Pages deployment:
  301a632d-dc9a-4655-8368-2d77f8db3b21
Cloudflare GET/provider total/retry/write: 5/5/0/0
```

The mode-0700 directory
`/Users/kensmba/.line-harness-5229-B1-D1-20260903` contains exactly one
mode-0600 `sanitized-summary.json`, SHA-256
`c2e294eae170d8a3f3b1592a43232b0c1ce2538f605464e7da3d057d44bebbd2`.
It contains no token, header, raw provider body, project name/URL, settings
value, customer identifier, or asset content. No Worker content or asset was
read. No deploy, migration/backfill, credential/secret/token change, R2
operation, purge, restart, feature enablement, Drive write, LINE send, PR
merge, or rollback occurred. This approval is consumed and is not reusable.

## Packet B1-D2 — stable full-config hash discovery, consumed STOP

This is a new read-only approval boundary required by the final B1 security
audit. D1 established asset/Page topology but intentionally did not retain the
full Worker settings, subdomain, or schedules digests. D2 reads the same six
resources twice, requires byte-equivalent canonical snapshots, and retains
only hashes and already-approved resource IDs. It performs no provider write.

```text
Approval ID: 5229-B1-D2-20260903
Mode: CF-WORKER-STABLE-FULL-CONFIG-HASH-READ-ONLY
Issues/PR: #5229 / #5230 / Draft PR #5244
Approval lifetime: exactly two hours after KEN's explicit approval

Immutable anchors:
- parent Harness head:
  881d237873d9aa6ea90a61e60dde8f2f29c707b9
- completed D1 receipt SHA-256:
  c2e294eae170d8a3f3b1592a43232b0c1ce2538f605464e7da3d057d44bebbd2
- active deployment/version:
  7b3bb319-e618-4f57-a520-cd33f43115e5 /
  c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7
- script etag:
  1d9a88703ce2509f372740c140aa18699884b779a82108efdd863484555611b6
- settings/version ASSETS binding SHA-256:
  8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6
- Admin project-name SHA-256/canonical deployment:
  492123998ae432be97e93235fce10a2d5d118fd9eb8be802edd46ae8345ca9a2 /
  301a632d-dc9a-4655-8368-2d77f8db3b21
- exact 20-binding shape, compatibility 2024-12-01/[nodejs_compat],
  subdomain `{enabled:true,previews_enabled:false}`, and cron expressions
  `* * * * *` plus `0 */6 * * *`
- v0.19 backport/Accounting heads:
  9f3c6c3ac98d0777f8e7354f807a6af4ab642b18 /
  ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f

Exact collector/test:
- scripts/worker-b1-d2-config-anchor-5229.ts
- scripts/worker-b1-d2-config-anchor-5229.test.ts
- collector SHA-256:
  5f3a157390d33556ba747335c006a4695c0456aac0b92fdaeb541ff3ced3ba3d
- test SHA-256:
  7bf6f7a9af27635b7417196ef406ef00a256cb0f9b5d4092dd85108e08e933f9

Required zero-provider preflight:
- planning/backport/Accounting worktrees are clean at the approved exact heads
- collector/test are regular mode-0644 files in the clean approved commit
- completed D1 receipt directory is mode 0700 with exactly one regular
  mode-0600 `sanitized-summary.json`, and its SHA-256 matches the immutable
  anchor above before token access or any provider request
- focused D2 tests 10/10, related B1 tests 32/32, canonical script tests
  130/130, strict standalone TypeScript, and git diff check pass
- output path `/Users/kensmba/.line-harness-5229-B1-D2-20260903` is absent
- invoke exactly:
  pnpm exec tsx scripts/worker-b1-d2-config-anchor-5229.ts \
    --preflight-only \
    --approved-harness-head <exact commit in KEN approval>
- require status=preflight_passed, planning_head=<approved exact Harness head>,
  token_present=true, and provider requests/writes/local writes all 0

Approved reads, exact order repeated twice:
1. GET Worker deployments
2. GET complete Worker settings
3. GET exact active Worker version detail
4. GET exact Admin Pages project derived in memory from settings
5. GET Worker subdomain
6. GET Worker schedules

Read validation and sanitized evidence:
- each pass must match all immutable IDs/topology/semantics above; the complete
  canonical first and second snapshots must be identical
- direct node:https, TLS 443, agent=false, redirect=0, retry=0, serial only;
  status 200, JSON content type, identity/absent content encoding, body maximum
  262,144 bytes, and the half-open approval interval checked before and after
  every response including transport completion
- provider request total exactly 12 GETs; provider writes exactly 0
- create only `/Users/kensmba/.line-harness-5229-B1-D2-20260903` mode 0700
  containing only mode-0600 `sanitized-summary.json`
- retain only approval/head/timestamps, stable-snapshot count, approved IDs,
  script etag, canonical settings/subdomain/schedules/binding hashes,
  ASSETS topology hashes, Admin name hash/deployment ID, and request counts
- never retain or print token/header, raw response/settings/binding values,
  project name/URL, secret/customer/image value, or error/response body
- exact execution command:
  pnpm exec tsx scripts/worker-b1-d2-config-anchor-5229.ts \
    --approval-received <exact approval instant> \
    --approval-expires <exact instant plus two hours> \
    --approved-harness-head <exact commit in KEN approval>
- STOP immediately without retry on any mismatch; a STOP may write only the
  same sanitized one-file receipt and does not authorize reuse of the approval

Writes/actions explicitly forbidden and expected zero:
- Worker/Pages/D1/R2 write, Worker or asset content GET, deploy, migration,
  backfill, credential/token/secret change, purge, restart, gate/feature
  enablement, Drive write, LINE send, PR merge, and rollback
```

The exact committed Harness head and SHA-256 of this packet file must appear in
KEN's approval. D2 authorizes only the 12 configuration GETs and sanitized
local receipt. It does not authorize B1-R1 deployment.

### B1-D2 execution result — STOP, approval consumed

KEN approved exact Harness head
`8d2bde586d0a881ec738e824b47bdf3bbd09e8cd` and packet SHA-256
`f15d4120e21f9b3e75446498fea5fd9e191f916700f67cebe9528ce9813db2ad`.
The explicit approval event occurred at `2026-09-03T05:22:00.990Z`. The
executor receipt recorded `2026-09-03T05:22:30Z` as its conservative local
window start and `2026-09-03T07:22:30Z` as its end. This shifted the declared
end 29.010 seconds later than the real approval window, but the actual provider
access ran from `2026-09-03T05:22:44.691Z` through
`2026-09-03T05:22:46.346Z`, safely inside both windows. Future packets must use
the actual approval event instant without substitution.

The approved zero-provider preflight passed. The execution then completed the
first six-resource GET sequence and stopped with `subdomain_drift` before the
second snapshot. Receipt SHA-256:
`253cebe9939a54852cbd104a74bf5523f6b3182f841e7f7e098986592abdd0a6`.

```text
status: stopped
stop_reason: subdomain_drift
stable_snapshot_count: 0
Cloudflare GET/provider total: 6/6
retry/redirect/provider write: 0/0/0
local write: one sanitized STOP receipt
```

The receipt directory is mode 0700 with exactly one regular mode-0600 file.
Two independent receipt audits found no unauthorized provider action or secret
leakage; one audit recorded the approval-timestamp discrepancy above as P2.
This approval is consumed and cannot be reused. No deploy, migration/backfill,
credential/token/secret change, R2 operation, purge, restart, feature
enablement, Drive write, LINE send, PR merge, or rollback occurred.

## Packet B1-D3 — exact subdomain-state discovery, awaiting KEN approval

D2 proved that the current script-level subdomain response differs from the
previously assumed `{enabled:true,previews_enabled:false}` state, but its
sanitized STOP receipt intentionally retained no response value. D3 discovers
only the two non-secret booleans from the one mismatched resource. It does not
replace the required successful full-config D2-R1 readback.

The response contract is the current Cloudflare `GET Worker subdomain` schema:
`https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/get/`.

```text
Approval ID: 5229-B1-D3-20260903
Mode: CF-WORKER-SUBDOMAIN-STATE-READ-ONLY
Issues/PR: #5229 / #5230 / Draft PR #5244
Approval lifetime: exactly two hours from the actual KEN approval event instant

Immutable anchors:
- parent Harness head:
  8d2bde586d0a881ec738e824b47bdf3bbd09e8cd
- consumed D2 STOP receipt SHA-256:
  253cebe9939a54852cbd104a74bf5523f6b3182f841e7f7e098986592abdd0a6
- v0.19 backport/Accounting heads:
  9f3c6c3ac98d0777f8e7354f807a6af4ab642b18 /
  ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f

Exact collector/test:
- scripts/worker-b1-d3-subdomain-anchor-5229.ts
- scripts/worker-b1-d3-subdomain-anchor-5229.test.ts
- collector SHA-256:
  ca94588bbe28bc401fdd296a4821238458531fe730d0a6b3f58308fd2140b09b
- test SHA-256:
  677a78459c8be776f0d0426ec29a153df109e11daa136fb8b991e8956183d3d4

Required zero-provider preflight, only after the new approval:
- planning/backport/Accounting worktrees are clean at the approved exact heads
- collector/test are regular mode-0644 files in the clean approved commit
- consumed D2 receipt directory is mode 0700 with exactly one regular
  mode-0600 `sanitized-summary.json`; its SHA-256 and STOP/count fields match
  the immutable anchor above before token access or provider request
- focused D3 tests 13/13, related B1 tests 45/45, canonical script tests
  143/143, strict standalone TypeScript, and git diff check pass
- output path `/Users/kensmba/.line-harness-5229-B1-D3-20260903` is absent
- invoke exactly:
  pnpm exec tsx scripts/worker-b1-d3-subdomain-anchor-5229.ts \
    --preflight-only \
    --approved-harness-head <exact commit in KEN approval>
- require status=preflight_passed, planning_head=<approved exact Harness head>,
  token_present=true, and provider requests/writes/local writes all 0

Approved reads, exact serial order:
1. GET the exact script-level Worker subdomain endpoint
2. GET the identical endpoint again

Read validation and sanitized evidence:
- accept no predetermined boolean values; require only an exact result object
  with own keys `enabled` and `previews_enabled`, both boolean
- require the two canonical responses to be identical
- direct node:https, TLS 443, agent=false, body absent, redirect=0, retry=0;
  status 200, JSON content type, identity/absent content encoding, body maximum
  4,096 bytes, and the half-open approval interval checked before and after
  every response including transport completion
- provider request total exactly 2 GETs; provider writes exactly 0
- create only `/Users/kensmba/.line-harness-5229-B1-D3-20260903` mode 0700
  containing only mode-0600 `sanitized-summary.json`
- retain only approval/head/timestamps, stable-snapshot count, the two boolean
  values, their canonical SHA-256, and request counts
- never retain or print token/header, raw response/envelope, account subdomain,
  URL, customer/image value, provider error/body, or CF-Ray
- exact execution command must use the actual approval event instant and its
  exact plus-two-hour expiry:
  pnpm exec tsx scripts/worker-b1-d3-subdomain-anchor-5229.ts \
    --approval-received <actual KEN approval event ISO-8601 instant> \
    --approval-expires <that exact instant plus two hours> \
    --approved-harness-head <exact commit in KEN approval>
- STOP immediately without retry on any mismatch; a STOP may write only the
  same sanitized one-file receipt and cannot reuse the approval

Writes/actions explicitly forbidden and expected zero:
- Worker/Pages/D1/R2 write, Worker or asset content GET, deploy, migration,
  backfill, credential/token/secret change, purge, restart, gate/feature
  enablement, Drive write, LINE send, PR merge, and rollback
```

The exact committed Harness head and SHA-256 of this packet file must appear in
KEN's approval. D3 authorizes only two script-subdomain configuration GETs and
one sanitized receipt. After D3, a separate D2-R1 packet must pin the discovered
state and complete the full six-resource double snapshot before B1-R1 can be
approved.

### B1-D3 execution result — completed, approval consumed

KEN's blanket continuation approval event occurred at
`2026-09-03T05:51:46.737Z`; its exact two-hour boundary is
`2026-09-03T07:51:46.737Z`. The zero-provider preflight passed, then the two
approved serial GETs completed from `2026-09-03T05:52:45.001Z` through
`2026-09-03T05:52:45.661Z`.

```text
status: completed
stable_snapshot_count: 2
subdomain: enabled=true, previews_enabled=true
canonical SHA-256:
  81d85b2e35295c30a89a15cfce655824db618966f23be5b068d6f55c545429f3
Cloudflare GET/provider total: 2/2
retry/redirect/provider write: 0/0/0
local write: one sanitized receipt
receipt SHA-256:
  554d9f725bd251ecceb96ff383e81c83706f489e2bb0b2d164ad2bed6169385f
```

The receipt directory is mode 0700 with exactly one regular mode-0600 file.
An independent audit found P0=0, P1=0, and P2=0. No deploy,
migration/backfill, credential/token/secret change, R2 operation, purge,
restart, feature enablement, Drive write, LINE send, PR merge, or rollback
occurred. This approval is consumed and cannot be reused.

## Packet B1-D2-R1 — corrected stable full-config hash discovery

D2-R1 repeats D2's complete six-resource double snapshot with the discovered
script subdomain state fixed to `enabled=true,previews_enabled=true`. It first
pins the completed D3 receipt and performs no provider write.

```text
Approval ID: 5229-B1-D2-R1-20260903
Mode: CF-WORKER-STABLE-FULL-CONFIG-HASH-READ-ONLY-R1
Issues/PR: #5229 / #5230 / Draft PR #5244
Approval lifetime: within the blanket approval's half-open interval
  [2026-09-03T05:51:46.737Z, 2026-09-03T07:51:46.737Z)

Immutable anchors:
- parent Harness head:
  fdc2aa2913719658b495a1461e69929631efea95
- completed D3 receipt SHA-256:
  554d9f725bd251ecceb96ff383e81c83706f489e2bb0b2d164ad2bed6169385f
- subdomain canonical SHA-256 and value:
  81d85b2e35295c30a89a15cfce655824db618966f23be5b068d6f55c545429f3 /
  {enabled:true,previews_enabled:true}
- active deployment/version:
  7b3bb319-e618-4f57-a520-cd33f43115e5 /
  c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7
- script etag:
  1d9a88703ce2509f372740c140aa18699884b779a82108efdd863484555611b6
- settings/version ASSETS binding SHA-256:
  8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6
- Admin project-name SHA-256/canonical deployment:
  492123998ae432be97e93235fce10a2d5d118fd9eb8be802edd46ae8345ca9a2 /
  301a632d-dc9a-4655-8368-2d77f8db3b21
- exact 20-binding shape, compatibility 2024-12-01/[nodejs_compat], and cron
  expressions `* * * * *` plus `0 */6 * * *`
- v0.19 backport/Accounting heads:
  9f3c6c3ac98d0777f8e7354f807a6af4ab642b18 /
  ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f

Exact collector/test and shared snapshot validator:
- scripts/worker-b1-d2-config-anchor-5229.ts
- scripts/worker-b1-d2-config-anchor-5229.test.ts
- scripts/worker-b1-deploy-5229.ts
- scripts/worker-b1-deploy-5229.test.ts
- collector SHA-256:
  26f0082b31a5086c36d856b199ec22cc61b932a4dccf4a62a1c6bad016f597c9
- collector test SHA-256:
  0373f56645e94981ad4fed58a6367dfbe73335cf6f73141a4b7b1679d817198b
- shared validator SHA-256:
  9a6113ac1d89204cc1fd999490c3642a41eef30d8e4064c2787be1a29bbfab52
- shared validator test SHA-256:
  95f5f848b6bf50d6f927d11e369873ddd761f859412f478062e3802b5f4bb986

Required zero-provider preflight:
- planning/backport/Accounting worktrees are clean at the approved exact heads
- D3 receipt is the sole mode-0600 file in its mode-0700 directory and matches
  its SHA, completed state, true/true booleans/hash, and exact request counts
  before token access or provider request
- collector/test/shared validator files are regular mode-0644 files
- focused D2-R1 tests 10/10, related B1 tests 45/45, canonical script tests
  143/143, strict standalone TypeScript, and git diff check pass
- output path `/Users/kensmba/.line-harness-5229-B1-D2-R1-20260903` is absent
- invoke exactly:
  pnpm exec tsx scripts/worker-b1-d2-config-anchor-5229.ts \
    --preflight-only \
    --approved-harness-head <exact committed Harness head>
- require status=preflight_passed, planning_head=<exact committed Harness head>,
  token_present=true, and provider requests/writes/local writes all 0

Approved reads, exact order repeated twice:
1. GET Worker deployments
2. GET complete Worker settings
3. GET exact active Worker version detail
4. GET exact Admin Pages project derived in memory from settings
5. GET Worker subdomain
6. GET Worker schedules

Read validation and sanitized evidence:
- each pass must match every immutable identity, topology, and semantic anchor
  above; the complete canonical snapshots must be identical
- direct node:https, TLS 443, agent=false, redirect=0, retry=0, serial only;
  status 200, JSON content type, identity/absent content encoding, body maximum
  262,144 bytes, and the blanket approval interval checked before and after
  every response including transport completion
- provider request total exactly 12 GETs; provider writes exactly 0
- create only `/Users/kensmba/.line-harness-5229-B1-D2-R1-20260903` mode 0700
  containing only mode-0600 `sanitized-summary.json`
- retain only approval/head/timestamps, stable-snapshot count, approved IDs,
  script etag, canonical settings/subdomain/schedules/binding hashes, ASSETS
  topology hashes, Admin name hash/deployment ID, and request counts
- never retain or print token/header, raw response/settings/binding values,
  project name/URL, secret/customer/image value, or error/response body
- exact execution command:
  pnpm exec tsx scripts/worker-b1-d2-config-anchor-5229.ts \
    --approval-received 2026-09-03T05:51:46.737Z \
    --approval-expires 2026-09-03T07:51:46.737Z \
    --approved-harness-head <exact committed Harness head>
- STOP immediately without retry on any mismatch; a STOP may write only the
  same sanitized one-file receipt and cannot reuse this approval

Writes/actions explicitly forbidden and expected zero:
- Worker/Pages/D1/R2 write, Worker or asset content GET, deploy, migration,
  backfill, credential/token/secret change, purge, restart, gate/feature
  enablement, Drive write, LINE send, PR merge, and rollback
```

D2-R1 remains a read-only gate. A completed receipt is required before any
B1-R1 content PUT. Its exact committed head and packet SHA are recorded before
execution under KEN's blanket continuation approval.

### B1-D2-R1 execution result — completed, approval consumed

The zero-provider preflight passed at exact Harness head
`eddaec06c191a0b5ae207ac1e3f0b71de78be502` and packet SHA-256
`58525f27eaad9022a0b139764a8d33e0b76e68ac9669a25a24a18d88eaa218dd`.
The approved twelve GETs ran from `2026-09-03T05:58:16.134Z` through
`2026-09-03T05:58:19.091Z` inside the blanket approval interval.

```text
status/stable_snapshot_count: completed / 2
active deployment/version:
  7b3bb319-e618-4f57-a520-cd33f43115e5 /
  c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7
script etag:
  1d9a88703ce2509f372740c140aa18699884b779a82108efdd863484555611b6
settings SHA-256:
  107835eb17613fa3789f34a913ced66be79b9dc48fa8666276bf2feed9a51abc
subdomain SHA-256:
  81d85b2e35295c30a89a15cfce655824db618966f23be5b068d6f55c545429f3
schedules SHA-256:
  ba94fb8a9b24fb239e7de571c5b281dd302cc139821d28fa7f12721ef2cd1849
binding shape SHA-256/count:
  cdc3ac05d11170d7d795274d4a873576358eeaf86737e0b78931c81b59dc19a4 / 20
Cloudflare GET/provider total: 12/12
retry/redirect/provider write: 0/0/0
receipt SHA-256:
  f3ca1426f0c3ca19175699bf1af685b4b315e1a4eb29d04c296ed2e791bbb5c2
```

The receipt directory is mode 0700 with exactly one regular mode-0600 file.
Two independent audits found P0=0, P1=0, and P2=0. No deploy,
migration/backfill, credential/token/secret change, R2 operation, purge,
restart, feature enablement, Drive write, LINE send, PR merge, or rollback
occurred. This read-only approval is consumed and cannot be reused.

## Packet B1-R1 — exact code-only Worker deploy, ready under blanket approval

This supersedes the consumed B1 packet. Completed B1-D3 and D2-R1 receipts now
fix the actual subdomain state and exact full settings/subdomain/schedules
hashes in the executor and this packet. It deploys
only the private incoming media Worker code while explicitly preserving the legacy environment's unknown
Admin/LIFF identity sentinels. The sentinels are not asset byte hashes. Asset
continuity is instead enforced using the exact Worker settings, ASSETS binding
digests, and Admin Pages canonical deployment discovered by D1 before and after
the code-only PUT.

Cloudflare's content endpoint contract is code-only and does not change config
or metadata. Pages and Worker asset content endpoints are not called by this
packet.

```text
Approval ID: 5229-B1-R1-20260903
Mode: CF-WORKER-EXACT-CODE-CONTENT-IMMEDIATE-DEPLOY-WITH-ASSET-CONTINUITY
Issues/PR: #5229 / #5230 / Draft PR #5244
Approval lifetime: within the blanket approval's half-open interval
  [2026-09-03T05:51:46.737Z, 2026-09-03T07:51:46.737Z)

Immutable source/evidence anchors:
- D1 planning/execution head:
  e6be695c073cb90959ea6056699c9620d45d45eb
- D1 packet SHA-256:
  970508f8516ccd3d69ce10904c513bbfcb5f3fe1f9cd35cf424d4512a4435ffd
- D1 receipt SHA-256:
  c2e294eae170d8a3f3b1592a43232b0c1ce2538f605464e7da3d057d44bebbd2
- completed D2-R1 receipt SHA-256:
  f3ca1426f0c3ca19175699bf1af685b4b315e1a4eb29d04c296ed2e791bbb5c2
- B1 STOP receipt SHA-256:
  af2e06bbcf1358d5128836cb5729b0b49e8a2eaa1a9cbcd54e08ca2f0361751b
- completed B2 receipt SHA-256:
  5f393930c545582d656c0068ee1d854a01ef8d60e66e1d04e4dca49a0beda95f
- v0.19 backport source head:
  9f3c6c3ac98d0777f8e7354f807a6af4ab642b18
- Accounting PR head:
  ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- original protected B1 artifact SHA-256:
  1355c7bdffc73dd20bc082fd439a1750fd8b7d5831291c1635cd71396c946de4

Deterministic local artifact derivation:
- builder/test:
  scripts/worker-b1-r1-artifact-5229.ts
  scripts/worker-b1-r1-artifact-5229.test.ts
- builder SHA-256:
  c5d5f9dba49f8b03afeea1f6b43d07a8d26da22615c7d5e37c6b60187139fa2b
- builder test SHA-256:
  fe2e3a658105cedcdc499aaac1940dbdbe459fc5c9b48b003bb1feefe5853cfd
- source is the exact protected B1 artifact; each original Admin/LIFF hash must
  occur once and the legacy-unknown sentinel must be absent
- replace only those two equal-length embedded fields with the exact D0
  sentinel, generate twice independently, require byte equality, and retain
  the source artifact unchanged
- exact final artifact:
  /Users/kensmba/.line-harness-5229-B1-R1-BUILD-20260903/
  apps/worker/dist-release-final/index.js
- directory/file mode, bytes, SHA-256:
  0700/0600 / 1,350,194 /
  07dcc5ef5504bf2ae70286fad2d356444beb7626f6d64faa920ea7b3c33b19c1
- byte differences from original: 121; target version and Worker hash markers
  remain exact and occur once; legacy-unknown sentinel occurs exactly twice

Target runtime identity:
- version: 0.19.0-5229.b1.9f3c6c3
- embedded Worker first-pass hash:
  sha256:6420c520444baa670973197f6c336b23a511e9dcd8fdbdf24082b61ce24c2b1e
- Admin identity: legacy_unknown sentinel
- LIFF identity: legacy_unknown sentinel
- both sentinel fields:
  sha256:0000000000000000000000000000000000000000000000000000000000000000

Exact executor/test:
- scripts/worker-b1-deploy-5229.ts
- scripts/worker-b1-deploy-5229.test.ts
- executor SHA-256:
  85fdd3f1a7a34ab466e4c1105abd20e9d37af7fc23e6ebfca3bf62183534d690
- executor test SHA-256:
  24ac11b6129b092a0652c75d009fbe63558c1eb55650badf7146b5f585b761f1

Exact production target and required before-state:
- account/script/origin:
  67907592fdf596376bc2097e14a6563a / line-harness /
  https://line-harness.family8office.workers.dev
- active deployment/version:
  7b3bb319-e618-4f57-a520-cd33f43115e5 /
  c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7 at 100%
- script etag:
  1d9a88703ce2509f372740c140aa18699884b779a82108efdd863484555611b6
- settings and version ASSETS binding digest:
  8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6
- ASSETS extra resource identity: absent; LIFF topology: worker_assets
- Admin project-name hash/canonical Pages deployment:
  492123998ae432be97e93235fce10a2d5d118fd9eb8be802edd46ae8345ca9a2 /
  301a632d-dc9a-4655-8368-2d77f8db3b21
- exact 20-binding shape, compatibility date/flags
  2024-12-01/[nodejs_compat], subdomain exactly
  `{enabled:true,previews_enabled:true}`, cron expressions exactly
  `* * * * *` and `0 */6 * * *`
- exact full configuration anchors from D2-R1:
  - settings: `107835eb17613fa3789f34a913ced66be79b9dc48fa8666276bf2feed9a51abc`
  - subdomain: `81d85b2e35295c30a89a15cfce655824db618966f23be5b068d6f55c545429f3`
  - schedules: `ba94fb8a9b24fb239e7de571c5b281dd302cc139821d28fa7f12721ef2cd1849`
  - binding shape: `cdc3ac05d11170d7d795274d4a873576358eeaf86737e0b78931c81b59dc19a4`
  All four must match before PUT and remain unchanged after PUT.
- migration ledger contains exact 071/072 names/checksums from B2
- public /admin/version is the exact D0 unstamped sentinel state and is not
  already the target version

Required final local preflight before any provider request:
- planning/backport/Accounting worktrees clean at approved exact heads
- executor/test/builder/test and artifact have the exact hashes/modes above
- protected manifest, B2 receipt, D1 receipt, and D2-R1 receipt have exact entry sets,
  modes, hashes, and required sanitized fields
- focused B1-R1 tests 22/22, related B1 tests 47/47, canonical script tests
  145/145, strict standalone
  TypeScript, artifact/source diff invariants, and git diff check pass
- output path `/Users/kensmba/.line-harness-5229-B1-R1-20260903` is absent
- invoke exactly:
  pnpm exec tsx scripts/worker-b1-deploy-5229.ts \
    --preflight-only \
    --approved-harness-head <exact commit in KEN approval>
- require status=preflight_passed, exact artifact hash/bytes,
  planning_head=<approved exact Harness head>, token_present=true, and provider
  requests/writes/local writes all 0

Approved pre-write reads, in exact order:
1. GET Worker deployments; require exact prior deployment/version and one 100%
2. GET Worker settings; require full config plus exact topology/binding state
3. GET exact active Worker version detail; require prior script etag and exact
   ASSETS binding digest with no extra resource identity
4. GET exact Admin Pages project derived only in memory from settings; require
   hashed project name and canonical deployment ID above
5. GET Worker subdomain; require exactly enabled=true and previews_enabled=true
6. GET Worker schedules; require exactly the two approved cron expressions
   `* * * * *` and `0 */6 * * *` (provider timestamps may be present)
7. GET direct Worker /admin/version; require exact D0 legacy sentinel state
8. one D1 read-only query POST; require exact 071/072 ledger rows/checksums
9. repeat the complete six-resource snapshot immediately before PUT and require
   byte-equivalent canonical state to reads 1-6; any concurrent deployment,
   settings, asset topology, Admin Page, subdomain, or schedule drift stops
   before mutation

Approved mutation — exactly one request:
- PUT /client/v4/accounts/67907592fdf596376bc2097e14a6563a/
  workers/scripts/line-harness/content
- exact multipart metadata is {"main_module":"worker.js"}; the only code part
  is worker.js with the exact artifact bytes and
  Content-Type=application/javascript+module
- no binding, asset, keep_assets, keep_bindings, compatibility, migration,
  annotation, route, schedule, or secret metadata
- this immediately creates/activates one new version; no separate deploy POST
- exact command:
  pnpm exec tsx scripts/worker-b1-deploy-5229.ts \
    --approval-received 2026-09-03T05:51:46.737Z \
    --approval-expires 2026-09-03T07:51:46.737Z \
    --approved-harness-head <exact committed Harness head>

Required immediate readback:
1. repeat deployments/settings/new-version-detail/Admin Pages/subdomain/
   schedules in the same order
2. require new deployment/version, unchanged complete settings/subdomain/
   schedules digests and binding shape, unchanged ASSETS digests/topology,
   unchanged Admin Pages canonical deployment, prior script etag exact, and
   new script etag different from prior
3. poll direct /admin/version at most 12 times, two seconds apart; require exact
   target version/Worker hash and both legacy_unknown sentinels
4. unauthenticated private-route HEAD returns 401 with empty body
5. repeat Worker deployments after all runtime readback; require the same new
   deployment/version observed in readback 1 before writing a success receipt

Transport/request ceilings:
- serial direct node:https only, agent=false, redirect=0, retry=0; each request
  begins and completes inside the half-open two-hour approval interval and an
  in-flight request aborts at expiry
- Cloudflare read maximum=20: nineteen management GETs plus one D1 read-only POST
- Worker content PUT exactly=1
- runtime reads minimum/maximum=3/14; total provider requests=24..35
- response ceilings remain 262,144 bytes management, 65,536 D1, 8,192
  version, 1,024 each HEAD
- Cloudflare documents no compare-and-swap predecessor condition for this
  content update. The executor therefore minimizes but cannot eliminate the
  interval between the final pre-PUT deployment GET and PUT; any competing
  deployment observed by post-readback or the terminal deployment GET is a
  STOP with rollback_required=true, never an automatic rollback

Evidence/STOP/rollback:
- create exactly one mode-0700 output directory with one mode-0600 sanitized
  summary on completion or STOP
- receipt may retain only approved hashes/digests/IDs/status/count fields and
  cf-ray values; never token/header, project name/URL, settings/body, image
  path/identifier, or customer value
- STOP before PUT on any anchor/artifact/receipt/token/prior-state/migration/
  sentinel/topology/config drift
- STOP after PUT on first deployment/config/asset/Page/runtime/probe/expiry
  mismatch; record rollback_required=true and do not automatically roll back
- STOP evidence distinguishes PUT not_attempted, outcome unknown, and provider
  accepted, and records the stage at which execution stopped
- rollback requires a separate exact approval for prior version
  c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7; this packet does not authorize it

Writes/actions explicitly forbidden and expected zero:
- full Worker/config upload, version upload/deploy POST, binding/secret/settings/
  asset endpoint/route/schedule/domain/Pages change, D1 write/backfill, credential issue/
  revoke, R2 operation, Worker/Pages asset content GET, purge, restart, gate or
  feature enablement, Drive write, LINE send, PR merge, and rollback
```

The exact committed Harness head and SHA-256 of this packet file must appear in
KEN's approval. Any changed head, code/test/artifact/receipt/packet hash,
prior resource identity, request ceiling, or approval window invalidates the
approval. B1-R1 still does not authorize credential issuance, historical
backfill, authenticated private-media 200 readback, customer notification, or
feature enablement.

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

## 5229-B1-R1-20260903 accepted PUT and post-write STOP

The code-only content PUT was accepted exactly once during the blanket approval
interval `[2026-09-03T05:51:46.737Z, 2026-09-03T07:51:46.737Z)`. The executor
then stopped fail-closed at `settingsSha256_changed`; it did not roll back.

- sanitized receipt:
  `/Users/kensmba/.line-harness-5229-B1-R1-20260903/sanitized-summary.json`
- receipt SHA-256:
  `a3f5e2c411f5b8656427f363549d5ed0952da3937a1c47e47185ea78faa3f785`
- prior deployment/version:
  `7b3bb319-e618-4f57-a520-cd33f43115e5` /
  `c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7`
- observed accepted deployment/version:
  `89b40fb5-bfc8-48b1-a7b1-b8f3538bccf7` /
  `5dab4e03-2147-4c34-b5c7-f70c105b4712`
- observed new script etag:
  `41cc0b7544b0466426c08b7b2544c8b161ae4817925803605d68760f85659f1c`
- requests: Cloudflare reads 19; content PUT 1; runtime read 1; total 21;
  retry 0

The receipt's `rollback_required=true` means that a separate decision is
required after a post-write STOP. It is not an authorization or instruction to
roll back. A raw settings-response digest change alone is not classified as a
security or configuration regression.

## Packet 5229-B1-V1-20260903 — bounded post-deploy read-only decision

```text
Approval ID: 5229-B1-V1-20260903
Approval source: KEN blanket continuation approval recorded at
  2026-09-03T05:51:46.737Z
Approval interval: [2026-09-03T05:51:46.737Z,
  2026-09-03T07:51:46.737Z)
Mode: POST-DEPLOY-READ-ONLY-DECISION
Issues/PR: #5229 / #5230 / Draft PR #5244

Immutable anchors:
- Harness parent head before this packet: 90d518576749bd63f39ba6876132f6091fe6aedd
- Accounting head: ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- v0.19 backport head: 9f3c6c3ac98d0777f8e7354f807a6af4ab642b18
- B1 STOP receipt SHA-256:
  a3f5e2c411f5b8656427f363549d5ed0952da3937a1c47e47185ea78faa3f785
- executor SHA-256:
  4557814b81d1da548f4ee1a4d5d9f4429144791e38acbfc304a0fbe0747b933a
- executor test SHA-256:
  e6f58d5202c4d389f7461e4ae51e311aa9cc2cb36e54053aaeac566964be6275
- prior deployment/version/etag:
  7b3bb319-e618-4f57-a520-cd33f43115e5 /
  c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7 /
  1d9a88703ce2509f372740c140aa18699884b779a82108efdd863484555611b6
- current deployment/version/etag:
  89b40fb5-bfc8-48b1-a7b1-b8f3538bccf7 /
  5dab4e03-2147-4c34-b5c7-f70c105b4712 /
  41cc0b7544b0466426c08b7b2544c8b161ae4817925803605d68760f85659f1c

Exact serial read plan, no redirect/transport retry/fallback:
1. Cloudflare GET deployments; require current deployment/version at 100%.
2. Cloudflare GET current settings; revalidate compatibility and exact binding
   shape/topology without retaining values.
3. Cloudflare GET immutable current version detail.
4. Cloudflare GET the pinned Admin Pages project; revalidate its deployment.
5. Cloudflare GET subdomain; require the pinned enabled=true and
   previews_enabled=true state.
6. Cloudflare GET schedules; require the exact pinned cron set.
7. Cloudflare GET immutable prior version detail.
8. Direct Worker GET /admin/version; one second GET is allowed only if the
   first identity is not the exact target.
9. Direct Worker unauthenticated HEAD to the fixed non-customer private probe;
   require 401 and empty body.
10. Direct Worker HEAD to the first manifest-derived frozen legacy public path;
    require 200, empty body, and exact manifest MIME type. The path is used
    only in memory and never stored.
11. Cloudflare GET deployments; require byte-equivalent active identity to step 1.

Request ceilings:
- Cloudflare management GET: exactly 8
- direct Worker reads: 3, or 4 only for the one conditional version re-read
- provider total: 11..12
- provider writes, transport retry, redirect, fallback: 0
- management/version body ceiling: 262,144 bytes
- runtime version body ceiling: 8,192 bytes
- HEAD body ceiling: 1,024 bytes
- concurrency maximum: 1

Semantic comparison:
- compare every field and value under old/new version resources in memory
- sort only the binding array by exact name/type
- allow differences only at version audit fields $.id, $.number, $.metadata,
  $.annotations and script fields $.resources.script.etag and
  $.resources.script.last_deployed_from
- require the exact 20 binding names/types; compare resource IDs and plain-text
  values without writing or printing them; secret bindings are compared only as
  returned by the provider and are never retained
- separately retain only equality booleans and SHA-256 digests for full
  comparable resources, full bindings, script runtime, and handler topology

Candidate, STOP, and rollback boundary:
- emit an accept candidate only when both deployment reads are the exact current 100% deployment,
  current settings/Pages/subdomain/schedules match every pinned anchor, all
  comparable version resources are equal, target runtime identity is exact,
  private HEAD is 401/empty, and legacy HEAD is 200/empty with exact MIME
- classify the evidence as bounded_current_config_anchors_and_version_resources_equal;
  do not claim that every unretained raw settings field was proven unchanged
- active-deployment mismatch is external_drift and must not be overwritten
- resource/runtime/private/legacy mismatch is inconclusive because a terminal
  deployment read has not yet proved the active deployment stayed fixed; this
  packet never performs rollback
- provider/auth/timeout/expiry/shape ambiguity is inconclusive; do not infer
  either acceptance or rollback

Evidence:
- create exactly one mode-0700 directory:
  /Users/kensmba/.line-harness-5229-B1-V1-20260903
- write exactly one mode-0600 sanitized-summary.json on completion or STOP
- never retain token/header values, raw provider bodies, binding values,
  customer identifiers, legacy path, or response bodies

Writes/actions explicitly forbidden and expected zero:
- Worker deploy/rollback, D1/R2 mutation, credential issue/revoke, secret or
  binding change, route/schedule/domain/Pages change, purge, restart, feature
  enablement, Drive write, LINE send, and PR merge
```

The exact committed Harness head containing this packet and both V1 files is
the execution head under the blanket continuation approval. Any head/hash/
receipt/resource/interval drift invalidates execution and stops before provider
access. A rollback, if indicated, remains a new exact write packet.

### 5229-B1-V1-20260903 execution receipt — COMPLETED

The bounded read-only decision completed at Harness head
`fb2d6bb8e32b32bca9e3b9bff29d62acc53d39ee` inside the fixed blanket
approval interval.

- receipt:
  `/Users/kensmba/.line-harness-5229-B1-V1-20260903/sanitized-summary.json`
- receipt SHA-256:
  `5e3dcbf0a5ae7b5e883788cfa7ce87f9bb411fa1935d885ae2bb10a2f769d3a6`
- Cloudflare GET/runtime reads/provider writes: `8/3/0`
- active deployment/version remained
  `89b40fb5-bfc8-48b1-a7b1-b8f3538bccf7` /
  `5dab4e03-2147-4c34-b5c7-f70c105b4712` at 100% through the terminal read
- old/new comparable version resources and full binding values were equal;
  exact binding count was 20
- target runtime identity matched on the first read
- unauthenticated private HEAD was 401/empty
- manifest-derived legacy public HEAD was 200/empty with exact MIME
- disposition: `accept_candidate_no_rollback`; automatic rollback: 0

Independent receipt audit passed with P0/P1/P2 all zero. For continuation under
KEN's blanket approval, B1 is treated as operationally accepted on the combined
basis of Cloudflare's content-only update contract, the pinned current
configuration anchors, equal immutable version resources, exact runtime build,
both authorization/compatibility probes, and terminal deployment stability.
This decision does not assert that every unretained field in the raw settings
response was independently reconstructed. Subsequent packets must continue to
fail closed on any live drift.

## Packet 5229-B0-20260903 — issue one account-bound read credential

```text
Approval ID: 5229-B0-20260903
Approval source/interval: KEN blanket continuation approval,
  [2026-09-03T05:51:46.737Z, 2026-09-03T07:51:46.737Z)
Mode: ONE-ROW-D1-CREDENTIAL-ISSUE

Immutable anchors:
- B1-V1 source head: fb2d6bb8e32b32bca9e3b9bff29d62acc53d39ee
- Accounting deploy worktree/head:
  /Users/kensmba/scripts-wt/5230-line-recovery-deploy /
  ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f
- executor SHA-256:
  8e2e6a838ca39a6c8301bc6d3cdda8ec99765f9e10713742c849700ca1d86d80
- executor test SHA-256:
  d1f7fa80f4df264e7880b767197a8b1fdf83f1b709786662742d27472778abfd
- protected 77-row manifest SHA-256:
  cf35a1045040a265019a5afad8c2cefb8994edba684eeaa5dd2fad0b17b1663e
- B2/B1/V1 receipt SHA-256 values are pinned by the executor
- offline credential directory is exactly mode 0700 with apply.sql,
  credential.env, and manifest.json exactly mode 0600
- credential id: a6f8d1124f07d9ab81d0aa3b8ee080fb
- scope: incoming_media_read
- not-before/expires-at:
  2026-09-03T06:30:00.000Z / 2026-12-02T06:30:00.000Z
- the exact account is derived from the protected manifest and never retained
  in the execution receipt

Exact provider operations:
1. one D1 transactional query batch containing one prerequisite assertion,
   one parameterized INSERT, and one changes()=1 assertion
2. one D1 read-only query batch requiring exactly one row with the exact
   credential id, account, scope, token digest, active window, creation time,
   and revoked_at IS NULL

Ceilings and STOP:
- D1 POST total exactly 2; write batches exactly 1; inserted rows exactly 1
- direct HTTPS, serial, agent=false, no redirect or retry
- stop before provider access on any head/worktree/receipt/manifest/artifact/
  mode/hash/approval drift
- stop after write on any response/readback/expiry mismatch; do not retry,
  revoke, or delete automatically
- every success or STOP receipt records mutation_stage, mutation_outcome
  (not_attempted, unknown, or accepted), and reconciliation_required; a
  request/response ambiguity is unknown, while an accepted INSERT without
  exact readback remains accepted but requires reconciliation

Evidence:
- output /Users/kensmba/.line-harness-5229-B0-20260903 mode 0700
- exactly one sanitized-summary.json mode 0600
- receipt may retain credential id, scope, active window, revoked boolean,
  account_match boolean, counts, timestamps, and pinned receipt hashes
- never retain or print LINE account ID, plaintext credential, token digest,
  Authorization header, SQL parameters, or provider response body

Explicitly forbidden and expected zero:
- accounting secret installation/restart/feature enable, credential revoke,
  Worker deploy/settings/gate, backfill, R2 operation, purge, Drive write,
  LINE send, and PR merge
```

The final clean Harness commit containing this packet and the B0 executor/tests
is the approved execution head under the blanket continuation approval. Any
drift stops before provider access.

## Packet 5229-B3-20260903 — atomic 77-row D1 backfill

```text
Approval source/interval: KEN blanket continuation approval,
  [2026-09-03T05:51:46.737Z, 2026-09-03T07:51:46.737Z)
Executor/test SHA-256:
  a8851c310e2ace5f41ad949a6db7f94717578e20706af4e13db9958d493b2044 /
  88108bcf5fcd08b67d8598524324ef731b9b68c80e7c32e4bd9c1db914c7b397
Inputs: exact B1 artifact and B1/V1/B2 receipts; M0 manifest N=77,
  E=0, B=27,625,839; exact preflight/apply/rollback/purge/readback PLAN files.

Provider sequence, serial and no retry:
1. one read-only D1 batch containing the exact 154 preflight operations;
   require every expected row count
2. one unsplittable transactional D1 batch containing all exact 308 apply
   operations: 77 ledger inserts, 77 exact-preimage messages_log rewrites, and
   154 adjacent changes() assertions
3. one read-only D1 batch containing the exact 154 readback operations;
   require every expected row count and digest

Ceilings: D1 POST exactly 3; provider write batches exactly 1; ledger inserts
77; messages_log rewrites 77; R2/Worker/deploy/gate/purge/credential/LINE/Drive
operations 0. Any drift or assertion failure is STOP. Never split, retry,
resume, auto-rollback, or delete evidence.

Evidence: /Users/kensmba/.line-harness-5229-B3-20260903 mode 0700 with exactly
one sanitized-summary.json mode 0600. Retain only hashes/counts/timestamps and
mutation outcome; never row identifiers, URLs, JSON content, account/message/
sender IDs, SQL parameters, or provider bodies.
```

## Packet 5229-B3-R1-20260903 — complete private functional readback

```text
Approval source/interval: KEN blanket continuation approval,
  [2026-09-03T05:51:46.737Z, 2026-09-03T07:51:46.737Z)
Executor/test SHA-256:
  ed0d5a0d788d99c57db183f0e8d001831738a619da1cba8811635d9b38abe26b /
  a9078432e5aea5ccd074a94ffb793f88cfc413afe8bc5264db6b3a642011efba
Prerequisites: exact B0 and B3 completed receipts plus protected credential,
manifest, PLAN, B1/V1/B2 evidence, and final clean Harness/accounting heads.
The operator must pass both exact completed receipt SHA-256 values on the
command line; preflight and execution validate their mode, hash, approval/head,
semantic outcome, counts, and credential identity before provider access.

Exact reads:
- one D1 read-only SELECT batch proving 77 exact ledger rows and 77 rewritten
  messages_log rows
- four fixed authorization probes: anonymous=401, invalid credential=401,
  correct credential with cross-account=404, unrelated route denied
- for each of 77 exact manifest entries, one account-bound authenticated HEAD
  and one authenticated GET; require 200, private/no-store, exact MIME/length/
  SHA-256 and image magic; identifiers and bytes remain memory-only

Ceilings: D1 POST 1 + Worker reads 158 = provider reads 159; provider writes,
direct R2, retry, redirect, fallback, gate, purge, Drive, LINE 0. All requests
are serial and approval-bound. Any mismatch is STOP; no retry or rollback.

Evidence: /Users/kensmba/.line-harness-5229-B3-R1-20260903 mode 0700 with
exactly one sanitized-summary.json mode 0600. Retain aggregate counts/digests
and status matrix only; never token/token digest, account/message/key/path/URL,
customer image bytes, header values, SQL params, or provider bodies.
```

The final clean Harness commit containing both B3 packets and four files is the
approved execution head. B3-R1 cannot preflight or execute until B0 and B3
completed receipts exist and match their exact pinned states.

## Packet 5229-B4-20260903 — public compatibility gate safety STOP

```text
Approval source/interval: KEN blanket continuation approval,
  [2026-09-03T05:51:46.737Z, 2026-09-03T07:51:46.737Z)
Executor/test SHA-256:
  1b2f94e15d3f0db554776d702f2fa26eacf9d731671e7efaf1f681f18e72b656 /
  cc990af967e2a34b4d5d3fc72566409a3b18975c6b81bfd921a30c61b0bb5474
Mode: STOP-NO-PROVIDER-TRANSPORT

Decision:
- Cloudflare settings PATCH requires a complete binding disposition; the
  settings endpoint does not provide a strict fail-on-unresolved inheritance
  guarantee equivalent to version upload
- therefore preservation of all 20 live bindings cannot be proved under this
  packet's zero-loss/no-automatic-rollback constraints
- the executor intentionally contains no provider transport and cannot change
  the public compatibility gate

Evidence:
- validate the exact clean Harness/accounting heads, the B1/V1/B2/manifest
  anchors, and protected artifact modes/hashes locally
- write one mode-0600 sanitized STOP receipt below one mode-0700 directory
- record provider requests/writes, deploys, gate changes, purges, Drive writes,
  and LINE sends as zero

Disposition:
- STOP; do not use settings PATCH
- a later gate closure must use a separately reviewed code-only deployment or
  another mechanism that proves complete binding preservation
```

B5 is not a zone-cache purge. The 77 legacy URLs are workers.dev URLs and the
Worker does not use the Workers Cache API. A zone purge would not purge Workers
Cache and cannot revoke copies already held by browsers or LINE. After a safe
B4 implementation, B5 is replaced by a zero-write cache attestation: require
cache settings absent/false, all exact 77 legacy HEAD probes 404, and no
CF-Cache-Status HIT/STALE/UPDATING. If cache is enabled, STOP without fallback.

## 2026-09-03 blanket continuation execution receipts

All operations below ran at Harness head
`51e5e505b0c2e83426506144bb3fc6afa1c525d0` inside the fixed blanket interval.

- B0 credential issue: completed; one D1 write batch, one inserted account-bound
  credential, exact readback, no retry, no reconciliation required. Receipt
  `/Users/kensmba/.line-harness-5229-B0-20260903/sanitized-summary.json`, SHA-256
  `a85d62c7f68b4c901612481c985ac735260373efa98e19d547579fb04ef9e32b`.
- B3 backfill: completed; all 154 preflight assertions, 77 ledger inserts, 77
  message URL rewrites, and all 154 post-write assertions passed in one
  transactional write batch with no retry or rollback requirement. Receipt
  `/Users/kensmba/.line-harness-5229-B3-20260903/sanitized-summary.json`, SHA-256
  `098b0ded9bf20d16d40d5e1108c6571f2e75e24179a0fae29f7b80c27e76c660`.
- B3-R1 functional readback: completed; D1 exact count 77, authenticated HEAD
  77, GET 77, content SHA-256 match 77, JPEG magic match 77, expected denial
  matrix 4/4, provider reads 159, writes/retry/redirect 0. Receipt
  `/Users/kensmba/.line-harness-5229-B3-R1-20260903/sanitized-summary.json`,
  SHA-256
  `4372dc856adbf7ac59facac24789417d61f3d282f8f47d91b92f73d4018ae991`.
- B4: stopped before provider access because a lossless settings PATCH could
  not be proved. Provider requests/writes are zero. Receipt
  `/Users/kensmba/.line-harness-5229-B4-STOP-20260903/sanitized-summary.json`,
  SHA-256
  `2eee00f58b52bdedd1fbba1b516431f4820099727f2db66a7cab280f0c2dbeff`.
- Accounting receiver: deployed from exact head
  `ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f` in the isolated deploy worktree.
  The scoped credential fingerprint was verified without disclosure. Harness
  recovery is `write` for the 11 companies resolved by the current routing.
  Customer recovery notification is also `write` for those exact companies;
  bot identity, route fingerprint, body hash, and emergency stop are rechecked
  before every send. No outbox row existed during activation, so activation
  itself sent zero LINE messages. Launchd is running and `/health`
  reports zero pending/processing/ambiguous/failed events and zero outbox rows.
  Sanitized receipt
  `/Users/kensmba/.line-accounting-5230-deploy-20260903/sanitized-summary.json`,
  SHA-256
  `c55985ef41e5189740938a5fb94a0f76d2ed729865f0b89b705f507841982882`.
  The all-routed-company activation readback is
  `/Users/kensmba/.line-accounting-5230-deploy-20260903/activation-r1-summary.json`,
  SHA-256
  `194e44d29b1dfee9c6125cfd32d5ce39225a7e31bbdef82847c56a1c927e42d7`.
  The final notification-write activation readback is
  `/Users/kensmba/.line-accounting-5230-deploy-20260903/activation-r2-summary.json`,
  SHA-256
  `728b3bc722811a4327c9469c297b13f64d430bc43fa17abbcd3d4344ef3461d5`.

The incident image that was absent at 14:54 was independently found in Drive
with creation time 15:12 JST under `月次添付物/2026年08月/その他`. Its 455,769
bytes exactly match the retained Harness object by SHA-256, so no duplicate
Drive upload was performed.

## Packet 5229-B4-R1-20260904 — code-only permanent public-route closure

```text
Approval source/interval: KEN continuation approval received in this task,
  [2026-09-04T00:50:00.301Z, 2026-09-04T02:50:00.301Z)
Implementation parent: Harness 3872515c877356959cb937f0f795788d3c522ed7
Production source: v0.19 backport ac104571b1a3e053f4d573ebd8d31ffb88e2d6f9
  (exact descendant of 9f3c6c3; only index.ts, images.ts, images.test.ts differ)
Executor/test SHA-256:
  c9b75d927bcd95d4e1c38f078ba0a794b5c7f7988a83c1f2c951bbbcca4bdce3 /
  7fc09f3f0bfb099d2298789067e544277520d529973d062b93b6ccb88dcecb60
Artifact: SHA-256 bc5e139610376b126bb2fc61fa1fbb6b112ac4587b4f89db87b3d6d5bad02790,
  1,350,017 bytes, two independent wrangler dry-run builds byte-identical,
  runtime version 0.19.0-5229.b4.ac10457, worker identity
  sha256:45aa5132adffe83e1710534efd914b116cb6a4d06df0926df4b28b71f9f51bf2.

Behavior change:
- every normalized incoming-* key returns generic 404 before R2 access
- closure is unconditional and does not read a runtime binding
- the 404 is private/no-store and nosniff
- ordinary non-incoming public image URLs remain unchanged

Exact provider sequence, serial and no retry:
1. two identical pre-write six-resource Cloudflare snapshots, two current
   version-resource reads, exact current /admin/version readback, and current
   scoped private denial/HEAD/GET with exact size/MIME/SHA-256 before mutation
2. exactly one PUT to /workers/scripts/line-harness/content containing only
   metadata {main_module: worker.js} and one pinned worker.js module
3. one six-resource post-write snapshot and new version-resource comparison;
   bindings/resources/compatibility/cache/assets/subdomain/schedules/Admin
   topology must remain semantically unchanged and cache must be absent/false
4. bounded /admin/version propagation, anonymous private HEAD=401, scoped
   authenticated private HEAD=200 and GET=200 with exact size/MIME/SHA-256
5. exact manifest-derived 77 bare legacy URLs GET with Range bytes=0-0; all
   must return fixed JSON 404, private/no-store, nosniff, and no cache-hit state
6. one terminal deployments GET proving the new version remains 100% active

Ceilings: Cloudflare GET at most 23, Worker runtime reads at most 96, content
PUT exactly one on success and at most one always. Settings, binding, secret,
D1, R2-direct, purge, restart, LINE, Drive, PR merge, retry, redirect, and
automatic rollback are zero. A PUT ambiguity or any post-write mismatch sets
reconciliation_required; the executor never retries or rolls back. Rolling
back to the prior version would reopen 77 URLs and therefore requires a
separate exact approval.

Evidence: /Users/kensmba/.line-harness-5229-B4-R1-20260904 mode 0700 with
exactly one sanitized-summary.json mode 0600. The receipt keeps only aggregate
counts, digests, deployment/version identifiers, mutation outcome, and config
anchors. It never keeps token/header values, account/message/key/path/URL,
customer bytes, or provider bodies.

Residual boundary: the update blocks future origin access and verifies the
observed edge path 77/77. Copies already retained by a browser or LINE client
cannot be recalled by a Worker deploy or Cloudflare purge.
```
