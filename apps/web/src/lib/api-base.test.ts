import { afterEach, describe, expect, it, vi } from 'vitest'

const ADMIN_URL_PLACEHOLDER = 'https://__LH_WORKER_URL__'

async function loadApiBase(runtimePlaceholder = ADMIN_URL_PLACEHOLDER) {
  vi.resetModules()
  // v0.23.0's deploy-time materializer replaced every occurrence of the
  // placeholder, including the imported comparison sentinel. Let tests model
  // that exact post-materialization module shape so the regression cannot
  // hide behind source-only tests.
  vi.doMock('@line-harness/update-engine/pure', () => ({
    ADMIN_URL_PLACEHOLDER: runtimePlaceholder,
  }))
  return import('./api-base')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.doUnmock('@line-harness/update-engine/pure')
  vi.resetModules()
})

describe('getApiBase', () => {
  it('uses the build-time value once the placeholder has been substituted (per-tenant build / self-hosted install)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://tenant123.example.workers.dev')

    const { getApiBase } = await loadApiBase()

    expect(getApiBase()).toBe('https://tenant123.example.workers.dev')
  })

  it('keeps the materialized Worker URL when the old comparison sentinel was materialized too (v0.23.0 regression)', async () => {
    const workerUrl = 'https://tenant123.example.workers.dev'
    vi.stubEnv('NEXT_PUBLIC_API_URL', workerUrl)
    vi.stubGlobal('window', { location: { origin: 'https://admin-example.pages.dev' } })

    const { getApiBase } = await loadApiBase(workerUrl)

    expect(getApiBase()).toBe(workerUrl)
  })

  it('falls back to the browser origin only in an explicit same-origin Cloud build)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', ADMIN_URL_PLACEHOLDER)
    vi.stubEnv('NEXT_PUBLIC_API_MODE', 'same-origin')
    vi.stubGlobal('window', { location: { origin: 'https://tenant456.example.com' } })

    const { getApiBase } = await loadApiBase()

    expect(getApiBase()).toBe('https://tenant456.example.com')
  })

  it('does not silently treat a standard build with an unmaterialized placeholder as same-origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', ADMIN_URL_PLACEHOLDER)
    vi.stubGlobal('window', { location: { origin: 'https://admin-example.pages.dev' } })

    const { getApiBase } = await loadApiBase()

    expect(getApiBase()).toBeUndefined()
  })

  it('returns the placeholder during a same-origin Cloud build static prerender (no window)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', ADMIN_URL_PLACEHOLDER)
    vi.stubEnv('NEXT_PUBLIC_API_MODE', 'same-origin')
    // No window stub here — simulates the Node-side static prerender pass.
    expect(typeof window).toBe('undefined')

    const { getApiBase } = await loadApiBase()

    expect(getApiBase()).toBe(ADMIN_URL_PLACEHOLDER)
  })

  it('returns undefined when NEXT_PUBLIC_API_URL was never set at all', async () => {
    // vi.stubEnv always assigns a string, so simulate "unset" by deleting
    // the key outright rather than stubbing it to ''.
    const original = process.env.NEXT_PUBLIC_API_URL
    delete process.env.NEXT_PUBLIC_API_URL

    try {
      const { getApiBase } = await loadApiBase()
      expect(getApiBase()).toBeUndefined()
    } finally {
      if (original !== undefined) process.env.NEXT_PUBLIC_API_URL = original
    }
  })
})
