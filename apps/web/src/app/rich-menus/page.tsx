'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import type { RichMenu, RichMenuArea, RichMenuBounds } from '@/lib/api'
import Header from '@/components/layout/header'

type SizeKey = '1200x810' | '1200x405'

const SIZES: Record<SizeKey, { width: number; height: number; label: string }> = {
  '1200x810': { width: 1200, height: 810, label: '通常 (1200×810)' },
  '1200x405': { width: 1200, height: 405, label: 'コンパクト (1200×405)' },
}

type PresetKey = 'full' | 'halves_h' | 'halves_v' | 'hero_left_2right' | 'grid_2x3' | 'triple_v'

const PRESETS: Record<PresetKey, { label: string; build: (w: number, h: number) => RichMenuBounds[] }> = {
  full: {
    label: '全面 (1エリア)',
    build: (w, h) => [{ x: 0, y: 0, width: w, height: h }],
  },
  halves_h: {
    label: '上下2分割',
    build: (w, h) => [
      { x: 0, y: 0, width: w, height: Math.floor(h / 2) },
      { x: 0, y: Math.floor(h / 2), width: w, height: h - Math.floor(h / 2) },
    ],
  },
  halves_v: {
    label: '左右2分割',
    build: (w, h) => [
      { x: 0, y: 0, width: Math.floor(w / 2), height: h },
      { x: Math.floor(w / 2), y: 0, width: w - Math.floor(w / 2), height: h },
    ],
  },
  hero_left_2right: {
    label: '左大 + 右上下',
    build: (w, h) => [
      { x: 0, y: 0, width: Math.floor(w / 2), height: h },
      { x: Math.floor(w / 2), y: 0, width: w - Math.floor(w / 2), height: Math.floor(h / 2) },
      {
        x: Math.floor(w / 2),
        y: Math.floor(h / 2),
        width: w - Math.floor(w / 2),
        height: h - Math.floor(h / 2),
      },
    ],
  },
  grid_2x3: {
    label: '2列×3行 (6エリア)',
    build: (w, h) => {
      const res: RichMenuBounds[] = []
      const cw = Math.floor(w / 2)
      const ch = Math.floor(h / 3)
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 2; c++) {
          res.push({
            x: c * cw,
            y: r * ch,
            width: c === 1 ? w - cw : cw,
            height: r === 2 ? h - 2 * ch : ch,
          })
        }
      }
      return res
    },
  },
  triple_v: {
    label: '縦3分割',
    build: (w, h) => {
      const cw = Math.floor(w / 3)
      return [
        { x: 0, y: 0, width: cw, height: h },
        { x: cw, y: 0, width: cw, height: h },
        { x: 2 * cw, y: 0, width: w - 2 * cw, height: h },
      ]
    },
  },
}

const PRESETS_BY_SIZE: Record<SizeKey, PresetKey[]> = {
  '1200x810': ['full', 'halves_h', 'halves_v', 'hero_left_2right', 'grid_2x3'],
  '1200x405': ['full', 'halves_v', 'triple_v'],
}

function boundsToAreas(bounds: RichMenuBounds[], existingAreas?: RichMenuArea[]): RichMenuArea[] {
  return bounds.map((b, i) => {
    const existing = existingAreas?.[i]
    const action = existing?.action ?? { type: 'message' as const, text: '', label: '' }
    return { bounds: b, action }
  })
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1] ?? ''
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function Thumbnail({ richMenuId }: { richMenuId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    api.richMenus.fetchImageBlob(richMenuId)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [richMenuId])

  if (failed) {
    return (
      <div className="w-32 h-20 bg-gray-100 rounded flex items-center justify-center text-[10px] text-gray-400">
        画像なし
      </div>
    )
  }
  if (!url) {
    return <div className="w-32 h-20 bg-gray-100 rounded animate-pulse" />
  }
  return <img src={url} alt="rich menu" className="w-32 h-auto rounded border border-gray-200" />
}

