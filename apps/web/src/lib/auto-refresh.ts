/**
 * 自動更新 (ポーリング) の共通スケジューラ。
 *
 * 管理画面は Cloudflare Pages 上の静的 SPA で、Webhook 受信や MCP / API 経由の
 * アクションはサーバ側 (Workers) だけで起こるため、開きっぱなしの画面には
 * 手動リロードするまで反映されない。SSE / WebSocket を Workers で提供するには
 * Durable Objects が必要になるため、まずは各画面が軽量なポーリングで新着を
 * 追従する。ここはその共通実装で、画面ごとに再実装されがちな以下を一元化する:
 *
 * - タブ非表示中の停止 (見ていない画面のために API を叩かない)
 * - タブ復帰時の即時更新 (最大ポーリング間隔ぶんの表示遅延を解消)
 * - 実行中 tick の重複防止 (レスポンス遅延時にリクエストを並走させない)
 * - 呼び出し側都合の一時停止 (送信中の楽観更新と競合させない等)
 *
 * React コンポーネントからは `useAutoRefresh` (hooks/use-auto-refresh.ts) を使う。
 * このモジュール自体は DOM グローバルに直接依存しない (visibility は注入可能)
 * ので、Node 環境の vitest でそのままテストできる。
 */

/** `document` のうちスケジューラが使う可視性まわりだけを切り出した型 (テスト注入用)。 */
export interface VisibilityDocument {
  readonly hidden: boolean
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export interface AutoRefreshOptions {
  /** ポーリング間隔 (ms)。対象 API の重さに応じて画面側で決める。 */
  intervalMs: number
  /**
   * true を返す間は tick をスキップする。
   * 例: メッセージ送信中に楽観更新をサーバの古いレスポンスで巻き戻さない。
   */
  isPaused?: () => boolean
  /** タブ非表示中も tick する (既定 false = 停止)。 */
  runWhenHidden?: boolean
  /** タブが表示に戻った瞬間に 1 回 tick する (既定 true)。 */
  refreshOnVisible?: boolean
  /** visibility の取得元。省略時はグローバル document (SSR/テストでは null 可)。 */
  doc?: VisibilityDocument | null
}

export interface AutoRefreshHandle {
  /**
   * 手動で即時更新する。ユーザー操作やアプリ内イベント起点の更新に使うため、
   * hidden / isPaused のガードは通さない (重複実行ガードだけ効く)。
   */
  refresh: () => Promise<void>
  /** ポーリングを停止しリスナーを解除する。以後 refresh() も no-op。 */
  stop: () => void
}

function defaultDoc(): VisibilityDocument | null {
  return typeof document === 'undefined' ? null : document
}

/**
 * ポーリングを開始する。戻り値の `stop()` で必ず後始末すること
 * (React からは `useAutoRefresh` が effect cleanup として面倒を見る)。
 *
 * `refresh` が reject してもポーリングは継続する (一時的なネットワーク断で
 * 自動更新が死なないように)。エラー表示が必要な画面は `refresh` 側で処理する。
 */
export function startAutoRefresh(
  refresh: () => void | Promise<void>,
  options: AutoRefreshOptions,
): AutoRefreshHandle {
  const {
    intervalMs,
    isPaused,
    runWhenHidden = false,
    refreshOnVisible = true,
    doc = defaultDoc(),
  } = options

  let stopped = false
  let busy = false

  // busy ガードを通した 1 回分の実行。tick / 手動 refresh の両方がここを通る
  // ので、ポーリングと手動更新が並走してもリクエストは常に 1 本に保たれる。
  const run = async (): Promise<void> => {
    if (stopped || busy) return
    busy = true
    try {
      await refresh()
    } catch {
      // 呼び出し側で処理される想定。ここでは次回の tick を止めないことが責務。
    } finally {
      busy = false
    }
  }

  const tick = (): void => {
    if (stopped) return
    if (doc && doc.hidden && !runWhenHidden) return
    if (isPaused?.()) return
    void run()
  }

  const intervalId = setInterval(tick, intervalMs)

  const onVisibilityChange = (): void => {
    if (refreshOnVisible && doc && !doc.hidden) tick()
  }
  doc?.addEventListener('visibilitychange', onVisibilityChange)

  return {
    refresh: () => run(),
    stop: () => {
      stopped = true
      clearInterval(intervalId)
      doc?.removeEventListener('visibilitychange', onVisibilityChange)
    },
  }
}
