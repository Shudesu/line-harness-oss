# TypeScript Fixes + Local Dev Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 5 TypeScript errors in `apps/worker` so `pnpm --filter worker typecheck` passes, then wire up a fully local dev environment so the dashboard is accessible at `http://localhost:3001`.

**Architecture:** Each TS fix is a surgical, isolated edit — no refactoring beyond what fixes the type error. The local dev setup creates one env file, fixes one script name, runs the D1 migration locally, then verifies both servers start.

**Tech Stack:** TypeScript 5.9, Hono 4, Cloudflare Workers (Vite + `@cloudflare/vite-plugin`), Next.js 15, wrangler 4, pnpm workspaces, D1 SQLite (local mode).

---

## File Map

| File | Change |
|---|---|
| `apps/worker/src/routes/webhook.ts` | Add `liffUrl?: string` param to `handleEvent`; pass `c.env.LIFF_URL` at call site; replace `c.env.LIFF_URL` inside function body |
| `apps/worker/src/services/event-bus.ts` | Cast `payload.eventData?.['text']` to `string \| undefined` at lines 222 and 349 |
| `apps/worker/src/routes/capabilities.test.ts` | Cast `res.json()` result to typed object |
| `apps/worker/src/services/intro-message.test.ts` | Type `flex` as `Extract<IntroMessage, { type: 'flex' }>` |
| `package.json` (root) | Fix `db:migrate:local` script: `line-crm` → `line-harness` |
| `apps/web/.env.local` | Create with `NEXT_PUBLIC_API_URL=http://localhost:8787` |

---

## Task 1: Fix `webhook.ts` — `c` out of scope on line 364

**Files:**
- Modify: `apps/worker/src/routes/webhook.ts`

The `handleEvent` function signature is at line 81. Line 364 uses `c.env.LIFF_URL` but `c` (the Hono context) only exists in the route handler closure, not inside `handleEvent`. The fix is to thread `liffUrl` through as an optional parameter.

- [ ] **Step 1: Open the file and locate the function signature**

Read `apps/worker/src/routes/webhook.ts` lines 81–88:
```ts
async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  lineAccessToken: string,
  lineAccountId: string | null = null,
  workerUrl?: string,
): Promise<void> {
```

- [ ] **Step 2: Add `liffUrl` parameter to the signature**

Change the signature to:
```ts
async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  lineAccessToken: string,
  lineAccountId: string | null = null,
  workerUrl?: string,
  liffUrl?: string,
): Promise<void> {
```

- [ ] **Step 3: Update the call site (line 69)**

The call site currently reads:
```ts
await handleEvent(db, lineClient, event, channelAccessToken, matchedAccountId, c.env.WORKER_URL || new URL(c.req.url).origin);
```

Change it to:
```ts
await handleEvent(db, lineClient, event, channelAccessToken, matchedAccountId, c.env.WORKER_URL || new URL(c.req.url).origin, c.env.LIFF_URL);
```

- [ ] **Step 4: Replace `c.env.LIFF_URL` usage on line 364**

The old code inside `handleEvent`:
```ts
...(c.env.LIFF_URL ? [{ type: 'button', action: { type: 'uri', label: 'フィードバックを送る', uri: `${c.env.LIFF_URL}?page=form` }, style: 'secondary', margin: 'sm' }] : []),
```

Replace with:
```ts
...(liffUrl ? [{ type: 'button', action: { type: 'uri', label: 'フィードバックを送る', uri: `${liffUrl}?page=form` }, style: 'secondary', margin: 'sm' }] : []),
```

- [ ] **Step 5: Verify only the two TS errors from webhook.ts are gone**

