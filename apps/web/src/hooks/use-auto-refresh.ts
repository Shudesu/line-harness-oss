'use client'

/**
 * 自動更新 (ポーリング) の React フック。実体は lib/auto-refresh.ts の
 * 共通スケジューラで、このフックはライフサイクル管理だけを担う。
 *
 * 使い方:
 *
 *   // 10 秒ごとに一覧を再取得 (タブ非表示中は停止、復帰時に即時更新)
 *   useAutoRefresh(reload, { intervalMs: 10_000 })
 *
 *   // 送信中だけ 3 秒ごとに進捗を追う (完了したら自動停止)
 *   useAutoRefresh(fetchProgress, { intervalMs: 3000, enabled: status === 'sending' })
 *
 *   // アプリ内イベントから手動で即時更新
 *   const { refresh } = useAutoRefresh(fetchCount, { intervalMs: 5 * 60_000 })
 *
 * `refresh` / `isPaused` は最新のクロージャが ref 経由で呼ばれるため、
 * 呼び出し側で useCallback で固定する必要はない (依存が変わっても
 * インターバルは張り直されない)。
 */

import { useCallback, useEffect, useRef } from 'react'
import { startAutoRefresh, type AutoRefreshHandle } from '@/lib/auto-refresh'

export interface UseAutoRefreshOptions {
  /** ポーリング間隔 (ms)。対象 API の重さに応じて画面側で決める。 */
  intervalMs: number
  /** false の間はポーリングしない (条件付きポーリング用。既定 true)。 */
  enabled?: boolean
  /** true を返す間は tick をスキップする (例: 送信中は楽観更新と競合させない)。 */
  isPaused?: () => boolean
  /** タブ非表示中も tick する (既定 false = 停止)。 */
  runWhenHidden?: boolean
  /** タブが表示に戻った瞬間に 1 回 tick する (既定 true)。 */
  refreshOnVisible?: boolean
}

export function useAutoRefresh(
  refresh: () => void | Promise<void>,
  options: UseAutoRefreshOptions,
): { refresh: () => Promise<void> } {
  const { intervalMs, enabled = true, runWhenHidden, refreshOnVisible } = options

  // 最新のコールバックを ref に保持し、インターバルを張り直さずに
  // 常に最新の state / props を参照できるようにする (stale closure 対策)。
  const refreshRef = useRef(refresh)
  useEffect(() => { refreshRef.current = refresh })
  const isPausedRef = useRef(options.isPaused)
  useEffect(() => { isPausedRef.current = options.isPaused })

  const handleRef = useRef<AutoRefreshHandle | null>(null)

  useEffect(() => {
    if (!enabled) return
    const handle = startAutoRefresh(() => refreshRef.current(), {
      intervalMs,
      runWhenHidden,
      refreshOnVisible,
      isPaused: () => isPausedRef.current?.() ?? false,
    })
    handleRef.current = handle
    return () => {
      handleRef.current = null
      handle.stop()
    }
  }, [intervalMs, enabled, runWhenHidden, refreshOnVisible])

  // 手動即時更新。ポーリング停止中 (enabled: false) でも動くように、
  // ハンドルが無ければコールバックを直接呼ぶ。
  const manualRefresh = useCallback(async () => {
    if (handleRef.current) {
      await handleRef.current.refresh()
    } else {
      await refreshRef.current()
    }
  }, [])

  return { refresh: manualRefresh }
}
