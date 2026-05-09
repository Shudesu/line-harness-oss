'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type RichMenu, type RichMenuAction, type RichMenuArea } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

type SizePreset = 'full' | 'half'
type LayoutPreset = '3' | '6'
type ActionType = 'uri' | 'message' | 'postback'

type AreaForm = {
  label: string
  type: ActionType
  value: string
}

const sizeOptions: Record<SizePreset, { label: string; width: number; height: number }> = {
  full: { label: 'フルサイズ 2500x1686', width: 2500, height: 1686 },
  half: { label: 'ハーフサイズ 2500x843', width: 2500, height: 843 },
}

function createAreaForms(count: number): AreaForm[] {
  return Array.from({ length: count }, (_, index) => ({
    label: `エリア${index + 1}`,
    type: 'uri',
    value: '',
  }))
}

function boundsFor(index: number, layout: LayoutPreset, size: SizePreset) {
  if (layout === '3') {
    const width = index === 2 ? 834 : 833
    return { x: index * 833, y: 0, width, height: 843 }
  }

  const row = Math.floor(index / 3)
  const col = index % 3
  const width = col === 2 ? 834 : 833
  return { x: col * 833, y: row * 843, width, height: size === 'full' ? 843 : 421 }
}

function toAction(area: AreaForm): RichMenuAction {
  const label = area.label.trim() || undefined
  const value = area.value.trim()
  if (area.type === 'message') return { type: 'message', text: value, label }
  if (area.type === 'postback') return { type: 'postback', data: value, displayText: area.label.trim() || value, label }
  return { type: 'uri', uri: value, label }
}

