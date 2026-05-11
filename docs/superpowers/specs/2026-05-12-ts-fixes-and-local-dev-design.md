# TypeScript Fixes + Local Dev Setup

**Date:** 2026-05-12  
**Status:** Approved

---

## Goal

1. Fix all TypeScript errors in `apps/worker` so `pnpm typecheck` passes cleanly.
2. Wire up a fully local development environment (worker + web dashboard) with no Cloudflare account required.

---

## Section 1: TypeScript Fixes

### Fix 1 — `webhook.ts:364` — `c` referenced outside its scope

**Problem:** `handleEvent()` is a plain async function; it receives no Hono context. Line 364 references `c.env.LIFF_URL` inside a Flex message builder within that function — `c` does not exist there.

**Fix:** Add an optional `liffUrl?: string` parameter to `handleEvent`. At the call site (line 69), pass `c.env.LIFF_URL`. Replace `c.env.LIFF_URL` on line 364 with the new `liffUrl` parameter.

**Files:** `apps/worker/src/routes/webhook.ts`

---

### Fix 2 & 3 — `event-bus.ts:222,349` — `unknown` indexing on `eventData`

**Problem:** `EventPayload.eventData` is typed `Record<string, unknown>`, so `eventData?.text` resolves to `unknown`. TypeScript rejects `.trim()` on `unknown` (line 222) and rejects passing it to a `(s: string)` parameter (line 349).

**Fix:** Cast at the point of access:
- Line 222: `(payload.eventData?.['text'] as string | undefined || '').trim()`
- Line 349: `escapeForJsonString((payload.eventData?.['text'] as string) || '')`

**Files:** `apps/worker/src/services/event-bus.ts`

---

### Fix 4 — `capabilities.test.ts` — untyped `res.json()`

**Problem:** Hono's test helper returns `Promise<unknown>` from `res.json()`. Accessing `.success`, `.data.harness_kind`, etc. without a type assertion produces 8 TS18046 errors.

**Fix:** Cast the result: `const body = await res.json() as { success: boolean; data: Record<string, unknown> }`.

**Files:** `apps/worker/src/routes/capabilities.test.ts`

---

### Fix 5 — `intro-message.test.ts` — union type not narrowed

**Problem:** `DEFAULT_FORM_LINK_FLEX` is typed to return `IntroMessage` (a union of `{ type: 'text'; text: string }` and `{ type: 'flex'; altText: string; contents: unknown }`). Accessing `flex.altText` without narrowing causes TS2339.

**Fix:** Type the local variable as the flex variant directly:
```ts
const flex = DEFAULT_FORM_LINK_FLEX(url) as Extract<IntroMessage, { type: 'flex' }>;
```

**Files:** `apps/worker/src/services/intro-message.test.ts`

---

## Section 2: Local Dev Setup

### 2a — Web env file

Create `apps/web/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8787
```

The worker's Vite dev server binds to port 8787 by default via `@cloudflare/vite-plugin`.

### 2b — DB name consistency fix

`package.json`'s `db:migrate:local` script targets `line-crm`, but `wrangler.toml` names the D1 binding `line-harness`. These must match. Update the `db:migrate:local` script in `package.json` to use `line-harness`.

### 2c — Run local migration

```bash
wrangler d1 execute line-harness --local --file=packages/db/schema.sql
```

This creates a local SQLite file under `.wrangler/state/v3/d1/` — no Cloudflare account needed.

### 2d — Start servers

```bash
pnpm dev:worker   # localhost:8787
pnpm dev:web      # localhost:3001
```

Login screen at `http://localhost:3001`. The worker's `POST /api/setup` endpoint creates the initial owner account on first run.

---

## Success Criteria

- `pnpm --filter worker typecheck` exits 0.
- `pnpm --filter web dev` starts without errors.
- Dashboard is reachable at `http://localhost:3001`.
- Worker API responds at `http://localhost:8787/api/health`.
