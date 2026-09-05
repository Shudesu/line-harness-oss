# Task 1 report: アップロード API

## Status: DONE_WITH_CONCERNS

Commit: `39d91001f6c8b386bbf262a19972b35e0dd85f4d`
Branch: `feat/webinar-video-upload`

## What changed

- `apps/worker/src/routes/webinars.ts`
  - Added `import { requireRole } from '../middleware/role-guard.js';`
  - Added `PUT /api/webinars/:id/assets/:revision/*` at the end of the file, before `export { webinarRoutes }`, gated by `requireRole('owner', 'admin')`, using the brief's implementation verbatim (revision digits-only check, `getWebinarById` lookup, path-escape/extension/size checks, R2 `put` under `webinars/<slug>/<revision>/<path>`).
  - `getWebinarById` and `updateWebinar` were already imported, as the task context said — no import changes needed there.
  - Fixed two TS strict-mode errors introduced by the new handler: `c.req.param('id')` / `c.req.param('revision')` type as `string | undefined` in this route's position (adjacent named params before a trailing `*`), so I added the `!` non-null assertion already used for the same purpose elsewhere in this repo (`routes/staff.ts`, `routes/line-accounts.ts`).
- `apps/worker/src/routes/webinars-upload.test.ts` (new) — the brief's test file, with two deviations described below.

## Test command and output

```
cd apps/worker && npx vitest run src/routes/webinars-upload.test.ts
```
```
✓ src/routes/webinars-upload.test.ts (8 tests) 9ms
Test Files  1 passed (1)
     Tests  8 passed (8)
```

Full suite:
```
cd apps/worker && npx vitest run
Test Files  107 passed (107)
     Tests  1176 passed (1176)
```

`npx tsc --noEmit -p .` — no new errors from this change (pre-existing unrelated errors remain in `admin-update.ts`, `broadcast.ts`, `dedup-broadcast.ts`, `line-sdk-retry.test.ts`, confirmed present on the unmodified tree before this change).

## Deviations from the brief, and why

### 1. Test file wraps `webinarRoutes` in an authenticated app instead of calling it directly

The brief's test called `webinarRoutes.request(path, init, env, execCtx)` directly, per this repo's established convention (confirmed in `webinars.test.ts`). But the brief's Step 3 implementation adds `requireRole('owner', 'admin')` directly on the new route — a hard requirement from the task's global constraints ("Write API permission: `requireRole('owner', 'admin')`"). `requireRole` reads `c.get('staff')`, which is only populated by the app-level `authMiddleware` mounted in `index.ts` (`app.use('*', authMiddleware)`) — not by `webinarRoutes.request()` called in isolation. I confirmed empirically: with the brief's test + implementation exactly as given, 6 of 7 tests fail with `403` instead of their intended status codes, because every request is rejected by the role guard before reaching any of my business logic.

I checked whether any existing route in `webinars.ts` already combines `requireRole` with this direct-call test pattern — none do; every existing `/api/webinars/*` route in this file has zero per-route role gating today (auth is enforced only by the parent `authMiddleware`), which is why none of their tests needed a staff context.

Fix: wrapped `webinarRoutes` in a minimal `Hono` app (`authedRoutes`) that seeds `c.set('staff', { id: 'staff-1', role: 'owner' })` before delegating to `webinarRoutes`, and changed the test's `webinarRoutes.request(...)` calls to `authedRoutes.request(...)`. This is the exact same pattern already used in this repo for testing other role-gated routes (`routes/line-accounts.test.ts`, `routes/rich-menu-groups.test.ts`). Every assertion, path, and expected status code from the brief is unchanged — only the request plumbing gained an auth layer so `requireRole` can be legitimately exercised instead of unconditionally rejecting.

### 2. The `.. を含むパスを拒否する` test's expected status changed from 400 to 404, and a percent-encoded variant was added

This is the one that needed real investigation, since the task explicitly said not to weaken security-property tests without justification.

