'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import QRCode from 'qrcode'

interface TrackedLink {
  id: string
  name: string
  originalUrl: string
  trackingUrl: string
  tagId: string | null
  scenarioId: string | null
  isActive: boolean
  clickCount: number
  createdAt: string
  updatedAt: string
}

interface ClickDetail {
  id: string
  friendId: string | null
  friendDisplayName: string | null
  clickedAt: string
}

interface TrackedLinkDetail extends TrackedLink {
  clicks: ClickDetail[]
}

type SortField = 'name' | 'clickCount' | 'createdAt'
type SortDir = 'asc' | 'desc'

function SortIcon({ field, current, dir }: { field: SortField; current: SortField; dir: SortDir }) {
  if (field !== current) return <span className="ml-1 text-gray-300">↕</span>
  return <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>
}

export default function TrackedLinksPage() {
  const [links, setLinks] = useState<TrackedLink[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', originalUrl: '' })
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TrackedLinkDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // 検索・ソート
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // 編集
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', originalUrl: '' })
  const [saving, setSaving] = useState(false)

  // QR
  const [qrVisibleId, setQrVisibleId] = useState<string | null>(null)
  const [qrDataUrls, setQrDataUrls] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: TrackedLink[] }>('/api/tracked-links')
      if (res.success) setLinks(res.data)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── 作成 ──────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.originalUrl) return
    setCreating(true)
    try {
      await fetchApi('/api/tracked-links', {
        method: 'POST',
        body: JSON.stringify({ name: form.name, originalUrl: form.originalUrl }),
      })
      setForm({ name: '', originalUrl: '' })
      setShowCreate(false)
      load()
    } catch {}
    setCreating(false)
  }

  // ── 削除 ──────────────────────────────────────────────────
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('このトラッキングリンクを削除しますか？')) return
    try {
      await fetchApi(`/api/tracked-links/${id}`, { method: 'DELETE' })
      load()
    } catch {}
  }

  // ── コピー ────────────────────────────────────────────────
  const handleCopy = async (url: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // ── 行展開（クリック履歴） ────────────────────────────────
  const handleRowClick = async (id: string) => {
    if (editingId === id) return
    if (expandedId === id) {
      setExpandedId(null)
      setDetail(null)
      return
    }
    setExpandedId(id)
    setDetailLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: TrackedLinkDetail }>(`/api/tracked-links/${id}`)
      if (res.success) setDetail(res.data)
    } catch {
      setDetail(null)
    }
    setDetailLoading(false)
  }

  // ── ステータストグル ──────────────────────────────────────
  const handleToggleActive = async (id: string, current: boolean, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fetchApi(`/api/tracked-links/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !current }),
      })
      setLinks(prev => prev.map(l => l.id === id ? { ...l, isActive: !current } : l))
    } catch {}
  }

  // ── 編集 ──────────────────────────────────────────────────
  const handleEditStart = (link: TrackedLink, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(link.id)
    setEditForm({ name: link.name, originalUrl: link.originalUrl })
    setExpandedId(null)
  }

  const handleEditSave = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!editForm.name || !editForm.originalUrl) return
    setSaving(true)
    try {
      await fetchApi(`/api/tracked-links/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editForm.name, originalUrl: editForm.originalUrl }),
      })
      setLinks(prev => prev.map(l =>
        l.id === id ? { ...l, name: editForm.name, originalUrl: editForm.originalUrl } : l
      ))
      setEditingId(null)
    } catch {}
    setSaving(false)
  }

  const handleEditCancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(null)
  }

  // ── QR ────────────────────────────────────────────────────
  const handleToggleQr = async (id: string, url: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (qrVisibleId === id) { setQrVisibleId(null); return }
    setQrVisibleId(id)
    if (!qrDataUrls[id]) {
      try {
        const dataUrl = await QRCode.toDataURL(url, { width: 200 })
        setQrDataUrls(prev => ({ ...prev, [id]: dataUrl }))
      } catch {}
    }
  }

  // ── ソート ────────────────────────────────────────────────
  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  // ── 計算値 ────────────────────────────────────────────────
  const filteredLinks = links.filter(l =>
    l.name.toLowerCase().includes(search.toLowerCase())
  )
  const sortedLinks = [...filteredLinks].sort((a, b) => {
    let cmp = 0
    if (sortField === 'name') cmp = a.name.localeCompare(b.name, 'ja')
    else if (sortField === 'clickCount') cmp = a.clickCount - b.clickCount
    else cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    return sortDir === 'asc' ? cmp : -cmp
  })

  const totalClicks = links.reduce((sum, l) => sum + l.clickCount, 0)
  const activeCount = links.filter(l => l.isActive).length

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

  const thBase = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase select-none'

  return (
    <div>
      <Header
        title="トラッキングリンク"
        description="SNS・広告別クリック計測リンクの管理"
        action={
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 min-h-[44px] rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            {showCreate ? 'キャンセル' : '+ リンク作成'}
          </button>
        }
      />

      {/* サマリーカード */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <p className="text-sm text-gray-500">総リンク数</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{links.length}</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <p className="text-sm text-gray-500">総クリック数</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{totalClicks}</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <p className="text-sm text-gray-500">有効リンク</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{activeCount}</p>
        </div>
      </div>

      {/* 作成フォーム */}
      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">リンク名</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Instagram_profile"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">遷移先URL</label>
              <input
                type="url"
                value={form.originalUrl}
                onChange={(e) => setForm({ ...form, originalUrl: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="https://example.com/lp"
                required
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="mt-4 px-4 py-2 min-h-[44px] rounded-lg text-white text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {creating ? '作成中...' : '作成'}
          </button>
        </form>
      )}

      {/* 検索バー */}
      <div className="mb-4 flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="リンク名で検索..."
          aria-label="リンク名で検索"
          className="w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        {search && (
          <span className="text-sm text-gray-500">{filteredLinks.length} 件</span>
        )}
      </div>

      {/* テーブル */}
      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          読み込み中...
        </div>
      ) : links.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          トラッキングリンクがまだありません
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th
                  className={`${thBase} cursor-pointer hover:text-gray-700`}
                  onClick={() => handleSort('name')}
                >
                  リンク名 <SortIcon field="name" current={sortField} dir={sortDir} />
                </th>
                <th className={thBase}>遷移先</th>
                <th className={thBase}>トラッキングURL</th>
                <th
                  className={`${thBase} text-right cursor-pointer hover:text-gray-700`}
                  onClick={() => handleSort('clickCount')}
                >
                  クリック数 <SortIcon field="clickCount" current={sortField} dir={sortDir} />
                </th>
                <th className={thBase}>状態</th>
                <th
                  className={`${thBase} cursor-pointer hover:text-gray-700`}
                  onClick={() => handleSort('createdAt')}
                >
                  作成日 <SortIcon field="createdAt" current={sortField} dir={sortDir} />
                </th>
                <th className={`${thBase} text-right`}>操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedLinks.map((link) => (
                <React.Fragment key={link.id}>
                  <tr
                    key={link.id}
                    className={`hover:bg-gray-50 ${editingId !== link.id ? 'cursor-pointer' : ''}`}
                    onClick={() => handleRowClick(link.id)}
                  >
                    {/* リンク名（編集時はinput） */}
                    <td className="px-4 py-3 text-sm font-medium text-gray-900" onClick={editingId === link.id ? (e) => e.stopPropagation() : undefined}>
                      {editingId === link.id ? (
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full border border-blue-300 rounded px-2 py-1 text-sm"
                          aria-label="リンク名を編集"
                          required
                        />
                      ) : link.name}
                    </td>

                    {/* 遷移先URL（編集時はinput） */}
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px]" onClick={editingId === link.id ? (e) => e.stopPropagation() : undefined}>
                      {editingId === link.id ? (
                        <input
                          type="url"
                          value={editForm.originalUrl}
                          onChange={(e) => setEditForm({ ...editForm, originalUrl: e.target.value })}
                          className="w-full border border-blue-300 rounded px-2 py-1 text-sm"
                          aria-label="遷移先URLを編集"
                          required
                        />
                      ) : (
                        <span className="truncate block" title={link.originalUrl}>{link.originalUrl}</span>
                      )}
                    </td>

                    {/* トラッキングURL + コピー + QR */}
                    <td className="px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-mono text-blue-600 truncate max-w-[140px]" title={link.trackingUrl}>
                          {link.trackingUrl}
                        </span>
                        <button
                          onClick={(e) => handleCopy(link.trackingUrl, link.id, e)}
                          className="text-xs text-blue-500 hover:text-blue-700 shrink-0 px-1"
                        >
                          {copiedId === link.id ? 'コピー済' : 'コピー'}
                        </button>
                        <button
                          onClick={(e) => handleToggleQr(link.id, link.trackingUrl, e)}
                          aria-label="QRコードを表示"
                          className="shrink-0 p-1 text-gray-400 hover:text-gray-700"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                          </svg>
                        </button>
                      </div>
                    </td>

                    {/* クリック数 */}
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-bold text-gray-900">{link.clickCount}</span>
                    </td>

                    {/* ステータストグル */}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => handleToggleActive(link.id, link.isActive, e)}
                        role="switch"
                        aria-checked={link.isActive}
                        aria-label={link.isActive ? '有効 (クリックで無効化)' : '無効 (クリックで有効化)'}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                          link.isActive ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      >
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                          link.isActive ? 'translate-x-5' : 'translate-x-1'
                        }`} />
                      </button>
                    </td>

                    {/* 作成日 */}
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(link.createdAt)}</td>

                    {/* 操作 */}
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {editingId === link.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => handleEditSave(link.id, e)}
                            disabled={saving}
                            className="text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                          >
                            {saving ? '保存中' : '保存'}
                          </button>
                          <button
                            onClick={handleEditCancel}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            キャンセル
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={(e) => handleEditStart(link, e)}
                            className="text-blue-500 hover:text-blue-700 text-sm"
                          >
                            編集
                          </button>
                          <button
                            onClick={(e) => handleDelete(link.id, e)}
                            className="text-red-500 hover:text-red-700 text-sm"
                          >
                            削除
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>

                  {/* クリック履歴（展開行） */}
                  {expandedId === link.id && (
                    <tr>
                      {/* 展開行にはキー不要 (Fragment で管理) */}
                      <td colSpan={7} className="px-6 py-4 bg-gray-50">
                        {detailLoading ? (
                          <p className="text-sm text-gray-400">読み込み中...</p>
                        ) : detail && detail.clicks.length > 0 ? (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-3">
                              クリック履歴 ({detail.clicks.length}件)
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {detail.clicks.map((click) => (
                                <div
                                  key={click.id}
                                  className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100"
                                >
                                  <span className="text-sm text-gray-800 font-medium truncate">
                                    {click.friendDisplayName ?? '不明なユーザー'}
                                  </span>
                                  <span className="text-xs text-gray-400 ml-2 shrink-0">
                                    {formatDateTime(click.clickedAt)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400">まだクリックがありません</p>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* QR コードモーダル */}
      {qrVisibleId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setQrVisibleId(null)}
          data-testid="qr-modal-overlay"
        >
          <div
            className="bg-white rounded-xl p-6 shadow-xl text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-gray-700 mb-4">QRコード</p>
            {qrDataUrls[qrVisibleId] ? (
              <img
                src={qrDataUrls[qrVisibleId]}
                alt="QR Code"
                className="w-48 h-48 mx-auto"
              />
            ) : (
              <div className="w-48 h-48 mx-auto flex items-center justify-center text-gray-400 text-sm">
                生成中...
              </div>
            )}
            <button
              className="mt-4 text-sm text-gray-500 hover:text-gray-700"
              onClick={() => setQrVisibleId(null)}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
