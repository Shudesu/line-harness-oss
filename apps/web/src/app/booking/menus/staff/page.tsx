'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import { bookingApi, type BookingMenu, type BookingStaff, type StaffMenuMatrix } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Table } from '@cloudflare/kumo/components/table'

// このメニューを各スタッフが提供するか／料金所要を上書きするかの一括編集 UI。
// staff_menus は staff_id × menu_id 主キー。スタッフごとに個別 PUT で書く。
export default function MenuStaffMatrix() {
  const sp = useSearchParams()
  const id = sp.get('menu_id') ?? ''
  const { selectedAccountId } = useAccount()
  const [menu, setMenu] = useState<BookingMenu | null>(null)
  const [staff, setStaff] = useState<BookingStaff[]>([])
  const [rows, setRows] = useState<Record<string, StaffMenuMatrix>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId || !id) return
    setLoading(true)
    setError(null)
    // 前 menu/account の rows が残ったまま fetch 失敗 → 保存すると別 menu の
    // 設定を上書きする事故になる。先にクリア + 失敗時は保存ボタン無効化。
    setMenu(null)
    setStaff([])
    setRows({})
    try {
      const [menusRes, sRes] = await Promise.all([
        bookingApi.listMenus(selectedAccountId),
        bookingApi.listStaff(selectedAccountId),
      ])
      setMenu(menusRes.menus.find((m) => m.id === id) ?? null)
      setStaff(sRes.staff)
      const rowsMap: Record<string, StaffMenuMatrix> = {}
      await Promise.all(
        sRes.staff.map(async (s) => {
          const r = await bookingApi.getStaffMenus(selectedAccountId, s.id)
          const me = r.matrix.find((x) => x.menu_id === id)
          rowsMap[s.id] = me ?? {
            menu_id: id,
            name: '',
            is_offered: 0,
            override_duration_minutes: null,
            override_price: null,
          }
        }),
      )
      setRows(rowsMap)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [id, selectedAccountId])

  useEffect(() => {
    load()
  }, [load])

  function update(staffId: string, patch: Partial<StaffMenuMatrix>) {
    setRows({ ...rows, [staffId]: { ...rows[staffId], ...patch } })
  }

  async function saveAll() {
    if (!selectedAccountId) return
    setSaving(true)
    setError(null)
    try {
      for (const s of staff) {
        const fullMatrix = await bookingApi.getStaffMenus(selectedAccountId, s.id)
        const updated = fullMatrix.matrix.map((row) =>
          row.menu_id === id
            ? {
                menu_id: row.menu_id,
                is_offered: Boolean(rows[s.id].is_offered),
                override_duration_minutes: rows[s.id].override_duration_minutes,
                override_price: rows[s.id].override_price,
              }
            : {
                menu_id: row.menu_id,
                is_offered: Boolean(row.is_offered),
                override_duration_minutes: row.override_duration_minutes,
                override_price: row.override_price,
              },
        )
        await bookingApi.putStaffMenus(selectedAccountId, s.id, updated)
      }
      setSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header
        title="メニュー × スタッフ"
        description={
          menu
            ? `「${menu.name}」を提供するスタッフ・上書き設定`
            : 'このメニューを提供できるスタッフ・上書き料金/所要分'
        }
        action={
          <Button
            type="button"
            variant="primary"
            loading={saving}
            onClick={saveAll}
            // error がある間も無効化: 失敗時に古い rows が残る可能性があるので
            // 「保存して再取得」のショートサーキットを防ぎ、ユーザーが再読み込みする導線へ。
            disabled={saving || !selectedAccountId || loading || Boolean(error)}
          >
            保存
          </Button>
        }
      />

      {error && (
        <Banner className="mb-4" variant="error" title="設定を読み込めませんでした" description={error} />
      )}
      {savedAt && Date.now() - savedAt < 3000 && (
        <Banner className="mb-4" variant="default" title="保存しました" />
      )}

      {!selectedAccountId ? (
        <Empty title="アカウントが未選択です" description="サイドバーで操作するアカウントを選択してください。" />
      ) : loading ? (
        <LayerCard className="p-12"><Loader className="mx-auto" /></LayerCard>
      ) : staff.length === 0 ? (
        <Empty title="スタッフがいません" description="先に予約スタッフを登録してください。" />
      ) : (
        <LayerCard className="overflow-hidden p-0">
          {menu && (
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs text-gray-600">
              基本: {menu.duration_minutes}分 / ¥{menu.base_price.toLocaleString()}
              {menu.buffer_after_minutes > 0 && <span className="ml-2">後バッファ {menu.buffer_after_minutes}分</span>}
            </div>
          )}
          <div className="overflow-x-auto">
            <Table className="min-w-[600px]">
              <Table.Header><Table.Row><Table.Head>スタッフ</Table.Head><Table.Head className="text-center">提供する</Table.Head><Table.Head>所要分（上書き）</Table.Head><Table.Head>料金（上書き）</Table.Head></Table.Row></Table.Header>
              <Table.Body>
                {staff.map((s) => {
                  const row = rows[s.id]
                  if (!row) return null
                  const offered = Boolean(row.is_offered)
                  return (
                    <Table.Row key={s.id} className={offered ? '' : 'opacity-60'}>
                      <Table.Cell>
                        <div className="flex items-center gap-2">
                          {s.profile_image_url ? (
                            <img src={s.profile_image_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-400 text-xs">
                              {s.display_name.slice(0, 1)}
                            </div>
                          )}
                          <div>
                            <div className="font-medium">{s.display_name}</div>
                            {s.is_designation_optional ? (
                              <div className="text-xs text-purple-600">指名なし枠</div>
                            ) : null}
                          </div>
                        </div>
                      </Table.Cell>
                      <Table.Cell className="text-center">
                        <Checkbox
                          aria-label={`${s.display_name}がこのメニューを提供する`}
                          checked={offered}
                          onCheckedChange={(checked) => update(s.id, { is_offered: checked ? 1 : 0 })}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <Input
                          aria-label={`${s.display_name}の所要時間`}
                          type="number"
                          value={row.override_duration_minutes ?? ''}
                          onChange={(e) =>
                            update(s.id, {
                              override_duration_minutes: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          disabled={!offered}
                          placeholder={menu ? `${menu.duration_minutes}` : '-'}
                          className="w-24 tabular-nums"
                        />
                        <span className="ml-1 text-xs text-gray-400">分</span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-xs text-gray-400 mr-1">¥</span>
                        <Input
                          aria-label={`${s.display_name}の料金`}
                          type="number"
                          value={row.override_price ?? ''}
                          onChange={(e) =>
                            update(s.id, {
                              override_price: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          disabled={!offered}
                          placeholder={menu ? menu.base_price.toString() : '-'}
                          className="inline-flex w-28 tabular-nums"
                        />
                      </Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          </div>
        </LayerCard>
      )}
    </div>
  )
}
