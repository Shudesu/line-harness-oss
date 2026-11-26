import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider } from './auth-context'

// Lifecycle adapter for the real provider. No browser, DOM or authenticated session.
const h = vi.hoisted(() => ({ cursor: 0, slots: [] as any[], effects: [] as (() => void)[], pathname: '/chats', router: { replace: vi.fn() } }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState(initial: unknown) {
    const i = h.cursor++
    if (!(i in h.slots)) h.slots[i] = initial
    return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next }]
  },
  useEffect(effect: () => (() => void) | void, deps: unknown[]) {
    const i = h.cursor++, previous = h.slots[i]
    if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j]))) {
      h.effects.push(() => { previous?.cleanup?.(); h.slots[i] = { deps, cleanup: effect() } })
    }
  },
}))
vi.mock('next/navigation', () => ({ useRouter: () => h.router, usePathname: () => h.pathname }))
vi.mock('@/lib/api-base', () => ({ getApiBase: () => 'https://api.example' }))
vi.mock('@/lib/admin-session', async () => import('../lib/admin-session'))

function render() {
  h.cursor = 0
  const result = AuthProvider({ children: 'protected-content' }) as any
  for (const effect of h.effects.splice(0)) effect()
  return result.props.value as { status: string; error: string | null; retry: () => void }
}
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)) }
let stored: Record<string, string>
beforeEach(() => {
  h.cursor = 0; h.slots = []; h.effects = []; h.pathname = '/chats'; h.router.replace.mockClear(); stored = {}
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: {
    removeItem: vi.fn(), setItem: vi.fn((k: string, v: string) => { stored[k] = v }), getItem: vi.fn((k: string) => stored[k] ?? null),
  } }))
})
afterEach(() => {
  for (const slot of h.slots) slot?.cleanup?.()
  vi.unstubAllGlobals()
})
it('redirects only a confirmed expired session to login', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
  render(); await settle()
  expect(h.router.replace.mock.calls).toEqual([['/login']])
})
it.each([403, 500])('shows retry after HTTP %s and recovers without a login redirect', async status => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status })).mockResolvedValueOnce(Response.json({ success: true, data: { role: 'owner' } }))
  vi.stubGlobal('fetch', fetch)
  render(); await settle()
  const failed = render()
  expect(failed.status).toBe('error')
  expect(h.router.replace).not.toHaveBeenCalled()
  failed.retry()
  render(); await settle()
  expect(render().status).toBe('ok')
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('keeps the optimistic shell when a previous session exists and the check fails transiently', async () => {
  stored.lh_csrf = 'x'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
  render(); await settle()
  expect(render().status).toBe('ok')
  expect(h.router.replace).not.toHaveBeenCalled()
})
it('accepts the verified cookie when localStorage access throws', async () => {
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked') } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, data: { role: 'owner' } })))
  render(); await settle()
  expect(render().status).toBe('ok')
  expect(h.router.replace).not.toHaveBeenCalled()
})
it('checks the session once, not on every navigation', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: { role: 'owner' } }))
  vi.stubGlobal('fetch', fetch)
  render(); await settle(); h.pathname = '/friends'; render(); await settle(); h.pathname = '/tags'; render(); await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(render().status).toBe('ok')
})
it('preserves the strict staff redirect after verification', async () => {
  h.pathname = '/'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, data: { role: 'staff', staffRolePolicy: 'strict' } })))
  render(); await settle(); render()
  expect(h.router.replace.mock.calls).toEqual([['/chats']])
})
it('does not show the dashboard optimistically to a cached strict staff on /', async () => {
  h.pathname = '/'
  Object.assign(stored, { lh_csrf: 'x', lh_staff_role: 'staff', lh_staff_policy: 'strict' })
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  render()
  expect(render().status).toBe('checking')
})
it('re-verifies once on an API 401 and sends a confirmed expiry to /login', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ success: true, data: { role: 'owner' } }))
    .mockResolvedValueOnce(new Response('', { status: 401 }))
  vi.stubGlobal('fetch', fetch)
  render(); await settle()
  window.dispatchEvent(new Event('lh-auth-expired')); window.dispatchEvent(new Event('lh-auth-expired'))
  await settle()
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(h.router.replace.mock.calls).toEqual([['/login']])
})
it('keeps the user signed in when the re-verification fails transiently', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ success: true, data: { role: 'owner' } }))
    .mockResolvedValueOnce(new Response('', { status: 503 }))
  vi.stubGlobal('fetch', fetch)
  render(); await settle()
  window.dispatchEvent(new Event('lh-auth-expired')); await settle()
  expect(h.router.replace).not.toHaveBeenCalled()
})
