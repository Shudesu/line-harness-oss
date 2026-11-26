'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { api, bookingApi, type BookingMenu } from '@/lib/api'
import { getApiBase } from '@/lib/api-base'
import type { Tag } from '@line-crm/shared'
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
import { Select } from '@cloudflare/kumo/components/select'
import { Table } from '@cloudflare/kumo/components/table'

const EMPTY: Partial<BookingMenu> = {
  name: '',
  category_label: '',
  description: '',
  duration_minutes: 60,
  buffer_after_minutes: 0,
  base_price: 5000,
  sort_order: 0,
  is_active: 1,
  auto_tag_id: null,
}

export default function MenusPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [items, setItems] = useState<BookingMenu[]>([])
  const [editing, setEditing] = useState<Partial<BookingMenu> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // copy 状態は menu.id 単位で持つ。複数メニューを連続でコピーしたとき
  // 直近にコピーした行だけ「コピー済」が出る。
  const [copiedMenuId, setCopiedMenuId] = useState<string | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [deleteTarget, setDeleteTarget] = useState<BookingMenu | null>(null)

  const liffId = selectedAccount?.liffId ?? null
  const workerBase = getApiBase() ?? ''

  async function copyMenuUrl(menuId: string) {
    if (!workerBase || !liffId) return
    const url = `${workerBase}/o?liffId=${encodeURIComponent(liffId)}&page=salon-book&menu_id=${encodeURIComponent(menuId)}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedMenuId(menuId)
      setTimeout(() => {
        setCopiedMenuId((cur) => (cur === menuId ? null : cur))
      }, 2000)
    } catch {
      window.prompt('コピーしてください:', url)
    }
  }

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    // アカウント切替時は前 account の menus が表示・操作可能なまま残らないよう
    // 先にクリア。fetch 失敗でも cross-account の操作事故が起きない。
    setItems([])
    try {
      const r = await bookingApi.listMenus(selectedAccountId)
      setItems(r.menus)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    api.tags
      .list()
      .then((r) => {
        if (!cancelled && r.success) setTags(r.data)
      })
      .catch(() => {
        // タグ取得失敗時はセレクタが空になるが、メニュー編集自体は継続可能。
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function save(m: Partial<BookingMenu>) {
    if (!selectedAccountId) return
    if (m.id) {
      await bookingApi.updateMenu(selectedAccountId, m.id, m)
    } else {
      await bookingApi.createMenu(selectedAccountId, m)
    }
    setEditing(null)
    await load()
  }

  async function remove() {
    if (!selectedAccountId) return
    if (!deleteTarget) return
    await bookingApi.deleteMenu(selectedAccountId, deleteTarget.id)
    setDeleteTarget(null)
    await load()
  }

  return (
    <div>
      <Header
        title="メニュー"
        description="予約メニューの登録・編集"
        action={
          <Button
            type="button"
            variant="primary"
            onClick={() => setEditing(EMPTY)}
            disabled={!selectedAccountId}
          >
            + 新規メニュー
          </Button>
        }
      />

      {error && (
        <Banner className="mb-4" variant="error" title="メニューを読み込めませんでした" description={error} />
      )}

      {!selectedAccountId ? (
        <Empty title="アカウントが未選択です" description="サイドバーで操作するアカウントを選択してください。" />
      ) : loading ? (
        <LayerCard className="p-12"><Loader className="mx-auto" /></LayerCard>
      ) : items.length === 0 ? (
        <Empty title="まだメニューがありません" description="右上の「+ 新規メニュー」から追加してください。" />
      ) : (
        <LayerCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <Table.Header><Table.Row><Table.Head>名前</Table.Head><Table.Head>カテゴリ</Table.Head><Table.Head>所要</Table.Head><Table.Head className="text-right">料金</Table.Head><Table.Head className="text-right">並び順</Table.Head><Table.Head className="text-center">有効</Table.Head><Table.Head className="text-right">操作</Table.Head></Table.Row></Table.Header>
              <Table.Body>
                {items.map((m) => (
                  <Table.Row key={m.id}>
                    <Table.Cell className="font-medium">{m.name}</Table.Cell>
                    <Table.Cell className="text-kumo-subtle">
                      {m.category_label ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-gray-100 text-xs">{m.category_label}</span>
                      ) : (
                        '-'
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-kumo-subtle tabular-nums">
                      {m.duration_minutes}分
                      {m.buffer_after_minutes > 0 && (
                        <span className="text-xs text-gray-400 ml-1">+{m.buffer_after_minutes}</span>
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">¥{m.base_price.toLocaleString()}</Table.Cell>
                    <Table.Cell className="text-right tabular-nums text-kumo-subtle">{m.sort_order}</Table.Cell>
                    <Table.Cell className="text-center">
                      {m.is_active ? (
                        <Badge variant="success">ON</Badge>
                      ) : (
                        <Badge variant="neutral">OFF</Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      <div className="inline-flex gap-2 text-xs">
                        <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(m)}>編集</Button>
                        <Link href={`/booking/menus/staff?menu_id=${m.id}`} className="text-blue-600 hover:underline">
                          スタッフ割当
                        </Link>
                        {!liffId ? (
                          <span className="text-gray-300" title="LIFF ID 未設定">専用URL</span>
                        ) : !m.is_active ? (
                          // is_active=0 のメニューは /api/liff/booking/menus が
                          // 返さないので、URL を送っても LIFF は解決失敗して
                          // 通常のメニュー一覧に fallback する。間違って「指定メニュー
                          // 直通」のつもりで送って別メニュー予約されるのを防ぐため、
                          // 有効化されるまでコピー不可にする。
                          <span className="text-gray-300" title="メニューを有効化するとコピーできます">専用URL</span>
                        ) : (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            onClick={() => copyMenuUrl(m.id)}
                          >
                            {copiedMenuId === m.id ? '✓ コピー済' : '専用URL'}
                          </Button>
                        )}
                        <Button type="button" size="xs" variant="destructive" onClick={() => setDeleteTarget(m)}>削除</Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        </LayerCard>
      )}

      {editing && <Modal menu={editing} tags={tags} onSave={save} onClose={() => setEditing(null)} />}
      <Dialog.Root role="alertdialog" open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}><Dialog><Dialog.Title>メニューを削除しますか？</Dialog.Title><Dialog.Description className="mt-2">「{deleteTarget?.name}」を削除します。既存予約は維持されます。</Dialog.Description><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>キャンセル</Button><Button type="button" variant="destructive" onClick={remove}>削除</Button></div></Dialog></Dialog.Root>
    </div>
  )
}

function Modal({
  menu,
  tags,
  onSave,
  onClose,
}: {
  menu: Partial<BookingMenu>
  tags: Tag[]
  onSave: (m: Partial<BookingMenu>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<BookingMenu>>(menu)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof BookingMenu>(k: K, v: BookingMenu[K] | string | null) {
    setForm({ ...form, [k]: v })
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
        <div className="px-6 py-4 border-b border-gray-200">
          <Dialog.Title>{form.id ? 'メニュー編集' : '新規メニュー'}</Dialog.Title>
        </div>
        <div className="px-6 py-4 space-y-4">
            <Input
              label="名前"
              type="text"
              value={form.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              required
              placeholder="例: カット"
            />
            <Input
              label="カテゴリ"
              type="text"
              value={form.category_label ?? ''}
              onChange={(e) => set('category_label', e.target.value)}
              placeholder="例: カット / カラー / パーマ"
            />
            <InputArea
              label="説明"
              value={form.description ?? ''}
              onValueChange={(value) => set('description', value)}
              minRows={2}
              placeholder="顧客に表示される説明文"
            />
          <div className="grid grid-cols-2 gap-3">
            <NumField
              label="所要時間（分）"
              required
              value={form.duration_minutes ?? 60}
              onChange={(v) => set('duration_minutes', v)}
            />
            <NumField
              label="後バッファ（分）"
              value={form.buffer_after_minutes ?? 0}
              onChange={(v) => set('buffer_after_minutes', v)}
            />
            <NumField
              label="料金（円）"
              required
              value={form.base_price ?? 0}
              onChange={(v) => set('base_price', v)}
            />
            <NumField
              label="並び順"
              value={form.sort_order ?? 0}
              onChange={(v) => set('sort_order', v)}
            />
          </div>
          <div>
            <Select
              label="予約申込時に自動付与するタグ"
              value={form.auto_tag_id ?? ''}
              onValueChange={(value) => set('auto_tag_id', value || null)}
              placeholder="— なし —"
              items={Object.fromEntries(tags.map((tag) => [tag.id, tag.name]))}
            />
            <p className="mt-1 text-xs text-gray-500">
              このメニューが予約されると、申込者の友だちに自動でこのタグが付きます。タグは既存のものから選択してください (友だち画面 / シナリオ等で使われているタグ)。
            </p>
          </div>
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

function NumField({
  label,
  required,
  value,
  onChange,
}: { label: string; required?: boolean; value: number; onChange: (v: number) => void }) {
  return <Input label={label} type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} className="tabular-nums" required={required} />
}
