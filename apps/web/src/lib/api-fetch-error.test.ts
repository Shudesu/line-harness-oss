import { afterEach, describe, expect, it, vi } from 'vitest'

// fetchApi() previously discarded the response body on a non-2xx status and
// threw a bare `API error: <status>`, hiding the server's own
// `{ success: false, error: "..." }` message (e.g. a LINE API rejection
// surfaced by the rich-menu publish route). These tests pin the fix: the
// server's `error` string should reach the caller when present, and the
// generic message should remain the fallback when it isn't.

async function loadApi() {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://worker.example.workers.dev')
  return import('./api')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('fetchApi error handling', () => {
  it('surfaces the server-provided error message from a JSON error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: 'LINE createRichMenu failed: 400 ...' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const { fetchApi, ApiError } = await loadApi()

    await expect(fetchApi('/api/rich-menu-groups/g1/publish', { method: 'POST' })).rejects.toMatchObject({
      message: 'LINE createRichMenu failed: 400 ...',
      status: 500,
    })
    await expect(fetchApi('/api/rich-menu-groups/g1/publish', { method: 'POST' })).rejects.toBeInstanceOf(ApiError)
  })

  it('falls back to the generic status message when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 })),
    )

    const { fetchApi } = await loadApi()

    await expect(fetchApi('/api/rich-menu-groups/g1/publish', { method: 'POST' })).rejects.toMatchObject({
      message: 'API error: 500',
      status: 500,
    })
  })

  it('falls back to the generic status message when the JSON body has no error field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const { fetchApi } = await loadApi()

    await expect(fetchApi('/api/rich-menu-groups/g1/publish', { method: 'POST' })).rejects.toMatchObject({
      message: 'API error: 404',
      status: 404,
    })
  })
})
