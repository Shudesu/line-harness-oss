# #5229 historical incoming-media migration runbook

## Goal and completion condition

Move only the approved historical `messages_log` image references from public
`/images/incoming-*` URLs to the authenticated, account-scoped
`/api/incoming-media/:accountId/:messageId/content` route. It is complete only
when the exact approved manifest reconciles across D1, R2, message JSON, the
limited cache purge, and authenticated/unauthenticated readback. This runbook
does **not** authorize or perform a production action by itself.

The bridge is `INCOMING_MEDIA_PUBLIC_BLOCK_ENABLED`. It applies **only** to the
historical flat keys with an image extension:
`incoming-*.(png|jpg|jpeg|gif|webp)`. The Worker blocks those legacy public
URLs only when its value is exactly `true`; it is deliberately unset by default
so they can be migrated without an interruption. Any other value (`TRUE`, `1`,
`false`, or unset) leaves only that legacy GET behavior intact. New #5229
objects use the deterministic `incoming-<64 lowercase hex>` shape (no file
extension), and every other `incoming-*` shape is always private and returns
404 before R2 regardless of the bridge setting. Generic
`DELETE /api/images/incoming-*` remains blocked for both legacy and new keys.

## Scope and hard stops

- Name one tenant, D1 database, R2 bucket, Worker origin, release commit, and
  deployment/version ID. Re-read each live identifier at every action boundary.
- Include only a prebuilt, redacted, verified manifest of historical image rows.
  Never infer candidates from an R2 prefix listing or a broad SQL rewrite.
- Each candidate must have a `line_account_id` and `line_message_id` matching
  the private route's `[A-Za-z0-9_-]+` identifier rule, plus an existing exact
  historical key: `incoming-{accountId}-{messageId}.{ext}`. `ext` is derived
  from the verified MIME (`png`, `jpg`, `gif`, or `webp`), not guessed from an
  R2 listing. Digest-only/new or arbitrary `incoming-*` keys are rejected.
  The candidate must also have byte size, SHA-256, and an exact
  `messages_log.content` JSON preimage where both image URL fields equal the
  same legacy URL.
- Stop on malformed JSON, URL mismatch, duplicate identity, missing object,
  non-image MIME, metadata/hash mismatch, pre-existing divergent ledger row, or
  any SQL expected-count mismatch. Record excluded rows as blockers; do not
  guess or repair them in this run.
- Never use a generic image DELETE, R2 deletion, a wildcard/prefix purge,
  purge-everything, `UPDATE ... LIKE`, or an unbounded provider query.
- Do not put manifests, D1 exports, R2 objects, tokens, cookies, authorization
  headers, friend identifiers, or customer content in Git, CI logs, or chat.

## Read-only preflight

1. Reconfirm the live tenant header, exact Worker release, D1 binding, R2
   bucket, and that this code is deployed with
   `INCOMING_MEDIA_PUBLIC_BLOCK_ENABLED` **not** equal to `true`.
2. Collect a read-only candidate extract by
   joining each historical incoming `messages_log` image with its account/source
   attribution. The old `messages_log.line_account_id` may be absent, so derive
   the account only from the verified relation; do not split a legacy R2 key.
   Do not create a backup under this read-only approval: backup creation and
   retention are a separate write-preparation packet before migration.
3. For every exact candidate, perform R2 HEAD and the separately approved
   content/hash verification. Confirm object key, MIME, byte size, SHA-256, and
   allowed image magic. This repository intentionally does not include an R2
   downloader or credentialed verifier.
4. Confirm the exact original JSON remains in `messages_log`, and check that
   `incoming_media` is absent (or halt for an existing row that differs). Count
   candidates and exclusions, then freeze a redacted JSON manifest outside Git.
5. Build review artifacts locally; this is offline and does not contact any
   provider:

```bash
pnpm exec tsx scripts/incoming-media-migration-plan.ts \
  --manifest /secure/5229-verified-redacted.json \
  --output-dir /secure/5229-artifacts
```

The manifest requires `schema_version: 1`, `issue: 5229`, `verified: true`, a
single HTTPS Worker origin, fixed `backfill_at`, and one entry per identity.
The helper only emits conditional D1 operations, exact URL purge targets, and
readback expectations; it never imports Cloudflare/LINE clients, reads R2, or
executes generated SQL. It creates its new output directory as `0700` and every
artifact as `0600`, even under a permissive umask. It refuses non-empty or
non-`0700` existing directories rather than changing their permissions or
mixing approval packets.

