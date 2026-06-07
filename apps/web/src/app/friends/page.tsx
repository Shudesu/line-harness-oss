'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Tag } from '@line-crm/shared'
import { api, fetchApi } from '@/lib/api'
import type { FriendListItem } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendListTable from '@/components/friends/friend-list-table'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
} from '@/components/ui/primitives'

const ccPrompts = [
  {
    title: '友だちのセグメント分析',
    prompt: `友だち一覧のデータを分析してください。
1. タグ別の友だち数を集計
2. アクティブ率の高いセグメントを特定
3. エンゲージメントが低い層への施策を提案
レポート形式で出力してください。`,
  },
  {
    title: 'タグ一括管理',
    prompt: `友だちのタグを一括管理してください。
1. 未タグの友だちを特定
2. 行動履歴に基づいたタグ付け提案
3. 不要タグの整理
作業手順を示してください。`,
  },
]

const PAGE_SIZE = 20

type SortMode = 'recent' | 'oldest'
type ResponseFilter = 'all' | 'unhandled'
type BulkMode = 'add' | 'remove' | null

// Minimal API response shape for the bulk endpoints. They're not yet in
// the `api.friends.*` namespace so the page calls fetchApi directly.
// `data` may include per-friend pass/fail counts — we surface those so a
// partial failure (e.g. one friend already has the tag) doesn't look like
// "all good" in the toast.
type BulkApiResponse = {
  success: boolean
  error?: string
  data?: { succeeded?: number; failed?: number; total?: number } | unknown
}

function readBulkCounts(data: BulkApiResponse['data']): {
  succeeded?: number
  failed?: number
} {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const succeeded = typeof obj.succeeded === 'number' ? obj.succeeded : undefined
    const failed = typeof obj.failed === 'number' ? obj.failed : undefined
    return { succeeded, failed }
  }
  return {}
}