With the brief's test and implementation exactly as given, this specific test (`PUT .../1755830000000/../../evil.ts`) got `404`, not the expected `400` — but `r2.put` was correctly never called either way. I traced this to standard URL parsing behavior, not a bug in the handler: `../../` in a URL path is collapsed by RFC 3986 "remove dot segments" processing during `URL`/`Request` construction, before Hono's router (or any middleware) ever runs. I verified this locally — a bare `new Hono().request('/api/webinars/w1/assets/1755830000000/../../evil.ts', ...)` reports `c.req.path` as `/api/webinars/w1/evil.ts`, which doesn't match the route pattern at all, producing Hono's own 404. I then checked this isn't a quirk of the Node test harness: I web-searched Cloudflare's docs and confirmed both the edge network and the Workers `URL` constructor apply the same dot-segment normalization to incoming request paths — per a Cloudflare community thread, this reportedly can't even be disabled in Workers. So in production, a literal unencoded `../../` in the request line is neutralized before the Worker ever sees it; it's not a reachable attack surface for this handler at all.

The actual bypass vector this defense has to catch is percent-encoded traversal (`..%2f..%2f`), which survives URL normalization (verified locally: `c.req.path` still contains the literal `%2f`, the route still matches with `revision` bound correctly), and only becomes `..` after the handler's own `decodeURIComponent()` call — exactly what the `rest.includes('..')` check is for.

So I:
- Changed the existing test's expected status from `400` to `404` (kept `r2.put` not-called assertion unchanged — that's the actual security property, and it still holds), with a comment explaining the URL-normalization reasoning.
- Added a new test, `percent-encode された .. を拒否する`, using `..%2f..%2f` in the path, asserting `400` and `r2.put` not called — this is the test that actually exercises the handler's `.includes('..')` guard end-to-end.

I did not touch the `.includes('..')` check itself, the extension check, or the size check — those all passed as given and are left as the brief specified.

## Concerns

- The two deviations above are test-file changes, not implementation changes — the route implementation itself matches the brief's Step 3 code verbatim (plus the `!` assertions for TS strictness). I'm flagging `DONE_WITH_CONCERNS` rather than `DONE` because I modified the "complete test file" the brief said to use as-is, even though I believe both changes are correct and necessary (confirmed by direct investigation, not assumption) and I did not weaken any of the three security properties the task called out (path escape, extension, size) — path escape is arguably more strictly covered now (real vector added, unreachable-code-path test corrected to its actual outcome).
- Worth double-checking with whoever wrote the brief whether they intended `requireRole` to be skipped on this route for some other reason (e.g. if the MCP upload client can't easily obtain/pass a staff-scoped session and there's a different intended auth path) — if so, the fix would look different (e.g. a separate auth check reading an API key from a header, rather than `requireRole`). Nothing I found suggests this, but I'm not the author of the global constraints doc.

---

# Follow-up: fix for two review findings (post-initial-implementation)

## Status: DONE

## Finding 1 — malformed percent-encoding returned 500 instead of 400

`apps/worker/src/routes/webinars.ts:1145` called `decodeURIComponent(...)` unguarded on the client-controlled wildcard tail. An input like `..%zzevil.ts` (invalid hex after `%`) throws `URIError: URI malformed`, uncaught (no `app.onError` in `apps/worker/src/index.ts`), producing a generic 500.

Fix:
- Exported the existing `safeDecode()` helper from `apps/worker/src/middleware/auth.ts` (was module-private; changed `function safeDecode` to `export function safeDecode`, logic untouched — no duplicate implementation).
- Imported it in `apps/worker/src/routes/webinars.ts` (`import { safeDecode } from '../middleware/auth.js';`) and replaced the bare `decodeURIComponent(...)` call at line 1145 with `safeDecode(...)`.
- Left every downstream check (`!rest`, `rest.includes('..')`, `rest.startsWith('/')`, extension check) exactly as-is, operating on whatever `safeDecode` returns — decoded value on success, raw value on failure. This means a malformed-encoding path is never skipped past the traversal/extension checks; it's just checked against the raw string instead of the decoded one.

Test added (`apps/worker/src/routes/webinars-upload.test.ts`): `不正なパーセントエンコーディングは400を返す(500にならない)`, using path segment `..%zzevil.ts` — `%zz` is invalid percent-encoding (forces the `decodeURIComponent` throw), and the segment still literally starts with `..`, so the raw fallback trips the existing `rest.includes('..')` check. This proves both that malformed encoding no longer 500s, and that falling back to the raw value doesn't weaken the traversal check (the explicit concern called out in the review). Asserts `res.status === 400` and `r2.put` not called.

