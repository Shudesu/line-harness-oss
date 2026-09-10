import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserPollingEnvironment, createActivityPoller, POLLING_IDLE_MS, POLLING_RESUME_EVENT, type PollingEnvironment, type PollingState } from './activity-polling'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup(load = vi.fn(async (_signal: AbortSignal) => 'fresh'), visibleInitially = true) {
  let visible = visibleInitially
  let notify: ((event: 'activity' | 'visibility' | 'resume') => void) | undefined
  const unsubscribe = vi.fn(() => { notify = undefined })
  const environment: PollingEnvironment = {
    now: () => Date.now(), visible: () => visible,
    setTimer: (callback, ms) => setTimeout(callback, ms), clearTimer: clearTimeout,
    subscribe: (callback) => { notify = callback; return unsubscribe },
  }
  const onData = vi.fn(), onError = vi.fn(), states: PollingState[] = []
  const poller = createActivityPoller({ environment, intervalMs: 30_000, load, onData, onError, onState: (state) => states.push(state) })
  return { ...poller, load, onData, onError, states, unsubscribe,
    visibility: (next: boolean) => { visible = next; notify?.('visibility') },
    activity: () => notify?.('activity'), resume: () => notify?.('resume'),
  }
}
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('activity-aware read polling', () => {
  it('stops foreground polling after five idle minutes and keeps eight unattended hours quiet', async () => {
    const s = setup()
    await vi.advanceTimersByTimeAsync(POLLING_IDLE_MS)
    expect(s.load).toHaveBeenCalledTimes(10) // t=0 then 30s..270s; no call at the idle boundary
    expect(s.states.at(-1)).toEqual({ reason: 'idle', fetching: false })
    await vi.advanceTimersByTimeAsync(8 * 60 * 60_000)
    expect(s.load).toHaveBeenCalledTimes(10)
    s.activity(); await flush()
    expect(s.load).toHaveBeenCalledTimes(11)
    expect(s.states.at(-1)?.reason).toBe('active')
    s.dispose()
  })

  it('does not fetch in an initially hidden tab and resumes immediately when shown', async () => {
    const s = setup(undefined, false)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(s.load).not.toHaveBeenCalled()
    s.resume(); s.activity(); await flush()
    expect(s.load).not.toHaveBeenCalled()
    s.visibility(true); await flush()
    expect(s.load).toHaveBeenCalledTimes(1)
    s.visibility(false)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(s.load).toHaveBeenCalledTimes(1)
    s.visibility(true); await flush()
    expect(s.load).toHaveBeenCalledTimes(2)
    s.dispose()
  })

  it('ongoing keyboard/pointer activity extends the idle deadline without an extra fetch per event', async () => {
    const s = setup(); await flush()
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(60_000)
      for (let n = 0; n < 100; n++) s.activity()
    }
    expect(s.load).toHaveBeenCalledTimes(13)
    expect(s.states.at(-1)?.reason).toBe('active')
    s.dispose()
  })

  it('never overlaps a slow request and waits one interval after it settles', async () => {
    const first = deferred<string>()
    const s = setup(vi.fn(() => first.promise))
    await vi.advanceTimersByTimeAsync(90_000)
    expect(s.load).toHaveBeenCalledTimes(1)
    first.resolve('one'); await flush()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(s.load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(s.load).toHaveBeenCalledTimes(2)
    s.dispose()
  })

  it('aborts on hide, ignores a stale success, and queues one fresh request after returning', async () => {
    const first = deferred<string>()
    const load = vi.fn<(_signal: AbortSignal) => Promise<string>>().mockImplementationOnce(() => first.promise).mockResolvedValue('current')
    const s = setup(load)
    s.visibility(false)
    expect(load.mock.calls[0][0].aborted).toBe(true)
    s.visibility(true); s.activity(); s.resume()
    expect(load).toHaveBeenCalledTimes(1)
    first.resolve('stale'); await flush()
    expect(load).toHaveBeenCalledTimes(2)
    expect(s.onData.mock.calls).toEqual([['current']])
    expect(s.onError).not.toHaveBeenCalled()
    s.dispose()
  })

  it('coalesces mutation refreshes and does not let their old result overwrite fresh data', async () => {
    const first = deferred<string>()
    const load = vi.fn<(_signal: AbortSignal) => Promise<string>>().mockImplementationOnce(() => first.promise).mockResolvedValue('latest')
    const s = setup(load)
    s.refresh(); s.refresh(); s.refresh()
    expect(load).toHaveBeenCalledTimes(1)
    first.resolve('old'); await flush()
    expect(load).toHaveBeenCalledTimes(2)
    expect(s.onData.mock.calls).toEqual([['latest']])
    s.visibility(false); s.refresh()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(2)
    s.visibility(true); await flush()
    expect(load).toHaveBeenCalledTimes(3)
    s.dispose()
  })

  it('manual resume after pointer activity reuses the request already started by that activity', async () => {
    const slow = deferred<string>()
    const load = vi.fn<(_signal: AbortSignal) => Promise<string>>().mockResolvedValue('first')
    const s = setup(load)
    await vi.advanceTimersByTimeAsync(POLLING_IDLE_MS)
    load.mockImplementation(() => slow.promise)
    const previous = load.mock.calls.length
    s.activity(); s.resume(); s.resume()
    slow.resolve('resumed'); await flush()
    expect(load).toHaveBeenCalledTimes(previous + 1)
    s.dispose()
  })

  it('treats pause abort as normal and ignores completion/error after disposal', async () => {
    const first = deferred<string>()
    const s = setup(vi.fn(() => first.promise))
    s.visibility(false)
    first.reject(new DOMException('Aborted', 'AbortError')); await flush()
    expect(s.onError).not.toHaveBeenCalled()
    s.dispose()
    expect(s.unsubscribe).toHaveBeenCalledOnce()
    const states = s.states.length
    s.activity(); s.refresh(); s.resume()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(s.states).toHaveLength(states)
    expect(s.load).toHaveBeenCalledTimes(1)
  })

  it('unmount aborts a pending transport, ignores its result, and clears every timer', async () => {
    const first = deferred<string>()
    const load = vi.fn((_signal: AbortSignal) => first.promise)
    const s = setup(load)
    s.dispose()
    expect(load.mock.calls[0][0].aborted).toBe(true)
    first.resolve('too late'); await flush()
    expect(s.onData).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps retrying real errors at the existing interval while active', async () => {
    const load = vi.fn<(_signal: AbortSignal) => Promise<string>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('recovered')
    const s = setup(load); await flush()
    expect(s.onError).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(s.onData.mock.calls).toEqual([['recovered']])
    s.dispose()
  })
})

