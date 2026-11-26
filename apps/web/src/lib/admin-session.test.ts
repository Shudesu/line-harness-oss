import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheAdminSession, readAdminSession, SessionCheckError } from './admin-session'

const session = { success: true, data: { name: 'Test', role: 'owner' as const }, csrfToken: 'csrf-test' }
const signal = () => new AbortController().signal
afterEach(() => vi.unstubAllGlobals())

describe('reload session restoration', () => {
  it('checks the cookie session without caching or exposing a credential', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(session))
    vi.stubGlobal('fetch', fetch)
    const s = signal()
    expect(await readAdminSession('https://api.example', s)).toEqual(session)
    expect(fetch).toHaveBeenCalledWith('https://api.example/api/auth/session', { credentials: 'include', cache: 'no-store', signal: s })
  })
  it('recognizes a confirmed 401 as signed out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    expect(await readAdminSession('https://api.example', signal())).toBeNull()
  })
  it.each([403, 429, 500, 503])('keeps HTTP %s distinct from signed out', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })))
    await expect(readAdminSession('https://api.example', signal())).rejects.toMatchObject({ status })
  })
  it('preserves a transport failure for retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(readAdminSession('https://api.example', signal())).rejects.toBeInstanceOf(TypeError)
  })
  it.each([{ success: false }, { success: true, data: {} }])('rejects a malformed session response without treating it as 401', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
    await expect(readAdminSession('https://api.example', signal())).rejects.toBeInstanceOf(SessionCheckError)
  })
  it('rejects an HTML response from an authentication gateway', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>login</html>')))
    await expect(readAdminSession('https://api.example', signal())).rejects.toBeInstanceOf(SyntaxError)
  })
  it('does not call a relative API when configuration is missing', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(readAdminSession(undefined, signal())).rejects.toBeInstanceOf(SessionCheckError)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps a successful session when accessing localStorage is forbidden', () => {
    expect(() => cacheAdminSession(session, () => { throw new DOMException('Blocked', 'SecurityError') })).not.toThrow()
  })
  it('keeps a successful session when writing display metadata fails', () => {
    const storage = { removeItem: vi.fn(), setItem: vi.fn(() => { throw new Error('quota') }) }
    expect(() => cacheAdminSession(session, () => storage as unknown as Storage)).not.toThrow()
  })
})
