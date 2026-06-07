'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import FlexPreviewComponent from '@/components/flex-preview'
import CcPromptButton from '@/components/cc-prompt-button'
import ImageUploader from '@/components/shared/image-uploader'
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/primitives'

const messageTypeBadgeTones: Record<string, 'neutral' | 'default' | 'info' | 'warning'> = {
  text: 'neutral',
  flex: 'default',
  image: 'info',
  carousel: 'warning',
}

interface Template {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  usageCount: number
  createdAt: string
  updatedAt: string
}

interface TemplateDetail {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  usedBy: {
    autoReplies: Array<{ id: string; keyword: string; matchType: 'exact' | 'contains'; lineAccountId: string | null }>
    automations: Array<{ id: string; name: string; eventType: string }>
  }
  createdAt: string
  updatedAt: string
}

type TypeFilter = 'all' | 'text' | 'flex' | 'image' | 'unused'

const messageTypeLabels: Record<string, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flex',
  carousel: 'Carousel',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ccPrompts = [
  {
    title: 'テンプレート作成',
    prompt: `新しいメッセージテンプレートの作成をサポートしてください。
1. 用途別（挨拶、キャンペーン、通知、フォローアップ）のテンプレート文例を提案
2. テキスト・Flexメッセージそれぞれの効果的な使い方
3. カテゴリ分類と命名規則のベストプラクティス
手順を示してください。`,
  },
]

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [form, setForm] = useState({ name: '', category: 'general', messageType: 'text', messageContent: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Drawer
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [drawerData, setDrawerData] = useState<TemplateDetail | null>(null)
  const [scenarioStepUsages, setScenarioStepUsages] = useState<Array<{
    scenarioId: string
    scenarioName: string
    stepId: string
    stepOrder: number
  }>>([])
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)
  const [editContent, setEditContent] = useState<string | null>(null)
  const [editName, setEditName] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.templates.list()
      if (res.success) {
        setTemplates(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('テンプレートの読み込みに失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Drawer fetch
  useEffect(() => {
    if (!drawerId) { setDrawerData(null); setDrawerError(null); setScenarioStepUsages([]); return }
    let cancelled = false
    setDrawerLoading(true)
    setDrawerError(null)
    setDrawerData(null)
    setScenarioStepUsages([])
    Promise.all([
      api.templates.get(drawerId),
      api.templates.usages(drawerId).catch(() => null),
    ]).then(([detailRes, usagesRes]) => {
      if (cancelled) return
      if (detailRes.success && detailRes.data) {
        setDrawerData(detailRes.data)
      } else {
        setDrawerError((detailRes as { error?: string }).error ?? '読み込みに失敗しました')
      }
      if (usagesRes && usagesRes.success) {
        setScenarioStepUsages(usagesRes.data.scenarioSteps)
      }
    }).catch((err) => {
      if (cancelled) return
      setDrawerError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      if (!cancelled) setDrawerLoading(false)
    })
    return () => { cancelled = true }
  }, [drawerId])

  // reset edits when drawer changes
  useEffect(() => { setEditContent(null); setEditName(null) }, [drawerId])

  const filteredTemplates = templates.filter((t) => {
    if (typeFilter === 'all') return true
    if (typeFilter === 'unused') return t.usageCount === 0
    return t.messageType === typeFilter
  })

  const handleCreate = async () => {
    if (!form.name.trim()) { setFormError('テンプレート名を入力してください'); return }
    if (!form.messageContent.trim()) { setFormError('メッセージ内容を入力してください'); return }
    setSaving(true)
    setFormError('')
    try {
      const res = await api.templates.create(form)
      if (res.success) {
        setShowCreate(false)
        setForm({ name: '', category: 'general', messageType: 'text', messageContent: '' })
        load()
      } else {
        setFormError(res.error)
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!drawerData) return
    if (editContent !== null && !editContent.trim()) {
      setError('内容を空にはできません')
      return
    }
    if (editName !== null && !editName.trim()) {
      setError('名前を空にはできません')
      return
    }
    setSavingEdit(true)
    try {
      const updates: Record<string, string> = {}
      if (editContent !== null) updates.messageContent = editContent
      if (editName !== null) updates.name = editName
      await api.templates.update(drawerData.id, updates)
      const r = await api.templates.get(drawerData.id)
      if (r.success && r.data) setDrawerData(r.data)
      setEditContent(null)
      setEditName(null)
      load()
    } catch {
      setError('更新に失敗しました')
    }
    setSavingEdit(false)
  }

  const handleDelete = async (id: string, usageCount: number) => {
    if (usageCount > 0) {
      if (!confirm(`このテンプレートは ${usageCount} 箇所で使用されています。削除すると参照がクリアされます。続行しますか？`)) return
    } else {
      if (!confirm('このテンプレートを削除しますか？')) return
    }
    try {
      await api.templates.delete(id)
      if (drawerId === id) setDrawerId(null)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="テンプレート管理"
        action={
          <Button
            onClick={() => setShowCreate(true)}
            className="text-white hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規テンプレート
          </Button>
        }
      />

      {error && (
        <Banner tone="danger" className="mb-4">
          {error}
        </Banner>
      )}

      {/* Type filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        {([
          { key: 'all', label: '全て' },
          { key: 'text', label: 'テキスト' },
          { key: 'flex', label: 'Flex' },
          { key: 'image', label: '画像' },
          { key: 'unused', label: '未使用' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTypeFilter(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              typeFilter === key ? 'text-white' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
            }`}
            style={typeFilter === key ? { backgroundColor: '#06C755' } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm">新規テンプレートを作成</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-w-lg">
              <div>
                <Label className="text-xs">名前 <span className="text-red-500">*</span></Label>
                <Input
                  type="text"
                  placeholder="例: コスト比較 flex"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">カテゴリ</Label>
                <Input
                  type="text"
                  placeholder="例: general, 挨拶, 返信"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">タイプ</Label>
                <Select
                  value={form.messageType}
                  onChange={(e) => setForm({ ...form, messageType: e.target.value })}
                >
                  <option value="text">テキスト</option>
                  <option value="flex">Flex</option>
                  <option value="image">画像</option>
                </Select>
              </div>
              <div>
                <Label className="text-xs">内容 / JSON <span className="text-red-500">*</span></Label>
                {form.messageType === 'image' ? (
                  <ImageUploader
                    mode="line-image"
                    value={(() => {
                      try {
                        const parsed = JSON.parse(form.messageContent) as { originalContentUrl?: string; previewImageUrl?: string }
                        if (parsed.originalContentUrl) {
                          return {
                            mode: 'line-image' as const,
                            originalContentUrl: parsed.originalContentUrl,
                            previewImageUrl: parsed.previewImageUrl ?? parsed.originalContentUrl,
                          }
                        }
                      } catch { /* ignore */ }
                      return null
                    })()}
                    onChange={(v) => {
                      if (v?.mode === 'line-image') {
                        setForm((prev) => ({ ...prev, messageContent: JSON.stringify({
                          originalContentUrl: v.originalContentUrl,
                          previewImageUrl: v.previewImageUrl,
                        }) }))
                      } else {
                        setForm((prev) => ({ ...prev, messageContent: '' }))
                      }
                    }}
                    label="テンプレート画像"
                  />
                ) : (
                  <Textarea
                    className="text-xs font-mono resize-y"
                    rows={form.messageType === 'flex' ? 10 : 4}
                    placeholder={form.messageType === 'flex' ? '{"type":"bubble","body":...}' : 'メッセージ内容'}
                    value={form.messageContent}
                    onChange={(e) => setForm({ ...form, messageContent: e.target.value })}
                  />
                )}
              </div>

              {formError && <p className="text-xs text-red-600">{formError}</p>}

              <div className="flex gap-2">
                <Button
                  onClick={handleCreate}
                  disabled={saving}
                  className="text-white"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {saving ? '作成中...' : '作成'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setShowCreate(false); setFormError('') }}
                >
                  キャンセル
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex items-center gap-4 animate-pulse">
              <div className="h-5 bg-gray-100 rounded w-12" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-48" />
                <div className="h-2 bg-gray-100 rounded w-32" />
              </div>
              <div className="h-3 bg-gray-100 rounded w-12" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
          ))}
        </div>
      ) : filteredTemplates.length === 0 ? (
        <EmptyState title="該当するテンプレートがありません" />
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">タイプ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">名前</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">カテゴリ</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">使用数</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">更新日</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredTemplates.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setDrawerId(t.id)}
                    className={`hover:bg-gray-50 cursor-pointer transition-colors ${drawerId === t.id ? 'bg-green-50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <Badge tone={messageTypeBadgeTones[t.messageType] ?? 'neutral'}>
                        {messageTypeLabels[t.messageType] ?? t.messageType}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{t.name}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5 truncate max-w-md">
                        {t.messageContent.slice(0, 60)}{t.messageContent.length > 60 ? '...' : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="info" className="rounded-full">
                        {t.category}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm ${t.usageCount === 0 ? 'text-gray-400' : 'text-gray-900 font-medium'}`}>
                        {t.usageCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(t.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); handleDelete(t.id, t.usageCount) }}
                        className="text-red-500 hover:bg-red-50"
                      >
                        削除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Drawer */}
      {drawerId && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-30 lg:hidden"
            onClick={() => setDrawerId(null)}
          />
          <div className="fixed inset-y-0 right-0 w-full lg:w-[480px] bg-white shadow-xl border-l border-gray-200 z-40 overflow-y-auto">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {editName !== null ? (
                  <Input
                    type="text"
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-0 flex-1"
                  />
                ) : (
                  <h3
                    className="text-sm font-semibold truncate cursor-text"
                    onClick={() => setEditName(drawerData?.name ?? '')}
                    title="クリックで編集"
                  >
                    {drawerData?.name ?? '読み込み中...'}
                  </h3>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDrawerId(null)}
                className="ml-2 text-gray-400 hover:text-gray-600 text-2xl leading-none px-1"
              >
                ×
              </Button>
            </div>

            {drawerLoading ? (
              <div className="p-6 text-sm text-gray-400">読み込み中...</div>
            ) : drawerError ? (
              <div className="p-6">
                <p className="text-sm text-red-600 mb-2">読み込みに失敗しました</p>
                <p className="text-xs text-gray-500">{drawerError}</p>
              </div>
            ) : !drawerData ? null : (
              <div className="p-4 space-y-5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone={messageTypeBadgeTones[drawerData.messageType] ?? 'neutral'}>
                    {messageTypeLabels[drawerData.messageType] ?? drawerData.messageType}
                  </Badge>
                  <Badge tone="info" className="rounded-full">
                    {drawerData.category}
                  </Badge>
                  <span className="text-[10px] text-gray-400">
                    更新: {formatDate(drawerData.updatedAt)}
                  </span>
                </div>

                {/* Preview */}
                <div>
                  <h4 className="text-[11px] font-medium text-gray-500 mb-1.5 uppercase tracking-wide">プレビュー</h4>
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 overflow-x-auto">
                    {drawerData.messageType === 'flex' ? (
                      (() => {
                        try {
                          return <FlexPreviewComponent content={drawerData.messageContent} maxWidth={420} />
                        } catch {
                          return <p className="text-xs text-red-500">Flex JSON parse 失敗</p>
                        }
                      })()
                    ) : drawerData.messageType === 'image' ? (
                      (() => {
                        try {
                          const parsed = JSON.parse(drawerData.messageContent)
                          return <img src={parsed.originalContentUrl || parsed.previewImageUrl} alt="" className="max-w-full rounded" />
                        } catch {
                          return <pre className="text-xs whitespace-pre-wrap">{drawerData.messageContent}</pre>
                        }
                      })()
                    ) : (
                      <p className="text-sm whitespace-pre-wrap break-words">{drawerData.messageContent}</p>
                    )}
                  </div>
                </div>

                {/* Edit JSON / content */}
                <div>
                  <h4 className="text-[11px] font-medium text-gray-500 mb-1.5 uppercase tracking-wide">内容 / JSON 編集</h4>
                  <Textarea
                    rows={drawerData.messageType === 'flex' ? 12 : 4}
                    className="text-xs font-mono resize-y"
                    value={editContent ?? drawerData.messageContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                </div>

                {(editContent !== null || editName !== null) && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveEdit}
                      disabled={savingEdit}
                      className="text-white"
                      style={{ backgroundColor: '#06C755' }}
                    >
                      {savingEdit ? '保存中...' : '保存'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setEditContent(null); setEditName(null) }}
                    >
                      キャンセル
                    </Button>
                  </div>
                )}

                {/* Used by */}
                <div>
                  <h4 className="text-[11px] font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
                    使用箇所 ({drawerData.usedBy.autoReplies.length + drawerData.usedBy.automations.length + scenarioStepUsages.length})
                  </h4>
                  {(drawerData.usedBy.autoReplies.length === 0 && drawerData.usedBy.automations.length === 0 && scenarioStepUsages.length === 0) ? (
                    <p className="text-[11px] text-gray-400 italic">どこからも使用されていません</p>
                  ) : (
                    <>
                      <ul className="space-y-1.5 text-xs">
                        {drawerData.usedBy.autoReplies.map((ar) => (
                          <li key={`ar-${ar.id}`}>
                            <a href="/auto-replies" className="text-blue-600 hover:underline">
                              🔗 自動返信: {ar.keyword} <span className="text-gray-400">({ar.matchType})</span>
                            </a>
                          </li>
                        ))}
                        {drawerData.usedBy.automations.map((au) => (
                          <li key={`au-${au.id}`}>
                            <a href="/automations" className="text-blue-600 hover:underline">
                              🔗 オートメーション: {au.name} <span className="text-gray-400">({au.eventType})</span>
                            </a>
                          </li>
                        ))}
                        {scenarioStepUsages.map((ss) => (
                          <li key={`ss-${ss.stepId}`}>
                            <a href={`/scenarios/detail?id=${ss.scenarioId}`} className="text-blue-600 hover:underline">
                              🎬 シナリオ: {ss.scenarioName} <span className="text-gray-400">#{ss.stepOrder}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                      {scenarioStepUsages.length > 0 && (
                        <p className="mt-2 text-[10px] text-amber-700">
                          ⚠ このテンプレートを修正すると、上記すべてに一斉反映されます
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
