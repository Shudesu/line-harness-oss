'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import Header from '@/components/layout/header'
import { api, type ApiEventDefinition, type ApiEventTagRule, type ApiUserEvent } from '@/lib/api'
import type { Tag } from '@line-crm/shared'

type ManagedTag = Tag & {
  kind?: 'system' | 'custom'
  category?: string | null
  description?: string | null
  isActive?: boolean
  isLocked?: boolean
  updatedAt?: string | null
}

type TagDraft = {
  name: string
  color: string
  category: string
  description: string
}

type RuleDraft = {
  name: string
  eventType: string
  conditionKey: string
  conditionValue: string
  action: 'add_tag' | 'remove_tag'
  tagId: string
}

const TAG_CATEGORIES = [
  { value: 'reservation', label: '予約' },
  { value: 'visit', label: '来園' },
  { value: 'campaign', label: 'キャンペーン' },
  { value: 'interest', label: '興味' },
  { value: 'source', label: '流入元' },
  { value: 'customer', label: '顧客' },
  { value: 'risk', label: '注意' },
  { value: 'manual', label: '手動' },
]

const DEFAULT_TAG_DRAFT: TagDraft = {
  name: '',
  color: '#06C755',
  category: 'reservation',
  description: '',
}

const DEFAULT_RULE_DRAFT: RuleDraft = {
  name: '',
  eventType: '',
  conditionKey: '',
  conditionValue: '',
  action: 'add_tag',
  tagId: '',
}

function unwrapApiData<T>(response: { success: true; data: T } | { success: false; error: string }, fallback: T): T {
  return response.success ? response.data : fallback
}

function isLockedTag(tag: ManagedTag) {
  return tag.kind === 'system' || Boolean(tag.isLocked)
}

function tagKindLabel(tag: ManagedTag) {
  return tag.kind === 'system' ? 'システム' : 'カスタム'
}

function tagCategoryLabel(category?: string | null) {
  return TAG_CATEGORIES.find((item) => item.value === category)?.label || category || '未分類'
}

function formatDateTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function compactJson(value: string | null | undefined) {
  const parsed = parseJsonObject(value)
  const keys = Object.keys(parsed)
  if (keys.length === 0) return '条件なし'
  return keys.map((key) => `${key}: ${String(parsed[key])}`).join(' / ')
}

function metadataPreview(value: string | null | undefined) {
  const parsed = parseJsonObject(value)
  const entries = Object.entries(parsed).slice(0, 4)
  if (entries.length === 0) return 'metadataなし'
  return entries.map(([key, item]) => `${key}: ${String(item)}`).join(' / ')
}