export default function RichMenusPage() {
  const [menus, setMenus] = useState<RichMenu[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  // create form state
  const [name, setName] = useState('')
  const [chatBarText, setChatBarText] = useState('メニュー')
  const [sizeKey, setSizeKey] = useState<SizeKey>('1200x810')
  const [presetKey, setPresetKey] = useState<PresetKey>('hero_left_2right')
  const [areas, setAreas] = useState<RichMenuArea[]>([])
  const [jsonMode, setJsonMode] = useState(false)
  const [areasJson, setAreasJson] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [setAsDefault, setSetAsDefault] = useState(true)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [listRes, defRes] = await Promise.all([
        api.richMenus.list(),
        api.richMenus.getDefault(),
      ])
      if (listRes.success) setMenus(listRes.data)
      else setError(listRes.error)
      if (defRes.success) setDefaultId(defRes.data.richMenuId)
    } catch (e) {
      setError('リッチメニューの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // reset areas when size or preset changes
  useEffect(() => {
    if (jsonMode) return
    const size = SIZES[sizeKey]
    const bounds = PRESETS[presetKey].build(size.width, size.height)
    setAreas((prev) => boundsToAreas(bounds, prev))
    // keep preset valid for the chosen size
    if (!PRESETS_BY_SIZE[sizeKey].includes(presetKey)) {
      setPresetKey(PRESETS_BY_SIZE[sizeKey][0])
    }
  }, [sizeKey, presetKey, jsonMode])

  function handlePickImage(file: File | null) {
    setImageFile(file)
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImagePreview(file ? URL.createObjectURL(file) : null)
  }

  function openCreate() {
    setName('')
    setChatBarText('メニュー')
    setSizeKey('1200x810')
    setPresetKey('hero_left_2right')
    const size = SIZES['1200x810']
    setAreas(boundsToAreas(PRESETS.hero_left_2right.build(size.width, size.height)))
    setJsonMode(false)
    setAreasJson('')
    setImageFile(null)
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImagePreview(null)
    setSetAsDefault(true)
    setFormError('')
    setShowCreate(true)
  }

  function toggleJsonMode() {
    if (!jsonMode) {
      // entering JSON mode: serialize current areas
      setAreasJson(JSON.stringify(areas, null, 2))
    } else {
      // leaving JSON mode: try to parse
      try {
        const parsed = JSON.parse(areasJson)
        if (Array.isArray(parsed)) setAreas(parsed)
      } catch {
        setFormError('JSONが不正です。保存時に再度確認されます')
      }
    }
    setJsonMode(!jsonMode)
  }

  async function handleCreate() {
    setFormError('')
    if (!name.trim()) return setFormError('名前を入力してください')
    if (!chatBarText.trim()) return setFormError('チャットバーテキストを入力してください')
    if (chatBarText.length > 14) return setFormError('チャットバーテキストは14文字以内')
    if (!imageFile) return setFormError('画像を選択してください')

    let finalAreas: RichMenuArea[] = areas
    if (jsonMode) {
      try {
        const parsed = JSON.parse(areasJson)
        if (!Array.isArray(parsed)) throw new Error()
        finalAreas = parsed
      } catch {
        return setFormError('JSONが不正です')
      }
    }
    if (finalAreas.length === 0) return setFormError('エリアが空です')
    for (const [i, a] of finalAreas.entries()) {
      if (a.action.type === 'message' && !a.action.text?.trim()) {
        return setFormError(`エリア${i + 1}のタップ時テキストが空です`)
      }
    }

    setSaving(true)
    try {
      const size = SIZES[sizeKey]
      const createRes = await api.richMenus.create({
        size: { width: size.width, height: size.height },
        name: name.trim(),
        chatBarText: chatBarText.trim(),
        selected: setAsDefault,
        areas: finalAreas,
      })
      if (!createRes.success) {
        setFormError(createRes.error || '作成失敗')
        setSaving(false)
        return
      }
      const newId = createRes.data.richMenuId

      // Upload image
      const base64 = await fileToBase64(imageFile)
      const contentType: 'image/png' | 'image/jpeg' =
        imageFile.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
      const upRes = await api.richMenus.uploadImage(newId, base64, contentType)
      if (!upRes.success) {
        setFormError(`画像アップロード失敗: ${upRes.error}。作成されたメニュー(${newId})は手動削除してください`)
        setSaving(false)
        return
      }

      if (setAsDefault) {
        const defRes = await api.richMenus.setDefault(newId)
        if (!defRes.success) {
          setFormError(`デフォルト設定失敗: ${defRes.error}`)
          setSaving(false)
          return
        }
      }

      setShowCreate(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  async function handleSetDefault(id: string) {
    if (!confirm('このリッチメニューを全ユーザーのデフォルトに設定しますか？')) return
    try {
      const res = await api.richMenus.setDefault(id)
      if (res.success) await load()
      else setError(res.error)
    } catch {
      setError('デフォルト設定に失敗しました')
    }
  }

  async function handleDelete(id: string) {
    if (id === defaultId) {
      if (!confirm('このリッチメニューは現在デフォルトです。削除するとユーザーにメニューが表示されなくなります。本当に削除しますか？')) return
    } else {
      if (!confirm('このリッチメニューを削除しますか？')) return
    }
    try {
      const res = await api.richMenus.delete(id)
      if (res.success) await load()
      else setError(res.error)
    } catch {
      setError('削除に失敗しました')
    }
  }

  const availablePresets = PRESETS_BY_SIZE[sizeKey]

  return (
    <div>
      <Header
        title="リッチメニュー管理"
        action={
          <button
            onClick={openCreate}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規作成
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl my-8 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">新規リッチメニュー作成</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left column */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">管理名 <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例: 自分用LINE v3"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    チャットバーテキスト <span className="text-red-500">*</span>
                    <span className="text-gray-400 ml-1">(14文字以内)</span>
                  </label>
                  <input
                    type="text"
                    value={chatBarText}
                    onChange={(e) => setChatBarText(e.target.value)}
                    maxLength={14}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">サイズ</label>
                  <select
                    value={sizeKey}
                    onChange={(e) => setSizeKey(e.target.value as SizeKey)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    {(Object.keys(SIZES) as SizeKey[]).map((k) => (
                      <option key={k} value={k}>{SIZES[k].label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">レイアウトプリセット</label>
                  <div className="grid grid-cols-2 gap-2">
                    {availablePresets.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => { setPresetKey(p); setJsonMode(false) }}
                        className={`text-xs py-2 px-2 rounded border ${
                          presetKey === p && !jsonMode
                            ? 'border-green-600 bg-green-50 text-green-800'
                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {PRESETS[p].label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={toggleJsonMode}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    {jsonMode ? '← プリセットに戻す' : 'JSON直接編集'}
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    画像 <span className="text-red-500">*</span>
                    <span className="text-gray-400 ml-1">(PNG / JPEG, 1MB以下推奨)</span>
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => handlePickImage(e.target.files?.[0] ?? null)}
                    className="block w-full text-xs text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:text-xs file:bg-gray-100 file:text-gray-700"
                  />
                  {imagePreview && (
                    <div className="mt-2 relative border border-gray-200 rounded overflow-hidden">
                      <img src={imagePreview} alt="preview" className="w-full h-auto" />
                      {/* Overlay areas */}
                      <div className="absolute inset-0 pointer-events-none">
                        {(jsonMode ? safeParseAreas(areasJson) : areas).map((a, i) => {
                          const size = SIZES[sizeKey]
                          const left = (a.bounds.x / size.width) * 100
                          const top = (a.bounds.y / size.height) * 100
                          const w = (a.bounds.width / size.width) * 100
                          const h = (a.bounds.height / size.height) * 100
                          return (
                            <div
                              key={i}
                              className="absolute border-2 border-green-500 bg-green-500/10 flex items-center justify-center"
                              style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}
                            >
                              <span className="text-[10px] bg-green-600 text-white px-1 rounded">{i + 1}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={setAsDefault}
                    onChange={(e) => setSetAsDefault(e.target.checked)}
                  />
                  作成後にデフォルトに設定する
                </label>
              </div>

              {/* Right column: areas editor */}
              <div>
                {jsonMode ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">エリア定義 (JSON)</label>
                    <textarea
                      value={areasJson}
                      onChange={(e) => setAreasJson(e.target.value)}
                      rows={18}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder='[{"bounds":{...},"action":{"type":"message","text":"..."}}]'
                    />
                    <p className="text-[11px] text-gray-400 mt-1">
                      LINE Messaging APIの areas 配列そのまま。action.type は message / uri / postback が使える
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">各エリアのタップ時テキスト</label>
                    <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                      {areas.map((a, i) => (
                        <div key={i} className="border border-gray-200 rounded p-3 bg-gray-50">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-gray-700">エリア {i + 1}</span>
                            <span className="text-[10px] text-gray-500">
                              {a.bounds.x},{a.bounds.y} / {a.bounds.width}×{a.bounds.height}
                            </span>
                          </div>
                          <input
                            type="text"
                            value={a.action.type === 'message' ? a.action.text : ''}
                            placeholder="送信されるテキスト"
                            onChange={(e) => {
                              const next = [...areas]
                              next[i] = {
                                ...next[i],
                                action: { type: 'message', text: e.target.value, label: e.target.value.slice(0, 20) },
                              }
                              setAreas(next)
                            }}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 bg-white"
                          />
                          <p className="text-[10px] text-gray-400 mt-1">
                            ※ Phase 2でURL/ポストバックも選べるようになる予定
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {formError && <p className="text-xs text-red-600 mt-4">{formError}</p>}

            <div className="flex gap-2 mt-6">
              <button
                onClick={handleCreate}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '作成中...' : '作成してアップロード'}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse h-28" />
          ))}
        </div>
      ) : menus.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">リッチメニューがありません。「新規作成」から追加してください。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {menus.map((m) => {
            const isDefault = m.richMenuId === defaultId
            return (
              <div key={m.richMenuId} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="flex gap-4">
                  <Thumbnail richMenuId={m.richMenuId} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="text-sm font-semibold text-gray-900 truncate">{m.name}</h3>
                      {isDefault && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                          デフォルト
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <p>チャットバー: {m.chatBarText}</p>
                      <p>サイズ: {m.size.width}×{m.size.height} / エリア数: {m.areas.length}</p>
                      <p className="font-mono text-[10px] text-gray-400 truncate">{m.richMenuId}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    {!isDefault && (
                      <button
                        onClick={() => handleSetDefault(m.richMenuId)}
                        className="px-3 py-1.5 text-xs font-medium text-white rounded hover:opacity-90"
                        style={{ backgroundColor: '#06C755' }}
                      >
                        デフォルトに設定
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(m.richMenuId)}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded hover:bg-red-50"
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function safeParseAreas(json: string): RichMenuArea[] {
  try {
    const v = JSON.parse(json)
    if (Array.isArray(v)) return v
  } catch {}
  return []
}
