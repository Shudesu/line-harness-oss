import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchApi } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('API authentication recovery', () => {
  it.each(['POST', 'PUT', 'DELETE'])('redirects a legacy-cookie %s 401 to login without replaying the mutation', async method => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test')
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/console')
    const replace = vi.fn()
    vi.stubGlobal('window', { location: { replace } })
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) })
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401 }))
    vi.stubGlobal('fetch', fetch)

    await expect(fetchApi('/api/protected', { method })).rejects.toMatchObject({ status: 401 })
    expect(replace).toHaveBeenCalledWith('/console/login')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('https://api.example.test/api/protected', expect.objectContaining({ method, credentials: 'include' }))
  })

  it.each([403, 429, 503])('preserves %s errors without a login redirect', async status => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test')
    const replace = vi.fn()
    vi.stubGlobal('window', { location: { replace } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })))
    await expect(fetchApi('/api/protected')).rejects.toMatchObject({ status })
    expect(replace).not.toHaveBeenCalled()
  })
})
