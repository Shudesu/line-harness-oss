# Historical mileage updates

Updates must preserve the released bytes and checksums of migrations 062/063
and all existing `mileage_ledger` rows. Re-running their original INSERTs can
award live activity a second time because their old history keys differ from
runtime keys. Do not clear migration ledgers or manually replay those SQL files
to recover a failed update.

The update engine recognizes only the exact released 062/063 files. It prepares
additive structure, then uses one atomic D1 request to register historical
activity and the migration checksum. It does not insert monetary ledger rows.
Native activity, including events still waiting to enqueue, retains its owner.
Previously rewarded history gets processed queue entries; genuinely unprocessed
history is held for the compatible runtime. Existing ledger rows are not edited.

The hold uses `_line_harness_legacy_mileage_claims` and an unavailable queue date.
Only the compatible processor claims these rows, applies the recorded builtin
actor rule, and checks its policy snapshot. The sentinel remains on failures
and abandoned claims, so an older processor cannot accidentally pick them up.
Normal processing uses immutable legacy grants for source/subject/day dedupe
and includes linked historic actor grants in daily limits.

## Release contract

- A compatible Worker release advertises `legacy_mileage_projection_version: 1`.
- Such a release requires manifest `schema_version: 2`. Schema-1 engines reject
  schema 2 before migrations, instead of ignoring the capability and replaying
  the unsafe original SQL. The new reader accepts both schema versions.
- Publish the compatible update engine and CLI before publishing a schema-2
  manifest. The source versions prepared for this change are engine 0.0.13 and
  CLI 0.2.12. The Worker bundle and its capability must come from the same
  verified release build. This document does not authorize publication.
- Do not publish the engine/CLI with a schema-1 handoff release. A new engine
  also rejects unrecorded 062/063 against a target without the capability.
  Matching-checksum migrations remain no-ops when selecting an older target.
- A failed Worker deployment leaves historical claims safely held. Retry the
  compatible deployment; do not remove the hold or migration checksum to force
  old code to process it. After successful deployment, normal scheduled mileage
  processing projects the held rows. SQL completion does not mean projection
  has already finished.

## Conditions requiring review

Automatic replay stops atomically when it cannot establish ownership or reward
policy: changed/renamed historical SQL, a queue-less synchronous baseline with
existing rules, orphan/repurposed historic events, incompatible custom rules or
multipliers, a changed held-claim policy, or live activity in flight overlapping
an old grant. Raw CTA timestamps do not identify which CTA was clicked; without
native or recoverable historical identity, replay stops rather than inventing
`primary`. An in-flight enqueue may make a later retry unambiguous.

Preserve data and inspect the indicated ownership/policy discrepancy before
retrying. In particular, do not drain an old processor's known overlapping
legacy rewards merely to silence the guard: that old processor can already
re-award them. Reconcile with the compatible processor in a planned maintenance
step, preserving any legitimate custom rewards.

The adapter does not repair already-duplicated balances, reverse existing
entries, or guarantee the behavior of an arbitrary older/forked writer. Its
atomic guard covers the replay boundary, not new independent actions arriving
later while old code remains deployed. Plan compatible deployment promptly;
old-runtime subject-dedupe defects require the runtime fix as well.

## Verification

Regression fixtures cover existing live grants, genuine ungranted history,
processed/pending/event-before-enqueue states, retries, transaction rollback,
CTA identity, rule changes, and linked identity/cap behavior. They preserve
all existing monetary rows. The multi-statement transaction and trigger support
must also be verified against an isolated real D1 before release. Production
migration and Worker deployment remain separate from source merges.