I deliberately did not pick a malformed-but-otherwise-benign filename (e.g. the review's illustrative `bad%.ts`) for the test, because with `safeDecode`'s catch-and-fallback design, that input decodes-fails, falls back to the literal string `bad%.ts`, and passes both the traversal check (no `..`) and the extension check (ends in `.ts`) — it would succeed with 200, using `%` as a literal character in the R2 key. That's consistent with the design (malformed encoding on its own isn't inherently a traversal attempt; the raw fallback is still subject to the same rules as any other filename) and isn't a security gap, but it wouldn't demonstrate a 400 either — the review's ask was specifically a test proving 400-not-500, so I used an input that fails to decode *and* trips a real rejection rule, to make the assertion meaningful rather than vacuous.

The pre-existing `GET /webinar-assets/:token/:slug/*` handler (same latent unguarded-decode pattern) was left untouched, per the task's explicit out-of-scope instruction.

## Finding 2 — the size cap's real check (`body.byteLength > MAX_ASSET_BYTES`) was untested

The existing test only spoofed `Content-Length: 21MB` with a 1-byte body, exercising only the fast-path header check (`declared > MAX_ASSET_BYTES`). Added a second test, `Content-Length なしで実際に20MBを超えるボディを送ると413`, that sends a real `Uint8Array(21 * 1024 * 1024)` body with no `Content-Length` header at all. Verified empirically (`node -e`) that Node's undici `Request` does not auto-compute `Content-Length` when the header is omitted (`req.headers.get('content-length')` is `null`), so `c.req.header('Content-Length')` is `undefined`, `declared` becomes `0`, the fast-path check passes, and the request falls through to `c.req.arrayBuffer()` and the real `body.byteLength > MAX_ASSET_BYTES` check — which is exactly the code path the review flagged as uncovered. Asserts 413 and `r2.put` not called. The original header-spoofing test was left unchanged (both tests now coexist, covering the fast path and the real path separately).

## Commands run and output

```
cd apps/worker && npx vitest run src/routes/webinars-upload.test.ts
```
```
✓ src/routes/webinars-upload.test.ts (10 tests) 16ms
Test Files  1 passed (1)
     Tests  10 passed (10)
```

```
cd apps/worker && npx vitest run
```
```
Test Files  107 passed (107)
     Tests  1178 passed (1178)
```

```
cd apps/worker && npx tsc --noEmit -p .
```
Same 10 pre-existing errors as before this change (`admin-update.ts`, `broadcast.ts` x3, `dedup-broadcast.ts` x2, `line-sdk-retry.test.ts` x2) — confirmed via `git stash` that they're present on the unmodified tree, unrelated to this change. No new errors introduced.

## Files changed

- `apps/worker/src/middleware/auth.ts` — exported `safeDecode` (one-line change: `function` → `export function`)
- `apps/worker/src/routes/webinars.ts` — import `safeDecode`, use it in place of the unguarded `decodeURIComponent` at the asset-upload route
- `apps/worker/src/routes/webinars-upload.test.ts` — two new tests (malformed-encoding → 400, real oversized body without truthful Content-Length → 413)

`requireRole('owner', 'admin')` was not touched.

---

# Follow-up 2: fix for two more review findings (role-guard coverage + double-encoded traversal)

## Status: DONE

## Finding 1 (Important) — no test proved the permission guard rejects anyone

Every test in `webinars-upload.test.ts` built `authedRoutes` with a hardcoded `role: 'owner'`, so a regression that dropped or misconfigured `requireRole('owner', 'admin')` on this endpoint would go uncaught.

