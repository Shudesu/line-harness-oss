'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import ImageUploader from '@/components/shared/image-uploader'
import { bookingApi, type BookingStaff } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Table } from '@cloudflare/kumo/components/table'

const EMPTY: Partial<BookingStaff> = {
  name: '',
  display_name: '',
  role: '',
  profile_image_url: '',
  bio: '',
  sort_order: 0,
  is_designation_optional: 0,
  is_active: 1,
}

export default function BookingStaffPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<BookingStaff[]>([])
  const [editing, setEditing] = useState<Partial<BookingStaff> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BookingStaff | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    // アカウント切替時の stale state 防止（cross-account 表示/操作の事故防止）。
    setItems([])
    try {
      const r = await bookingApi.listStaff(selectedAccountId)
      setItems(r.staff)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    load()
  }, [load])

  async function save(s: Partial<BookingStaff>) {
    if (!selectedAccountId) return
    if (s.id) {
      await bookingApi.updateStaff(selectedAccountId, s.id, s)
    } else {
      await bookingApi.createStaff(selectedAccountId, s)
    }
    setEditing(null)
    await load()
  }

  async function remove() {
    if (!selectedAccountId) return
    if (!deleteTarget) return
    await bookingApi.deleteStaff(selectedAccountId, deleteTarget.id)
    setDeleteTarget(null)
    await load()
  }

  return (
    <div>
      <Header
        title="予約スタッフ"
        description="予約担当スタッフの管理（指名なし枠も含む）"
        action={
          <Button
            type="button"
            variant="primary"
            onClick={() => setEditing(EMPTY)}
            disabled={!selectedAccountId}
          >
            + 新規スタッフ
          </Button>
        }
      />

      {error && (
        <Banner className="mb-4" variant="error" title="スタッフを読み込めませんでした" description={error} />
      )}

      {!selectedAccountId ? (
        <Empty title="アカウントが未選択です" description="サイドバーで操作するアカウントを選択してください。" />
      ) : loading ? (
        <LayerCard className="p-12"><Loader className="mx-auto" /></LayerCard>
      ) : items.length === 0 ? (
        <Empty title="まだスタッフがいません" description="右上の「+ 新規スタッフ」から追加してください。" />
      ) : (
        <LayerCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <Table.Header><Table.Row><Table.Head>スタッフ</Table.Head><Table.Head>役職</Table.Head><Table.Head className="text-center">指名なし枠</Table.Head><Table.Head className="text-center">受付時間</Table.Head><Table.Head className="text-right">並び順</Table.Head><Table.Head className="text-center">有効</Table.Head><Table.Head className="text-right">操作</Table.Head></Table.Row></Table.Header>
              <Table.Body>
                {items.map((s) => (
                  <Table.Row key={s.id}>
                    <Table.Cell>
                      <div className="flex items-center gap-3">
                        {s.profile_image_url ? (
                          <img
                            src={s.profile_image_url}
                            alt={s.display_name}
                            className="w-9 h-9 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-400 text-xs">
                            {s.display_name.slice(0, 1)}
                          </div>
                        )}
                        <div>
                          <div className="font-medium">{s.display_name}</div>
                          {s.name !== s.display_name && (
                            <div className="text-xs text-gray-400">{s.name}</div>
                          )}
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="text-kumo-subtle">{s.role ?? '-'}</Table.Cell>
                    <Table.Cell className="text-center">
                      {s.is_designation_optional ? (
                        <Badge variant="info">指名なし</Badge>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-center">
                      {s.has_working_hours === 0 ? (
                        <Link
                          href={`/booking/staff/shifts?staff_id=${s.id}`}
                          className="inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs hover:bg-amber-200"
                          title="受付時間を保存するまで、このスタッフの予約枠は表示されません"
                        >
                          未設定
                        </Link>
                      ) : s.has_working_hours === 1 ? (
                        <Badge variant="success">設定済み</Badge>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums text-kumo-subtle">{s.sort_order}</Table.Cell>
                    <Table.Cell className="text-center">
                      {s.is_active ? (
                        <Badge variant="success">ON</Badge>
                      ) : (
                        <Badge variant="neutral">OFF</Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      <div className="inline-flex gap-2 text-xs">
                        <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(s)}>編集</Button>
                        <Link href={`/booking/staff/shifts?staff_id=${s.id}`} className="text-blue-600 hover:underline">
                          シフト
                        </Link>
                        <Button type="button" size="xs" variant="destructive" onClick={() => setDeleteTarget(s)}>削除</Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        </LayerCard>
      )}

      {editing && <Modal staff={editing} onSave={save} onClose={() => setEditing(null)} />}
      <Dialog.Root role="alertdialog" open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <Dialog><Dialog.Title>スタッフを削除しますか？</Dialog.Title><Dialog.Description className="mt-2">「{deleteTarget?.display_name}」を削除します。既存予約は維持されます。</Dialog.Description><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>キャンセル</Button><Button type="button" variant="destructive" onClick={remove}>削除</Button></div></Dialog>
      </Dialog.Root>
    </div>
  )
}

function Modal({
  staff,
  onSave,
  onClose,
}: {
  staff: Partial<BookingStaff>
  onSave: (s: Partial<BookingStaff>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<BookingStaff>>(staff)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof BookingStaff>(k: K, v: BookingStaff[K]) {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  async function submit() {
    setSaving(true)
    setErr(null)
    try {
      await onSave(form)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <Dialog className="w-full max-w-md max-h-[90vh] overflow-y-auto p-0">
        <div className="px-6 py-4 border-b border-kumo-line"><Dialog.Title>{form.id ? 'スタッフ編集' : '新規スタッフ'}</Dialog.Title></div>
        <div className="px-6 py-4 space-y-4">
            <Input
              label="内部名（管理用）"
              type="text"
              value={form.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              required
              placeholder="例: yamada-taro"
            />
            <Input
              label="表示名"
              type="text"
              value={form.display_name ?? ''}
              onChange={(e) => set('display_name', e.target.value)}
              required
              placeholder="顧客に表示される名前"
            />
            <Input
              label="役職"
              type="text"
              value={form.role ?? ''}
              onChange={(e) => set('role', e.target.value)}
              placeholder="例: トップスタイリスト"
            />
          <ImageUploader
            mode="url"
            value={form.profile_image_url ? { mode: 'url', url: form.profile_image_url } : null}
            onChange={(v) => set('profile_image_url', v?.mode === 'url' ? v.url : '')}
            label="プロフィール画像"
          />
            <InputArea
              label="紹介文"
              value={form.bio ?? ''}
              onValueChange={(value) => set('bio', value)}
              minRows={2}
            />
            <Input
              label="並び順"
              type="number"
              value={form.sort_order ?? 0}
              onChange={(e) => set('sort_order', Number(e.target.value))}
              className="tabular-nums"
            />
          <Checkbox
              label="「指名なし」枠（仮想スタッフ）"
              checked={Boolean(form.is_designation_optional)}
              onCheckedChange={(checked) => set('is_designation_optional', checked ? 1 : 0)}
            />
          <Checkbox
              label="有効（顧客に表示する）"
              checked={Boolean(form.is_active)}
              onCheckedChange={(checked) => set('is_active', checked ? 1 : 0)}
            />
          {err && <Banner size="sm" variant="error" title="保存できませんでした" description={err} />}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex gap-2 justify-end">
          <Button type="button" variant="secondary"
            onClick={onClose}
          >
            キャンセル
          </Button>
          <Button type="button" variant="primary" loading={saving}
            onClick={submit}
            disabled={saving}
          >
            保存
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
