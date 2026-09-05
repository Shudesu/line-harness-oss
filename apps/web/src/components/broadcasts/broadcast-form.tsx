'use client'

import { useEffect, useRef, useState } from 'react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Select } from '@cloudflare/kumo/components/select'
import { Tabs } from '@cloudflare/kumo/components/tabs'
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
  // Network timeout後の再クリックでも同じ作成要求として扱い、二重予約を防ぐ。
  const createIdempotencyKey = useRef(crypto.randomUUID())
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
      }, { idempotencyKey: createIdempotencyKey.current })
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
    <LayerCard className="mb-6 p-6">
      <h2 className="mb-5 text-sm font-semibold text-kumo-strong">新規配信を作成</h2>

      <div className="space-y-4 max-w-lg">
        <Input label="配信タイトル" required placeholder="例：3月のキャンペーン告知" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />

        <div>
          <p className="mb-2 text-xs font-medium text-kumo-subtle">メッセージ種別</p>
          <Tabs
            size="sm"
            value={form.messageType}
            onValueChange={(value) => setForm({ ...form, messageType: value as ApiBroadcast['messageType'] })}
            tabs={(Object.keys(messageTypeLabels) as ApiBroadcast['messageType'][]).map((type) => ({ value: type, label: messageTypeLabels[type] }))}
          />
        </div>

        {/* Message content */}
        <div>
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
              <Select
                label="リンクするイベント"
                required={false}
                value=""
                onValueChange={(value) => {
                  const id = value ?? ''
                  if (!id) return
                  const url = `https://liff.line.me/{{liff_id}}/?page=event&id=${id}&liffId={{liff_id}}`
                  setForm((prev) => ({
                    ...prev,
                    messageContent: prev.messageContent
                      ? `${prev.messageContent}\n${url}`
                      : url,
                  }))
                }}
                placeholder="選択しない"
                items={linkableEvents.map((event) => ({ value: event.id, label: `${event.name} (${event.target_type === 'multi-account-dedup' ? 'multi' : 'single'})` }))}
              />
              <p className="mt-1 text-xs text-kumo-subtle">
                選ぶと本文末尾にテンプレ URL を挿入。{'{{liff_id}}'} は配信時に各友だちのアカに対応した値に自動置換されます。
              </p>
            </div>
          )}
          <InputArea
            label="メッセージ内容"
            required
            description={form.messageType === 'text' ? undefined : 'JSON形式で指定します。'}
            className={form.messageType !== 'text' ? 'font-mono' : undefined}
            rows={form.messageType === 'flex' ? 8 : form.messageType === 'image' ? 3 : 4}
            placeholder={
              form.messageType === 'text'
                ? '配信するメッセージを入力...'
                : form.messageType === 'image'
                ? '{"originalContentUrl":"...","previewImageUrl":"..."}'
                : '{"type":"bubble","body":{...}}'
            }
            value={form.messageContent}
            onValueChange={(value) => setForm({ ...form, messageContent: value })}
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
            <Checkbox label="このメッセージでリンクを短縮する（クリック計測）" checked={form.trackLinks} onCheckedChange={(checked) => setForm({ ...form, trackLinks: checked })} />
            <p className="ml-6 mt-1 text-xs text-kumo-subtle">
              ONにすると本文のURLが計測用リンク（/t/…）に自動変換されます。OFFの場合はURLをそのまま送信します。
            </p>
          </div>
        )}

        {/* Target */}
        <div>
          <p className="mb-2 text-xs font-medium text-kumo-subtle">配信対象</p>
          <Tabs
            size="sm"
            value={form.targetType}
            onValueChange={(value) => setForm({ ...form, targetType: value as ApiBroadcast['targetType'], targetTagId: value === 'tag' ? form.targetTagId : '' })}
            tabs={[{ value: 'all', label: '全員' }, { value: 'tag', label: 'タグで絞り込み' }, { value: 'multi-account-dedup', label: '複数アカ重複除外' }]}
          />
          {form.targetType === 'tag' && (
            <Select
              className="mt-2 w-full"
              aria-label="配信対象タグ"
              value={form.targetTagId}
              onValueChange={(value) => setForm({ ...form, targetTagId: value ?? '' })}
              placeholder="タグを選択"
              items={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
            />
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
          <p className="mb-2 text-xs font-medium text-kumo-subtle">配信タイミング</p>
          <Tabs size="sm" value={form.sendNow ? 'draft' : 'scheduled'} onValueChange={(value) => setForm({ ...form, sendNow: value === 'draft', scheduledAt: value === 'draft' ? '' : form.scheduledAt })} tabs={[{ value: 'draft', label: '下書きとして保存' }, { value: 'scheduled', label: '予約配信' }]} />
          {!form.sendNow && (
            <Input
              className="mt-2"
              label="配信日時"
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })}
            />
          )}
        </div>

        {/* Error */}
        {error ? <Banner size="sm" variant="error" title="作成できません" description={error} /> : null}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="primary" loading={saving} onClick={() => void handleSave()}>作成</Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>キャンセル</Button>
        </div>
      </div>
    </LayerCard>
  )
}
