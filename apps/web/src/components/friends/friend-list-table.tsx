'use client'

import { useEffect, useRef, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import type { FriendListItem } from '@/lib/api'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import FriendListRow from './friend-list-row'
import TagBadge from './tag-badge'

interface Props {
  friends: FriendListItem[]
  allTags: Tag[]
  onRefresh: () => void
  // Multi-select (Linear/Notion style bulk operations). Owned by the page
  // so selection state survives across rerenders and is cleared on page
  // navigation. When `selectedIds` is omitted the checkbox column hides.
  selectedIds?: Set<string>
  onToggleSelect?: (friendId: string, next: boolean) => void
  onToggleSelectAll?: (next: boolean) => void
}

export default function FriendListTable({
  friends,
  allTags,
  onRefresh,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: Props) {
  const { selectedAccountId } = useAccount()
  // Inline tag-management expander. The row's primary click navigates to
  // /chats; tag editing stays available here as a secondary action because
  // the chats page's FriendInfoSidebar currently only displays tags (no
  // add/remove). Without this expander operators would lose the only path
  // to mutate friend tags from the admin UI.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [addingTagForFriend, setAddingTagForFriend] = useState<string | null>(null)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Header checkbox: native HTML can't express "indeterminate" via JSX
  // attribute, so reach into the DOM whenever the selection cardinality
  // changes (none / some / all). Without this the master toggle would
  // look "checked" while only partial rows are selected.
  const selectionEnabled = selectedIds !== undefined && onToggleSelect !== undefined && onToggleSelectAll !== undefined
  const visibleIds = friends.map((f) => f.id)
  const selectedOnPage = selectionEnabled
    ? visibleIds.filter((id) => selectedIds!.has(id)).length
    : 0
  const allSelectedOnPage = selectionEnabled && visibleIds.length > 0 && selectedOnPage === visibleIds.length
  const someSelectedOnPage = selectionEnabled && selectedOnPage > 0 && !allSelectedOnPage
  const headerCheckboxRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelectedOnPage
    }
  }, [someSelectedOnPage])

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id)
    setAddingTagForFriend(null)
    setSelectedTagId('')
    setError('')
  }

  const handleAddTag = async (friendId: string) => {
    if (!selectedTagId) return
    setLoading(true)
    setError('')
    try {
      await api.friends.addTag(friendId, selectedTagId, selectedAccountId)
      setAddingTagForFriend(null)
      setSelectedTagId('')
      onRefresh()
    } catch {
      setError('タグの追加に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveTag = async (friendId: string, tagId: string) => {
    setLoading(true)
    setError('')
    try {
      await api.friends.removeTag(friendId, tagId, selectedAccountId)
      onRefresh()
    } catch {
      setError('タグの削除に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  if (friends.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
        <p className="text-gray-500">友だちが見つかりません</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Header sits inside the same overflow container as the body so the
          column labels stay aligned with their values when the user scrolls
          horizontally on narrower viewports (e.g. desktop with sidebar open
          and the body forced to min-w-[900px]). */}
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <div
            className={
              selectionEnabled
                ? 'hidden lg:grid grid-cols-[40px_80px_220px_120px_1fr_280px] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wider'
                : 'hidden lg:grid grid-cols-[80px_220px_120px_1fr_280px] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wider'
            }
          >
            {selectionEnabled && (
              <div className="flex items-center">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  checked={allSelectedOnPage}
                  onChange={(e) => onToggleSelectAll!(e.target.checked)}
                  aria-label="このページの友だちをすべて選択"
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </div>
            )}
            <div>対応マーク</div>
            <div>名前</div>
            <div>シナリオ</div>
            <div>受信メッセージ</div>
            <div>★つきタグ・友だち情報</div>
          </div>
          {friends.map((friend) => {
            const isExpanded = expandedId === friend.id
            const isAddingTag = addingTagForFriend === friend.id
            const availableTags = allTags.filter(
              (t) => !friend.tags.some((ft) => ft.id === t.id),
            )

            return (
              <div key={friend.id}>
                <FriendListRow
                  friend={friend}
                  onTagEditClick={() => toggleExpand(friend.id)}
                  selected={selectionEnabled ? selectedIds!.has(friend.id) : undefined}
                  onSelectChange={
                    selectionEnabled
                      ? (next) => onToggleSelect!(friend.id, next)
                      : undefined
                  }
                />

                {isExpanded && (
                  <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-1">LINE ユーザーID</p>
                      <p className="text-xs text-gray-600 font-mono break-all select-all">{friend.lineUserId}</p>
                    </div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">タグ管理</p>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {friend.tags.map((tag) => (
                        <TagBadge
                          key={tag.id}
                          tag={tag}
                          onRemove={() => handleRemoveTag(friend.id, tag.id)}
                        />
                      ))}
                    </div>

                    {isAddingTag ? (
                      <div className="flex items-center gap-2">
                        <select
                          className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
                          value={selectedTagId}
                          onChange={(e) => setSelectedTagId(e.target.value)}
                        >
                          <option value="">タグを選択...</option>
                          {availableTags.map((tag) => (
                            <option key={tag.id} value={tag.id}>{tag.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAddTag(friend.id)}
                          disabled={!selectedTagId || loading}
                          className="px-3 py-1 text-xs font-medium rounded-md text-white disabled:opacity-50 transition-opacity"
                          style={{ backgroundColor: '#06C755' }}
                        >
                          追加
                        </button>
                        <button
                          onClick={() => { setAddingTagForFriend(null); setSelectedTagId('') }}
                          className="px-3 py-1 text-xs font-medium rounded-md text-gray-600 bg-gray-200 hover:bg-gray-300 transition-colors"
                        >
                          キャンセル
                        </button>
                      </div>
                    ) : (
                      availableTags.length > 0 && (
                        <button
                          onClick={() => setAddingTagForFriend(friend.id)}
                          className="text-xs font-medium text-green-600 hover:text-green-700 flex items-center gap-1 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          タグを追加
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
