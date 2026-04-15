'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import type { FriendWithTags, ApiBroadcast } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendTable from '@/components/friends/friend-table'
import CcPromptButton from '@/components/cc-prompt-button'
import FlexPreviewComponent from '@/components/flex-preview'
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

  // Selection & multicast state
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set())
  const [showMulticastModal, setShowMulticastModal] = useState(false)
  const [multicastForm, setMulticastForm] = useState({
    messageType: 'text' as ApiBroadcast['messageType'],
    messageContent: '',
  })
  const [multicastSending, setMulticastSending] = useState(false)
  const [multicastQueued, setMulticastQueued] = useState(false)

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

  const handleMulticastSend = async () => {
    if (selectedFriendIds.size === 0) return
    if (!multicastForm.messageContent.trim()) return

    if (multicastForm.messageType === 'flex') {
      try { JSON.parse(multicastForm.messageContent) } catch { setError('FlexメッセージのJSONが無効です'); return }
    }

    setMulticastSending(true)
    setError('')
    setMulticastQueued(false)
    try {
      const res = await api.broadcasts.multicastQueue({
        friendIds: Array.from(selectedFriendIds),
        messageType: multicastForm.messageType,
        messageContent: multicastForm.messageContent,
      })
      if (res.success) {
        setMulticastQueued(true)
        setSelectedFriendIds(new Set())
        setMulticastForm({ messageType: 'text', messageContent: '' })
        setShowMulticastModal(false)
      } else {
        setError(res.error)
      }
    } catch {
      setError('キューへの追加に失敗しました')
    } finally {
      setMulticastSending(false)
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
      </div>

      {/* Selection action bar */}
      {selectedFriendIds.size > 0 && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-medium text-green-800">
            {selectedFriendIds.size}人 選択中
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMulticastModal(true)}
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity"
              style={{ backgroundColor: '#06C755' }}
            >
              選択した人に配信
            </button>
            <button
              onClick={() => setSelectedFriendIds(new Set())}
              className="px-3 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              選択解除
            </button>
          </div>
        </div>
      )}

      {/* Multicast queued result */}
      {multicastQueued && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm flex items-center justify-between">
          <span>配信をキューに追加しました。配信管理ページで進捗を確認できます。</span>
          <button onClick={() => setMulticastQueued(false)} className="text-green-600 hover:text-green-800 text-xs">
            閉じる
          </button>
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
          selectedIds={selectedFriendIds}
          onSelectionChange={setSelectedFriendIds}
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

      {/* Multicast modal */}
      {showMulticastModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !multicastSending && setShowMulticastModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              {selectedFriendIds.size}人に配信
            </h3>

            <div className="space-y-4">
              {/* Message type */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">メッセージ種別</label>
                <div className="flex gap-2">
                  {(['text', 'image', 'flex'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setMulticastForm({ ...multicastForm, messageType: type })}
                      className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                        multicastForm.messageType === type
                          ? 'border-green-500 text-green-700 bg-green-50'
                          : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
                      }`}
                    >
                      {type === 'text' ? 'テキスト' : type === 'image' ? '画像' : 'Flexメッセージ'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Image helper */}
              {multicastForm.messageType === 'image' && (() => {
                let parsed: { originalContentUrl?: string; previewImageUrl?: string } = {}
                try { parsed = JSON.parse(multicastForm.messageContent) } catch { /* not yet valid */ }
                return (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">元画像URL</label>
                      <input
                        type="url"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="https://example.com/image.png"
                        value={parsed.originalContentUrl ?? ''}
                        onChange={(e) => {
                          const orig = e.target.value
                          const prev = parsed.previewImageUrl ?? orig
                          setMulticastForm({ ...multicastForm, messageContent: JSON.stringify({ originalContentUrl: orig, previewImageUrl: prev }) })
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">プレビュー画像URL</label>
                      <input
                        type="url"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="空欄で元画像と同じ"
                        value={parsed.previewImageUrl ?? ''}
                        onChange={(e) => {
                          const prev = e.target.value
                          setMulticastForm({ ...multicastForm, messageContent: JSON.stringify({ originalContentUrl: parsed.originalContentUrl ?? '', previewImageUrl: prev }) })
                        }}
                      />
                    </div>
                  </div>
                )
              })()}

              {/* Message content */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  メッセージ内容 <span className="text-red-500">*</span>
                </label>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                  rows={multicastForm.messageType === 'flex' ? 8 : 4}
                  placeholder={
                    multicastForm.messageType === 'text'
                      ? '配信するメッセージを入力...'
                      : multicastForm.messageType === 'image'
                      ? '{"originalContentUrl":"...","previewImageUrl":"..."}'
                      : '{"type":"bubble","body":{...}}'
                  }
                  value={multicastForm.messageContent}
                  onChange={(e) => setMulticastForm({ ...multicastForm, messageContent: e.target.value })}
                  style={{ fontFamily: multicastForm.messageType !== 'text' ? 'monospace' : 'inherit' }}
                />
              </div>

              {/* Flex preview */}
              {multicastForm.messageType === 'flex' && multicastForm.messageContent && (() => {
                try { JSON.parse(multicastForm.messageContent); return true } catch { return false }
              })() && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">プレビュー</p>
                  <FlexPreviewComponent content={multicastForm.messageContent} maxWidth={280} />
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleMulticastSend}
                  disabled={multicastSending || !multicastForm.messageContent.trim()}
                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {multicastSending ? '送信中...' : `${selectedFriendIds.size}人に配信`}
                </button>
                <button
                  onClick={() => setShowMulticastModal(false)}
                  disabled={multicastSending}
                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