## KEN approval packet — required before every external write

Ask KEN for item-specific approval containing all of the following:

- tenant/D1/R2/Worker/release identifiers and the manifest SHA-256;
- candidate, excluded, D1 insert, JSON rewrite, and exact-URL purge counts;
- the proposed before/after URLs, maintenance impact (expected: none while the
  bridge is off), and exact rollback operation/order;
- permission for migrations `071` and `072`, one account-bound credential hash
  insert, the separately controlled accounting runtime secret update,
  manifest-only D1 ledger writes, conditional
  `messages_log` rewrites, deployment/config change to set the gate to `true`,
  and the exact limited cache purge;
- the required provider readback: D1 row state, R2 HEAD, anonymous old URL,
  unauthenticated private route, account-bound service-credential HEAD/GET,
  cross-account and wrong-method denial, and
  MIME/length/SHA-256 checks.

Approval is invalid if the manifest digest, counts, release, tenant, or any
live identifier changes. A deployment/config write, D1 write, and cache purge
are separate external-write boundaries; re-read provider results after each.

## Approved execution order

1. Recheck the manifest digest and Step 1 identifiers. Run the preflight
   artifact read-only and stop on every non-zero expectation.
2. Apply `packages/db/migrations/071_incoming_media.sql` and
   `072_incoming_media_service_credentials.sql` through separately approved D1
   changes. Read back both tables/indexes and migration-ledger checksums.
   Generate credential artifacts offline with
   `scripts/incoming-media-service-credential.ts`; separately approve exactly
   one hash-row insert and one accounting runtime-secret update. Never place
   plaintext in D1, Git, logs, chat, or the approval packet.
3. Execute `apply.json` entry by entry under the approved executor. Each entry
   must be transactional: insert precisely one `incoming_media` row with
   `status='stored'`, then rewrite exactly one `messages_log` row only when its
   content equals the manifest preimage. Roll back that entry if either expected
   change count is not one. Do not overwrite a conflict.
4. Read back every approved D1 ledger row and rewritten JSON against the
   manifest. While the gate is off, old public URLs remain available for
   continuity; this is expected, not completion.
5. Perform the required private R2/Worker readback before closing the bridge.
   Every ledger object must HEAD with
   the expected metadata; private metadata HEAD/content GET must deny anonymous
   access and succeed with the credential bound to that exact account. The same
   credential must return 404 for another account and 401 on unrelated routes.
   Content must match the expected MIME, length, and SHA-256. Owner/admin is
   break-glass compatibility, not the accounting runtime credential.
6. Only after Steps 1–5 have recorded readback may KEN separately approve
   setting `INCOMING_MEDIA_PUBLIC_BLOCK_ENABLED=true` and deploying that exact
   configuration. Re-read the deployed gate value and exact Worker version
   before any purge. This closes the public origin route first, so an old URL
   cannot be requested and re-cached during the cache invalidation window.
7. Purge only the URLs listed in `purge.json`, in approved bounded batches,
   **after** Step 6. Save provider request/result receipts. No wildcard, prefix,
   or zone purge.
8. Run `readback.json` only after the Step 6 gate/version receipt and Step 7
   successful exact-URL purge receipt. Verify every legacy public URL returns
   404, and repeat the account-bound private HEAD/GET plus the negative auth
   matrix and MIME/length/SHA-256
   checks. The private route must retain `Cache-Control: private, no-store` and
   must not expose an R2 key.

## Rollback

Before enabling the public block, use the generated `rollback.json` only with
new KEN approval. It restores a row only when the current JSON is exactly the
manifest replacement JSON. Retain the D1 ledger and R2 evidence; never delete
either as rollback. After the public block is enabled, do not reopen public
evidence by default. The cache purge itself is irreversible, although an old
Worker revision or `gate=false` could make the origin serve a legacy URL again.
Either action is a new approval packet with exact affected URLs/count, reason,
rollback, and provider readback; it is not an automatic post-purge rollback.

## Acceptance record

Record sanitized provider receipts and the manifest digest outside Git. Report
separately: migration 071/072 status, credential ID/account/scope (never value),
ledger backfill count, JSON rewrite count, purge count, private-route auth/hash
readback, public-block result, and every
excluded blocker. A green deployment, a D1 screen, or a browser tab alone is
not completion.