it('the browser event adapter observes visibility, activity, explicit resume and cleans listeners', () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const win = new EventTarget()
  const env = browserPollingEnvironment(doc as unknown as Document, win as unknown as Window)
  const callback = vi.fn()
  const stop = env.subscribe(callback)
  for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus']) win.dispatchEvent(new Event(event))
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'))
  win.dispatchEvent(new Event(POLLING_RESUME_EVENT))
  expect(env.visible()).toBe(false)
  expect(callback.mock.calls.map(([event]) => event)).toEqual(['activity', 'activity', 'activity', 'activity', 'activity', 'activity', 'visibility', 'resume'])
  stop()
  win.dispatchEvent(new Event('pointerdown')); doc.dispatchEvent(new Event('visibilitychange'))
  expect(callback).toHaveBeenCalledTimes(8)
})

it('one explicit resume wakes both mounted inbox and sidebar controllers exactly once', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const win = new EventTarget()
  const environment = browserPollingEnvironment(doc as unknown as Document, win as unknown as Window)
  const loadInbox = vi.fn(async () => 'inbox'), loadSidebar = vi.fn(async () => 'sidebar')
  const base = { environment, onData: () => {}, onError: () => {}, onState: () => {} }
  const inbox = createActivityPoller({ ...base, load: loadInbox, intervalMs: 30_000 })
  const sidebar = createActivityPoller({ ...base, load: loadSidebar, intervalMs: 5 * 60_000 })
  await vi.advanceTimersByTimeAsync(POLLING_IDLE_MS)
  const inboxBefore = loadInbox.mock.calls.length, sidebarBefore = loadSidebar.mock.calls.length
  win.dispatchEvent(new Event('pointerdown'))
  win.dispatchEvent(new Event(POLLING_RESUME_EVENT))
  await flush()
  expect(loadInbox).toHaveBeenCalledTimes(inboxBefore + 1)
  expect(loadSidebar).toHaveBeenCalledTimes(sidebarBefore + 1)
  inbox.dispose(); sidebar.dispose()
})

it('programmatic scroll events after each refresh do not keep an unattended page polling', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const win = new EventTarget()
  const environment = browserPollingEnvironment(doc as unknown as Document, win as unknown as Window)
  const load = vi.fn(async () => 'fresh')
  const states: PollingState[] = []
  const poller = createActivityPoller({
    environment, intervalMs: 30_000, load,
    // Represents layout/scroll restoration effects, not a browser reproduction.
    onData: () => win.dispatchEvent(new Event('scroll')),
    onError: () => {}, onState: (state) => states.push(state),
  })
  await vi.advanceTimersByTimeAsync(POLLING_IDLE_MS)
  expect(states.at(-1)).toEqual({ reason: 'idle', fetching: false })
  expect(load).toHaveBeenCalledTimes(10)
  for (let i = 0; i < 10; i++) {
    win.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(30_000)
  }
  expect(load).toHaveBeenCalledTimes(10)
  poller.dispose()
})

it('wheel input extends the idle deadline and resumes a paused page without a fetch for every wheel event', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const win = new EventTarget()
  const environment = browserPollingEnvironment(doc as unknown as Document, win as unknown as Window)
  const load = vi.fn(async () => 'fresh')
  const states: PollingState[] = []
  const poller = createActivityPoller({ environment, intervalMs: 30_000, load, onData: () => {}, onError: () => {}, onState: (state) => states.push(state) })
  for (let i = 0; i < 6; i++) {
    await vi.advanceTimersByTimeAsync(60_000)
    for (let n = 0; n < 20; n++) win.dispatchEvent(new Event('wheel'))
  }
  expect(states.at(-1)?.reason).toBe('active')
  expect(load).toHaveBeenCalledTimes(13)
  await vi.advanceTimersByTimeAsync(POLLING_IDLE_MS)
  expect(states.at(-1)?.reason).toBe('idle')
  const previous = load.mock.calls.length
  win.dispatchEvent(new Event('wheel')); await flush()
  expect(states.at(-1)?.reason).toBe('active')
  expect(load).toHaveBeenCalledTimes(previous + 1)
  poller.dispose()
})