Run:
```bash
pnpm --filter worker typecheck 2>&1 | grep "webhook.ts"
```
Expected: no output (zero matches).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/routes/webhook.ts
git commit -m "fix(worker): pass liffUrl param to handleEvent instead of accessing c out of scope"
```

---

## Task 2: Fix `event-bus.ts` — unknown indexing at lines 222 and 349

**Files:**
- Modify: `apps/worker/src/services/event-bus.ts`

`EventPayload.eventData` is `Record<string, unknown>`, so indexing it yields `unknown`, not `string`. Two places need a cast.

- [ ] **Step 1: Fix line 222 — `.trim()` on unknown**

Find this block (around line 220–226):
```ts
// keyword_exact（完全一致）
if (conditions.keyword_exact) {
  const text = (payload.eventData?.text || '').trim();
  if (text !== conditions.keyword_exact) {
    return false;
  }
}
```

Replace with:
```ts
// keyword_exact（完全一致）
if (conditions.keyword_exact) {
  const text = ((payload.eventData?.['text'] as string | undefined) || '').trim();
  if (text !== conditions.keyword_exact) {
    return false;
  }
}
```

- [ ] **Step 2: Fix line 349 — `unknown` passed to `(s: string)` parameter**

Find this line (around line 348–349):
```ts
const raw = (action.params.data || '{}')
  .replace(/\{\{message\}\}/g, escapeForJsonString(payload.eventData?.text || ''));
```

Replace with:
```ts
const raw = (action.params.data || '{}')
  .replace(/\{\{message\}\}/g, escapeForJsonString((payload.eventData?.['text'] as string) || ''));
```

- [ ] **Step 3: Verify the two event-bus errors are gone**

Run:
```bash
pnpm --filter worker typecheck 2>&1 | grep "event-bus.ts"
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/services/event-bus.ts
git commit -m "fix(worker): cast eventData text access to string to satisfy TS unknown indexing"
```

---

## Task 3: Fix `capabilities.test.ts` — untyped `res.json()`

**Files:**
- Modify: `apps/worker/src/routes/capabilities.test.ts`

`res.json()` returns `unknown` in this test environment. The test accesses `.success`, `.data.harness_kind`, `.data.features`, etc. directly — 8 errors total.

- [ ] **Step 1: Add a type cast after `res.json()`**

Find line 24:
```ts
const body = await res.json();
```

Replace with:
```ts
const body = await res.json() as { success: boolean; data: Record<string, unknown> };
```

- [ ] **Step 2: Verify all 8 capabilities.test.ts errors are gone**

Run:
```bash
pnpm --filter worker typecheck 2>&1 | grep "capabilities.test.ts"
```
Expected: no output.

- [ ] **Step 3: Run the test to confirm it still passes**

```bash
pnpm --filter worker test 2>&1 | grep -E "capabilities|PASS|FAIL|✓|✗"
```
Expected: test passes.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/routes/capabilities.test.ts
git commit -m "fix(worker): type-assert res.json() in capabilities test"
```

---

## Task 4: Fix `intro-message.test.ts` — union not narrowed

**Files:**
- Modify: `apps/worker/src/services/intro-message.test.ts`

`DEFAULT_FORM_LINK_FLEX` returns `IntroMessage` (a union). Accessing `.altText` and `.contents` without narrowing causes TS2339.

- [ ] **Step 1: Check the import at the top of the test file**

The test file imports `IntroMessage` and `DEFAULT_FORM_LINK_FLEX`. Confirm the import line — it should look like:
```ts
import { DEFAULT_FORM_LINK_FLEX } from './intro-message.js';
import type { IntroMessage } from './intro-message.js';
```
If `IntroMessage` is not imported, add it.

- [ ] **Step 2: Narrow the `flex` variable type**

Find the test block (around line 108–116):
```ts
describe('DEFAULT_FORM_LINK_FLEX', () => {
  it('formUrl がボタンの uri にセットされる', () => {
    const url = 'https://liff.line.me/abc?page=form&id=xyz';
    const flex = DEFAULT_FORM_LINK_FLEX(url);
    expect(flex.type).toBe('flex');
    expect(flex.altText).toBe('🎁 特典を受け取る');
    const contents = flex.contents as { footer: { contents: Array<{ action: { uri: string } }> } };
    expect(contents.footer.contents[0].action.uri).toBe(url);
  });
});
```

