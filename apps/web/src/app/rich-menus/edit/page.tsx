'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import { CanvasEditor, type Area } from '@/components/rich-menus/canvas-editor'
import { AreaProperties } from '@/components/rich-menus/area-properties'

type Page = {
  id: string
  orderIndex: number
  name: string
  aliasId: string
  lineRichmenuId: string | null
  imageR2Key: string | null
  imageContentType: string | null
  areas: Area[]
}

type Group = {
  id: string
  accountId: string
  name: string
  chatBarText: string
  size: 'large' | 'compact'
  defaultPageId: string | null
  isDefaultForAll: boolean
  selected: boolean
  status: 'draft' | 'published'
  publishingAt: string | null
  pages: Page[]
}

const SIZE_LABEL: Record<Group['size'], string> = {
  large: '2500×1686',
  compact: '2500×843',
}

export default function RichMenuEditPage() {
  return (
    <Suspense
      fallback={
        <main className="p-6 max-w-7xl mx-auto">
          <p className="text-sm text-gray-500">読み込み中...</p>
        </main>
      }
    >
      <RichMenuEditPageInner />
    </Suspense>
  )
}

function RichMenuEditPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const groupId = searchParams.get('id') ?? ''

  if (!groupId) {
    return (
      <main className="p-6 max-w-7xl mx-auto">
        <p className="text-sm text-red-600">id クエリパラメータが必要です</p>
        <Link href="/rich-menus" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
          ← 一覧に戻る
        </Link>
      </main>
    )
  }
  return <Editor groupId={groupId} router={router} />
}

