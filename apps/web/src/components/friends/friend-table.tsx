'use client'

import { Fragment, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import type { FriendWithTags } from '@/lib/api'
import { api } from '@/lib/api'
import TagBadge from './tag-badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Select } from '@cloudflare/kumo/components/select'
import { Table } from '@cloudflare/kumo/components/table'

interface FriendTableProps {
  friends: FriendWithTags[]
  allTags: Tag[]
  onRefresh: () => void
}

export default function FriendTable({ friends, allTags, onRefresh }: FriendTableProps) {
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

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  if (friends.length === 0) {
    return (
      <Empty title="友だちが見つかりません" description="検索条件や絞り込みを変更してください。" />
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {error && <Banner variant="error" title="タグ操作に失敗しました" description={error} />}
      <div className="overflow-x-auto">
      <Table className="w-full min-w-[640px]">
        <Table.Header>
          <Table.Row>
            <Table.Head>アイコン / 表示名</Table.Head>
            <Table.Head>ステータス</Table.Head>
            <Table.Head>タグ / 流入</Table.Head>
            <Table.Head>登録日</Table.Head>
            <Table.Head />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {friends.map((friend) => {
            const isExpanded = expandedId === friend.id
            const isAddingTag = addingTagForFriend === friend.id
            const availableTags = allTags.filter(
              (t) => !friend.tags.some((ft) => ft.id === t.id)
            )

            return (
              <Fragment key={friend.id}>
                <Table.Row
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => toggleExpand(friend.id)}
                >
                  {/* Avatar + Name */}
                  <Table.Cell>
                    <div className="flex items-center gap-3">
                      {friend.pictureUrl ? (
                        <img
                          src={friend.pictureUrl}
                          alt={friend.displayName}
                          className="w-9 h-9 rounded-full object-cover bg-gray-100"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium">
                          {friend.displayName?.charAt(0) ?? '?'}
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-gray-900">{friend.displayName}</p>
                        {friend.statusMessage && (
                          <p className="text-xs text-gray-400 truncate max-w-[160px]">{friend.statusMessage}</p>
                        )}
                      </div>
                    </div>
                  </Table.Cell>

                  {/* Following status */}
                  <Table.Cell>
                    {friend.isFollowing ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        フォロー中
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                        ブロック/退会
                      </span>
                    )}
                  </Table.Cell>

                  {/* Tags + Ref */}
                  <Table.Cell>
                    <div className="flex flex-wrap gap-1">
                      {(friend as unknown as { refCode?: string }).refCode && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                          {(friend as unknown as { refCode: string }).refCode}
                        </span>
                      )}
                      {friend.tags.length > 0 ? (
                        friend.tags.map((tag) => <TagBadge key={tag.id} tag={tag} />)
                      ) : !((friend as unknown as { refCode?: string }).refCode) ? (
                        <span className="text-xs text-gray-400">なし</span>
                      ) : null}
                    </div>
                  </Table.Cell>

                  {/* Registered date */}
                  <Table.Cell className="text-sm text-gray-500">
                    {formatDate(friend.createdAt)}
                  </Table.Cell>

                  {/* Expand indicator */}
                  <Table.Cell className="text-right">
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform inline-block ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </Table.Cell>
                </Table.Row>

                {/* Expanded detail row */}
                {isExpanded && (
                  <Table.Row className="bg-gray-50">
                    <Table.Cell colSpan={5} className="px-6 py-4">
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-1">LINE ユーザーID</p>
                          <p className="text-xs text-gray-600 font-mono">{friend.lineUserId}</p>
                        </div>

                        {/* IG account attribution (written by IG Harness cross-link, first touch) */}
                        {(() => {
                          const meta = (friend as unknown as { metadata?: Record<string, unknown> }).metadata
                          const igUsername = meta?.ig_account_username as string | undefined
                          const igAccountId = meta?.ig_account_id as string | undefined
                          if (!igUsername && !igAccountId) return null
                          return (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 mb-1">流入元 Instagram</p>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-700">
                                IG: {igUsername ? `@${igUsername}` : igAccountId} 経由
                              </span>
                            </div>
                          )
                        })()}

                        {/* Tag management */}
                        <div>
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
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <Select
                                label="追加するタグ"
                                hideLabel
                                value={selectedTagId}
                                onValueChange={(value) => setSelectedTagId(value ?? '')}
                                placeholder="タグを選択..."
                                items={Object.fromEntries(availableTags.map((tag) => [tag.id, tag.name]))}
                              />
                              <Button
                                size="xs"
                                variant="primary"
                                onClick={() => handleAddTag(friend.id)}
                                disabled={!selectedTagId || loading}
                                loading={loading}
                              >
                                追加
                              </Button>
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => { setAddingTagForFriend(null); setSelectedTagId('') }}
                              >
                                キャンセル
                              </Button>
                            </div>
                          ) : (
                            availableTags.length > 0 && (
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={(e) => { e.stopPropagation(); setAddingTagForFriend(friend.id) }}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                タグを追加
                              </Button>
                            )
                          )}
                        </div>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Fragment>
            )
          })}
        </Table.Body>
      </Table>
      </div>
    </div>
  )
}
