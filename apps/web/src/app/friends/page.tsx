'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import type { FriendWithTags } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendTable from '@/components/friends/friend-table'
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

interface SyncProgress {
  pages: number
  processed: number
  created: number
  updated: number
  failed: number
  done: boolean
  error?: string
}

export default function FriendsPage() {
  const { selectedAccountId } = useAccount()
  const [friends, setFriends] = useState<FriendWithTags[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)

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
      const params: Record<string, string> = {
        offset: String((page - 1) * PAGE_SIZE),
        limit: String(PAGE_SIZE),
      }
      if (selectedTagId) params.tagId = selectedTagId
      if (selectedAccountId) params.accountId = selectedAccountId

      const res = await api.friends.list(params)
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
  }, [page, selectedTagId, selectedAccountId])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  useEffect(() => {
    setPage(1)
  }, [selectedTagId, selectedAccountId])

  useEffect(() => {
    loadFriends()
  }, [loadFriends])

  const handleTagFilter = (tagId: string) => {
    setSelectedTagId(tagId)
  }

  const handleSyncFollowers = async () => {
    if (!selectedAccountId || syncing) return
    if (!window.confirm('LINE 公式アカウントから友だち一覧を取得し、DB に反映します。\n友だちが多い場合は数分かかります。実行しますか？')) {
      return
    }
    setSyncing(true)
    setError('')
    const progress: SyncProgress = { pages: 0, processed: 0, created: 0, updated: 0, failed: 0, done: false }
    setSyncProgress({ ...progress })
    let cursor: string | undefined = undefined
    try {
      // Drive the LINE followers/ids cursor from the client so each request
      // stays within the Worker's safe execution budget. The server pages 300
      // IDs per call (capped at 1000), so a 10k-friend account is ~34 calls.
      while (!progress.done) {
        const res = await api.lineAccounts.syncFollowers(selectedAccountId, { start: cursor })
        if (!res.success) throw new Error(res.error || 'sync failed')
        const { processed, created, updated, failed, next, done } = res.data
        progress.pages += 1
        progress.processed += processed
        progress.created += created
        progress.updated += updated
        progress.failed += failed
        progress.done = done
        setSyncProgress({ ...progress })
        cursor = next ?? undefined
        if (done) break
      }
      // Refresh list so newly imported friends show up
      await loadFriends()
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown'
      progress.error = detail
      setSyncProgress({ ...progress })
      setError(`同期に失敗しました: ${detail}`)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      <Header title="友だち管理" />

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 font-medium whitespace-nowrap">タグで絞り込み:</label>
          <select
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] bg-white focus:outline-none focus:ring-2 focus:ring-green-500 flex-1 sm:flex-none"
            value={selectedTagId}
            onChange={(e) => handleTagFilter(e.target.value)}
          >
            <option value="">すべて</option>
            {allTags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </select>
        </div>
        <span className="text-sm text-gray-500">
          {loading ? '読み込み中...' : `${total.toLocaleString('ja-JP')} 件`}
        </span>
        <div className="sm:ml-auto">
          <button
            onClick={handleSyncFollowers}
            disabled={!selectedAccountId || syncing}
            title={!selectedAccountId ? 'アカウントを選択してください' : 'LINE 公式アカウントから友だちを取得して DB に反映'}
            className="px-3 py-2 min-h-[44px] text-sm font-medium rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{ backgroundColor: '#06C755' }}
          >
            {syncing ? '同期中...' : 'LINE から友だち同期'}
          </button>
        </div>
      </div>

      {/* Sync progress */}
      {syncProgress && (
        <div className={`mb-4 p-4 rounded-lg text-sm border ${
          syncProgress.error
            ? 'bg-red-50 border-red-200 text-red-700'
            : syncProgress.done
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-blue-50 border-blue-200 text-blue-700'
        }`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              {syncProgress.error
                ? `同期エラー: ${syncProgress.error}`
                : syncProgress.done
                  ? '同期が完了しました'
                  : `同期中... (ページ ${syncProgress.pages})`}
            </div>
            <button
              onClick={() => setSyncProgress(null)}
              className="text-xs underline opacity-70 hover:opacity-100"
            >
              閉じる
            </button>
          </div>
          <div className="mt-1 text-xs">
            処理: {syncProgress.processed} 件 / 新規: {syncProgress.created} / 更新: {syncProgress.updated}
            {syncProgress.failed > 0 && ` / 失敗: ${syncProgress.failed}`}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex items-center gap-4 animate-pulse">
              <div className="w-9 h-9 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-32" />
                <div className="h-2 bg-gray-100 rounded w-20" />
              </div>
              <div className="h-5 bg-gray-100 rounded-full w-16" />
              <div className="h-5 bg-gray-100 rounded-full w-12" />
              <div className="h-3 bg-gray-100 rounded w-20" />
            </div>
          ))}
        </div>
      ) : (
        <FriendTable
          friends={friends}
          allTags={allTags}
          onRefresh={loadFriends}
        />
      )}

      {/* Pagination */}
      {!loading && total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-4">
          <p className="text-sm text-gray-500">
            {((page - 1) * PAGE_SIZE) + 1}〜{Math.min(page * PAGE_SIZE, total)} 件 / 全{total.toLocaleString('ja-JP')}件
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              前へ
            </button>
            <span className="text-sm text-gray-600 px-1">{page} ページ</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNextPage}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              次へ
            </button>
          </div>
        </div>
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
