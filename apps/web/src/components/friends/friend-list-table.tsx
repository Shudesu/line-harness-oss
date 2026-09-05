'use client'

import { useState } from 'react'
import { PlusIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Select } from '@cloudflare/kumo/components/select'
import type { Tag } from '@line-crm/shared'
import type { FriendListItem } from '@/lib/api'
import { api } from '@/lib/api'
import FriendListRow from './friend-list-row'
import TagBadge from './tag-badge'

interface Props {
  friends: FriendListItem[]
  allTags: Tag[]
  onRefresh: () => void
}

export default function FriendListTable({ friends, allTags, onRefresh }: Props) {
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
      await api.friends.addTag(friendId, selectedTagId)
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
      await api.friends.removeTag(friendId, tagId)
      onRefresh()
    } catch {
      setError('タグの削除に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  if (friends.length === 0) {
    return (
      <Empty size="sm" title="友だちが見つかりません" description="検索条件や絞り込みを変更してお試しください。" />
    )
  }

  return (
    <LayerCard className="overflow-hidden p-0">
      {error ? <Banner variant="error" title="タグを更新できませんでした" description={error} /> : null}

      {/* Header sits inside the same overflow container as the body so the
          column labels stay aligned with their values when the user scrolls
          horizontally on narrower viewports (e.g. desktop with sidebar open
          and the body forced to min-w-[900px]). */}
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="hidden grid-cols-[80px_220px_120px_1fr_280px] gap-3 border-b border-kumo-line bg-kumo-tint px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-kumo-subtle lg:grid">
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
                />

                {isExpanded && (
                  <div className="space-y-3 border-b border-kumo-line bg-kumo-tint px-6 py-4">
                    <div>
                      <p className="mb-1 text-xs font-semibold text-kumo-subtle">LINE ユーザーID</p>
                      <p className="select-all break-all font-mono text-xs text-kumo-default">{friend.lineUserId}</p>
                    </div>
                    <p className="mb-2 text-xs font-semibold text-kumo-subtle">タグ管理</p>
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
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          size="sm"
                          aria-label="追加するタグ"
                          value={selectedTagId}
                          onValueChange={(value) => setSelectedTagId(value ?? '')}
                          placeholder="タグを選択"
                          items={availableTags.map((tag) => ({ value: tag.id, label: tag.name }))}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          onClick={() => handleAddTag(friend.id)}
                          disabled={!selectedTagId || loading}
                          loading={loading}
                        >
                          追加
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => { setAddingTagForFriend(null); setSelectedTagId('') }}
                        >
                          キャンセル
                        </Button>
                      </div>
                    ) : (
                      availableTags.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          icon={PlusIcon}
                          onClick={() => setAddingTagForFriend(friend.id)}
                        >
                          タグを追加
                        </Button>
                      )
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </LayerCard>
  )
}
