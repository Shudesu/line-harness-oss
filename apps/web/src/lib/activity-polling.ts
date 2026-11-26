/** Read-only dashboard polling. Active updates/deployments must not use this. */
export const POLLING_IDLE_MS = 5 * 60_000
export const POLLING_RESUME_EVENT = 'lh:polling-resume'
export type PollingReason = 'active' | 'hidden' | 'idle'
export interface PollingState { reason: PollingReason; fetching: boolean }
export interface PollingEnvironment {
  now: () => number
  visible: () => boolean
  setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void
  subscribe: (callback: (event: 'activity' | 'visibility' | 'resume') => void) => () => void
}

export function createActivityPoller<T>(options: {
  environment: PollingEnvironment
  intervalMs: number
  idleMs?: number
  load: (signal: AbortSignal) => Promise<T>
  onData: (value: T) => void
  onError: (error: unknown) => void
  onState: (state: PollingState) => void
}) {
  const { environment: env } = options
  const idleMs = options.idleMs ?? POLLING_IDLE_MS
  let state: PollingState = { reason: env.visible() ? 'active' : 'hidden', fetching: false }
  let lastActivity = env.now()
  let generation = 0
  let disposed = false
  let pendingRefresh = false
  let inFlight: AbortController | null = null
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const publish = () => { if (!disposed) options.onState({ ...state }) }
  function clearPoll() { if (pollTimer !== undefined) env.clearTimer(pollTimer); pollTimer = undefined }
  function clearIdle() { if (idleTimer !== undefined) env.clearTimer(idleTimer); idleTimer = undefined }
  function pause(reason: 'hidden' | 'idle') {
    clearPoll()
    clearIdle()
    generation++
    inFlight?.abort()
    state = { reason, fetching: false }
    publish()
  }
  function active(): boolean {
    if (disposed) return false
    if (!env.visible()) { if (state.reason !== 'hidden') pause('hidden'); return false }
    if (env.now() - lastActivity >= idleMs) { if (state.reason !== 'idle') pause('idle'); return false }
    return state.reason === 'active'
  }
  function armIdle() {
    if (idleTimer !== undefined || disposed) return
    idleTimer = env.setTimer(() => {
      idleTimer = undefined
      if (active()) armIdle()
    }, Math.max(0, idleMs - (env.now() - lastActivity)))
  }
  async function run() {
    if (!active()) return
    // A transport that ignores abort must settle before its replacement starts.
    if (inFlight) { pendingRefresh = true; return }
    clearPoll()
    pendingRefresh = false
    const controller = new AbortController()
    inFlight = controller
    const issued = generation
    state.fetching = true
    publish()
    const current = () => !disposed && issued === generation && !controller.signal.aborted && active()
    try {
      const value = await options.load(controller.signal)
      if (current()) options.onData(value)
    } catch (error) {
      if (current()) options.onError(error)
    } finally {
      inFlight = null
      if (!disposed && state.reason === 'active') {
        state.fetching = false
        publish()
        if (active()) {
          if (pendingRefresh) void run()
          else pollTimer = env.setTimer(() => { pollTimer = undefined; void run() }, options.intervalMs)
        }
      }
    }
  }
  function activity(manual = false) {
    if (disposed || !env.visible()) return
    const wasPaused = state.reason !== 'active'
    lastActivity = env.now()
    state.reason = 'active'
    armIdle()
    if (wasPaused) { publish(); void run() }
    // pointerdown may already have resumed the same request before a button's
    // click. Reuse it instead of aborting/repeating the just-started fetch.
    else if (manual && !inFlight) void run()
  }
  const unsubscribe = env.subscribe((event) => {
    if (event === 'visibility' && !env.visible()) pause('hidden')
    else activity(event === 'resume')
  })
  publish()
  if (state.reason === 'active') { armIdle(); void run() }
  return {
    /** Mutation notifications invalidate an old result, but do not wake a hidden/idle tab. */
    refresh() {
      if (disposed) return
      generation++
      pendingRefresh = true
      inFlight?.abort()
      if (active()) void run()
    },
    dispose() {
      disposed = true
      generation++
      clearPoll()
      clearIdle()
      unsubscribe()
      inFlight?.abort()
    },
  }
}

/** Adapter is injectable so visibility/activity are tested without a browser. */
export function browserPollingEnvironment(doc: Document, win: Window): PollingEnvironment {
  return {
    now: () => Date.now(),
    visible: () => doc.visibilityState !== 'hidden',
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (timer) => clearTimeout(timer),
    subscribe(callback) {
      const activity = () => callback('activity')
      const visibility = () => callback('visibility')
      const resume = () => callback('resume')
      // Scroll events also come from layout shifts, anchor adjustment and
      // scrollTo(). Only input events may extend the idle deadline; otherwise
      // a refresh that adjusts scrolling could keep its own polling alive.
      const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
      for (const event of events) win.addEventListener(event, activity, { passive: true, capture: true })
      win.addEventListener('focus', activity)
      win.addEventListener(POLLING_RESUME_EVENT, resume)
      doc.addEventListener('visibilitychange', visibility)
      return () => {
        for (const event of events) win.removeEventListener(event, activity, { capture: true })
        win.removeEventListener('focus', activity)
        win.removeEventListener(POLLING_RESUME_EVENT, resume)
        doc.removeEventListener('visibilitychange', visibility)
      }
    },
  }
}
