'use client'

import { useCallback, useEffect, useState } from 'react'
import { PlusIcon, UsersThreeIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'
import { Table } from '@cloudflare/kumo/components/table'
import type { Tag } from '@line-crm/shared'
import { api, ApiError, type LineGroupItem } from '@/lib/api'
import Header from '@/components/layout/header'
import GroupTagBadge from '@/components/groups/group-tag-badge'

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `サーバーがエラーを返しました (${err.status})`
  return err instanceof Error ? err.message : String(err)
}

/** Tag picker for one row. Only tags the group does not already carry are offered. */
function AddTagControl({
  group,
  allTags,
  onAdded,
  onError,
}: {
  group: LineGroupItem
  allTags: Tag[]
  onAdded: () => void
  onError: (message: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const attached = new Set(group.tags.map((t) => t.id))
  const available = allTags.filter((t) => !attached.has(t.id))

  if (available.length === 0) return null

  const add = async (tagId: string) => {
    if (!tagId) return
    setSaving(true)
    try {
      await api.groups.addTag(group.id, tagId)
      onAdded()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Select
      size="sm"
      value=""
      disabled={saving}
      aria-label={`${group.name ?? group.id} にタグを追加`}
      onValueChange={(value) => void add(value ?? '')}
      items={[
        { value: '', label: saving ? '追加中…' : '+ タグを付ける' },
        ...available.map((t) => ({ value: t.id, label: t.name })),
      ]}
    />
  )
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<LineGroupItem[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [selectedTagId, setSelectedTagId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.groups.list(selectedTagId ? { tagId: selectedTagId } : undefined)
      setGroups(res.data)
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [selectedTagId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.tags.list()
        setAllTags(res.data)
      } catch (err) {
        setError(errorMessage(err))
      }
    })()
  }, [])

  const removeTag = async (groupId: string, tagId: string) => {
    try {
      await api.groups.removeTag(groupId, tagId)
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div>
      <Header
        title="グループ"
        description="LINE グループにタグを付けて分類します。グループは bot が招待された時点で自動登録されます。"
        action={(
          <Button type="button" variant="secondary" icon={PlusIcon} onClick={() => { window.location.href = '/tasks' }}>
            タスク一覧へ
          </Button>
        )}
      />

      {error ? (
        <Banner
          className="mb-4"
          variant="error"
          title="操作を完了できませんでした"
          description={error}
        />
      ) : null}

      <LayerCard className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            size="sm"
            label="タグで絞り込み"
            value={selectedTagId}
            onValueChange={(value) => setSelectedTagId(value ?? '')}
            items={[
              { value: '', label: 'すべて' },
              ...allTags.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <span className="ml-auto pb-1 text-xs text-kumo-subtle">
            {loading ? '読み込み中' : `${groups.length.toLocaleString('ja-JP')} 件`}
          </span>
        </div>
      </LayerCard>

      <LayerCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[880px]">
            <Table.Header>
              <Table.Row>
                <Table.Head>グループ</Table.Head>
                <Table.Head>タグ</Table.Head>
                <Table.Head>受信数</Table.Head>
                <Table.Head>最終受信</Table.Head>
                <Table.Head />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {loading ? (
                <Table.Row>
                  <Table.Cell colSpan={5} className="py-12 text-center">
                    <span className="inline-flex items-center gap-2 text-sm text-kumo-subtle">
                      <Loader size="sm" /> 読み込み中
                    </span>
                  </Table.Cell>
                </Table.Row>
              ) : groups.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={5} className="p-0">
                    <Empty
                      size="sm"
                      icon={<UsersThreeIcon size={32} />}
                      title={selectedTagId ? 'このタグが付いたグループはありません' : 'グループがまだありません'}
                      description={
                        selectedTagId
                          ? '絞り込みを「すべて」に戻すと、登録済みのグループが表示されます。'
                          : 'bot を LINE グループに招待すると、ここに自動で登録されます。'
                      }
                    />
                  </Table.Cell>
                </Table.Row>
              ) : (
                groups.map((group) => (
                  <Table.Row key={group.id}>
                    <Table.Cell>
                      <div className="font-medium text-kumo-strong">
                        {group.name ?? '(名前未取得)'}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-kumo-subtle">{group.id}</div>
                      {group.status === 'left' ? (
                        <div className="mt-0.5 text-xs text-kumo-subtle">退出済み</div>
                      ) : null}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {group.tags.map((tag) => (
                          <GroupTagBadge
                            key={tag.id}
                            tag={tag}
                            onRemove={() => void removeTag(group.id, tag.id)}
                          />
                        ))}
                        {group.tags.length === 0 ? (
                          <span className="text-xs text-kumo-subtle">なし</span>
                        ) : null}
                      </div>
                    </Table.Cell>
                    <Table.Cell className="tabular-nums text-kumo-default">
                      {group.messageCount.toLocaleString('ja-JP')}
                      <span className="ml-0.5 text-xs text-kumo-subtle">件</span>
                    </Table.Cell>
                    <Table.Cell className="text-xs text-kumo-subtle">
                      {group.lastMessageAt
                        ? new Date(group.lastMessageAt).toLocaleString('ja-JP')
                        : '—'}
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap text-right">
                      <AddTagControl
                        group={group}
                        allTags={allTags}
                        onAdded={() => void load()}
                        onError={setError}
                      />
                    </Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table>
        </div>
      </LayerCard>
    </div>
  )
}
