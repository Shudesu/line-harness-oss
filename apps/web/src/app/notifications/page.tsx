'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Header from '@/components/layout/header'
import InboxFilters from '@/components/inbox/inbox-filters'
import InboxList from '@/components/inbox/inbox-list'
import InboxSummaryBar from '@/components/inbox/inbox-summary-bar'
import { Banner } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import type { InboxRowData } from '@/components/inbox/inbox-row'

const PAGE_SIZE = 50
const POLL_INTERVAL_MS = 30_000
// 全件 fetch の上限。worker 側 MAX_PAGE_SIZE と一致させる。222 件規模で
// 余裕を持って 1〜2 年の運用カバー。これを超えるとサマリーに警告を出す
// (Codex Round 1 指摘: サイレント切り捨て防止)。
const FETCH_PAGE_SIZE = 2000

interface AccountOption {
  id: string
  name: string
}

export default function InboxPage() {
  const { selectedAccountId } = useAccount()
  const [allRows, setAllRows] = useState<InboxRowData[]>([])
  // サーバが返す真の総件数 (2000件超のとき allRows は capped されるので別途保持)。
  // Codex Round 2 指摘: summary.total を allRows.length から取ると under-report。
  const [serverTotal, setServerTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [account, setAccount] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([])

  // 重複 polling で古いレスポンスが新しいデータを上書きしないように世代管理
  // (Codex Round 1 指摘: race condition)。
  const requestSeqRef = useRef(0)

  // 検索/account/overdue を変えたらページを1に戻す
  useEffect(() => {
    setPage(1)
  }, [q, account, overdueOnly])

  // Active なアカウントを候補に出す
  useEffect(() => {
    api.lineAccounts.list().then((res) => {
      if (res.success) {
        setAccountOptions(
          res.data
            .filter((a) => a.isActive)
            .map((a) => ({ id: a.id, name: a.name }))
            .sort((x, y) => x.name.localeCompare(y.name)),
        )
      }
    })
  }, [])

  const loadAll = useCallback(async () => {
    if (!selectedAccountId) {
      // Server now enforces account boundary on /api/inbox/unanswered.
      // Without a selected account we can't fetch meaningful data — hold
      // the loading state so the empty list isn't mistaken for "no rows".
      return
    }
    const seq = ++requestSeqRef.current
    setLoading(true)
    setError('')
    try {
      const res = await api.inbox.unanswered.list({
        account: selectedAccountId,
        page: 1,
        pageSize: FETCH_PAGE_SIZE,
      })
      // 古いリクエストが新しいリクエストの後に到着したら破棄
      if (seq !== requestSeqRef.current) return
      if (res.success) {
        setAllRows(res.data.rows)
        setServerTotal(res.data.total)
        // rows.length < total なら上限ヒット (capped)。バナーで明示。
        setTruncated(res.data.total > res.data.rows.length)
      } else {
        setError('取得に失敗しました')
        // allRows は前回値を保持して stale-while-error
      }
    } catch {
      if (seq !== requestSeqRef.current) return
      setError('取得に失敗しました')
    } finally {
      if (seq === requestSeqRef.current) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    loadAll()
    const id = setInterval(loadAll, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [loadAll])

  // ── client-side filter ──
  const filteredRows = useMemo(() => {
    const qLower = q.trim().toLowerCase()
    const cutoff = overdueOnly ? Date.now() - 60 * 60_000 : null
    return allRows.filter((r) => {
      if (account && r.accountId !== account) return false
      if (cutoff !== null && new Date(r.lastIncomingAt).getTime() > cutoff) return false
      if (qLower && !(r.displayName?.toLowerCase().includes(qLower) ?? false)) return false
      return true
    })
  }, [allRows, q, account, overdueOnly])

  // ── サマリー集計（allRows 全体から計算、フィルタ無視）──
  const summary = useMemo(() => {
    const byAccountMap = new Map<string, { accountName: string; count: number }>()
    let oldest: string | null = null
    for (const r of allRows) {
      const existing = byAccountMap.get(r.accountId)
      if (existing) existing.count++
      else byAccountMap.set(r.accountId, { accountName: r.accountName, count: 1 })
      if (oldest === null || r.lastIncomingAt < oldest) oldest = r.lastIncomingAt
    }
    const byAccount = [...byAccountMap.entries()]
      .map(([accountId, v]) => ({ accountId, accountName: v.accountName, count: v.count }))
      .sort((a, b) => b.count - a.count)
    const oldestWaitMinutes =
      oldest !== null
        ? Math.max(0, Math.floor((Date.now() - new Date(oldest).getTime()) / 60_000))
        : null
    // total はサーバ由来 (capped 時も真の総件数を表示する)。
    // byAccount / oldestWaitMinutes は allRows 集計なので capped 時は近似値、
    // truncated バナーで補足する。
    return { total: serverTotal, byAccount, oldestWaitMinutes }
  }, [allRows, serverTotal])

  // ── pagination ──
  const total = filteredRows.length
  const pagedRows = useMemo(
    () => filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredRows, page],
  )

  return (
    <div className="space-y-6">
      <Header
        title="未対応インボックス"
        description="人間が返事してない LINE 会話の triage。auto_reply は人間の返事に数えない。"
      />

      <InboxSummaryBar
        total={summary.total}
        byAccount={summary.byAccount}
        oldestWaitMinutes={summary.oldestWaitMinutes}
      />

      <InboxFilters
        q={q}
        account={account}
        overdueOnly={overdueOnly}
        accountOptions={accountOptions}
        onChange={(next) => {
          if (next.q !== undefined) setQ(next.q)
          if (next.account !== undefined) setAccount(next.account)
          if (next.overdueOnly !== undefined) setOverdueOnly(next.overdueOnly)
        }}
      />

      {!selectedAccountId && (
        <Banner tone="warning">
          アカウントを選択してください。サーバ側で account 境界を要求するようになったため、未選択時は取得を保留します。
        </Banner>
      )}

      {error && <Banner tone="warning">{error}</Banner>}

      {truncated && (
        <Banner tone="danger">
          未対応が {FETCH_PAGE_SIZE} 件の表示上限に到達しました。古いデータが見えていない可能性があります。サーバ側ページネーション復帰を検討してください。
        </Banner>
      )}

      <InboxList
        rows={pagedRows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        loading={loading}
        onPageChange={setPage}
      />
    </div>
  )
}