export default function FriendsPage() {
  const { selectedAccountId } = useAccount()
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Bulk selection state lives at the page level so that:
  // - the action bar (rendered as a sibling of the table) can read it
  // - filter / page / search changes can clear it in one place
  // - re-mounting the table on refresh doesn't lose the user's selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkMode, setBulkMode] = useState<BulkMode>(null)
  const [bulkTagId, setBulkTagId] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState('')
  const [bulkNotice, setBulkNotice] = useState('')

  // For the `/` keyboard shortcut.
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Modal's first focusable so screen-reader / keyboard users land inside
  // the dialog when it opens (basic focus-management; not a full trap).
  const bulkTagSelectRef = useRef<HTMLSelectElement>(null)

  const loadTags = useCallback(async () => {
    try {
      const res = await api.tags.list()
      if (res.success) setAllTags(res.data)
    } catch {
      // Non-blocking — tags used for filter
    }
  }, [])

  const loadFriends = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.friends.list({
        offset: String((page - 1) * PAGE_SIZE),
        limit: PAGE_SIZE,
        tagId: selectedTagId || undefined,
        accountId: selectedAccountId || undefined,
        search: searchSubmitted || undefined,
        includeChatStatus: true,
        sort: sortMode,
        handled: responseFilter === 'unhandled' ? 'unhandled' : undefined,
      })
      if (res.success) {
        setFriends(res.data.items)
        setTotal(res.data.total)
        setHasNextPage(res.data.hasNextPage)
      } else {
        setError(res.error)
      }
    } catch {
      setError('友だちの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [page, selectedTagId, selectedAccountId, searchSubmitted, sortMode, responseFilter])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  // Reset to page 1 when the account context switches. We use a ref to
  // remember the previous account id and reset synchronously inside the
  // same render that flips selectedAccountId — without this, the previous
  // (account_A, page=N) request fires first, then page resets to 1 and
  // the (account_B, page=1) request fires. If the first one resolves
  // last it overwrites page-1 with stale rows.
  const prevAccountRef = useRef(selectedAccountId)
  if (prevAccountRef.current !== selectedAccountId) {
    prevAccountRef.current = selectedAccountId
    if (page !== 1) setPage(1)
  }

  useEffect(() => {
    loadFriends()
  }, [loadFriends])

  // Clear selection whenever the visible page changes (pagination, filter,
  // search). Bulk operations only make sense against rows the user can see
  // — preserving stale ids across pages risks operating on the wrong set.
  useEffect(() => {
    setSelectedIds(new Set())
  }, [page, selectedTagId, selectedAccountId, searchSubmitted, sortMode, responseFilter])

  // Keyboard shortcuts: `/` to focus search, ESC to clear/reset search.
  // Skip when the user is mid-typing in another input/textarea/select to
  // avoid stealing keystrokes from forms (e.g. the inline tag editor).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const isEditable =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target?.isContentEditable ?? false)

      // ESC closes the bulk modal first — it's the topmost UI element when
      // open, and dismiss-on-ESC is the standard dialog contract.
      if (e.key === 'Escape' && bulkMode !== null) {
        e.preventDefault()
        setBulkMode(null)
        setBulkTagId('')
        setBulkError('')
        return
      }
      if (e.key === '/' && !isEditable && bulkMode === null) {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }
      if (e.key === 'Escape') {
        // Only act when the search input itself is focused, or nothing
        // editable is focused — otherwise ESC should be free to close
        // modals/expanders the user is interacting with.
        const inSearchInput = target === searchInputRef.current
        if (!inSearchInput && isEditable) return
        if (searchInput || searchSubmitted) {
          setSearchInput('')
          setSearchSubmitted('')
          setPage(1)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [searchInput, searchSubmitted, bulkMode])

  // Fan-out helpers: changing a filter also resets pagination synchronously,
  // so React batches both state updates into one re-render and `loadFriends`
  // fires exactly once with the new filter + page=1.
  const updateAndResetPage = (cb: () => void) => {
    cb()
    setPage(1)
  }
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateAndResetPage(() => setSearchSubmitted(searchInput.trim()))
  }
  // Clearing the input clears the active search even if the user doesn't
  // press 検索 again. Without this, "search Alice → clear input → change
  // tag" would keep filtering by Alice while the input box looks empty —
  // see codex feedback. Keeping a non-empty input that doesn't match
  // searchSubmitted is fine: the user is mid-edit, hasn't applied yet.
  const handleSearchInputChange = (v: string) => {
    setSearchInput(v)
    if (v.trim() === '' && searchSubmitted !== '') {
      updateAndResetPage(() => setSearchSubmitted(''))
    }
  }
  const handleSortChange = (v: SortMode) => updateAndResetPage(() => setSortMode(v))
  const handleResponseFilterChange = (v: ResponseFilter) => updateAndResetPage(() => setResponseFilter(v))
  const handleTagFilterChange = (v: string) => updateAndResetPage(() => setSelectedTagId(v))

  // Selection handlers passed down to the table.
  const toggleSelect = useCallback((friendId: string, next: boolean) => {
    setSelectedIds((prev) => {
      const out = new Set(prev)
      if (next) out.add(friendId)
      else out.delete(friendId)
      return out
    })
  }, [])
  const toggleSelectAll = useCallback(
    (next: boolean) => {
      setSelectedIds((prev) => {
        const out = new Set(prev)
        if (next) friends.forEach((f) => out.add(f.id))
        else friends.forEach((f) => out.delete(f.id))
        return out
      })
    },
    [friends],
  )

  const selectedCount = selectedIds.size
  const openBulkAdd = () => {
    setBulkMode('add')
    setBulkTagId('')
    setBulkError('')
  }
  const openBulkRemove = () => {
    setBulkMode('remove')
    setBulkTagId('')
    setBulkError('')
  }
  const closeBulk = () => {
    setBulkMode(null)
    setBulkTagId('')
    setBulkError('')
  }
  const clearSelection = () => setSelectedIds(new Set())

  const submitBulk = async () => {
    if (!bulkTagId || selectedCount === 0 || bulkMode === null) return
    setBulkBusy(true)
    setBulkError('')
    const ids = Array.from(selectedIds)
    try {
      let res: BulkApiResponse
      if (bulkMode === 'add') {
        res = await fetchApi<BulkApiResponse>('/api/friends/bulk/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ friendIds: ids, tagId: bulkTagId }),
        })
      } else {
        res = await fetchApi<BulkApiResponse>(`/api/friends/bulk/tags/${bulkTagId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ friendIds: ids }),
        })
      }
      if (res.success === false) {
        setBulkError(res.error ?? 'タグの一括更新に失敗しました')
        return
      }
      const tagName = allTags.find((t) => t.id === bulkTagId)?.name ?? 'タグ'
      const { succeeded, failed } = readBulkCounts(res.data)
      // Prefer server-reported counts when available — bulk APIs can
      // silently skip rows (e.g. tag already present / not present) and
      // claiming "全件 N 成功" hides that. Fall back to selection size.
      const okCount = succeeded ?? ids.length
      const ngCount = failed ?? 0
      const verb = bulkMode === 'add' ? '追加' : '削除'
      const target = bulkMode === 'add' ? 'に' : 'から'
      const baseMsg = `${okCount} 件${target}「${tagName}」を${verb}しました`
      setBulkNotice(ngCount > 0 ? `${baseMsg}（${ngCount} 件は失敗または対象外）` : baseMsg)
      closeBulk()
      clearSelection()
      loadFriends()
    } catch {
      setBulkError('タグの一括更新に失敗しました')
    } finally {
      setBulkBusy(false)
    }
  }

  // Auto-dismiss the success notice after 4 seconds so it doesn't linger.
  useEffect(() => {
    if (!bulkNotice) return
    const id = window.setTimeout(() => setBulkNotice(''), 4000)
    return () => window.clearTimeout(id)
  }, [bulkNotice])

  // Move keyboard focus into the bulk modal as it opens. Falls back to
  // a no-op if the select hasn't mounted yet (shouldn't happen since the
  // modal renders synchronously, but defensive).
  useEffect(() => {
    if (bulkMode !== null) {
      // Defer one tick so the element is in the DOM before focusing.
      const id = window.setTimeout(() => bulkTagSelectRef.current?.focus(), 0)
      return () => window.clearTimeout(id)
    }
  }, [bulkMode])

  // Tag picker options — for remove mode, show only tags currently present
  // on the selected friends (no point offering tags none of them have).
  const removableTags = useMemo(() => {
    if (bulkMode !== 'remove') return [] as Tag[]
    const present = new Set<string>()
    friends.forEach((f) => {
      if (!selectedIds.has(f.id)) return
      f.tags.forEach((t) => present.add(t.id))
    })
    return allTags.filter((t) => present.has(t.id))
  }, [bulkMode, friends, selectedIds, allTags])

  return (
    <div className="pb-24">
      <Header
        title="友だちリスト"
        description="友だちの検索や、詳細情報の確認ができます。"
      />

      {bulkNotice && (
        <Banner tone="success" className="mb-4">
          {bulkNotice}
        </Banner>
      )}

      {/* Search + sort bar — L-step style. Sticky so it stays accessible
          while the operator scrolls a long list. */}
      <Card className="mb-4 sticky top-0 z-10 bg-white/95 backdrop-blur-sm">
        <CardContent className="p-4">
          <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-gray-400"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="9" cy="9" r="6" />
                  <path strokeLinecap="round" d="M14 14l3.5 3.5" />
                </svg>
              </span>
              <Input
                ref={searchInputRef}
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                placeholder="友だち名を検索  (/ で検索にフォーカス)"
                className="mt-0 pl-8"
              />
            </div>
            <Select
              value={sortMode}
              onChange={(e) => handleSortChange(e.target.value as SortMode)}
              className="mt-0 sm:w-auto"
            >
              <option value="recent">友だち追加の新しい順</option>
              <option value="oldest">友だち追加の古い順</option>
            </Select>
            <Button type="submit" variant="primary">
              検索
            </Button>
          </form>

          {/* Secondary filters — タグ + 対応マーク */}
          <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-gray-600 whitespace-nowrap mb-0">タグ:</Label>
              <Select
                value={selectedTagId}
                onChange={(e) => handleTagFilterChange(e.target.value)}
                className="mt-0 w-auto text-xs py-1.5"
              >
                <option value="">すべて</option>
                {allTags.map((tag) => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-gray-600 whitespace-nowrap mb-0">対応マーク:</Label>
              <Select
                value={responseFilter}
                onChange={(e) => handleResponseFilterChange(e.target.value as ResponseFilter)}
                className="mt-0 w-auto text-xs py-1.5"
              >
                <option value="all">すべて</option>
                <option value="unhandled">未対応のみ</option>
              </Select>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Badge tone="neutral">
                {loading ? '読み込み中...' : `${total.toLocaleString('ja-JP')} 件`}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Banner tone="danger" className="mb-4">
          {error}
        </Banner>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 grid grid-cols-[40px_80px_220px_120px_1fr_280px] gap-3 animate-pulse">
              <div className="h-4 w-4 bg-gray-200 rounded" />
              <div className="h-5 bg-gray-100 rounded w-16" />
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-gray-200" />
                <div className="h-3 bg-gray-200 rounded w-24" />
              </div>
              <div className="h-3 bg-gray-100 rounded w-20" />
              <div className="space-y-2">
                <div className="h-3 bg-gray-100 rounded w-3/4" />
                <div className="h-2 bg-gray-100 rounded w-20" />
              </div>
              <div className="h-5 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : (
        <FriendListTable
          friends={friends}
          allTags={allTags}
          onRefresh={loadFriends}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
        />
      )}

      {!loading && total > 0 && (
        <Card className="mt-4">
          <CardContent className="p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-500">
                {((page - 1) * PAGE_SIZE) + 1}〜{Math.min(page * PAGE_SIZE, total)} 件 / 全{total.toLocaleString('ja-JP')}件
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="min-h-[44px]"
                >
                  前へ
                </Button>
                <span className="text-sm text-gray-600 px-1">{page} ページ</span>
                <Button
                  variant="outline"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasNextPage}
                  className="min-h-[44px]"
                >
                  次へ
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Floating bulk action bar (Linear/Notion style). Only visible when
          at least one row is selected. Sits on top of the page footer with
          a fixed transform-centered position so it stays put while the
          operator scrolls. */}
      {selectedCount > 0 && (
        <div
          role="region"
          aria-label="一括操作"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-gray-200 bg-white shadow-lg px-4 py-3 flex items-center gap-3 max-w-[calc(100vw-2rem)]"
        >
          <Badge tone="info">{selectedCount} 件選択中</Badge>
          <Button variant="primary" size="sm" onClick={openBulkAdd}>
            タグを一括追加
          </Button>
          <Button variant="outline" size="sm" onClick={openBulkRemove}>
            タグを一括削除
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            キャンセル
          </Button>
        </div>
      )}

      {/* Bulk tag picker modal. Backdrop click closes, ESC handled via
          window listener above (search-clear path is no-op when this
          modal isn't actually capturing keystrokes). */}
      {bulkMode !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-label={bulkMode === 'add' ? 'タグを一括追加' : 'タグを一括削除'}
          onClick={closeBulk}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">
                {bulkMode === 'add' ? 'タグを一括追加' : 'タグを一括削除'}
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                {selectedCount} 件の友だちに対して操作します
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <Label htmlFor="bulk-tag-select" className="mb-0">タグ</Label>
              <Select
                id="bulk-tag-select"
                ref={bulkTagSelectRef}
                value={bulkTagId}
                onChange={(e) => setBulkTagId(e.target.value)}
                className="mt-0"
              >
                <option value="">タグを選択...</option>
                {(bulkMode === 'add' ? allTags : removableTags).map((tag) => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </Select>
              {bulkMode === 'remove' && removableTags.length === 0 && (
                <p className="text-xs text-gray-500">
                  削除できるタグがありません（選択中の友だちにタグが付いていません）
                </p>
              )}
              {bulkError && (
                <Banner tone="danger">{bulkError}</Banner>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={closeBulk} disabled={bulkBusy}>
                キャンセル
              </Button>
              <Button
                variant={bulkMode === 'add' ? 'primary' : 'danger'}
                size="sm"
                onClick={submitBulk}
                disabled={!bulkTagId || bulkBusy}
              >
                {bulkBusy ? '実行中...' : bulkMode === 'add' ? '追加する' : '削除する'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
