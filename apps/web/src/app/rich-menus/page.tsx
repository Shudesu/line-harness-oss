'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

// ─── Types ──────────────────────────────────────────────────────────────────

interface RichMenuLocal {
  id: string
  line_rich_menu_id: string
  name: string
  chat_bar_text: string
  size_width: number
  size_height: number
  areas_json: string
  image_url: string | null
  is_default: number
  line_account_id: string | null
  created_at: string
  updated_at: string
}

interface RichMenuRule {
  id: string
  name: string
  tag_id: string
  rich_menu_id: string
  priority: number
  is_active: number
  line_account_id: string | null
  created_at: string
}

interface RichMenuAlias {
  id: string
  alias_id: string
  rich_menu_id: string
  created_at: string
}

interface Tag {
  id: string
  name: string
  color: string
}

interface LineRichMenu {
  richMenuId: string
  name: string
  chatBarText: string
  size: { width: number; height: number }
  areas: { bounds: { x: number; y: number; width: number; height: number }; action: { type: string; [key: string]: unknown } }[]
}

type Tab = 'menus' | 'rules' | 'aliases'

// ─── Grid Templates ─────────────────────────────────────────────────────────

const GRID_TEMPLATES = [
  { label: '2x3 (6エリア)', cols: 3, rows: 2 },
  { label: '2x2 (4エリア)', cols: 2, rows: 2 },
  { label: '1x3 (3エリア)', cols: 3, rows: 1 },
  { label: '1x2 (2エリア)', cols: 2, rows: 1 },
  { label: '1x1 (全面)', cols: 1, rows: 1 },
]