export default function TagsEventsPage() {
  const [tags, setTags] = useState<ManagedTag[]>([])
  const [events, setEvents] = useState<ApiUserEvent[]>([])
  const [definitions, setDefinitions] = useState<ApiEventDefinition[]>([])
  const [rules, setRules] = useState<ApiEventTagRule[]>([])
  const [tagDraft, setTagDraft] = useState<TagDraft>(DEFAULT_TAG_DRAFT)
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(DEFAULT_RULE_DRAFT)
  const [eventFilter, setEventFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tagsRes, eventsRes, definitionsRes, rulesRes] = await Promise.all([
        api.tags.list(),
        api.events.list({ limit: 80 }),
        api.events.definitions(),
        api.events.rules(),
      ])
      setTags(unwrapApiData(tagsRes, []) as ManagedTag[])
      setEvents(unwrapApiData(eventsRes, []))
      setDefinitions(unwrapApiData(definitionsRes, []))
      setRules(unwrapApiData(rulesRes, []))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タグ・イベント設定の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const customTags = useMemo(() => tags.filter((tag) => tag.kind !== 'system'), [tags])
  const systemTags = useMemo(() => tags.filter((tag) => tag.kind === 'system'), [tags])
  const activeTags = useMemo(() => tags.filter((tag) => tag.isActive !== false), [tags])
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags])
  const filteredEvents = useMemo(() => {
    if (!eventFilter) return events
    return events.filter((event) => event.eventType === eventFilter)
  }, [eventFilter, events])

  const createTag = async (event: FormEvent) => {
    event.preventDefault()
    const name = tagDraft.name.trim()
    if (!name) {
      setError('タグ名を入力してください')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.tags.create({
        name,
        color: tagDraft.color,
        category: tagDraft.category,
        description: tagDraft.description.trim() || null,
      })
      setTagDraft(DEFAULT_TAG_DRAFT)
      setNotice('カスタムタグを作成しました')
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タグ作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const deleteTag = async (tag: ManagedTag) => {
    if (isLockedTag(tag)) return
    if (!window.confirm(`タグ「${tag.name}」を削除します。友だちへの付与も解除されます。よろしいですか？`)) return
    setSaving(true)
    setError(null)
    try {
      await api.tags.delete(tag.id)
      setNotice('タグを削除しました')
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タグ削除に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const createRule = async (event: FormEvent) => {
    event.preventDefault()
    if (!ruleDraft.name.trim() || !ruleDraft.eventType || !ruleDraft.tagId) {
      setError('ルール名、イベント種類、対象タグを入力してください')
      return
    }
    const conditionKey = ruleDraft.conditionKey.trim()
    const conditionValue = ruleDraft.conditionValue.trim()
    const conditions = conditionKey ? { [conditionKey]: conditionValue } : {}

    setSaving(true)
    setError(null)
    try {
      await api.events.createRule({
        name: ruleDraft.name.trim(),
        eventType: ruleDraft.eventType,
        conditions,
        action: ruleDraft.action,
        tagId: ruleDraft.tagId,
        isActive: true,
      })
      setRuleDraft((current) => ({
        ...DEFAULT_RULE_DRAFT,
        eventType: current.eventType,
        tagId: current.tagId,
      }))
      setNotice('イベントタグルールを作成しました')
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ルール作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const deleteRule = async (rule: ApiEventTagRule) => {
    if (!window.confirm(`ルール「${rule.name}」を削除します。よろしいですか？`)) return
    setSaving(true)
    setError(null)
    try {
      await api.events.deleteRule(rule.id)
      setNotice('イベントタグルールを削除しました')
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ルール削除に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header
        title="タグ・イベント設定"
        description="予約状態、リッチメニュー反応、LIFF操作をタグとイベントで管理します。"
        action={
          <button
            onClick={() => void loadAll()}
            disabled={loading}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            再読み込み
          </button>
        }
      />

      {(notice || error) && (
        <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
          error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'
        }`}>
          {error || notice}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="カスタムタグ" value={customTags.length} tone="green" />
        <SummaryCard label="システムタグ" value={systemTags.length} tone="blue" />
        <SummaryCard label="自動タグルール" value={rules.length} tone="amber" />
        <SummaryCard label="直近イベント" value={events.length} tone="slate" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[420px_1fr]">
        <section className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">カスタムタグ作成</h2>
              <p className="mt-1 text-sm text-gray-500">配信対象や顧客分類に使うタグを作ります。</p>
            </div>
            <form onSubmit={createTag} className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">タグ名</span>
                <input
                  value={tagDraft.name}
                  onChange={(event) => setTagDraft((current) => ({ ...current, name: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
                  placeholder="例: 予約興味あり"
                />
              </label>
              <div className="grid grid-cols-[1fr_88px] gap-3">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">カテゴリ</span>
                  <select
                    value={tagDraft.category}
                    onChange={(event) => setTagDraft((current) => ({ ...current, category: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
                  >
                    {TAG_CATEGORIES.map((category) => (
                      <option key={category.value} value={category.value}>{category.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">色</span>
                  <input
                    type="color"
                    value={tagDraft.color}
                    onChange={(event) => setTagDraft((current) => ({ ...current, color: event.target.value }))}
                    className="mt-1 h-[38px] w-full rounded-lg border border-gray-300 bg-white px-2 py-1"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">説明</span>
                <textarea
                  value={tagDraft.description}
                  onChange={(event) => setTagDraft((current) => ({ ...current, description: event.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
                  placeholder="このタグを使う目的を書いておくと運用が壊れにくくなります。"
                />
              </label>
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                タグを作成
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">タグ一覧</h2>
            <div className="mt-4 space-y-3">
              {tags.map((tag) => (
                <div key={tag.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color || '#94A3B8' }} />
                        <span className="font-medium text-gray-900">{tag.name}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500">{tagKindLabel(tag)}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500">{tagCategoryLabel(tag.category)}</span>
                      </div>
                      {tag.description && <p className="mt-2 text-xs text-gray-500">{tag.description}</p>}
                    </div>
                    <button
                      onClick={() => void deleteTag(tag)}
                      disabled={saving || isLockedTag(tag)}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-gray-300"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
              {!loading && tags.length === 0 && (
                <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">タグがありません。</p>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">イベントからタグを自動付与</h2>
              <p className="mt-1 text-sm text-gray-500">
                例: リッチメニューの予約ボタンを押した人に「予約興味あり」タグを付ける。
              </p>
            </div>
            <form onSubmit={createRule} className="grid gap-4 lg:grid-cols-2">
              <label className="block lg:col-span-2">
                <span className="text-sm font-medium text-gray-700">ルール名</span>
                <input
                  value={ruleDraft.name}
                  onChange={(event) => setRuleDraft((current) => ({ ...current, name: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
                  placeholder="例: 予約ボタンタップで興味タグ"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">イベント種類</span>
                <select
                  value={ruleDraft.eventType}
                  onChange={(event) => setRuleDraft((current) => ({ ...current, eventType: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
                >
                  <option value="">選択してください</option>
                  {definitions.map((definition) => (
                    <option key={definition.id} value={definition.eventType}>
                      {definition.name} / {definition.eventType}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">対象タグ</span>
                <select
                  value={ruleDraft.tagId}
                  onChange={(event) => setRuleDraft((current) => ({ ...current, tagId: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
                >
                  <option value="">選択してください</option>
                  {activeTags.map((tag) => (
                    <option key={tag.id} value={tag.id}>{tag.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">条件キー 任意</span>
                <input
                  value={ruleDraft.conditionKey}
                  onChange={(event) => setRuleDraft((current) => ({ ...current, conditionKey: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
                  placeholder="例: action"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">条件値 任意</span>
                <input
                  value={ruleDraft.conditionValue}
                  onChange={(event) => setRuleDraft((current) => ({ ...current, conditionValue: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
                  placeholder="例: booking"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">動作</span>
                <select
                  value={ruleDraft.action}
                  onChange={(event) => setRuleDraft((current) => ({ ...current, action: event.target.value as RuleDraft['action'] }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
                >
                  <option value="add_tag">タグを付ける</option>
                  <option value="remove_tag">タグを外す</option>
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  ルールを作成
                </button>
              </div>
            </form>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">自動タグルール</h2>
            <div className="mt-4 space-y-3">
              {rules.map((rule) => {
                const tag = tagById.get(rule.tagId)
                return (
                  <div key={rule.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-gray-900">{rule.name}</span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500">{rule.eventType}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${
                            rule.action === 'add_tag' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                          }`}>
                            {rule.action === 'add_tag' ? '付与' : '削除'}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-gray-600">
                          対象タグ: <span className="font-medium">{tag?.name || rule.tagId}</span>
                        </p>
                        <p className="mt-1 text-xs text-gray-500">条件: {compactJson(rule.conditions)}</p>
                      </div>
                      <button
                        onClick={() => void deleteRule(rule)}
                        disabled={saving}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                )
              })}
              {!loading && rules.length === 0 && (
                <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">自動タグルールはまだありません。</p>
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-900">直近イベント</h2>
                <select
                  value={eventFilter}
                  onChange={(event) => setEventFilter(event.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">すべて</option>
                  {definitions.map((definition) => (
                    <option key={definition.id} value={definition.eventType}>{definition.name}</option>
                  ))}
                </select>
              </div>
              <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                {filteredEvents.map((event) => (
                  <div key={event.id} className="rounded-xl border border-gray-100 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{event.eventName || event.eventType}</p>
                        <p className="mt-1 text-xs text-gray-500">{event.eventType} / {event.eventSource}</p>
                      </div>
                      <span className="shrink-0 text-xs text-gray-400">{formatDateTime(event.occurredAt)}</span>
                    </div>
                    <p className="mt-2 truncate text-xs text-gray-500">{metadataPreview(event.metadata)}</p>
                  </div>
                ))}
                {!loading && filteredEvents.length === 0 && (
                  <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">イベントがありません。</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">イベント定義</h2>
              <p className="mt-1 text-sm text-gray-500">どの操作がイベントとして保存されるかの一覧です。</p>
              <div className="mt-4 max-h-[520px] space-y-3 overflow-y-auto pr-1">
                {definitions.map((definition) => (
                  <div key={definition.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{definition.name}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500">{definition.category}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{definition.eventType}</p>
                    {definition.description && (
                      <p className="mt-2 text-sm text-gray-600">{definition.description}</p>
                    )}
                  </div>
                ))}
                {!loading && definitions.length === 0 && (
                  <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">イベント定義がありません。</p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: 'green' | 'blue' | 'amber' | 'slate' }) {
  const toneClass = {
    green: 'bg-green-50 text-green-700 border-green-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
  }[tone]

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-sm font-medium opacity-80">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  )
}
