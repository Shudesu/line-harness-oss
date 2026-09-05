'use client'

import { useState, useEffect, useCallback } from 'react'
import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Pagination } from '@cloudflare/kumo/components/pagination'
import { Select } from '@cloudflare/kumo/components/select'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import type { FriendListItem } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendListTable from '@/components/friends/friend-list-table'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'

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

export default function FriendsPage() {
  const { selectedAccountId } = useAccount()
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  // Reset the URL-style account context to page 1 in a separate effect.
  // For user-driven filter changes (search/sort/handled/tag) we reset
  // page synchronously inside the handlers below — that avoids the
  // double-fetch race where the old `page` request resolves after the
  // new `page=1` request and overwrites the correct page-1 rows.
  useEffect(() => {
    setPage(1)
  }, [selectedAccountId])

  useEffect(() => {
    loadFriends()
  }, [loadFriends])

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

  return (
    <div>
      <Header
        title="友だちリスト"
        description="友だちの検索や、詳細情報の確認ができます。"
      />

      <LayerCard className="mb-4 p-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            placeholder="友だち名を検索"
            aria-label="友だち名"
            className="flex-1"
          />
          <Select
            value={sortMode}
            onValueChange={(value) => handleSortChange((value ?? 'recent') as SortMode)}
            aria-label="並び順"
            items={{ recent: '友だち追加の新しい順', oldest: '友だち追加の古い順' }}
          />
          <Button type="submit" variant="primary" icon={MagnifyingGlassIcon}>
            検索
          </Button>
        </form>

        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-kumo-line pt-3">
          <Select
            size="sm"
            label="タグ"
            value={selectedTagId}
            onValueChange={(value) => handleTagFilterChange(value ?? '')}
            items={[{ value: '', label: 'すべて' }, ...allTags.map((tag) => ({ value: tag.id, label: tag.name }))]}
          />
          <Select
            size="sm"
            label="対応マーク"
            value={responseFilter}
            onValueChange={(value) => handleResponseFilterChange((value ?? 'all') as ResponseFilter)}
            items={{ all: 'すべて', unhandled: '未対応のみ' }}
          />
          <span className="ml-auto pb-1 text-xs text-kumo-subtle">
            {loading ? '読み込み中' : `${total.toLocaleString('ja-JP')} 件`}
          </span>
        </div>
      </LayerCard>

      {error ? <Banner className="mb-4" variant="error" title="友だちを読み込めませんでした" description={error} /> : null}

      {loading ? (
        <LayerCard className="flex min-h-48 items-center justify-center gap-2 text-sm text-kumo-subtle">
          <Loader size="sm" /> 友だちを読み込み中
        </LayerCard>
      ) : (
        <FriendListTable friends={friends} allTags={allTags} onRefresh={loadFriends} />
      )}

      {!loading && total > 0 && (
        <Pagination
          className="mt-4"
          page={page}
          setPage={setPage}
          perPage={PAGE_SIZE}
          totalCount={total}
          labels={{ navigation: '友だち一覧のページ', firstPage: '最初のページ', previousPage: '前のページ', nextPage: '次のページ', lastPage: '最後のページ', pageNumber: 'ページ番号' }}
        >
          <Pagination.Info>{({ pageShowingRange }) => `${pageShowingRange}件 / 全${total.toLocaleString('ja-JP')}件`}</Pagination.Info>
          <Pagination.Controls controls="full" pageSelector="input" />
        </Pagination>
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