function Editor({
  groupId,
  router,
}: {
  groupId: string
  router: ReturnType<typeof useRouter>
}) {
  const [group, setGroup] = useState<Group | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activePageId, setActivePageId] = useState<string | null>(null)

  // フォーム編集用 (group が読めたら反映)
  const [name, setName] = useState('')
  const [chatBarText, setChatBarText] = useState('')
  const [pages, setPages] = useState<Page[]>([])
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  // isDefaultForAll はこの画面では編集しない (ON/OFF は「友だちに表示」モーダルから)。
  // ただし persistDraft で送信値を一致させるため、現在値を保持する。
  const [isDefaultForAll, setIsDefaultForAll] = useState(false)
  const [selected, setSelected] = useState(false)

  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [unpublishing, setUnpublishing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [imageVersion, setImageVersion] = useState(0)

  const fileInput = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.get(groupId)
      if (!res.success) throw new Error(res.error ?? '取得失敗')
      const g = res.data as Group
      setGroup(g)
      setName(g.name)
      setChatBarText(g.chatBarText)
      setIsDefaultForAll(g.isDefaultForAll)
      setSelected(g.selected)
      setPages(g.pages)
      setActivePageId((prev) =>
        prev && g.pages.some((p) => p.id === prev) ? prev : (g.pages[0]?.id ?? null),
      )
      setSelectedAreaId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    reload()
  }, [reload])

  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0] ?? null
  const selectedArea =
    activePage?.areas.find((a) => a.id === selectedAreaId) ?? null

  function updatePage(pageId: string, patch: Partial<Page>) {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, ...patch } : p)))
  }

  function updateArea(pageId: string, areaId: string, patch: Partial<Area>) {
    setPages((prev) =>
      prev.map((p) =>
        p.id === pageId
          ? {
              ...p,
              areas: p.areas.map((a) => (a.id === areaId ? { ...a, ...patch } : a)),
            }
          : p,
      ),
    )
  }

  function addArea(pageId: string, area: Area) {
    setPages((prev) =>
      prev.map((p) => (p.id === pageId ? { ...p, areas: [...p.areas, area] } : p)),
    )
    setSelectedAreaId(area.id)
  }

  function deleteArea(pageId: string, areaId: string) {
    setPages((prev) =>
      prev.map((p) =>
        p.id === pageId ? { ...p, areas: p.areas.filter((a) => a.id !== areaId) } : p,
      ),
    )
    setSelectedAreaId(null)
  }

  function addPage() {
    const nextOrder = pages.length
    const newPage: Page = {
      id: `tmp-${Math.random().toString(36).slice(2, 10)}`,
      orderIndex: nextOrder,
      name: `ページ ${nextOrder + 1}`,
      aliasId: '',
      lineRichmenuId: null,
      imageR2Key: null,
      imageContentType: null,
      areas: [],
    }
    setPages([...pages, newPage])
    setActivePageId(newPage.id)
    setSelectedAreaId(null)
  }

  function removePage(pageId: string) {
    if (pages.length <= 1) {
      alert('最低 1 ページは必要です。')
      return
    }
    // 削除しようとしているページが他 page の richmenuswitch から参照されてないか確認。
    // 参照ありで削除すると publish 時に `target page not found` で失敗する。
    const referrers = pages
      .filter((p) => p.id !== pageId)
      .filter((p) =>
        p.areas.some(
          (a) =>
            a.actionType === 'richmenuswitch' &&
            (a.actionData as { targetPageId?: string }).targetPageId === pageId,
        ),
      )
    if (referrers.length > 0) {
      alert(
        `このページは ${referrers.map((p) => `「${p.name}」`).join(', ')} のタブ切替アクションから参照されています。先に各 area の遷移先を変更してから削除してください。`,
      )
      return
    }
    if (!confirm('このページを削除しますか？')) return
    const remaining = pages
      .filter((p) => p.id !== pageId)
      .map((p, i) => ({ ...p, orderIndex: i }))
    setPages(remaining)
    if (activePageId === pageId) {
      setActivePageId(remaining[0]?.id ?? null)
    }
    setSelectedAreaId(null)
  }

  async function persistDraft(): Promise<void> {
    const res = await api.richMenuGroups.update(groupId, {
      name,
      chatBarText,
      isDefaultForAll,
      selected,
      pages: pages.map((p, i) => ({
        // 既存 page (UUID) は id を渡す。新規 page (`tmp-*` プレフィックス) は
        // id を渡さず Worker 側で新 UUID を発行させる。
        ...(p.id.startsWith('tmp-') ? {} : { id: p.id }),
        name: p.name,
        orderIndex: i,
        areas: p.areas.map((a) => ({
          boundsX: a.boundsX,
          boundsY: a.boundsY,
          boundsWidth: a.boundsWidth,
          boundsHeight: a.boundsHeight,
          actionType: a.actionType,
          actionData: a.actionData,
        })),
      })),
    })
    if (!res.success) throw new Error(res.error ?? '保存失敗')
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await persistDraft()
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    if (!confirm(
      'このリッチメニューを LINE 公式アカウントに登録します。\n\n' +
        '※ この操作だけでは友だちのトーク画面にはまだ表示されません。\n' +
        '友だちに見せるには、登録後に一覧画面の「友だちに表示」を実行してください。\n\n' +
        '続行しますか？',
    )) return
    setPublishing(true)
    setError(null)
    try {
      await persistDraft()
      const res = await api.richMenuGroups.publish(groupId)
      if (!res.success) throw new Error(res.error ?? 'LINE 登録失敗')
      alert('LINE への登録が完了しました。\n\n友だちに表示するには、一覧画面の「友だちに表示」を実行してください。')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPublishing(false)
    }
  }

  async function handleUnpublish() {
    if (!confirm(
      'このリッチメニューを LINE から取り下げます。\n\n' +
        '・LINE 公式アカウント上のメニュー登録 (alias / richmenu) をすべて削除\n' +
        '・現在このメニューを見ている友だちのトーク画面からも消えます\n\n' +
        '取り下げ後はもう一度「LINE に登録」すれば再公開できます。\n\n続行しますか？',
    )) return
    setUnpublishing(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.unpublish(groupId)
      if (!res.success) throw new Error(res.error ?? '取り下げ失敗')
      const warnings = res.data?.warnings ?? []
      if (warnings.length > 0) {
        alert(`取り下げ完了 (一部 warnings あり):\n\n${warnings.join('\n')}`)
      } else {
        alert('LINE 上のメニュー登録を取り下げました。')
      }
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUnpublishing(false)
    }
  }

  async function handleDelete() {
    if (!group) return
    if (group.status === 'published') {
      alert(
        'このリッチメニューは LINE に登録中です。\n\n' +
          '先に「LINE から取り下げ」を実行してから削除してください。',
      )
      return
    }
    // 二重確認: メニュー名を入力してもらう
    const typed = prompt(
      `この操作は元に戻せません。\n\n削除を確定するには、リッチメニュー名「${group.name}」を入力してください。`,
    )
    if (typed === null) return
    if (typed !== group.name) {
      alert('入力が一致しませんでした。削除をキャンセルしました。')
      return
    }
    try {
      const res = await api.richMenuGroups.delete(groupId)
      if (!res.success) throw new Error(res.error ?? '削除失敗')
      router.push('/rich-menus')
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleImageUpload(pageId: string, file: File) {
    if (pageId.startsWith('tmp-')) {
      alert('まず Save Draft でページを保存してから画像を upload してください。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.uploadImage(groupId, pageId, file)
      updatePage(pageId, {
        imageR2Key: res.data.imageR2Key,
        imageContentType: res.data.imageContentType,
      })
      setImageVersion((v) => v + 1)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="p-6 max-w-7xl mx-auto">
        <p className="text-sm text-gray-500">読み込み中...</p>
      </main>
    )
  }
  if (!group) {
    return (
      <main className="p-6 max-w-7xl mx-auto">
        <p className="text-sm text-red-600">{error ?? 'リッチメニューが見つかりません'}</p>
        <Link href="/rich-menus" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
          ← 一覧に戻る
        </Link>
      </main>
    )
  }

  // richmenuswitch の遷移先候補は「保存済み page (UUID) のみ」に絞る。
  // 未保存 page (tmp-*) は persistDraft 時に id が新 UUID に置き換わるので、
  // ここで targetPageId に出してしまうと publish で `target page not found`
  // で失敗する。
  const pagesForSelect = pages
    .filter((p) => !p.id.startsWith('tmp-'))
    .map((p) => ({ id: p.id, name: p.name }))
  const imageUrl = activePage?.imageR2Key
    ? `${api.richMenuGroups.imageUrl(activePage.imageR2Key)}?v=${imageVersion}`
    : null

  return (
    <main className="p-6 max-w-7xl mx-auto">
      <Header
        title={name || '(無名)'}
        description={`サイズ ${SIZE_LABEL[group.size]} • ${group.status === 'published' ? 'LINE 登録済み' : '下書き'}`}
        action={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm text-gray-600 mr-2 cursor-pointer">
              <input
                type="checkbox"
                checked={preview}
                onChange={(e) => setPreview(e.target.checked)}
              />
              プレビュー
            </label>
            <button
              onClick={handleSave}
              disabled={saving || publishing || unpublishing || busy}
              className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {saving ? '保存中...' : '下書き保存'}
            </button>
            <button
              onClick={handlePublish}
              disabled={saving || publishing || unpublishing || busy}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#06C755' }}
            >
              {publishing
                ? 'LINE 登録中...'
                : group.status === 'published'
                  ? 'LINE に再登録'
                  : 'LINE に登録'}
            </button>
          </div>
        }
      />

      <Link
        href="/rich-menus"
        className="text-sm text-gray-500 hover:underline mb-4 inline-block"
      >
        ← 一覧に戻る
      </Link>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* タブバー */}
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        {pages.map((p) => {
          const active = p.id === activePageId
          return (
            <button
              key={p.id}
              onClick={() => {
                setActivePageId(p.id)
                setSelectedAreaId(null)
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              style={active ? { backgroundColor: '#06C755' } : undefined}
            >
              {p.name}
              {p.id.startsWith('tmp-') && (
                <span className="ml-1 text-xs opacity-70">(未保存)</span>
              )}
            </button>
          )
        })}
        <button
          onClick={addPage}
          className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          + ページ追加
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* 中央: キャンバス */}
        <section>
          {activePage ? (
            <CanvasEditor
              areas={activePage.areas}
              size={group.size}
              imageUrl={imageUrl}
              selectedAreaId={selectedAreaId}
              onSelectArea={setSelectedAreaId}
              onAddArea={(area) => addArea(activePage.id, area)}
              onUpdateArea={(id, patch) => updateArea(activePage.id, id, patch)}
              onDeleteArea={(id) => deleteArea(activePage.id, id)}
              preview={preview}
              onPreviewAction={(area) => {
                if (area.actionType === 'uri') {
                  const uri = (area.actionData as { uri?: string }).uri
                  if (uri) window.open(uri, '_blank')
                } else if (area.actionType === 'richmenuswitch') {
                  const targetId = (area.actionData as { targetPageId?: string }).targetPageId
                  if (targetId && pages.some((p) => p.id === targetId)) {
                    setActivePageId(targetId)
                    setSelectedAreaId(null)
                  }
                } else {
                  alert(`action: ${area.actionType}\n${JSON.stringify(area.actionData)}`)
                }
              }}
            />
          ) : (
            <p className="text-sm text-gray-500">ページがありません</p>
          )}
        </section>

        {/* 右パネル */}
        <aside className="space-y-5">
          {/* メニュー設定 */}
          <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">メニュー設定</h2>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">名前</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="mt-1 text-[11px] text-gray-500">管理画面でだけ使う名前 (友だちには見えない)</p>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">トーク画面下の文言</span>
              <input
                value={chatBarText}
                onChange={(e) => setChatBarText(e.target.value)}
                maxLength={14}
                className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="mt-1 text-[11px] text-gray-500">14 文字以内 (友だちのトーク画面でメニューを開く前に表示)</p>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) => setSelected(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-xs font-medium text-gray-700">
                  トークを開いたときにメニューを表示する
                </span>
                <span className="block mt-1 text-[11px] text-gray-500">
                  変更後は「LINE に登録」をやり直すと反映されます。
                </span>
              </span>
            </label>
          </section>

          {/* ページ設定 (画像 upload 含む、常時表示) */}
          {activePage && (
            <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-900">ページ設定</h2>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">ページ名</span>
                <input
                  value={activePage.name}
                  onChange={(e) =>
                    updatePage(activePage.id, { name: e.target.value })
                  }
                  className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </label>
              <div>
                <span className="text-xs font-medium text-gray-600">画像</span>
                {activePage.imageR2Key ? (
                  <p className="mt-1 text-xs text-gray-700">✓ アップロード済み</p>
                ) : (
                  <p className="mt-1 text-xs text-gray-400">未設定</p>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleImageUpload(activePage.id, file)
                    e.target.value = ''
                  }}
                />
                <button
                  onClick={() => fileInput.current?.click()}
                  disabled={busy || activePage.id.startsWith('tmp-')}
                  className="mt-2 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {activePage.imageR2Key ? '画像を差し替え' : '画像を選択'}
                </button>
                <p className="mt-1.5 text-[11px] text-gray-500">
                  PNG / JPEG, {SIZE_LABEL[group.size]}, 1MB 以下
                </p>
                {activePage.id.startsWith('tmp-') && (
                  <p className="mt-1 text-[11px] text-amber-600">
                    新規ページは「下書き保存」してから画像をアップロードしてください
                  </p>
                )}
              </div>
              <p className="text-[11px] text-gray-400 pt-3 border-t border-gray-100">
                中央のキャンバスでドラッグして tap 領域 (areas) を追加・編集できます。
              </p>
            </section>
          )}

          {/* 選択中エリア (area が選択されている時のみ追加表示) */}
          {selectedArea && activePage && (
            <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
              <AreaProperties
                area={selectedArea}
                pages={pagesForSelect}
                onUpdate={(patch) =>
                  updateArea(activePage.id, selectedArea.id, patch)
                }
                onDelete={() => deleteArea(activePage.id, selectedArea.id)}
              />
            </section>
          )}
        </aside>
      </div>

      {/* ─────────── 危険な操作 (画面最下部に分離) ─────────── */}
      <section className="mt-10 bg-red-50 border border-red-200 rounded-lg shadow-sm p-5">
        <h2 className="text-sm font-semibold text-red-700 mb-1">危険な操作</h2>
        <p className="text-xs text-red-600 mb-4">
          以下の操作は元に戻せません。誤操作を避けるため、別セクションにまとめています。
        </p>
        <div className="space-y-3">
          {group.status === 'published' && (
            <div className="flex items-start justify-between gap-4 bg-white border border-red-200 rounded-lg p-4">
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">LINE から取り下げ</div>
                <div className="text-xs text-gray-600 mt-0.5">
                  LINE 公式アカウント上のメニュー登録 (alias / richmenu / 全員のデフォルト設定) を解除します。
                  友だちのトーク画面からメニューが消えます。下書きに戻すので、再登録すれば復旧できます。
                </div>
              </div>
              <button
                onClick={handleUnpublish}
                disabled={saving || publishing || unpublishing || busy}
                className="shrink-0 px-3 py-2 text-sm font-medium border border-red-300 text-red-700 bg-white rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {unpublishing ? '取り下げ中...' : 'LINE から取り下げ'}
              </button>
            </div>
          )}
          {activePage && pages.length > 1 && (
            <div className="flex items-start justify-between gap-4 bg-white border border-red-200 rounded-lg p-4">
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">
                  ページ「{activePage.name}」を削除
                </div>
                <div className="text-xs text-gray-600 mt-0.5">
                  現在表示中のページを削除します。他のページから「タブ切替」でこのページを参照している場合は事前に解除が必要です。
                </div>
              </div>
              <button
                onClick={() => removePage(activePage.id)}
                className="shrink-0 px-3 py-2 text-sm font-medium border border-red-300 text-red-700 bg-white rounded-lg hover:bg-red-50 transition-colors"
              >
                ページ削除
              </button>
            </div>
          )}
          <div className="flex items-start justify-between gap-4 bg-white border border-red-300 rounded-lg p-4">
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900">
                このリッチメニュー全体を削除
              </div>
              <div className="text-xs text-gray-600 mt-0.5">
                {group.status === 'published'
                  ? '⚠ 先に「LINE から取り下げ」を実行してください。LINE 上のメニューが残ったままだと友だちに表示され続けます。'
                  : '管理画面と DB から完全に削除します。元には戻せません。'}
              </div>
            </div>
            <button
              onClick={handleDelete}
              className="shrink-0 px-3 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#dc2626' }}
            >
              削除
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
