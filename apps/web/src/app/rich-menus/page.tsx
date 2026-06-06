'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RichMenu, RichMenuAction, RichMenuArea } from '@line-harness/sdk'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import { createLineHarnessClient } from '@/lib/line-harness-client'

type SizePreset = 'full' | 'half'
type LayoutPreset = 'custom' | '3' | '6'
type ActionType = 'uri' | 'message' | 'postback' | 'richmenuswitch'

type AreaForm = {
  id: string
  label: string
  type: ActionType
  value: string
  displayText: string
  x: number
  y: number
  width: number
  height: number
}

const MAX_AREAS = 20

const sizeOptions: Record<SizePreset, { label: string; width: number; height: number }> = {
  full: { label: 'フルサイズ 2500x1686', width: 2500, height: 1686 },
  half: { label: 'ハーフサイズ 2500x843', width: 2500, height: 843 },
}

function newArea(index: number, size: SizePreset): AreaForm {
  const preset = sizeOptions[size]
  return {
    id: crypto.randomUUID(),
    label: `エリア${index + 1}`,
    type: 'uri',
    value: '',
    displayText: '',
    x: 0,
    y: Math.min(index * 120, Math.max(0, preset.height - 120)),
    width: 600,
    height: 120,
  }
}

function presetBounds(index: number, layout: Exclude<LayoutPreset, 'custom'>, size: SizePreset) {
  if (layout === '3') {
    const width = index === 2 ? 834 : 833
    return { x: index * 833, y: 0, width, height: 843 }
  }

  const row = Math.floor(index / 3)
  const col = index % 3
  const width = col === 2 ? 834 : 833
  return { x: col * 833, y: row * 843, width, height: size === 'full' ? 843 : 421 }
}

function createPresetAreas(layout: Exclude<LayoutPreset, 'custom'>, size: SizePreset): AreaForm[] {
  const count = layout === '3' ? 3 : 6
  return Array.from({ length: count }, (_, index) => ({
    ...newArea(index, size),
    ...presetBounds(index, layout, size),
  }))
}

function toAction(area: AreaForm): RichMenuAction {
  const label = area.label.trim() || undefined
  const value = area.value.trim()
  if (area.type === 'message') return { type: 'message', text: value, label }
  if (area.type === 'postback') {
    const displayText = area.displayText.trim() || area.label.trim() || value
    return { type: 'postback', data: value, displayText, label }
  }
  if (area.type === 'richmenuswitch') {
    return {
      type: 'richmenuswitch',
      richMenuAliasId: value,
      data: area.displayText.trim() || `switch:${value}`,
      label,
    }
  }
  return { type: 'uri', uri: value, label }
}

