'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { ApplyToTagModal } from '@/components/rich-menus/apply-to-tag-modal'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Table } from '@cloudflare/kumo/components/table'

type RichMenuGroupListItem = {
  id: string
  name: string
  chatBarText: string
  size: 'large' | 'compact'
  status: 'draft' | 'published'
  isDefaultForAll: boolean
  selected: boolean
  thumbnailR2Key: string | null
  updatedAt: string
}

function StatusBadge({ status }: { status: 'draft' | 'published' }) {
  return <Badge variant={status === 'published' ? 'success' : 'neutral'}>{status === 'published' ? 'LINE 登録済み' : '下書き'}</Badge>
}

type LineMenu = {
  richMenuId: string
  name: string
  chatBarText: string
  selected: boolean
  size: { width: number; height: number }
  areasCount: number
  isCurrentDefault: boolean
  adminManaged: boolean
  adminInfo: {
    groupId: string
    groupName: string
    pageName: string
    groupStatus: 'draft' | 'published'
  } | null
}

export default function RichMenusListPage() {
  const { selectedAccount } = useAccount()
  const [groups, setGroups] = useState<RichMenuGroupListItem[]>([])
  const [external, setExternal] = useState<{
    currentDefault: string | null
    lineMenus: LineMenu[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [externalError, setExternalError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applyTo, setApplyTo] = useState<RichMenuGroupListItem | null>(null)
  const [pendingAction, setPendingAction] = useState<{ kind: 'delete-group'; group: RichMenuGroupListItem } | { kind: 'delete-external' | 'import'; menu: LineMenu } | null>(null)

  const reload = useCallback(async () => {
    if (!selectedAccount?.id) return
    setLoading(true)
    setError(null)
    setExternalError(null)
    try {
      // 並列に: D1 管理 group の一覧と、LINE 上の現状
      const [groupsRes, externalRes] = await Promise.allSettled([
        api.richMenuGroups.list(selectedAccount.id),
        api.richMenuGroups.external(selectedAccount.id),
      ])
      if (groupsRes.status === 'fulfilled') {
        if (!groupsRes.value.success) throw new Error(groupsRes.value.error ?? '取得失敗')
        setGroups(groupsRes.value.data)
      } else {
        throw groupsRes.reason
      }
      if (externalRes.status === 'fulfilled') {
        const v = externalRes.value
        if (v.success) {
          setExternal(v.data)
        } else {
          setExternalError(v.error ?? 'LINE 上の状態取得に失敗')
          setExternal(null)
        }
      } else {
        setExternalError(
          externalRes.reason instanceof Error
            ? externalRes.reason.message
            : String(externalRes.reason),
        )
        setExternal(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccount?.id])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleDelete(group: RichMenuGroupListItem, confirmed = false) {
    if (group.status === 'published') {
      alert(
        `「${group.name}」は LINE に登録されています。\n\n` +
          '編集画面の「危険な操作」から「LINE から取り下げ」を実行してから、改めて削除してください。',
      )
      return
    }
    if (!confirmed) { setPendingAction({ kind: 'delete-group', group }); return }
    setPendingAction(null)
    try {
      const res = await api.richMenuGroups.delete(group.id)
      if (!res.success) throw new Error(res.error ?? '削除失敗')
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDeleteExternal(menu: LineMenu, confirmed = false) {
    if (!selectedAccount?.id) return
    if (!confirmed) { setPendingAction({ kind: 'delete-external', menu }); return }
    setPendingAction(null)
    try {
      const res = await api.richMenuGroups.deleteExternal(menu.richMenuId, selectedAccount.id)
      if (!res.success) throw new Error(res.error ?? '削除失敗')
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleImport(menu: LineMenu, confirmed = false) {
    if (!selectedAccount?.id) return
    if (!confirmed) { setPendingAction({ kind: 'import', menu }); return }
    setPendingAction(null)
    try {
      const res = await api.richMenuGroups.importFromLine(menu.richMenuId, selectedAccount.id)
      if (!res.success) throw new Error(res.error ?? '取り込み失敗')
      alert(`取り込みました: ${res.data?.name ?? menu.name}`)
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <main className="p-6 max-w-7xl mx-auto">
      <Header
        title="リッチメニュー"
        description="LINE トーク画面下に表示されるメニュー。タブ切替対応。"
        action={
          <Link
            href="/rich-menus/new"
            className="inline-flex items-center gap-1 rounded-lg bg-kumo-brand px-4 py-2 text-sm font-medium text-kumo-inverse hover:bg-kumo-brand-hover"
          >
            <span className="text-lg leading-none">+</span> 新規作成
          </Link>
        }
      />

      {!selectedAccount && (
        <div className="text-sm text-gray-500">
          アカウントを選択してください。
        </div>
      )}

      {selectedAccount && loading && (
        <div className="text-sm text-gray-500">読み込み中...</div>
      )}

      {selectedAccount && !loading && error && (
        <Banner className="mb-4" variant="error" title="読み込めませんでした" description={error} />
      )}

      {/* LINE 公式アカウントの現状 (admin 管理外の rich menu も含む) */}
      {selectedAccount && !loading && external && (
        <ExternalSection
          accountId={selectedAccount.id}
          accountName={selectedAccount.displayName || selectedAccount.name}
          external={external}
          onDeleteExternal={handleDeleteExternal}
          onImport={handleImport}
        />
      )}
      {selectedAccount && !loading && externalError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded mb-6">
          LINE 公式アカウントの状態取得に失敗しました: {externalError}
        </div>
      )}

      {/* Admin 管理メニュー見出し */}
      {selectedAccount && !loading && !error && (
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          管理画面で作成・編集するメニュー
        </h2>
      )}

      {selectedAccount && !loading && !error && groups.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-12 text-center">
          <p className="text-gray-500 mb-4">
            まだリッチメニューが作成されていません。
          </p>
          <Link
            href="/rich-menus/new"
            className="inline-flex items-center gap-1 rounded-lg bg-kumo-brand px-4 py-2 text-sm font-medium text-kumo-inverse hover:bg-kumo-brand-hover"
          >
            <span className="text-lg leading-none">+</span> 最初のメニューを作る
          </Link>
        </div>
      )}

      {selectedAccount && !loading && !error && groups.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((g) => (
            <div
              key={g.id}
              className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow flex flex-col"
            >
              <Link
                href={`/rich-menus/edit?id=${g.id}`}
                className="flex-1 hover:bg-gray-50 rounded-t-lg overflow-hidden"
              >
                {/* thumbnail */}
                <div
                  className="w-full bg-gray-100 border-b border-gray-100"
                  style={{
                    aspectRatio: g.size === 'large' ? '2500 / 1686' : '2500 / 843',
                  }}
                >
                  {g.thumbnailR2Key ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={api.richMenuGroups.imageUrl(g.thumbnailR2Key)}
                      alt={g.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                      画像未設定
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <h2 className="font-semibold text-gray-900 truncate">{g.name}</h2>
                    <StatusBadge status={g.status} />
                  </div>
                  <p className="text-sm text-gray-500 truncate">
                    トーク表示: <span className="text-gray-700">{g.chatBarText}</span>
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                    <span>サイズ: {g.size === 'large' ? '2500×1686' : '2500×843'}</span>
                    {g.isDefaultForAll && (
                      <span className="text-blue-600 font-medium">★ 全員のデフォルト</span>
                    )}
                    <span>{g.selected ? '初期表示: 開く' : '初期表示: 閉じる'}</span>
                  </div>
                </div>
              </Link>
              <div className="border-t border-gray-100 px-4 py-2.5 flex justify-end gap-4 text-xs">
                {g.status === 'published' && (
                  <Button type="button" size="xs" variant="primary"
                    onClick={() => setApplyTo(g)}
                  >
                    友だちに表示
                  </Button>
                )}
                <Link
                  href={`/rich-menus/edit?id=${g.id}`}
                  className="text-gray-600 hover:underline"
                >
                  編集
                </Link>
                <Button type="button" size="xs" variant="destructive"
                  onClick={() => handleDelete(g)}
                >
                  削除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {applyTo && (
        <ApplyToTagModal
          groupId={applyTo.id}
          groupName={applyTo.name}
          onClose={() => setApplyTo(null)}
        />
      )}
      <Dialog.Root role="alertdialog" open={pendingAction !== null} onOpenChange={(open) => { if (!open) setPendingAction(null) }}>
        <Dialog><Dialog.Title>{pendingAction?.kind === 'import' ? '管理画面に取り込みますか？' : 'リッチメニューを削除しますか？'}</Dialog.Title><Dialog.Description className="mt-2">{pendingAction?.kind === 'import' ? '取り込み後は管理画面から編集と再適用ができます。' : 'この操作は元に戻せません。'}</Dialog.Description><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setPendingAction(null)}>キャンセル</Button><Button type="button" variant={pendingAction?.kind === 'import' ? 'primary' : 'destructive'} onClick={() => { if (pendingAction?.kind === 'delete-group') void handleDelete(pendingAction.group, true); else if (pendingAction?.kind === 'delete-external') void handleDeleteExternal(pendingAction.menu, true); else if (pendingAction?.kind === 'import') void handleImport(pendingAction.menu, true) }}>実行する</Button></div></Dialog>
      </Dialog.Root>
    </main>
  )
}

function ExternalSection({
  accountId,
  accountName,
  external,
  onDeleteExternal,
  onImport,
}: {
  accountId: string
  accountName: string
  external: { currentDefault: string | null; lineMenus: LineMenu[] }
  onDeleteExternal: (menu: LineMenu) => void
  onImport: (menu: LineMenu) => void
}) {
  const { currentDefault, lineMenus } = external
  const sortedMenus = [...lineMenus].sort((a, b) => {
    // 現在のデフォルトを先頭、次に admin 管理外、最後に admin 管理
    if (a.isCurrentDefault) return -1
    if (b.isCurrentDefault) return 1
    if (a.adminManaged !== b.adminManaged) return a.adminManaged ? 1 : -1
    return a.name.localeCompare(b.name)
  })
  const currentDefaultMenu = lineMenus.find((m) => m.isCurrentDefault) ?? null
  const unmanagedCount = lineMenus.filter((m) => !m.adminManaged).length

  return (
    <section className="mb-8 bg-white border border-gray-200 rounded-lg shadow-sm p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-900">
          LINE 公式アカウントの現状
        </h2>
        <span className="text-xs text-gray-500 truncate">{accountName}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-sm">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-700 font-medium mb-0.5">
            現在の「全員のデフォルト」
          </div>
          {currentDefaultMenu ? (
            <div>
              <div className="font-medium text-gray-900 truncate">
                {currentDefaultMenu.name}
              </div>
              {currentDefaultMenu.adminInfo ? (
                <div className="text-xs text-gray-600 truncate">
                  管理画面: {currentDefaultMenu.adminInfo.groupName}
                </div>
              ) : (
                <div className="text-xs text-amber-700">管理画面外で設定</div>
              )}
            </div>
          ) : (
            <div className="text-gray-500 text-xs">設定なし</div>
          )}
          {currentDefault && (
            <div className="text-[10px] text-gray-400 font-mono mt-1 truncate">
              {currentDefault}
            </div>
          )}
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="text-xs text-gray-700 font-medium mb-0.5">
            LINE 上に登録されているメニュー
          </div>
          <div className="font-medium text-gray-900">{lineMenus.length} 個</div>
          {unmanagedCount > 0 && (
            <div className="text-xs text-amber-700">
              うち {unmanagedCount} 個が管理画面外
            </div>
          )}
        </div>
      </div>

      {lineMenus.length === 0 ? (
        <div className="text-xs text-gray-500 py-3">
          LINE 公式アカウントにはまだ rich menu が登録されていません。
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <Table>
            <Table.Header><Table.Row><Table.Head className="w-[88px]">画像</Table.Head><Table.Head>名前</Table.Head><Table.Head>サイズ</Table.Head><Table.Head>管理状態</Table.Head><Table.Head /></Table.Row></Table.Header>
            <Table.Body>
              {sortedMenus.map((m) => (
                <Table.Row key={m.richMenuId}>
                  <Table.Cell>
                    <div
                      className="w-20 bg-gray-100 rounded overflow-hidden"
                      style={{
                        aspectRatio:
                          m.size.width === 2500 && m.size.height === 1686
                            ? '2500 / 1686'
                            : m.size.width === 2500 && m.size.height === 843
                              ? '2500 / 843'
                              : `${m.size.width} / ${m.size.height}`,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={api.richMenuGroups.externalImageUrl(m.richMenuId, accountId)}
                        alt={m.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-2 mb-1">
                      {m.isCurrentDefault && (
                        <span
                          className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded"
                          title="LINE 公式アカウントの全員のデフォルト"
                        >
                          DEFAULT
                        </span>
                      )}
                      <span className="font-medium truncate max-w-[180px]">{m.name}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 truncate max-w-[200px]">
                      {m.chatBarText}
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono truncate max-w-[280px]">
                      {m.richMenuId}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-xs text-kumo-subtle whitespace-nowrap">
                    {m.size.width}×{m.size.height}
                    <div className="text-[10px] text-gray-400">{m.areasCount} エリア</div>
                  </Table.Cell>
                  <Table.Cell className="text-xs">
                    {m.adminManaged && m.adminInfo ? (
                      <Link
                        href={`/rich-menus/edit?id=${m.adminInfo.groupId}`}
                        className="text-gray-700 hover:underline"
                      >
                        管理画面 → {m.adminInfo.groupName}
                        <span className="text-gray-400 ml-1">({m.adminInfo.pageName})</span>
                      </Link>
                    ) : (
                      <span
                        className="text-amber-700 font-medium"
                        title="LINE 公式マネージャー、または旧 MCP/CLI から作成された可能性"
                      >
                        管理画面外
                      </span>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right whitespace-nowrap">
                    {!m.adminManaged && (
                      <div className="flex flex-col items-end gap-1">
                        <Button type="button" size="xs" variant="primary"
                          onClick={() => onImport(m)}
                        >
                          管理画面に取り込む
                        </Button>
                        <Button type="button" size="xs" variant="destructive"
                          onClick={() => onDeleteExternal(m)}
                        >
                          LINE から削除
                        </Button>
                      </div>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}
    </section>
  )
}
