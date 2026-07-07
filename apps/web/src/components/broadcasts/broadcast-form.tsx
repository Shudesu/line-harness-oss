'use client'

import { useEffect, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import { api, eventsApi, type ApiBroadcast, type EventListItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import FlexPreviewComponent from '@/components/flex-preview'
import ImageUploader from '@/components/shared/image-uploader'
import MultiAccountDedupSection from './multi-account-dedup-section'

interface BroadcastFormProps {
  tags: Tag[]
  onSuccess: () => void
  onCancel: () => void
}

const messageTypeLabels: Record<ApiBroadcast['messageType'], string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flexメッセージ',
}

interface FormState {
  title: string
  messageType: ApiBroadcast['messageType']
  messageContent: string
  targetType: ApiBroadcast['targetType']
  targetTagId: string
  scheduledAt: string
  sendNow: boolean
  accountIds: string[]
  dedupPriority: string[]
  trackLinks: boolean
}

export default function BroadcastForm({ tags, onSuccess, onCancel }: BroadcastFormProps) {
  const { selectedAccountId } = useAccount()
  // 「リンクするイベント」セレクタ用: 公開中の events を取得して
  // 選択された event の LIFF URL (テンプレ) を message に挿入する。
  const [linkableEvents, setLinkableEvents] = useState<EventListItem[]>([])
  useEffect(() => {
    if (!selectedAccountId) return
    let cancelled = false
    eventsApi.listEvents(selectedAccountId)
      .then((r) => { if (!cancelled) setLinkableEvents(r.items.filter((e) => e.is_published === 1)) })
      .catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [selectedAccountId])
  const [form, setForm] = useState<FormState>({
    title: '',
    messageType: 'text',
    messageContent: '',
    targetType: 'all',
    targetTagId: '',
    scheduledAt: '',
    sendNow: true,
    accountIds: [],
    dedupPriority: [],
    trackLinks: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!form.title.trim()) { setError('配信タイトルを入力してください'); return }
    if (!form.messageContent.trim()) { setError('メッセージ内容を入力してください'); return }
    if (form.messageType === 'flex') {
      try { JSON.parse(form.messageContent) } catch { setError('FlexメッセージのJSONが無効です'); return }
    }
    if (!form.sendNow && !form.scheduledAt) {
      setError('予約配信の場合は配信日時を指定してください')
      return
    }
    if (form.targetType === 'multi-account-dedup' && form.accountIds.length === 0) {
      setError('複数アカ重複除外: 配信先アカウントを 1 つ以上選択してください')
      return
    }

    setSaving(true)
    setError('')
    try {
      const res = await api.broadcasts.create({
        title: form.title,
        messageType: form.messageType,
        messageContent: form.messageContent,
        targetType: form.targetType,
        // tag mode: required; multi-account-dedup mode: optional narrowing filter; else: null
        targetTagId:
          form.targetType === 'tag'
            ? form.targetTagId || null
            : form.targetType === 'multi-account-dedup'
            ? form.targetTagId || null
            : null,
        status: 'draft',
        lineAccountId: form.targetType === 'multi-account-dedup' ? null : (selectedAccountId || null),
        accountIds: form.targetType === 'multi-account-dedup' ? form.accountIds : undefined,
        dedupPriority: form.targetType === 'multi-account-dedup' ? form.dedupPriority : undefined,
        trackLinks: form.trackLinks,
        // datetime-local returns YYYY-MM-DDTHH:mm in JST wall-clock time
        // Append +09:00 so new Date() parses correctly for epoch comparisons
        scheduledAt: form.sendNow || !form.scheduledAt
          ? null
          : form.scheduledAt + ':00.000+09:00',
      })
      if (res.success) {
        onSuccess()
      } else {
        setError(res.error)
      }
    } catch {
      setError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <h2 className="text-sm font-semibold text-gray-800 mb-5">新規配信を作成</h2>

      <div className="space-y-4 max-w-lg">
        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            配信タイトル <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="例: 3月のキャンペーン告知"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>

        {/* Message type */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">メッセージ種別</label>
          <div className="flex gap-2">
            {(Object.keys(messageTypeLabels) as ApiBroadcast['messageType'][]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setForm({ ...form, messageType: type })}
                className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                  form.messageType === type
                    ? 'border-green-500 text-green-700 bg-green-50'
                    : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
                }`}
              >
                {messageTypeLabels[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Message content */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            メッセージ内容 <span className="text-red-500">*</span>
            {(form.messageType === 'flex' || form.messageType === 'image') && (
              <span className="ml-1 text-gray-400">(JSON形式)</span>
            )}
          </label>

          {/* Image helper: ImageUploader that auto-generates the required LINE image JSON */}
          {form.messageType === 'image' && (
            <div className="mb-2">
              <ImageUploader
                mode="line-image"
                value={(() => {
                  try {
                    const parsed = JSON.parse(form.messageContent) as { originalContentUrl?: string; previewImageUrl?: string }
                    if (parsed.originalContentUrl) {
                      return { mode: 'line-image' as const, originalContentUrl: parsed.originalContentUrl, previewImageUrl: parsed.previewImageUrl ?? parsed.originalContentUrl }
                    }
                  } catch { /* ignore */ }
                  return null
                })()}
                onChange={(v) => {
                  if (v?.mode === 'line-image') {
                    setForm((prev) => ({ ...prev, messageContent: JSON.stringify({ originalContentUrl: v.originalContentUrl, previewImageUrl: v.previewImageUrl }) }))
                  } else {
                    setForm((prev) => ({ ...prev, messageContent: '' }))
                  }
                }}
                label="送信する画像"
              />
            </div>
          )}

          {/* リンクするイベント: 選択で {{liff_id}} 入りテンプレ URL を本文末尾に挿入 */}
          {linkableEvents.length > 0 && form.messageType === 'text' && (
            <div className="mb-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                リンクするイベント（任意）
              </label>
              <select
                value=""
                onChange={(e) => {
                  const id = e.target.value
                  if (!id) return
                  const url = `https://liff.line.me/{{liff_id}}/?page=event&id=${id}&liffId={{liff_id}}`
                  setForm((prev) => ({
                    ...prev,
                    messageContent: prev.messageContent
                      ? `${prev.messageContent}\n${url}`
                      : url,
                  }))
                  e.target.value = ''
                }}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-full"
              >
                <option value="">— 選択しない —</option>
                {linkableEvents.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} ({ev.target_type === 'multi-account-dedup' ? 'multi' : 'single'})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                選ぶと本文末尾にテンプレ URL を挿入。{'{{liff_id}}'} は配信時に各友だちのアカに対応した値に自動置換されます。
              </p>
            </div>
          )}
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
            rows={form.messageType === 'flex' ? 8 : form.messageType === 'image' ? 3 : 4}
            placeholder={
              form.messageType === 'text'
                ? '配信するメッセージを入力...'
                : form.messageType === 'image'
                ? '{"originalContentUrl":"...","previewImageUrl":"..."}'
                : '{"type":"bubble","body":{...}}'
            }
            value={form.messageContent}
            onChange={(e) => setForm({ ...form, messageContent: e.target.value })}
            style={{ fontFamily: form.messageType !== 'text' ? 'monospace' : 'inherit' }}
          />
          {form.messageType === 'image' && (
            <p className="text-xs text-gray-400 mt-1">上のURLフォームか、直接JSONを編集できます</p>
          )}
          {form.messageType === 'flex' && form.messageContent && (() => {
            try { JSON.parse(form.messageContent); return true } catch { return false }
          })() && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 mb-2">プレビュー</p>
              <FlexPreviewComponent content={form.messageContent} maxWidth={300} />
            </div>
          )}
        </div>

        {/* Link tracking toggle */}
        {form.messageType !== 'image' && (
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.trackLinks}
                onChange={(e) => setForm({ ...form, trackLinks: e.target.checked })}
              />
              このメッセージでリンクを短縮する（クリック計測）
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">
              ONにすると本文のURLが計測用リンク（/t/…）に自動変換されます。OFFの場合はURLをそのまま送信します。
            </p>
          </div>
        )}

        {/* Target */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">配信対象</label>
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, targetType: 'all', targetTagId: '' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.targetType === 'all'
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              全員
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, targetType: 'tag' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.targetType === 'tag'
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              タグで絞り込み
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, targetType: 'multi-account-dedup', targetTagId: '' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.targetType === 'multi-account-dedup'
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              複数アカ重複除外
            </button>
          </div>
          {form.targetType === 'tag' && (
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              value={form.targetTagId}
              onChange={(e) => setForm({ ...form, targetTagId: e.target.value })}
            >
              <option value="">タグを選択...</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          )}
          {form.targetType === 'multi-account-dedup' && (
            <MultiAccountDedupSection
              accountIds={form.accountIds}
              dedupPriority={form.dedupPriority}
              targetTagId={form.targetTagId || null}
              tags={tags}
              onAccountIdsChange={(ids) => setForm({ ...form, accountIds: ids })}
              onDedupPriorityChange={(ids) => setForm({ ...form, dedupPriority: ids })}
              onTargetTagIdChange={(id) => setForm({ ...form, targetTagId: id ?? '' })}
            />
          )}
        </div>

        {/* Schedule */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">配信タイミング</label>
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, sendNow: true, scheduledAt: '' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.sendNow
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              下書きとして保存
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, sendNow: false })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                !form.sendNow
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              予約配信
            </button>
          </div>
          {!form.sendNow && (
            <input
              type="datetime-local"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={form.scheduledAt}
              onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
            />
          )}
        </div>

        {/* Error */}
        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: '#06C755' }}
          >
            {saving ? '作成中...' : '作成'}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}
