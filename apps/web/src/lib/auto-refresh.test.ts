import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAutoRefresh, type VisibilityDocument } from './auto-refresh'

/** visibilitychange を発火できるテスト用 document。 */
function createFakeDoc(initialHidden = false) {
  let hidden = initialHidden
  const listeners = new Set<() => void>()
  const doc: VisibilityDocument = {
    get hidden() {
      return hidden
    },
    addEventListener: (_type, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener)
    },
  }
  return {
    doc,
    listenerCount: () => listeners.size,
    setHidden(next: boolean) {
      hidden = next
      for (const l of [...listeners]) l()
    },
  }
}

describe('startAutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('intervalMs ごとに refresh を呼ぶ', async () => {
    const refresh = vi.fn()
    const handle = startAutoRefresh(refresh, { intervalMs: 1000, doc: null })
    await vi.advanceTimersByTimeAsync(3000)
    expect(refresh).toHaveBeenCalledTimes(3)
    handle.stop()
  })

  it('前回の refresh が完了するまで次の tick をスキップする', async () => {
    let resolve!: () => void
    const refresh = vi.fn(
      () => new Promise<void>((r) => { resolve = r }),
    )
    const handle = startAutoRefresh(refresh, { intervalMs: 1000, doc: null })

    // 3 interval 経過しても、最初の呼び出しが pending の間は 1 回のまま
    await vi.advanceTimersByTimeAsync(3000)
    expect(refresh).toHaveBeenCalledTimes(1)

    // 完了したら次の interval から再開する
    resolve()
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(2)
    handle.stop()
  })

  it('isPaused が true の間は tick をスキップする', async () => {
    let paused = true
    const refresh = vi.fn()
    const handle = startAutoRefresh(refresh, {
      intervalMs: 1000,
      isPaused: () => paused,
      doc: null,
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(refresh).not.toHaveBeenCalled()

    paused = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(1)
    handle.stop()
  })

  it('タブ非表示中は tick をスキップし、表示に戻った瞬間に 1 回実行する', async () => {
    const fake = createFakeDoc(true)
    const refresh = vi.fn()
    const handle = startAutoRefresh(refresh, { intervalMs: 1000, doc: fake.doc })

    await vi.advanceTimersByTimeAsync(3000)
    expect(refresh).not.toHaveBeenCalled()

    fake.setHidden(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    handle.stop()
  })

  it('refreshOnVisible: false なら表示復帰時に実行しない', async () => {
    const fake = createFakeDoc(true)
    const refresh = vi.fn()
    const handle = startAutoRefresh(refresh, {
      intervalMs: 1000,
      refreshOnVisible: false,
      doc: fake.doc,
    })
    fake.setHidden(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).not.toHaveBeenCalled()

    // 通常の interval では実行される
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(1)
    handle.stop()
  })

  it('runWhenHidden: true ならタブ非表示中も実行する', async () => {
    const fake = createFakeDoc(true)
    const refresh = vi.fn()
    const handle = startAutoRefresh(refresh, {
      intervalMs: 1000,
      runWhenHidden: true,
      doc: fake.doc,
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(refresh).toHaveBeenCalledTimes(2)
    handle.stop()
  })

  it('stop 後は tick も手動 refresh も実行されず、リスナーが解除される', async () => {
    const fake = createFakeDoc(false)
    const refresh = vi.fn()
    const handle = startAutoRefresh(refresh, { intervalMs: 1000, doc: fake.doc })
    expect(fake.listenerCount()).toBe(1)

    handle.stop()
    expect(fake.listenerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(3000)
    await handle.refresh()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('手動 refresh は hidden / isPaused でも実行される', async () => {
    const fake = createFakeDoc(true)
    const refresh = vi.fn()
    const handle = startAutoRefresh(refresh, {
      intervalMs: 1000,
      isPaused: () => true,
      doc: fake.doc,
    })
    await handle.refresh()
    expect(refresh).toHaveBeenCalledTimes(1)
    handle.stop()
  })

  it('手動 refresh も実行中は重複しない', async () => {
    let resolve!: () => void
    const refresh = vi.fn(
      () => new Promise<void>((r) => { resolve = r }),
    )
    const handle = startAutoRefresh(refresh, { intervalMs: 1000, doc: null })

    const first = handle.refresh()
    const second = handle.refresh() // busy 中 — no-op
    resolve()
    await Promise.all([first, second])
    expect(refresh).toHaveBeenCalledTimes(1)
    handle.stop()
  })

  it('refresh が reject してもポーリングは継続する', async () => {
    const refresh = vi
      .fn<[], Promise<void>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined)
    const handle = startAutoRefresh(refresh, { intervalMs: 1000, doc: null })
    await vi.advanceTimersByTimeAsync(2000)
    expect(refresh).toHaveBeenCalledTimes(2)
    handle.stop()
  })
})