function formatSize(menu: RichMenu) {
  return `${menu.size.width} x ${menu.size.height}`
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function RichMenusPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [menus, setMenus] = useState<RichMenu[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createdRichMenuId, setCreatedRichMenuId] = useState('')
  const [form, setForm] = useState({
    name: 'メインメニュー',
    chatBarText: 'メニュー',
    selected: true,
    size: 'full' as SizePreset,
    layout: '6' as LayoutPreset,
    areas: createAreaForms(6),
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.richMenus.list({ accountId: selectedAccountId || undefined })
      if (res.success) setMenus(res.data)
      else setError(res.error || 'リッチメニュー一覧の取得に失敗しました')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'リッチメニュー一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const areaCount = form.layout === '3' ? 3 : 6
  const canCreate = useMemo(() => {
    return Boolean(form.name.trim() && form.chatBarText.trim() && form.areas.slice(0, areaCount).every((area) => area.value.trim()))
  }, [areaCount, form])

  function changeLayout(layout: LayoutPreset) {
    const nextCount = layout === '3' ? 3 : 6
    setForm((prev) => ({
      ...prev,
      layout,
      size: layout === '6' ? 'full' : prev.size,
      areas: prev.areas.length >= nextCount
        ? prev.areas.slice(0, nextCount)
        : [...prev.areas, ...createAreaForms(nextCount - prev.areas.length)],
    }))
  }

  async function handleCreate() {
    if (!canCreate || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    setCreatedRichMenuId('')
    try {
      const size = sizeOptions[form.size]
      const areas: RichMenuArea[] = form.areas.slice(0, areaCount).map((area, index) => ({
        bounds: boundsFor(index, form.layout, form.size),
        action: toAction(area),
      }))
      const res = await api.richMenus.create({
        size: { width: size.width, height: size.height },
        selected: form.selected,
        name: form.name.trim(),
        chatBarText: form.chatBarText.trim(),
        areas,
      }, { accountId: selectedAccountId || undefined })
      if (!res.success) throw new Error(res.error || 'リッチメニュー作成に失敗しました')
      setCreatedRichMenuId(res.data.richMenuId)
      setNotice('リッチメニューを作成しました。続けて画像をアップロードしてください。')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'リッチメニュー作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpload(richMenuId: string, file: File | undefined) {
    if (!file) return
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setError('画像はPNGまたはJPEGを選択してください')
      return
    }
    if (file.size > 1024 * 1024) {
      setError('LINEの制約に合わせ、画像は1MB以下にしてください')
      return
    }
    setUploadingId(richMenuId)
    setError('')
    setNotice('')
    try {
      const image = await fileToDataUrl(file)
      const res = await api.richMenus.uploadImage(
        richMenuId,
        { image, contentType: file.type as 'image/png' | 'image/jpeg' },
        { accountId: selectedAccountId || undefined },
      )
      if (!res.success) throw new Error(res.error || '画像アップロードに失敗しました')
      setNotice('画像をアップロードしました。必要に応じてデフォルト設定してください。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像アップロードに失敗しました')
    } finally {
      setUploadingId(null)
    }
  }

  async function handleSetDefault(richMenuId: string) {
    const ok = confirm('このリッチメニューを全友だちのデフォルトに設定します。既存のデフォルト表示が切り替わります。実行しますか？')
    if (!ok) return
    setError('')
    setNotice('')
    try {
      const res = await api.richMenus.setDefault(richMenuId, { accountId: selectedAccountId || undefined })
      if (!res.success) throw new Error(res.error || 'デフォルト設定に失敗しました')
      setNotice('デフォルトリッチメニューを設定しました')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'デフォルト設定に失敗しました')
    }
  }

  async function handleDelete(richMenuId: string) {
    const ok = confirm('LINE Platform上のリッチメニューを削除します。画像や設定も利用できなくなります。削除しますか？')
    if (!ok) return
    setError('')
    setNotice('')
    try {
      const res = await api.richMenus.delete(richMenuId, { accountId: selectedAccountId || undefined })
      if (!res.success) throw new Error(res.error || '削除に失敗しました')
      setNotice('リッチメニューを削除しました')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="リッチメニュー管理"
        description={`LINE Platform上のリッチメニューを管理します${selectedAccount ? ` / ${selectedAccount.displayName || selectedAccount.name}` : ''}`}
        action={
          <button
            onClick={() => setShowCreate((value) => !value)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            {showCreate ? '作成を閉じる' : '+ リッチメニュー作成'}
          </button>
        }
      />

      {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      {notice && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{notice}</div>}

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        安全制約: 作成だけでは友だちには表示されません。画像アップロード後、明示的に「デフォルト設定」を押した場合のみ全友だちに反映します。削除とデフォルト設定は確認ダイアログを挟みます。
      </div>

      {showCreate && (
        <section className="mb-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">新規リッチメニュー</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">管理名</span>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">チャットバー表示</span>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={form.chatBarText} onChange={(e) => setForm({ ...form, chatBarText: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">サイズ</span>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value as SizePreset })} disabled={form.layout === '6'}>
                <option value="full">{sizeOptions.full.label}</option>
                <option value="half">{sizeOptions.half.label}</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">レイアウト</span>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" value={form.layout} onChange={(e) => changeLayout(e.target.value as LayoutPreset)}>
                <option value="6">6分割</option>
                <option value="3">3分割</option>
              </select>
            </label>
          </div>
          <label className="mt-4 inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.selected} onChange={(e) => setForm({ ...form, selected: e.target.checked })} />
            初期表示でメニューを開く
          </label>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            {form.areas.slice(0, areaCount).map((area, index) => (
              <div key={index} className="rounded-lg border border-gray-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800">タップ領域 {index + 1}</p>
                  <span className="text-xs text-gray-400">{area.type}</span>
                </div>
                <div className="space-y-3">
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="ラベル"
                    value={area.label}
                    onChange={(e) => setForm((prev) => ({ ...prev, areas: prev.areas.map((item, i) => i === index ? { ...item, label: e.target.value } : item) }))}
                  />
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                    value={area.type}
                    onChange={(e) => setForm((prev) => ({ ...prev, areas: prev.areas.map((item, i) => i === index ? { ...item, type: e.target.value as ActionType, value: '' } : item) }))}
                  >
                    <option value="uri">URLを開く</option>
                    <option value="message">メッセージ送信</option>
                    <option value="postback">postback</option>
                  </select>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder={area.type === 'uri' ? 'https://...' : area.type === 'message' ? '送信するテキスト' : 'action=...'}
                    value={area.value}
                    onChange={(e) => setForm((prev) => ({ ...prev, areas: prev.areas.map((item, i) => i === index ? { ...item, value: e.target.value } : item) }))}
                  />
                </div>
              </div>
            ))}
          </div>

          {createdRichMenuId && (
            <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700">
              作成済みID: <span className="font-mono">{createdRichMenuId}</span>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!canCreate || saving}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {saving ? '作成中...' : '作成する'}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
              閉じる
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">読み込み中...</div>
      ) : menus.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-500">
          リッチメニューがありません。作成後、画像をアップロードしてください。
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {menus.map((menu) => (
            <article key={menu.richMenuId} className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-gray-900 truncate">{menu.name}</h2>
                  <p className="text-xs text-gray-400 font-mono truncate">{menu.richMenuId}</p>
                </div>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{formatSize(menu)}</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs text-gray-400">チャットバー</p>
                  <p className="font-medium text-gray-800">{menu.chatBarText}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs text-gray-400">領域数</p>
                  <p className="font-medium text-gray-800">{menu.areas.length}</p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {menu.areas.map((area, index) => (
                  <div key={index} className="rounded-lg border border-gray-100 p-3 text-xs text-gray-600">
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold text-gray-800">領域 {index + 1}</span>
                      <span>{area.action.type}</span>
                    </div>
                    <p className="mt-1 truncate">
                      {'uri' in area.action ? area.action.uri : 'text' in area.action ? area.action.text : area.action.data}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-3">
                <label className="block text-xs font-medium text-gray-600 mb-2">画像アップロード PNG/JPEG 1MB以下</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  disabled={uploadingId === menu.richMenuId}
                  onChange={(e) => void handleUpload(menu.richMenuId, e.target.files?.[0])}
                  className="block w-full text-xs text-gray-500 file:mr-3 file:rounded-md file:border-0 file:bg-green-50 file:px-3 file:py-2 file:text-xs file:font-medium file:text-green-700"
                />
                {uploadingId === menu.richMenuId && <p className="mt-2 text-xs text-gray-400">アップロード中...</p>}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => void handleSetDefault(menu.richMenuId)} className="px-3 py-2 text-xs font-medium text-white rounded-lg" style={{ backgroundColor: '#06C755' }}>
                  デフォルト設定
                </button>
                <button onClick={() => void handleDelete(menu.richMenuId)} className="px-3 py-2 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg">
                  削除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