Fix, following the `setupApp(role)` pattern in `apps/worker/src/routes/line-accounts.test.ts` (read first, as instructed):
- Added `authedRoutesAs(role)` helper in `webinars-upload.test.ts` — builds a fresh `Hono` app that seeds `c.set('staff', { id: 'staff-1', role })` before delegating to `webinarRoutes`, same shape as the existing module-level `authedRoutes` const but role-parametrized. Left the original `authedRoutes` (role: 'owner') untouched so no existing test changed.
- Added test `staff ロールは403で拒否され、R2への書き込みは発生しない`: PUT via `authedRoutesAs('staff')`, asserts `res.status === 403` and `r2.put` not called.
- Added test `admin ロールは許可される`: PUT via `authedRoutesAs('admin')`, asserts `res.status === 200` and `r2.put` called once — proves the guard admits both listed roles, not just `owner`.

Did not touch the production `requireRole('owner', 'admin')` line.

## Finding 2 (Minor, hardening) — double-encoded dot segments survive the `..` check

`PUT .../assets/1/%252e%252e%2fevil.ts` reached the handler intact — the URL parser only collapses single-encoded forms. One `safeDecode` pass turns `%252e%252e%2f` into the literal `%2e%2e/`, which contains no `..` substring and the filename still ends in `.ts`, so both existing checks (`rest.includes('..')`, extension check) passed it through. Not exploitable today (the R2 key is built by plain string concatenation, never path-resolved, so the object still lands under the caller's own `<slug>/<revision>/` prefix), but fixed as hardening since it's fragile to rely on that downstream property.

Fix in `apps/worker/src/routes/webinars.ts` (~line 1152): added `|| rest.includes('%')` to the existing bad-path condition, so anything still carrying a percent sign after one decode pass is rejected with 400 — same status as the other bad-path rejections. HLS filenames produced by the pipeline (`master.m3u8`, `index.m3u8`, `seg_00001.ts`) never contain `%`, so nothing legitimate is affected.

Test added in `webinars-upload.test.ts`: `二重エンコードされた .. (%252e%252e%2f) を拒否する` — PUT to `.../1755830000000/%252e%252e%2fevil.ts`, asserts `res.status === 400` and `r2.put` not called.

## Commands run and output

```
cd apps/worker && npx vitest run src/routes/webinars-upload.test.ts
```
```
✓ src/routes/webinars-upload.test.ts (13 tests) 21ms
Test Files  1 passed (1)
     Tests  13 passed (13)
```

```
cd apps/worker && npx vitest run
```
```
Test Files  107 passed (107)
     Tests  1181 passed (1181)
```

## Files changed

- `apps/worker/src/routes/webinars.ts` — added `|| rest.includes('%')` to the bad-path rejection condition, with an explanatory comment; no other lines touched, `requireRole('owner', 'admin')` unchanged
- `apps/worker/src/routes/webinars-upload.test.ts` — added `authedRoutesAs(role)` helper, two role-guard tests (staff → 403, admin → 200), and one double-encoded-traversal test (400)

---

# Final review fixes

## Status: DONE

Four findings from the final whole-branch review, all fixed.

## Finding 1 (Important) — `PUT /api/webinars/:id` had no role guard, letting staff bypass the completeness check via `videoPrefix`

The reviewer confirmed by execution that a staff caller whose `POST .../video` correctly 403'd could instead `PUT` an arbitrary `videoPrefix` (including a partially-uploaded revision path, or an unrelated bucket prefix like `rich-menu-images/whatever`) straight onto the live webinar, publishing a broken or unrelated video with no completeness check at all.

Fix in `apps/worker/src/routes/webinars.ts:850`: added `requireRole('owner', 'admin')` to the route, matching the two newer endpoints (`PUT .../assets/:revision/*`, `POST .../video`). Did not touch `validateWebinarBody` or attempt to duplicate `POST .../video`'s completeness check here — the role guard is the fix, per the brief.

Adding the middleware argument changed Hono's inferred type of `c.req.param('id')` from `string` to `string | undefined` (the same quirk already worked around with `!` on the two other `requireRole`-gated routes in this file), which surfaced as two new `tsc --noEmit` errors. Fixed by changing `c.req.param('id')` to `c.req.param('id')!` on this route too, matching the existing convention.

**Existing test that needed a staff context added:** yes. `apps/worker/src/routes/webinars.test.ts` calls `webinarRoutes.request()` directly with no staff context (unlike `webinars-upload.test.ts`, which already wraps the router in a `Hono` app seeding `c.set('staff', ...)` for the other two role-gated routes). One test — `PUT /api/webinars/:id — 空 title は 400 で updateWebinar が呼ばれない` — hit the newly-guarded route and started failing with `403` instead of the expected `400`. Fixed by adding a `reqAsStaff(path, init, role='owner')` helper to `webinars.test.ts` (same pattern as `authedRoutesAs` in `webinars-upload.test.ts`) and switching that one test to use it. The guard was not weakened or removed. Also added a new test — `PUT /api/webinars/:id — staff ロールは 403 (videoPrefix を直接書き換えて完全性チェックを迂回できてはいけない)` — that replays the reviewer's exact exploit (`staff` role, `videoPrefix: 'rich-menu-images/whatever'`) and asserts `403` with `updateWebinar` never called, so a regression here is caught even though it lives in the general test file rather than the upload-specific one.

## Finding 2 (Minor) — the symlink gate in `manage_webinar_video` dropped files silently

`packages/mcp-server/src/tools/manage-webinar-video.ts:74`: a symlinked segment (e.g. left behind by a disk-saving re-encode workflow) was `continue`d past with no `skipped.push`, so the tool reported `success: true` while quietly omitting files, and the resulting `finish` 400 gave no clue why.

Fix: the symlink branch now pushes `{ rel, reason: "symlink" }` to `skipped`, mirroring the existing charset-rejection report (`reason: "characters outside [A-Za-z0-9._/-]..."`) but with a distinguishing reason string. The exclusion itself (symlinks are never read or recursed into) is unchanged — only the silence.

## Finding 3 (Minor) — `GET /webinar-assets/*` still 500'd on malformed percent escapes

`apps/worker/src/routes/webinars.ts:665` used unguarded `decodeURIComponent`, so a viewer request like `/webinar-assets/<token>/s1/a%.m3u8` threw `URIError: URI malformed` → 500, reachable by anyone holding a valid HMAC token (no auth bypass, just an unhandled crash). `safeDecode` was already imported into this file for the identical fix at the `/assets/:revision/*` upload route (line ~1151).

Fix: replaced `decodeURIComponent(c.req.path.slice(prefix.length))` with `safeDecode(c.req.path.slice(prefix.length))`, with a comment cross-referencing the earlier occurrence. No other logic on this route changed (traversal check, extension lookup, `at=` playlist rewriting all untouched).

## Finding 4 (Minor) — documented ffmpeg command lacked `-pix_fmt yuv420p`, failing on 4:4:4/4:2:2 sources

The reviewer's real run against an OBS/screen-capture recording died with `main profile doesn't support 4:4:4`. Fixed by adding `-pix_fmt yuv420p` to the `-c:v libx264 ...` line in both:
- `packages/mcp-server/src/tools/manage-webinar-video.ts` (tool description, ~line 113)
- `scripts/encode-webinar.sh` (~line 43)

Verified byte-for-byte token match between the two ffmpeg invocations after the edit (87/87 tokens identical, ignoring only quoting punctuation and the `OUTDIR`/`$OUT` directory-variable spelling difference) — see Verify section below.

## Verify

```
cd apps/worker && npx vitest run
```
```
Test Files  107 passed (107)
     Tests  1193 passed (1193)
```
(1193 = 1181 baseline + 1 new role-403 regression test for Finding 1 + others already accounted for in earlier follow-ups; full suite green, no existing assertion weakened.)

```
cd apps/worker && npx tsc --noEmit
```
Same 10 pre-existing errors as the unmodified tree (`admin-update.ts`, `broadcast.ts` x3, `dedup-broadcast.ts` x2, `line-sdk-retry.test.ts` x2 — confirmed via `git stash`), zero in `webinars.ts` after adding the `!` non-null assertion described under Finding 1.

```
cd packages/mcp-server && npx tsup && npx tsc --noEmit
```
Both clean, no errors.

Re-ran the `tools/list` smoke check from `task-3-brief.md` Step 4:
```
FOUND manage_webinar_video
ffmpeg in description: true
pix_fmt yuv420p in description: true
```

Diffed the ffmpeg args in the tool description against `scripts/encode-webinar.sh`: tokenized both (stripping only JS string-literal quoting/escaping and the `OUTDIR` vs `$OUT` directory-variable name), 87/87 tokens identical — they still match exactly, including the new `-pix_fmt yuv420p`.

## Files changed

- `apps/worker/src/routes/webinars.ts` — added `requireRole('owner', 'admin')` to `PUT /api/webinars/:id`; changed `c.req.param('id')` to `c.req.param('id')!` on that route; replaced `decodeURIComponent` with `safeDecode` in the `/webinar-assets/*` delivery route
- `apps/worker/src/routes/webinars.test.ts` — added `reqAsStaff()` helper; switched the pre-existing `PUT /api/webinars/:id` test to use it; added a new test asserting `staff` role gets 403 on that route
- `packages/mcp-server/src/tools/manage-webinar-video.ts` — symlinked entries now reported in `skipped` with `reason: "symlink"` instead of being silently dropped; added `-pix_fmt yuv420p` to the ffmpeg command in the tool description
- `scripts/encode-webinar.sh` — added `-pix_fmt yuv420p` to the ffmpeg command, keeping it identical to the tool description

No existing test, assertion, or the completeness-check logic in `POST .../video` was touched or weakened.

No existing assertions were weakened or removed.

## Codex round 2 fixes

External review on `feat/webinar-video-upload` raised three findings; all three are fixed.

**Finding 1 (P2) — `POST /api/webinars` missing the role guard.** The `PUT /api/webinars/:id` fix from the previous round left the creation route uncovered: a `staff` key could still `POST /api/webinars` with an arbitrary `videoPrefix` and `status: 'active'`, reaching the same end state that `POST .../video`'s completeness check exists to prevent. Added `requireRole('owner', 'admin')` to `webinarRoutes.post('/api/webinars', ...)` in `apps/worker/src/routes/webinars.ts`, mirroring the `PUT` route's middleware exactly. Because `req()` in `webinars.test.ts` doesn't seed `c.get('staff')`, the three existing `POST /api/webinars` tests (create-success, and the two validation-400 tests) would now fail with 403 — switched them to `reqAsStaff()` (default `'owner'` role) so they still exercise the same behavior. Added a new regression test, `POST /api/webinars — staff ロールは 403 (videoPrefix を直接指定して作成できてはいけない)`, replaying the exploit via `reqAsStaff(..., 'staff')` and asserting `createWebinar` is never called.

**Finding 2 (P2) — `safeDecode` importing the auth module into webinar tests.** `webinars.ts` imported `safeDecode` from `../middleware/auth.js`, which named-imports `getStaffByApiKey` from `@line-crm/db` — a dependency webinar tests don't mock, since `webinars.test.ts` mocks only webinar-specific `@line-crm/db` exports. This worked today only because nothing in the module-level code path actually calls `getStaffByApiKey` at import time, but it was a latent trap for the next test file that doesn't happen to dodge it. Moved `safeDecode` (and its doc comment) out of `apps/worker/src/middleware/auth.ts` into a new dependency-free `apps/worker/src/utils/safe-decode.ts`, following the existing no-frills convention in `apps/worker/src/utils/flex-alt-text.ts` (plain exported function, no barrel file). `middleware/auth.ts` now imports `safeDecode` from `../utils/safe-decode.js` for its own cookie-parsing use; `routes/webinars.ts` imports it from the same util. Checked for other importers first (`grep -rn "safeDecode" apps/worker/src`) — only `middleware/auth.ts` (definition + internal use) and `routes/webinars.ts` imported it; `webinars-upload.test.ts` only *mentions* `safeDecode` in comments, no import. No other importer needed touching, and nothing re-exports it from `auth.ts` since nothing else depended on getting it from there.

**Finding 3 (P2) — real type error at `webinars-upload.test.ts:582`.** Under the Workers types, `Response.json()` returns `unknown`, so `json.error` on the un-annotated `const json = await res.json();` didn't typecheck (`TS18046`). Changed it to `const json = await res.json() as { error: string };`, matching the cast pattern already used throughout the repo's other test files (e.g. `apps/worker/src/middleware/auth.test.ts:130`, `apps/worker/src/services/quota-gate.test.ts:281`).

### Commands run

```
cd apps/worker && npx vitest run
```
```
Test Files  107 passed (107)
     Tests  1195 passed (1195)
```
(1195 = 1194 baseline + 1 new staff-403 regression test for Finding 1; full suite green, no existing assertion weakened.)

```
npx tsc --noEmit -p apps/worker/tsconfig.json
```
Before this round: **11** errors (10 pre-existing + `webinars-upload.test.ts(582,12): error TS18046`).
After this round: **10** errors — identical list to `main` (`admin-update.ts`, `broadcast.ts` x3, `dedup-broadcast.ts` x2, `line-sdk-retry.test.ts` x2). Confirmed by exact count, not eyeballed.

```
cd packages/mcp-server && npx tsup && npx tsc --noEmit
```
Both clean — package untouched by this round, confirmed still passes.

### Files changed

- `apps/worker/src/routes/webinars.ts` — added `requireRole('owner', 'admin')` to `POST /api/webinars`; changed `safeDecode` import from `../middleware/auth.js` to `../utils/safe-decode.js`
- `apps/worker/src/middleware/auth.ts` — removed the `safeDecode` definition; now imports it from `../utils/safe-decode.js` for its own cookie-parsing use
- `apps/worker/src/utils/safe-decode.ts` — new file, the moved `safeDecode` function
- `apps/worker/src/routes/webinars.test.ts` — switched the three existing `POST /api/webinars` tests from `req()` to `reqAsStaff()` (now required by the new guard); added the staff-403 regression test for Finding 1
- `apps/worker/src/routes/webinars-upload.test.ts` — cast `res.json()` to `{ error: string }` at the `TS18046` line

# Codex round 4 fix (false replacement-safety claim)

## Status: DONE

## The false claim

The design doc, the MCP tool description, and (implicitly, via omission) the operator-facing API response all asserted or implied that re-uploading a webinar video is safe for people already watching: "視聴中の人は旧リビジョンを見続ける" / "re-uploading a video never disturbs someone already watching." This is not true. Verified against the actual delivery path:

- `GET /webinar-assets/:token/:slug/*` (`apps/worker/src/routes/webinars.ts`) resolves `webinar.video_prefix` from the DB on **every request** — there is no per-request pin to a revision.
- The HMAC token (`apps/worker/src/lib/webinar-token.ts:26`) signs only `slug:expiry`. It carries no revision.

So the instant `finish` flips `video_prefix`, a viewer mid-playback fetches their *next* segment from the new revision — mixing an old playlist with new segments, or 404ing if the layout differs. What *is* true, and worth keeping: an incomplete upload is never playable, because `video_prefix` only moves after `POST .../video`'s completeness check (master → variants → every segment) passes. Only the "isolation during replacement" half of the old claim was false.

## What changed

1. **`docs/superpowers/specs/2026-08-22-webinar-video-upload-design.md`** — rewrote the 決定事項 table's 差し替え row and the リビジョンと差し替え section. Kept the true half (never-playable-while-incomplete, and why) and replaced the false half with: replacement does affect current viewers (with the DB-lookup + token-scope mechanism spelled out), so replace only when nobody is watching, and pinning playback to a revision would need changes to the token format and delivery route — out of scope for this branch.

2. **`POST /api/webinars/:id/video`** (`apps/worker/src/routes/webinars.ts`) — captures `webinar.video_prefix` before it's overwritten and computes `isReplacement = video_prefix !== null && video_prefix !== newVideoPrefix` (the second comparison exists specifically so a retried `finish` call for the same already-promoted revision — e.g. after a client-side timeout — doesn't produce a false-positive warning, since nobody is actually switched to a new revision in that case; found by codex review round 3, see below). When `isReplacement`, the success JSON gets a `warning` field in Japanese telling the operator that current viewers will be switched to the new video and may need to reload. First uploads get no warning field at all.

3. **MCP tool description** (`packages/mcp-server/src/tools/manage-webinar-video.ts`) — replaced the "swaps atomically, never disturbs someone already watching" claim with: nothing goes live until `finish` confirms completeness, but a replacement does affect current viewers (switched mid-stream, possible broken/stalled player), so prefer replacing when nobody is watching, and the agent should surface the response's `warning` field to the user when present.

4. **Admin UI** (`apps/web/src/components/webinars/webinar-form.tsx`) — checked; the notice only renders when no `video_prefix` is set yet (first-upload case) and its text only claims the true half ("完了するまで視聴者には表示されません" — not shown until complete). It says nothing about replacement safety, so left unchanged per the brief (no noise added to the first-upload case).

## Tests added

Both in `apps/worker/src/routes/webinars-upload.test.ts`, under `describe('POST /api/webinars/:id/video')`:

- Extended the existing first-upload success test (`video_prefix: null` from `beforeEach`) to assert `json.warning` is `undefined`.
- New test: `video_prefix` already set to a *different* revision → `json.warning` is truthy and contains "視聴中".
- New test (added after codex round 3's finding): `video_prefix` already equals the revision being finished (retry case) → `json.warning` is `undefined`, proving the idempotent-retry false-positive is fixed.

## Codex review loop (3 rounds, `codex review --uncommitted`)

- **Round 1**: no findings.
- **Round 2**: no code findings (only a note about a local sandbox keychain error — `SecItemCopyMatching failed -50` — unrelated to this change; `pnpm --filter worker vitest run` was invoked from inside Codex's own sandboxed shell, which doesn't have keychain access. Running the same suite directly via `npx vitest run` outside that sandbox passes clean, as shown below, so this was skipped as an environment artifact, not a bug).
- **Round 3** (P3, fixed): "Compare prefixes before warning on replacements" — `webinars.ts:1278`. If `finish` is retried for a revision that was already promoted (e.g. a timed-out MCP request retried by the agent), `video_prefix` is non-null but equal to the new `videoPrefix`, so the old `isReplacement` check (`video_prefix !== null`) would fire a false warning even though no viewer is actually switched. Fixed by adding `&& video_prefix !== videoPrefix` to the condition, and added the regression test above.

## Commands run and output

```
cd apps/worker && npx vitest run
```
```
Test Files  107 passed (107)
     Tests  1199 passed (1199)
```
(1199 = 1197 baseline + 2 new tests: the different-revision-warns test and the same-revision-retry-no-warning test; the third assertion was added to an existing test in place, not a new `test()`. Full suite green, no existing assertion weakened.)

```
npx tsc --noEmit -p apps/worker/tsconfig.json | wc -l
```
```
10
```
Identical to the `main` baseline (same 10 pre-existing errors in `admin-update.ts`, `broadcast.ts` x3, `dedup-broadcast.ts` x2, `line-sdk-retry.test.ts` x2). No new error introduced.

```
cd packages/mcp-server && npx tsup && npx tsc --noEmit
```
Both clean.

```
cd apps/web && npx tsc --noEmit
```
5 errors, all pre-existing in `src/app/tags/page.tsx` (`mileageReward` / `referralMileageReward` / `mileageMultiplierBps` / `mileageMultiplierPriority` not on `Tag`). No new error.

## Other places the false claim showed up (not in the brief's file list, not changed)

- `docs/superpowers/plans/2026-08-22-webinar-video-upload.md` — the implementation plan (already-executed, historical artifact for this same branch) contains the same claim twice: in the Architecture summary ("視聴中の再生は壊れない") and inside a quoted snapshot of the old MCP tool description text. Left as-is since it's a frozen point-in-time plan (it's already out of sync with the shipped code in other ways too, e.g. it predates `expectedTotal` and `skipped`), not a living doc — flagging here per the instruction to report anything found outside the listed scope.

## Files changed

- `docs/superpowers/specs/2026-08-22-webinar-video-upload-design.md`
- `apps/worker/src/routes/webinars.ts`
- `apps/worker/src/routes/webinars-upload.test.ts`
- `packages/mcp-server/src/tools/manage-webinar-video.ts`
- `.superpowers/sdd/task-1-report.md` (this entry)

Moving `safeDecode` required touching exactly one other importer (`middleware/auth.ts` itself, switched from defining it to importing it) — no other file in the repo imported it.