function generateAreas(cols: number, rows: number, width = 2500, height = 1686) {
  const areas: { bounds: { x: number; y: number; width: number; height: number }; action: { type: string; label: string; text: string } }[] = []
  const cellW = Math.floor(width / cols)
  const cellH = Math.floor(height / rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      areas.push({
        bounds: { x: c * cellW, y: r * cellH, width: cellW, height: cellH },
        action: { type: 'message', label: `エリア${r * cols + c + 1}`, text: `エリア${r * cols + c + 1}` },
      })
    }
  }
  return areas
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function RichMenusPage() {
  const { selectedAccount } = useAccount()
  const [tab, setTab] = useState<Tab>('menus')

  // Menus state
  const [lineMenus, setLineMenus] = useState<LineRichMenu[]>([])
  const [localMenus, setLocalMenus] = useState<RichMenuLocal[]>([])
  const [loading, setLoading] = useState(true)

  // Rules state
  const [rules, setRules] = useState<RichMenuRule[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [rulesLoading, setRulesLoading] = useState(false)

  // Aliases state
  const [aliases, setAliases] = useState<RichMenuAlias[]>([])

  // Create form state
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createChatBar, setCreateChatBar] = useState('メニュー')
  const [selectedGrid, setSelectedGrid] = useState(0)
  const [creating, setCreating] = useState(false)

  // Rule form state
  const [showRuleForm, setShowRuleForm] = useState(false)
  const [ruleName, setRuleName] = useState('')
  const [ruleTagId, setRuleTagId] = useState('')
  const [ruleMenuId, setRuleMenuId] = useState('')
  const [rulePriority, setRulePriority] = useState(0)

  // Alias form state
  const [showAliasForm, setShowAliasForm] = useState(false)
  const [aliasId, setAliasId] = useState('')
  const [aliasMenuId, setAliasMenuId] = useState('')

  const loadMenus = useCallback(async () => {
    setLoading(true)
    try {
      const [lineRes, localRes] = await Promise.all([
        fetchApi<{ success: boolean; data: LineRichMenu[] }>('/api/rich-menus'),
        fetchApi<{ success: boolean; data: RichMenuLocal[] }>(
          '/api/rich-menus-local?' + new URLSearchParams(selectedAccount?.id ? { lineAccountId: selectedAccount.id } : {})
        ),
      ])
      setLineMenus(lineRes.data || [])
      setLocalMenus(localRes.data || [])
    } catch (err) {
      console.error('Failed to load rich menus:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedAccount?.id])

  const loadRules = useCallback(async () => {
    setRulesLoading(true)
    try {
      const [rulesRes, tagsRes] = await Promise.all([
        fetchApi<{ success: boolean; data: RichMenuRule[] }>(
          '/api/rich-menu-rules?' + new URLSearchParams(selectedAccount?.id ? { lineAccountId: selectedAccount.id } : {})
        ),
        fetchApi<{ success: boolean; data: Tag[] }>('/api/tags'),
      ])
      setRules(rulesRes.data || [])
      setTags(tagsRes.data || [])
    } catch (err) {
      console.error('Failed to load rules:', err)
    } finally {
      setRulesLoading(false)
    }
  }, [selectedAccount?.id])

  const loadAliases = useCallback(async () => {
    try {
      const res = await fetchApi<{ success: boolean; data: RichMenuAlias[] }>('/api/rich-menu-aliases')
      setAliases(res.data || [])
    } catch (err) {
      console.error('Failed to load aliases:', err)
    }
  }, [])

  useEffect(() => {
    loadMenus()
    loadRules()
    loadAliases()
  }, [loadMenus, loadRules, loadAliases])

  // ─── Actions ────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!createName.trim()) return
    setCreating(true)
    try {
      const grid = GRID_TEMPLATES[selectedGrid]
      const areas = generateAreas(grid.cols, grid.rows)
      await fetchApi('/api/rich-menus', {
        method: 'POST',
        body: JSON.stringify({
          name: createName,
          chatBarText: createChatBar || 'メニュー',
          size: { width: 2500, height: 1686 },
          selected: false,
          areas,
          lineAccountId: selectedAccount?.id || undefined,
        }),
      })
      setShowCreate(false)
      setCreateName('')
      setCreateChatBar('メニュー')
      await loadMenus()
    } catch (err) {
      console.error('Failed to create rich menu:', err)
      alert('リッチメニュー作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (richMenuId: string) => {
    if (!confirm('このリッチメニューを削除しますか？')) return
    try {
      await fetchApi(`/api/rich-menus/${richMenuId}`, { method: 'DELETE' })
      await loadMenus()
    } catch (err) {
      console.error('Failed to delete rich menu:', err)
    }
  }

  const handleSetDefault = async (richMenuId: string) => {
    try {
      await fetchApi(`/api/rich-menus/${richMenuId}/default`, { method: 'POST' })
      await loadMenus()
    } catch (err) {
      console.error('Failed to set default:', err)
      alert('デフォルト設定に失敗しました')
    }
  }

  const handleCreateRule = async () => {
    if (!ruleName || !ruleTagId || !ruleMenuId) return
    try {
      await fetchApi('/api/rich-menu-rules', {
        method: 'POST',
        body: JSON.stringify({
          name: ruleName,
          tagId: ruleTagId,
          richMenuId: ruleMenuId,
          priority: rulePriority,
          lineAccountId: selectedAccount?.id || undefined,
        }),
      })
      setShowRuleForm(false)
      setRuleName('')
      setRuleTagId('')
      setRuleMenuId('')
      setRulePriority(0)
      await loadRules()
    } catch (err) {
      console.error('Failed to create rule:', err)
      alert('ルール作成に失敗しました')
    }
  }

  const handleDeleteRule = async (id: string) => {
    if (!confirm('このルールを削除しますか？')) return
    try {
      await fetchApi(`/api/rich-menu-rules/${id}`, { method: 'DELETE' })
      await loadRules()
    } catch (err) {
      console.error('Failed to delete rule:', err)
    }
  }

  const handleCreateAlias = async () => {
    if (!aliasId || !aliasMenuId) return
    try {
      await fetchApi('/api/rich-menu-aliases', {
        method: 'POST',
        body: JSON.stringify({ aliasId, richMenuId: aliasMenuId }),
      })
      setShowAliasForm(false)
      setAliasId('')
      setAliasMenuId('')
      await loadAliases()
    } catch (err) {
      console.error('Failed to create alias:', err)
      alert('エイリアス作成に失敗しました')
    }
  }

  const handleDeleteAlias = async (aid: string) => {
    if (!confirm('このエイリアスを削除しますか？')) return
    try {
      await fetchApi(`/api/rich-menu-aliases/${aid}`, { method: 'DELETE' })
      await loadAliases()
    } catch (err) {
      console.error('Failed to delete alias:', err)
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  const getMenuName = (richMenuId: string) => {
    const local = localMenus.find((m) => m.id === richMenuId || m.line_rich_menu_id === richMenuId)
    if (local) return local.name
    const line = lineMenus.find((m) => m.richMenuId === richMenuId)
    return line?.name || richMenuId.slice(0, 12) + '...'
  }

  const getTagName = (tagId: string) => tags.find((t) => t.id === tagId)?.name || tagId.slice(0, 8)

  const allMenuOptions = [
    ...lineMenus.map((m) => ({ value: m.richMenuId, label: m.name })),
    ...localMenus
      .filter((m) => !lineMenus.some((l) => l.richMenuId === m.line_rich_menu_id))
      .map((m) => ({ value: m.line_rich_menu_id, label: m.name })),
  ]

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch { return d }
  }

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto">
      <Header title="リッチメニュー" description="リッチメニューの作成・管理・タグ別自動割当" />

      <div className="p-4 sm:p-6 max-w-4xl">
        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
          {([['menus', 'メニュー一覧'], ['rules', '自動割当ルール'], ['aliases', 'エイリアス']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ─── Menus Tab ──────────────────────────────────────────── */}
        {tab === 'menus' && (
          <>
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setShowCreate(true)}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-colors"
                style={{ backgroundColor: '#06C755' }}
              >
                + 新規リッチメニュー
              </button>
            </div>

            {showCreate && (
              <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">新規リッチメニュー</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">メニュー名</label>
                    <input
                      type="text"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="メインメニュー"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">チャットバーテキスト</label>
                    <input
                      type="text"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="メニュー"
                      value={createChatBar}
                      onChange={(e) => setCreateChatBar(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">グリッドレイアウト</label>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                      {GRID_TEMPLATES.map((tmpl, i) => (
                        <button
                          key={i}
                          onClick={() => setSelectedGrid(i)}
                          className={`p-2 border rounded-lg text-xs text-center transition-colors ${
                            selectedGrid === i
                              ? 'border-green-500 bg-green-50 text-green-700'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          {/* Mini grid preview */}
                          <div className="flex flex-wrap gap-0.5 justify-center mb-1">
                            {Array.from({ length: tmpl.cols * tmpl.rows }).map((_, j) => (
                              <div
                                key={j}
                                className="bg-gray-300 rounded-sm"
                                style={{
                                  width: `${Math.floor(40 / tmpl.cols)}px`,
                                  height: `${Math.floor(24 / tmpl.rows)}px`,
                                }}
                              />
                            ))}
                          </div>
                          {tmpl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleCreate}
                      disabled={creating || !createName.trim()}
                      className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors"
                      style={{ backgroundColor: '#06C755' }}
                    >
                      {creating ? '作成中...' : '作成'}
                    </button>
                    <button
                      onClick={() => setShowCreate(false)}
                      className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              </div>
            )}

            {loading ? (
              <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
            ) : lineMenus.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400 text-sm">リッチメニューがまだありません</p>
                <p className="text-gray-300 text-xs mt-1">「新規リッチメニュー」でLINEリッチメニューを作成できます</p>
              </div>
            ) : (
              <div className="space-y-3">
                {lineMenus.map((menu) => {
                  const local = localMenus.find((m) => m.line_rich_menu_id === menu.richMenuId)
                  return (
                    <div key={menu.richMenuId} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-sm transition-shadow">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-semibold text-gray-900">{menu.name}</h4>
                            {local?.is_default === 1 && (
                              <span className="text-[10px] font-medium bg-green-100 text-green-700 px-1.5 py-0.5 rounded">デフォルト</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">チャットバー: {menu.chatBarText}</p>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                              {menu.size.width}x{menu.size.height}
                            </span>
                            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                              {menu.areas.length}エリア
                            </span>
                            <span className="text-xs text-gray-400 font-mono">
                              {menu.richMenuId.slice(0, 16)}...
                            </span>
                          </div>
                          {local?.image_url && (
                            <div className="mt-2">
                              <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">画像あり</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-3">
                          <button
                            onClick={() => handleSetDefault(menu.richMenuId)}
                            className="px-2 py-1 min-h-[36px] text-xs text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="デフォルトに設定"
                          >
                            デフォルト
                          </button>
                          <button
                            onClick={() => handleDelete(menu.richMenuId)}
                            className="px-2 py-1 min-h-[36px] text-xs text-red-500 hover:bg-red-50 rounded transition-colors"
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
          </>
        )}

        {/* ─── Rules Tab ──────────────────────────────────────────── */}
        {tab === 'rules' && (
          <>
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-3">
                タグに基づいてリッチメニューを自動で切り替えます。優先度が高いルールから順に評価されます。
              </p>
              <div className="flex justify-end">
                <button
                  onClick={() => setShowRuleForm(true)}
                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-colors"
                  style={{ backgroundColor: '#06C755' }}
                >
                  + ルール追加
                </button>
              </div>
            </div>

            {showRuleForm && (
              <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">新規ルール</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">ルール名</label>
                    <input
                      type="text"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="VIPメニュー割当"
                      value={ruleName}
                      onChange={(e) => setRuleName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">タグ</label>
                      <select
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        value={ruleTagId}
                        onChange={(e) => setRuleTagId(e.target.value)}
                      >
                        <option value="">選択...</option>
                        {tags.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">リッチメニュー</label>
                      <select
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        value={ruleMenuId}
                        onChange={(e) => setRuleMenuId(e.target.value)}
                      >
                        <option value="">選択...</option>
                        {allMenuOptions.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">優先度（高い順に評価）</label>
                    <input
                      type="number"
                      className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      value={rulePriority}
                      onChange={(e) => setRulePriority(parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleCreateRule}
                      disabled={!ruleName || !ruleTagId || !ruleMenuId}
                      className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors"
                      style={{ backgroundColor: '#06C755' }}
                    >
                      作成
                    </button>
                    <button
                      onClick={() => setShowRuleForm(false)}
                      className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              </div>
            )}

            {rulesLoading ? (
              <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
            ) : rules.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400 text-sm">自動割当ルールがまだありません</p>
                <p className="text-gray-300 text-xs mt-1">タグに基づいてリッチメニューを自動で切り替えるルールを追加できます</p>
              </div>
            ) : (
              <div className="space-y-3">
                {rules.map((rule) => (
                  <div key={rule.id} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-gray-900">{rule.name}</h4>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${rule.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {rule.is_active ? '有効' : '無効'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                          <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded">タグ: {getTagName(rule.tag_id)}</span>
                          <span className="text-gray-300">→</span>
                          <span className="bg-purple-50 text-purple-600 px-2 py-0.5 rounded">メニュー: {getMenuName(rule.rich_menu_id)}</span>
                          <span className="text-gray-400">優先度: {rule.priority}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="px-2 py-1 min-h-[36px] text-xs text-red-500 hover:bg-red-50 rounded transition-colors ml-3"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ─── Aliases Tab ────────────────────────────────────────── */}
        {tab === 'aliases' && (
          <>
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-3">
                エイリアスを使うとリッチメニューのタブ切替（richmenuswitch アクション）が可能になります。
              </p>
              <div className="flex justify-end">
                <button
                  onClick={() => setShowAliasForm(true)}
                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-colors"
                  style={{ backgroundColor: '#06C755' }}
                >
                  + エイリアス追加
                </button>
              </div>
            </div>

            {showAliasForm && (
              <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">新規エイリアス</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">エイリアスID</label>
                    <input
                      type="text"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="menu-tab-a"
                      value={aliasId}
                      onChange={(e) => setAliasId(e.target.value)}
                    />
                    <p className="text-[10px] text-gray-400 mt-1">英数字・ハイフン・アンダースコアのみ</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">リッチメニュー</label>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      value={aliasMenuId}
                      onChange={(e) => setAliasMenuId(e.target.value)}
                    >
                      <option value="">選択...</option>
                      {allMenuOptions.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleCreateAlias}
                      disabled={!aliasId || !aliasMenuId}
                      className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors"
                      style={{ backgroundColor: '#06C755' }}
                    >
                      作成
                    </button>
                    <button
                      onClick={() => setShowAliasForm(false)}
                      className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              </div>
            )}

            {aliases.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400 text-sm">エイリアスがまだありません</p>
                <p className="text-gray-300 text-xs mt-1">タブ切替用のエイリアスを追加できます</p>
              </div>
            ) : (
              <div className="space-y-3">
                {aliases.map((a) => (
                  <div key={a.id} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-gray-900 font-mono">{a.alias_id}</h4>
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                          <span className="bg-purple-50 text-purple-600 px-2 py-0.5 rounded">
                            メニュー: {getMenuName(a.rich_menu_id)}
                          </span>
                          <span className="text-gray-400">{formatDate(a.created_at)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteAlias(a.alias_id)}
                        className="px-2 py-1 min-h-[36px] text-xs text-red-500 hover:bg-red-50 rounded transition-colors ml-3"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
