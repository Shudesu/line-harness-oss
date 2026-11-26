import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useActivityPolling } from './use-activity-polling'

// Hook lifecycle adapter only: no DOM/browser automation. Effects, stable refs,
// dependency replacement and cleanup run the actual hook and polling controller.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as any[], effects: [] as (() => void)[] }))
vi.mock('react', () => ({
  useRef(value: unknown) { const index = hooks.cursor++; return hooks.slots[index] ??= { current: value } },
  useState(value: unknown) {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = value
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = next }]
  },
  useCallback(callback: unknown) { hooks.cursor++; return callback },
  useEffect(effect: () => () => void, deps: unknown[]) {
    const index = hooks.cursor++, previous = hooks.slots[index]
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      hooks.effects.push(() => { previous?.cleanup(); hooks.slots[index] = { deps, cleanup: effect() } })
    }
  },
}))
function render<T>(options: Parameters<typeof useActivityPolling<T>>[0], commit = true) {
  hooks.cursor = 0
  const result = useActivityPolling(options)
  if (commit) for (const effect of hooks.effects.splice(0)) effect()
  return result
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => {
  for (const slot of hooks.slots) slot?.cleanup?.()
  vi.unstubAllGlobals(); vi.useRealTimers()
})

it('changing inline load/onData identities after state updates does not restart polling or create a fetch loop', async () => {
  const requests = vi.fn(async () => 'value')
  const initial = vi.fn(), current = vi.fn()
  const options = (onData: typeof initial) => ({ intervalMs: 30_000, load: () => requests(), onData: (value: string) => onData(value), onError: () => {} })
  render(options(initial)); await vi.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 20; i++) render(options(current))
  expect(requests).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(requests).toHaveBeenCalledTimes(2)
  expect(initial).toHaveBeenCalledTimes(1)
  expect(current).toHaveBeenCalledTimes(1)
})

it('a new account/resource key aborts the previous request and never commits its old data', async () => {
  const old = deferred<string>()
  const first = vi.fn((_signal: AbortSignal) => old.promise), second = vi.fn(async () => 'account-b')
  const onData = vi.fn(), onError = vi.fn()
  render({ intervalMs: 30_000, requestKey: 'a', load: first, onData, onError })
  render({ intervalMs: 30_000, requestKey: 'b', load: second, onData, onError })
  expect(first.mock.calls[0][0].aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(0)
  old.resolve('account-a'); await vi.advanceTimersByTimeAsync(0)
  expect(onData.mock.calls).toEqual([['account-b']])
  expect(onError).not.toHaveBeenCalled()
})

it('rejects old-account data even before the replacement passive effect has cleaned up', async () => {
  const old = deferred<string>()
  const onData = vi.fn(), onError = vi.fn()
  render({ intervalMs: 30_000, requestKey: 'a', load: () => old.promise, onData, onError })
  render({ intervalMs: 30_000, requestKey: 'b', load: async () => 'b', onData, onError }, false)
  old.resolve('a'); await vi.advanceTimersByTimeAsync(0)
  expect(onData).not.toHaveBeenCalled()
  for (const effect of hooks.effects.splice(0)) effect()
  await vi.advanceTimersByTimeAsync(0)
  expect(onData.mock.calls).toEqual([['b']])
})

it('an explicit resume restarts the mounted poller once and cleanup removes its event listeners', async () => {
  const fetch = vi.fn(async () => 'fresh')
  const options = { intervalMs: 30_000, load: fetch, onData: () => {}, onError: () => {}, refreshEvent: 'synthetic-refresh' }
  const hook = render(options)
  await vi.advanceTimersByTimeAsync(5 * 60_000)
  const previous = fetch.mock.calls.length
  hook.resume(); await vi.advanceTimersByTimeAsync(0)
  expect(fetch).toHaveBeenCalledTimes(previous + 1)
  for (const slot of hooks.slots) if (slot?.cleanup) { slot.cleanup(); delete slot.cleanup }
  window.dispatchEvent(new Event('synthetic-refresh')); hook.resume()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(fetch).toHaveBeenCalledTimes(previous + 1)
})
