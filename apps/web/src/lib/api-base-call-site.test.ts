import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// `apps/web/src`
const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

// This file and api-base.ts/its own test are allowed to reference
// getApiBase() outside the "call time only" rule below — api-base.ts is
// where it's defined, its test exercises it directly, and this file's
// self-test line needs literal example strings (not real bindings).
const EXCLUDE = new Set(['lib/api-base.ts', 'lib/api-base.test.ts', 'lib/api-base-call-site.test.ts'])

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      collectSourceFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Regression guard for the bug fixed alongside this test: five call sites
 * bound `getApiBase()`'s result to a module-scope `const`, e.g.
 * `const API_URL = getApiBase()`. That freezes the value at first module
 * evaluation. `apps/web` is a Next.js `output: 'export'` app — 'use client'
 * pages are also rendered once in Node during `next build` to produce their
 * initial static HTML, and `window` is undefined there. For an explicit
 * same-origin shared build, that Node-side evaluation cannot resolve the
 * browser origin yet and would permanently capture the build-time value.
 * See apps/web/src/lib/api-base.ts's doc comment for the full precedence
 * rule.
 *
 * Every call site must instead call `getApiBase()` at call time (inside a
 * function body), so it re-resolves against the real `window.location.origin`
 * whenever a browser actually runs it.
 *
 * This regex flags a module-scope (column-0, unindented — this codebase is
 * prettier-formatted so a function body is always indented) `const`/`let`/
 * `var` declaration whose initializer calls `getApiBase()`.
 */
const MODULE_SCOPE_CAPTURE =
  /^(export\s+)?(const|let|var)\s+\w+(\s*:[^=]+)?\s*=\s*.*\bgetApiBase\(\)/

describe('getApiBase() call-site guard', () => {
  it('detector recognizes the known-bad module-scope pattern (self-test)', () => {
    // The exact five patterns this guard was written to catch (see the fix
    // commit): all bound at column 0, i.e. module scope.
    expect(MODULE_SCOPE_CAPTURE.test("const API_URL = getApiBase()!")).toBe(true)
    expect(MODULE_SCOPE_CAPTURE.test("const WORKER_BASE = getApiBase() ?? ''")).toBe(true)
    expect(MODULE_SCOPE_CAPTURE.test('const WORKER_BASE = getApiBase()')).toBe(true)
    expect(MODULE_SCOPE_CAPTURE.test('export const API_URL = getApiBase()')).toBe(true)
  })

  it('detector does not flag call-time usage inside a function body (self-test)', () => {
    // Indented (inside a function/handler) — the correct pattern used
    // throughout the codebase, e.g. components/auth-guard.tsx.
    expect(MODULE_SCOPE_CAPTURE.test('  const apiUrl = getApiBase()')).toBe(false)
    expect(MODULE_SCOPE_CAPTURE.test('        const apiUrl = getApiBase()')).toBe(false)
    // A function declaration wrapping the call is never itself flagged.
    expect(MODULE_SCOPE_CAPTURE.test('function apiUrl(): string {')).toBe(false)
  })

  it('no source file captures getApiBase() into a module-scope binding', () => {
    const files = collectSourceFiles(SRC_ROOT)
    const offenders: string[] = []
    for (const file of files) {
      const rel = relative(SRC_ROOT, file)
      if (EXCLUDE.has(rel)) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (MODULE_SCOPE_CAPTURE.test(line)) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