function actionSummary(action: RichMenuAction) {
  if (action.type === 'uri') return action.uri
  if (action.type === 'message') return action.text
  if (action.type === 'richmenuswitch') return `${action.richMenuAliasId} / ${action.data}`
  return action.data
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

function validateAreas(areas: AreaForm[], size: { width: number; height: number }) {
  if (areas.length < 1) return 'タップ領域を1つ以上設定してください'
  if (areas.length > MAX_AREAS) return `タップ領域は最大${MAX_AREAS}個です`

  for (const [index, area] of areas.entries()) {
    const label = `領域${index + 1}`
    if (!area.value.trim()) return `${label}のアクション値を入力してください`
    if (area.width <= 0 || area.height <= 0) return `${label}の幅と高さは1以上にしてください`
    if (area.x < 0 || area.y < 0) return `${label}のx/yは0以上にしてください`
    if (area.x + area.width > size.width) return `${label}が画像の横幅を超えています`
    if (area.y + area.height > size.height) return `${label}が画像の高さを超えています`
    if (area.type === 'richmenuswitch' && !/^[A-Za-z0-9_-]{1,32}$/.test(area.value.trim())) {
      return `${label}の切替先エイリアスIDは1-32文字の英数字・_・-で入力してください`
    }
  }
  return ''
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
  const [imagePreviews, setImagePreviews] = useState<Record<string, { url: string; key: string; mimeType: string }>>({})
  const [aliasForm, setAliasForm] = useState({ richMenuAliasId: '', richMenuId: '' })
  const [form, setForm] = useState({
    name: 'メインメニュー',
    chatBarText: 'メニュー',
    selected: true,
    size: 'full' as SizePreset,
    layout: '6' as LayoutPreset,
    areas: createPresetAreas('6', 'full'),
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const client = createLineHarnessClient(selectedAccountId)
      const loadedMenus = await client.richMenus.list()
      setMenus(loadedMenus)
      const previews = loadedMenus.reduce<Record<string, { url: string; key: string; mimeType: string }>>((acc, menu) => {
        if (menu.imageAsset) {
          acc[menu.richMenuId] = {
            url: menu.imageAsset.image_url,
            key: menu.imageAsset.image_key,
            mimeType: menu.imageAsset.mime_type,
          }
        }
        return acc
      }, {})
      setImagePreviews(previews)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'リッチメニュー一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const size = sizeOptions[form.size]
  const validationError = useMemo(() => {
    if (!form.name.trim()) return '管理名を入力してください'
    if (!form.chatBarText.trim()) return 'チャットバー表示を入力してください'
    return validateAreas(form.areas, size)
  }, [form, size])
  const canCreate = !validationError

  function applyLayout(layout: LayoutPreset) {
    setForm((prev) => {
      if (layout === 'custom') return { ...prev, layout }
      const nextSize = layout === '6' ? 'full' : prev.size
      return {
        ...prev,
        layout,
        size: nextSize,
        areas: createPresetAreas(layout, nextSize),
      }
    })
  }

  function updateArea(id: string, patch: Partial<AreaForm>) {
    setForm((prev) => ({
      ...prev,
      layout: prev.layout === 'custom' ? prev.layout : 'custom',
      areas: prev.areas.map((area) => area.id === id ? { ...area, ...patch } : area),
    }))
  }

  function addArea() {
    setForm((prev) => {
      if (prev.areas.length >= MAX_AREAS) return prev
      return {
        ...prev,
        layout: 'custom',
        areas: [...prev.areas, newArea(prev.areas.length, prev.size)],
      }
    })
  }

  function removeArea(id: string) {
    setForm((prev) => ({
      ...prev,
      layout: 'custom',
      areas: prev.areas.filter((area) => area.id !== id),
    }))
  }

  async function handleCreate() {
    if (!canCreate || saving) {
      if (validationError) setError(validationError)
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    setCreatedRichMenuId('')
    try {
      const areas: RichMenuArea[] = form.areas.map((area) => ({
        bounds: {
          x: Math.round(area.x),
          y: Math.round(area.y),
          width: Math.round(area.width),
          height: Math.round(area.height),
        },
        action: toAction(area),
      }))
      const client = createLineHarnessClient(selectedAccountId)
      const result = await client.richMenus.create({
        size: { width: size.width, height: size.height },
        selected: form.selected,
        name: form.name.trim(),
        chatBarText: form.chatBarText.trim(),
        areas,
      })
      setCreatedRichMenuId(result.richMenuId)
      setNotice('リッチメニューを作成しました。続けて画像アップロードと、必要ならエイリアス保存をしてください。')
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
      const client = createLineHarnessClient(selectedAccountId)
      const uploaded = await client.images.upload({
        data: image,
        mimeType: file.type,
        filename: file.name,
      })
      setImagePreviews((prev) => ({
        ...prev,
        [richMenuId]: {
          url: uploaded.url,
          key: uploaded.key,
          mimeType: uploaded.mimeType,
        },
      }))
      await client.richMenus.uploadImage(
        richMenuId,
        image,
        file.type as 'image/png' | 'image/jpeg',
        {
          asset: {
            key: uploaded.key,
            url: uploaded.url,
            mimeType: uploaded.mimeType,
            size: uploaded.size,
          },
        },
      )
      setNotice('画像をR2に保存し、LINEリッチメニュー画像として登録しました。必要に応じてデフォルト設定してください。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像アップロードまたはLINE登録に失敗しました')
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
      const client = createLineHarnessClient(selectedAccountId)
      await client.richMenus.setDefault(richMenuId)
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
      const client = createLineHarnessClient(selectedAccountId)
      await client.richMenus.delete(richMenuId)
      setNotice('リッチメニューを削除しました')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました')
    }
  }

  async function handleSaveAlias() {
    const richMenuAliasId = aliasForm.richMenuAliasId.trim()
    const richMenuId = aliasForm.richMenuId.trim()
    if (!richMenuAliasId || !richMenuId) {
      setError('エイリアスIDとリッチメニューIDを入力してください')
      return
    }
    setError('')
    setNotice('')
    try {
      const client = createLineHarnessClient(selectedAccountId)
      await client.richMenus.saveAlias(richMenuAliasId, richMenuId, { upsert: true })
      setNotice(`エイリアス ${richMenuAliasId} を保存しました`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エイリアス保存に失敗しました')
    }
  }

  async function handleDeleteAlias() {
    const richMenuAliasId = aliasForm.richMenuAliasId.trim()
    if (!richMenuAliasId) {
      setError('削除するエイリアスIDを入力してください')
      return
    }
    const ok = confirm(`エイリアス ${richMenuAliasId} を削除します。richmenuswitchの切替先に使っている場合は切替できなくなります。削除しますか？`)
    if (!ok) return
    setError('')
    setNotice('')
    try {
      const client = createLineHarnessClient(selectedAccountId)
      await client.richMenus.deleteAlias(richMenuAliasId)
      setNotice(`エイリアス ${richMenuAliasId} を削除しました`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エイリアス削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="リッチメニュー管理"
        description={`自由なタップ領域とタブ切替を設定します${selectedAccount ? ` / ${selectedAccount.displayName || selectedAccount.name}` : ''}`}
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
        安全制約: 作成だけでは友だちには表示されません。画像アップロード後、明示的に「デフォルト設定」を押した場合のみ反映します。タブ切替は2つ以上のリッチメニューを作り、エイリアスIDを `richmenuswitch` の切替先に指定します。
      </div>

      <section className="mb-6 bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">タブ切替エイリアス</h2>
            <p className="mt-1 text-xs text-gray-500">例: `main-tab` をメニューAに、`reserve-tab` をメニューBに紐づけ、各領域のアクションで切り替えます。</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_2fr_auto]">
          <input
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="richMenuAliasId 例: reserve-tab"
            value={aliasForm.richMenuAliasId}
            onChange={(e) => setAliasForm((prev) => ({ ...prev, richMenuAliasId: e.target.value }))}
          />
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            value={aliasForm.richMenuId}
            onChange={(e) => setAliasForm((prev) => ({ ...prev, richMenuId: e.target.value }))}
          >
            <option value="">紐づけるリッチメニューを選択</option>
            {menus.map((menu) => (
              <option key={menu.richMenuId} value={menu.richMenuId}>{menu.name} / {menu.richMenuId}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button onClick={() => void handleSaveAlias()} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white">保存</button>
            <button onClick={() => void handleDeleteAlias()} className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">削除</button>
          </div>
        </div>
      </section>

      {showCreate && (
        <section className="mb-6 bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">新規リッチメニュー</h2>
              <p className="mt-1 text-xs text-gray-500">最大20領域。座標はLINE画像サイズ上のpxで指定します。</p>
            </div>
            <span className="text-xs text-gray-500">{form.areas.length}/{MAX_AREAS} 領域</span>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
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
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" value={form.size} onChange={(e) => setForm((prev) => ({ ...prev, layout: 'custom', size: e.target.value as SizePreset }))}>
                <option value="full">{sizeOptions.full.label}</option>
                <option value="half">{sizeOptions.half.label}</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">レイアウト</span>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" value={form.layout} onChange={(e) => applyLayout(e.target.value as LayoutPreset)}>
                <option value="6">6分割プリセット</option>
                <option value="3">3分割プリセット</option>
                <option value="custom">カスタム</option>
              </select>
            </label>
          </div>

          <label className="mt-4 inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.selected} onChange={(e) => setForm({ ...form, selected: e.target.checked })} />
            初期表示でメニューを開く
          </label>

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(320px,420px)_1fr]">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
                <span>配置プレビュー</span>
                <span>{size.width} x {size.height}</span>
              </div>
              <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-white" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
                {form.areas.map((area, index) => (
                  <div
                    key={area.id}
                    className="absolute flex items-center justify-center border-2 border-green-500/80 bg-green-100/60 text-[10px] font-semibold text-green-900"
                    style={{
                      left: `${(area.x / size.width) * 100}%`,
                      top: `${(area.y / size.height) * 100}%`,
                      width: `${(area.width / size.width) * 100}%`,
                      height: `${(area.height / size.height) * 100}%`,
                    }}
                  >
                    {index + 1}
                  </div>
                ))}
              </div>
              <button onClick={addArea} disabled={form.areas.length >= MAX_AREAS} className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">
                + タップ領域を追加
              </button>
            </div>

            <div className="space-y-3">
              {form.areas.map((area, index) => (
                <div key={area.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-800">タップ領域 {index + 1}</p>
                    <button onClick={() => removeArea(area.id)} className="text-xs font-medium text-red-600 disabled:opacity-40" disabled={form.areas.length <= 1}>削除</button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(['x', 'y', 'width', 'height'] as const).map((field) => (
                      <label key={field} className="block">
                        <span className="block text-[11px] font-medium text-gray-500 mb-1">{field}</span>
                        <input
                          type="number"
                          min={field === 'x' || field === 'y' ? 0 : 1}
                          className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm"
                          value={area[field]}
                          onChange={(e) => updateArea(area.id, { [field]: Number(e.target.value) } as Partial<AreaForm>)}
                        />
                      </label>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_180px]">
                    <input
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="ラベル"
                      value={area.label}
                      onChange={(e) => updateArea(area.id, { label: e.target.value })}
                    />
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                      value={area.type}
                      onChange={(e) => updateArea(area.id, { type: e.target.value as ActionType, value: '', displayText: '' })}
                    >
                      <option value="uri">URLを開く</option>
                      <option value="message">メッセージ送信</option>
                      <option value="postback">postback</option>
                      <option value="richmenuswitch">タブ切替</option>
                    </select>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <input
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder={area.type === 'uri' ? 'https://...' : area.type === 'message' ? '送信するテキスト' : area.type === 'richmenuswitch' ? '切替先 aliasId 例: reserve-tab' : 'postback data 例: action=reserve'}
                      value={area.value}
                      onChange={(e) => updateArea(area.id, { value: e.target.value })}
                    />
                    <input
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder={area.type === 'richmenuswitch' ? '切替data 例: switch-to-reserve' : area.type === 'postback' ? '表示テキスト 任意' : '任意補助値'}
                      value={area.displayText}
                      onChange={(e) => updateArea(area.id, { displayText: e.target.value })}
                      disabled={area.type === 'uri' || area.type === 'message'}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {validationError && (
            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
              {validationError}
            </div>
          )}

          {createdRichMenuId && (
            <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700">
              作成済みID: <span className="font-mono">{createdRichMenuId}</span>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              onClick={() => void handleCreate()}
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
                    <p className="mt-1 text-gray-400">x:{area.bounds.x} y:{area.bounds.y} w:{area.bounds.width} h:{area.bounds.height}</p>
                    <p className="mt-1 truncate">{actionSummary(area.action)}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-3">
                <label className="block text-xs font-medium text-gray-600 mb-2">画像アップロード PNG/JPEG 1MB以下</label>
                {imagePreviews[menu.richMenuId] && (
                  <div className="mb-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    <img
                      src={imagePreviews[menu.richMenuId].url}
                      alt={`${menu.name} preview`}
                      className="h-auto w-full object-contain"
                    />
                    <div className="border-t border-gray-200 px-3 py-2 text-[11px] text-gray-500">
                      R2: <span className="font-mono">{imagePreviews[menu.richMenuId].key}</span>
                    </div>
                  </div>
                )}
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
                <button onClick={() => setAliasForm((prev) => ({ ...prev, richMenuId: menu.richMenuId }))} className="px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">
                  エイリアス対象にする
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
