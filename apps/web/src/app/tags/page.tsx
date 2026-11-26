'use client'

import { useState, useEffect, useCallback } from 'react'
import { PlusIcon, TagIcon, TrashIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Table } from '@cloudflare/kumo/components/table'
import type { Tag } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Header from '@/components/layout/header'
import TagBadge from '@/components/friends/tag-badge'

const PRESET_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#6B7280',
]

function TagMileageEditor({ tag, onSaved }: { tag: Tag; onSaved: () => void }) {
  const [reward, setReward] = useState(String(tag.mileageReward ?? 0))
  const [referralReward, setReferralReward] = useState(String(tag.referralMileageReward ?? 0))
  const [multiplier, setMultiplier] = useState(
    tag.mileageMultiplierBps == null ? '' : String(tag.mileageMultiplierBps / 10000),
  )
  const [priority, setPriority] = useState(String(tag.mileageMultiplierPriority ?? 0))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const rewardMiles = Number(reward)
    const referralRewardMiles = Number(referralReward)
    const multiplierBps = multiplier.trim() === '' ? null : Math.round(Number(multiplier) * 10000)
    const multiplierPriority = Number(priority)
    if (!Number.isInteger(rewardMiles) || rewardMiles < 0) return
    if (!Number.isInteger(referralRewardMiles) || referralRewardMiles < 0) return
    if (multiplierBps !== null && (!Number.isInteger(multiplierBps) || multiplierBps < 1000 || multiplierBps > 100000)) return
    if (!Number.isInteger(multiplierPriority) || multiplierPriority < 0) return
    setSaving(true)
    try {
      await api.tags.updateMileage(tag.id, {
        rewardMiles,
        referralRewardMiles,
        multiplierBps,
        multiplierPriority,
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Table.Cell>
        <Input
          aria-label={`${tag.name}の獲得マイル`}
          type="number"
          min={0}
          step={1}
          size="sm"
          value={reward}
          onChange={(event) => setReward(event.target.value)}
          className="w-20 tabular-nums"
        />
      </Table.Cell>
      <Table.Cell>
        <Input
          aria-label={`${tag.name}の紹介者マイル`}
          type="number"
          min={0}
          step={1}
          size="sm"
          value={referralReward}
          onChange={(event) => setReferralReward(event.target.value)}
          className="w-20 tabular-nums"
        />
      </Table.Cell>
      <Table.Cell>
        <div className="flex items-center gap-1">
          <Input
            aria-label={`${tag.name}の還元倍率`}
            type="number"
            min={0.1}
            max={10}
            step={0.1}
            size="sm"
            placeholder="なし"
            value={multiplier}
            onChange={(event) => setMultiplier(event.target.value)}
            className="w-20 tabular-nums"
          />
          <span className="text-xs text-kumo-subtle">倍</span>
        </div>
      </Table.Cell>
      <Table.Cell>
        <Input
          aria-label={`${tag.name}の倍率優先度`}
          type="number"
          min={0}
          max={1000}
          size="sm"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          className="w-16 tabular-nums"
        />
      </Table.Cell>
      <Table.Cell className="text-right whitespace-nowrap">
        <Button type="button" size="xs" variant="ghost" loading={saving} onClick={save}>
          マイル保存
        </Button>
      </Table.Cell>
    </>
  )
}

export default function TagsPage() {
  const [items, setItems] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.tags.list({ withCounts: true })
      if (response.success) setItems(response.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (saving) return
    const name = newName.trim()
    if (!name) return
    if (items.some((tag) => tag.name === name)) {
      setError(`タグ「${name}」は既に存在します`)
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.tags.create({ name, color: newColor })
      setNewName('')
      setCreating(false)
      await load()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError(`タグ「${name}」は既に存在します`)
        await load()
      } else {
        setError('作成に失敗しました')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setError('')
    try {
      await api.tags.delete(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError(`タグ「${deleteTarget.name}」はアフィリエイトオファー等で使用中のため削除できません`)
      } else {
        setError('削除に失敗しました')
      }
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const deleteDescription = deleteTarget
    ? (deleteTarget.friendCount ?? 0) > 0
      ? `「${deleteTarget.name}」は ${deleteTarget.friendCount} 人の友だちに付与されています。削除すると全員から外れます。`
      : `「${deleteTarget.name}」を削除します。この操作は取り消せません。`
    : ''

  return (
    <div>
      <Header
        title="タグ管理"
        description="本人のタグ獲得マイル、紹介者マイル、今後の行動倍率を管理します。"
        action={(
          <Button
            type="button"
            variant="primary"
            icon={PlusIcon}
            onClick={() => {
              setCreating((current) => !current)
              setError('')
            }}
          >
            新規タグ
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

      {creating ? (
        <LayerCard className="mb-4 p-5">
          <div className="grid items-end gap-4 lg:grid-cols-[minmax(220px,1fr)_auto_auto]">
            <Input
              label="タグ名"
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void handleCreate() }}
              placeholder="例: 見込み客"
              autoFocus
            />

            <div>
              <p className="mb-2 text-sm font-medium text-kumo-default">色</p>
              <div className="flex items-center gap-2">
                {PRESET_COLORS.map((color) => (
                  <Button
                    key={color}
                    type="button"
                    shape="circle"
                    size="sm"
                    variant="ghost"
                    onClick={() => setNewColor(color)}
                    className={newColor === color ? 'ring-2 ring-kumo-focus ring-offset-2' : ''}
                    style={{ backgroundColor: color }}
                    aria-label={`色 ${color}`}
                    aria-pressed={newColor === color}
                  />
                ))}
                <Input
                  type="color"
                  size="sm"
                  value={newColor}
                  onChange={(event) => setNewColor(event.target.value)}
                  className="w-9 cursor-pointer p-1"
                  aria-label="カスタム色"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="primary"
                loading={saving}
                disabled={!newName.trim()}
                onClick={handleCreate}
              >
                作成
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCreating(false)
                  setNewName('')
                }}
              >
                キャンセル
              </Button>
            </div>
          </div>
        </LayerCard>
      ) : null}

      <LayerCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[1020px]">
            <Table.Header>
              <Table.Row>
                <Table.Head>タグ</Table.Head>
                <Table.Head>友だち数</Table.Head>
                <Table.Head>作成日</Table.Head>
                <Table.Head>獲得マイル</Table.Head>
                <Table.Head>紹介者マイル</Table.Head>
                <Table.Head>行動倍率</Table.Head>
                <Table.Head>優先度</Table.Head>
                <Table.Head />
                <Table.Head />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {loading ? (
                <Table.Row>
                  <Table.Cell colSpan={9} className="py-12 text-center">
                    <span className="inline-flex items-center gap-2 text-sm text-kumo-subtle">
                      <Loader size="sm" /> 読み込み中
                    </span>
                  </Table.Cell>
                </Table.Row>
              ) : items.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={9} className="p-0">
                    <Empty
                      size="sm"
                      icon={<TagIcon size={32} />}
                      title="タグがありません"
                      description="最初のタグを作成すると、友だちの分類や自動化に利用できます。"
                      contents={(
                        <Button type="button" variant="primary" icon={PlusIcon} onClick={() => setCreating(true)}>
                          新規タグ
                        </Button>
                      )}
                    />
                  </Table.Cell>
                </Table.Row>
              ) : (
                items.map((tag) => (
                  <Table.Row key={tag.id}>
                    <Table.Cell><TagBadge tag={tag} /></Table.Cell>
                    <Table.Cell className="tabular-nums text-kumo-default">
                      {tag.friendCount ?? 0}<span className="ml-0.5 text-xs text-kumo-subtle">人</span>
                    </Table.Cell>
                    <Table.Cell className="text-xs text-kumo-subtle">
                      {tag.createdAt ? new Date(tag.createdAt).toLocaleDateString('ja-JP') : ''}
                    </Table.Cell>
                    <TagMileageEditor tag={tag} onSaved={load} />
                    <Table.Cell className="text-right whitespace-nowrap">
                      <Button
                        type="button"
                        size="xs"
                        variant="secondary-destructive"
                        icon={TrashIcon}
                        onClick={() => setDeleteTarget(tag)}
                      >
                        削除
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table>
        </div>
      </LayerCard>

      <Dialog.Root
        role="alertdialog"
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <Dialog size="base" className="p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">タグを削除しますか？</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-kumo-subtle">
            {deleteDescription}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close
              render={(props) => (
                <Button {...props} type="button" variant="secondary" disabled={deleting}>
                  キャンセル
                </Button>
              )}
            />
            <Button type="button" variant="destructive" loading={deleting} onClick={handleDelete}>
              削除する
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}