Replace with:
```ts
describe('DEFAULT_FORM_LINK_FLEX', () => {
  it('formUrl がボタンの uri にセットされる', () => {
    const url = 'https://liff.line.me/abc?page=form&id=xyz';
    const flex = DEFAULT_FORM_LINK_FLEX(url) as Extract<IntroMessage, { type: 'flex' }>;
    expect(flex.type).toBe('flex');
    expect(flex.altText).toBe('🎁 特典を受け取る');
    const contents = flex.contents as { footer: { contents: Array<{ action: { uri: string } }> } };
    expect(contents.footer.contents[0].action.uri).toBe(url);
  });
});
```

- [ ] **Step 3: Verify no intro-message.test.ts errors remain**

Run:
```bash
pnpm --filter worker typecheck 2>&1 | grep "intro-message.test.ts"
```
Expected: no output.

- [ ] **Step 4: Verify typecheck is fully clean**

Run:
```bash
pnpm --filter worker typecheck 2>&1
```
Expected: no output and exit code 0.

- [ ] **Step 5: Run all worker tests**

```bash
pnpm --filter worker test 2>&1
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/services/intro-message.test.ts
git commit -m "fix(worker): narrow IntroMessage union type in intro-message test"
```

---

## Task 5: Local Dev Setup

**Files:**
- Modify: `package.json` (root)
- Create: `apps/web/.env.local`

- [ ] **Step 1: Fix the DB script name mismatch in root `package.json`**

Open `package.json`. Find:
```json
"db:migrate:local": "wrangler d1 execute line-crm --file=packages/db/schema.sql --local",
```

Replace with:
```json
"db:migrate:local": "wrangler d1 execute line-harness --local --file=packages/db/schema.sql",
```

(The DB name must match `database_name = "line-harness"` in `apps/worker/wrangler.toml`.)

- [ ] **Step 2: Create `apps/web/.env.local`**

Create the file with this content:
```
NEXT_PUBLIC_API_URL=http://localhost:8787
```

This points the Next.js dashboard at the local wrangler dev server.

- [ ] **Step 3: Run the local D1 migration**

From the repo root:
```bash
pnpm exec wrangler d1 execute line-harness --local --file=packages/db/schema.sql
```
Expected output includes lines like `Executing on local database line-harness` and ends without errors. This creates a local SQLite file at `.wrangler/state/v3/d1/`.

- [ ] **Step 4: Start the worker dev server**

In a terminal:
```bash
pnpm dev:worker
```
Expected: Vite starts and prints something like:
```
  ➜  Local:   http://localhost:8787/
```

- [ ] **Step 5: Verify the worker API responds**

In a second terminal:
```bash
curl http://localhost:8787/api/health
```
Expected: JSON response like `{"status":"ok"}` or similar (HTTP 200).

- [ ] **Step 6: Start the web dashboard**

In a third terminal:
```bash
pnpm dev:web
```
Expected:
```
  ▲ Next.js 15.x.x
  - Local:        http://localhost:3001
```

- [ ] **Step 7: Open the dashboard and verify login page loads**

Open `http://localhost:3001` in a browser. Expected: a login form (email + password fields).

- [ ] **Step 8: Create the initial owner account**

The worker's setup endpoint creates the first admin user. Run:
```bash
curl -s -X POST http://localhost:8787/api/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local.dev","password":"localdev123","name":"Admin"}' | jq .
```
Expected: `{"success":true,"data":{"apiKey":"...","staffId":"..."}}`. Copy the `apiKey` — you'll need it to log in.

- [ ] **Step 9: Commit the setup changes**

```bash
git add package.json apps/web/.env.local
git commit -m "chore: fix db:migrate:local script name and add web .env.local for local dev"
```

---

## Verification Checklist

After all tasks:

```bash
# 1. TypeScript clean
pnpm --filter worker typecheck
# Expected: exits 0, no output

# 2. Tests pass
pnpm --filter worker test
# Expected: all tests green

# 3. Worker healthy
curl http://localhost:8787/api/health
# Expected: HTTP 200

# 4. Dashboard loads
open http://localhost:3001
# Expected: login page visible
```
