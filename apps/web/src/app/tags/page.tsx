'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import type { Tag, TagGroup } from '@line-crm/shared'

const COLOR_PRESETS = [
  '#06C755', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#14B8A6', '#6366F1', '#F97316', '#64748B',
]

type Filter = { kind: 'all' } | { kind: 'ungrouped' } | { kind: 'group'; id: string }

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const [search, setSearch] = useState('')

  const [showCreateTag, setShowCreateTag] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLOR_PRESETS[0])
  const [newGroupId, setNewGroupId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [editTagName, setEditTagName] = useState('')
  const [editTagColor, setEditTagColor] = useState('')
  const [editTagGroupId, setEditTagGroupId] = useState<string>('')

  const [creatingGroup, setCreatingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editGroupName, setEditGroupName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [tagsRes, groupsRes] = await Promise.all([api.tags.list(), api.tagGroups.list()])
      if (tagsRes.success) setTags(tagsRes.data)
      else setError(tagsRes.error)
      if (groupsRes.success) setGroups(groupsRes.data)
      else setError(groupsRes.error)
    } catch {
      setError('タグ・グループの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const selectedGroup = useMemo(
    () => (filter.kind === 'group' ? groups.find((g) => g.id === filter.id) ?? null : null),
    [filter, groups],
  )

  const visibleTags = useMemo(() => {
    let base: Tag[]
    if (filter.kind === 'all') base = tags
    else if (filter.kind === 'ungrouped') base = tags.filter((t) => !t.groupId)
    else base = tags.filter((t) => t.groupId === filter.id)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      base = base.filter((t) => t.name.toLowerCase().includes(q))
    }
    return base
  }, [tags, filter, search])

  const countAll = tags.length
  const countUngrouped = useMemo(() => tags.filter((t) => !t.groupId).length, [tags])
  const groupCount = useCallback(
    (id: string) => tags.filter((t) => t.groupId === id).length,
    [tags],
  )

  function openCreateTag() {
    setNewName('')
    setNewColor(COLOR_PRESETS[0])
    setNewGroupId(filter.kind === 'group' ? filter.id : '')
    setFormError('')
    setShowCreateTag(true)
  }

  async function handleCreateTag() {
    if (!newName.trim()) return setFormError('タグ名を入力してください')
    if (!/^#[0-9A-Fa-f]{6}$/.test(newColor)) return setFormError('色は #RRGGBB 形式で指定してください')
    setSaving(true)
    setFormError('')
    try {
      const res = await api.tags.create({
        name: newName.trim(),
        color: newColor,
        groupId: newGroupId || null,
      })
      if (!res.success) { setFormError(res.error || '作成失敗'); return }
      setShowCreateTag(false)
      await load()
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  function startEditTag(tag: Tag) {
    setEditingTagId(tag.id)
    setEditTagName(tag.name)
    setEditTagColor(tag.color)
    setEditTagGroupId(tag.groupId ?? '')
  }

  async function saveEditTag(id: string) {
    if (!editTagName.trim()) return setError('タグ名は必須です')
    if (!/^#[0-9A-Fa-f]{6}$/.test(editTagColor)) return setError('色は #RRGGBB 形式で指定してください')
    try {
      const res = await api.tags.update(id, {
        name: editTagName.trim(),
        color: editTagColor,
        groupId: editTagGroupId || null,
      })
      if (!res.success) return setError(res.error)
      setEditingTagId(null)
      await load()
    } catch {
      setError('更新に失敗しました')
    }
  }

  async function handleDeleteTag(tag: Tag) {
    if (!confirm(`タグ「${tag.name}」を削除しますか？\nこのタグが付いている友だちからも外れます。`)) return
    try {
      const res = await api.tags.delete(tag.id)
      if (!res.success) return setError(res.error)
      await load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  async function quickMoveTag(tag: Tag, groupId: string) {
    try {
      const res = await api.tags.update(tag.id, { groupId: groupId || null })
      if (!res.success) return setError(res.error)
      await load()
    } catch {
      setError('グループ変更に失敗しました')
    }
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return setError('グループ名を入力してください')
    try {
      const res = await api.tagGroups.create({ name: newGroupName.trim() })
      if (!res.success) return setError(res.error)
      setNewGroupName('')
      setCreatingGroup(false)
      await load()
      if (res.success) setFilter({ kind: 'group', id: res.data.id })
    } catch {
      setError('グループ作成に失敗しました')
    }
  }

  async function saveEditGroup(id: string) {
    if (!editGroupName.trim()) return setError('グループ名は必須です')
    try {
      const res = await api.tagGroups.update(id, { name: editGroupName.trim() })
      if (!res.success) return setError(res.error)
      setEditingGroupId(null)
      await load()
    } catch {
      setError('グループ更新に失敗しました')
    }
  }

  async function handleDeleteGroup(group: TagGroup) {
    if (!confirm(`グループ「${group.name}」を削除しますか？\n所属タグは未分類に戻ります（タグ自体は消えません）。`)) return
    try {
      const res = await api.tagGroups.delete(group.id)
      if (!res.success) return setError(res.error)
      if (filter.kind === 'group' && filter.id === group.id) setFilter({ kind: 'all' })
      await load()
    } catch {
      setError('グループ削除に失敗しました')
    }
  }

  const headerTitle = selectedGroup
    ? `📁 ${selectedGroup.name}`
    : filter.kind === 'ungrouped'
    ? '未分類'
    : 'すべてのタグ'

  return (
    <div>
      <Header
        title="タグ管理"
        action={
          <button
            onClick={openCreateTag}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規タグ
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {showCreateTag && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">新規タグ作成</h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                タグ名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例: 会員A"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">グループ</label>
              <select
                value={newGroupId}
                onChange={(e) => setNewGroupId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">(未分類)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">色</label>
              <ColorPicker value={newColor} onChange={setNewColor} />
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleCreateTag}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '作成中...' : '作成'}
              </button>
              <button
                onClick={() => setShowCreateTag(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">読み込み中...</div>
      ) : (
        <div className="flex gap-4 items-start">
          {/* Left: group tree */}
          <aside className="w-56 shrink-0 bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="タグ名で検索"
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>
            <nav className="py-1">
              <TreeItem
                label="すべて"
                count={countAll}
                active={filter.kind === 'all'}
                onClick={() => setFilter({ kind: 'all' })}
              />
              <TreeItem
                label="未分類"
                count={countUngrouped}
                active={filter.kind === 'ungrouped'}
                onClick={() => setFilter({ kind: 'ungrouped' })}
              />

              <div className="px-3 py-1.5 mt-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">グループ</span>
                <button
                  onClick={() => { setCreatingGroup(true); setNewGroupName('') }}
                  className="text-[10px] text-green-700 hover:text-green-900"
                >
                  + 追加
                </button>
              </div>

              {creatingGroup && (
                <div className="px-3 py-1.5 flex gap-1">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateGroup()
                      if (e.key === 'Escape') setCreatingGroup(false)
                    }}
                    placeholder="グループ名"
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
                    autoFocus
                  />
                  <button
                    onClick={handleCreateGroup}
                    className="px-2 py-1 text-[10px] text-white rounded"
                    style={{ backgroundColor: '#06C755' }}
                  >
                    OK
                  </button>
                </div>
              )}

              {groups.length === 0 && !creatingGroup && (
                <div className="px-3 py-2 text-[11px] text-gray-400">グループなし</div>
              )}

              {groups.map((g) => {
                const isActive = filter.kind === 'group' && filter.id === g.id
                const isEditing = editingGroupId === g.id
                if (isEditing) {
                  return (
                    <div key={g.id} className="px-3 py-1.5 flex gap-1">
                      <input
                        type="text"
                        value={editGroupName}
                        onChange={(e) => setEditGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEditGroup(g.id)
                          if (e.key === 'Escape') setEditingGroupId(null)
                        }}
                        className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
                        autoFocus
                      />
                      <button
                        onClick={() => saveEditGroup(g.id)}
                        className="px-2 py-1 text-[10px] text-white rounded"
                        style={{ backgroundColor: '#06C755' }}
                      >
                        OK
                      </button>
                    </div>
                  )
                }
                return (
                  <TreeItem
                    key={g.id}
                    label={`📁 ${g.name}`}
                    count={groupCount(g.id)}
                    active={isActive}
                    onClick={() => setFilter({ kind: 'group', id: g.id })}
                  />
                )
              })}
            </nav>
          </aside>

          {/* Right: tag pane */}
          <section className="flex-1 min-w-0 bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-800">{headerTitle}</h2>
                <span className="text-xs text-gray-400">({visibleTags.length}件)</span>
              </div>
              {selectedGroup && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setEditingGroupId(selectedGroup.id); setEditGroupName(selectedGroup.name) }}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    リネーム
                  </button>
                  <button
                    onClick={() => handleDeleteGroup(selectedGroup)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    グループ削除
                  </button>
                </div>
              )}
            </div>

            {visibleTags.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-gray-400">
                {search.trim()
                  ? `「${search}」に一致するタグがありません`
                  : 'タグがありません。右上「+ 新規タグ」から作成してください。'}
              </div>
            ) : (
              <table className="w-full">
                <tbody className="divide-y divide-gray-100">
                  {visibleTags.map((t) => {
                    const isEditing = editingTagId === t.id
                    const previewName = isEditing ? editTagName : t.name
                    const previewColor = isEditing ? editTagColor : t.color
                    return (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 w-56">
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                            style={{ backgroundColor: previewColor + '20', color: previewColor }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: previewColor }} />
                            {previewName || '(名前なし)'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {isEditing ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <input
                                type="text"
                                value={editTagName}
                                onChange={(e) => setEditTagName(e.target.value)}
                                className="border border-gray-300 rounded px-2 py-1 text-sm"
                                placeholder="名前"
                              />
                              <select
                                value={editTagGroupId}
                                onChange={(e) => setEditTagGroupId(e.target.value)}
                                className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                              >
                                <option value="">(未分類)</option>
                                {groups.map((g) => (
                                  <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                              </select>
                              <ColorPicker value={editTagColor} onChange={setEditTagColor} compact />
                            </div>
                          ) : (
                            <span className="text-xs font-mono text-gray-400">{t.color}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {isEditing ? (
                            <div className="inline-flex gap-2">
                              <button
                                onClick={() => saveEditTag(t.id)}
                                className="px-2 py-1 text-xs text-white rounded"
                                style={{ backgroundColor: '#06C755' }}
                              >
                                保存
                              </button>
                              <button
                                onClick={() => setEditingTagId(null)}
                                className="px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded"
                              >
                                キャンセル
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-2">
                              <select
                                value={t.groupId ?? ''}
                                onChange={(e) => quickMoveTag(t, e.target.value)}
                                className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-600"
                                title="グループを移動"
                              >
                                <option value="">(未分類)</option>
                                {groups.map((g) => (
                                  <option key={g.id} value={g.id}>→ {g.name}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => startEditTag(t)}
                                className="text-xs text-blue-600 hover:text-blue-800"
                              >
                                編集
                              </button>
                              <button
                                onClick={() => handleDeleteTag(t)}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                削除
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function TreeItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-1.5 text-left text-sm transition-colors ${
        active ? 'bg-green-50 text-green-800 font-medium' : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className={`text-xs ${active ? 'text-green-700' : 'text-gray-400'}`}>{count}</span>
    </button>
  )
}

function ColorPicker({
  value,
  onChange,
  compact = false,
}: {
  value: string
  onChange: (v: string) => void
  compact?: boolean
}) {
  return (
    <div className={compact ? 'flex items-center gap-1.5 flex-wrap' : 'space-y-2'}>
      <div className="flex flex-wrap gap-1.5">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`rounded-full border-2 transition ${
              value.toLowerCase() === c.toLowerCase() ? 'border-gray-800' : 'border-white'
            }`}
            style={{ width: 22, height: 22, backgroundColor: c }}
            aria-label={c}
          />
        ))}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#RRGGBB"
        className={`border border-gray-300 rounded px-2 py-1 text-xs font-mono ${
          compact ? 'w-24' : 'w-32'
        }`}
      />
    </div>
  )
}
