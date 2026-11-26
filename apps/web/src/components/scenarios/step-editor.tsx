'use client'

import { useState } from 'react'
import type { ScenarioStep, MessageType } from '@line-crm/shared'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Input, InputArea } from '@cloudflare/kumo/components/input'

interface StepEditorProps {
  step?: ScenarioStep
  stepOrder: number
  onSave: (data: { stepOrder: number; delayMinutes: number; messageType: MessageType; messageContent: string }) => Promise<void>
  onCancel: () => void
}

const messageTypeLabels: Record<MessageType, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flexメッセージ',
}

function minutesToDisplay(minutes: number): { days: number; hours: number; mins: number } {
  const days = Math.floor(minutes / (60 * 24))
  const hours = Math.floor((minutes % (60 * 24)) / 60)
  const mins = minutes % 60
  return { days, hours, mins }
}

function displayToMinutes(days: number, hours: number, mins: number): number {
  return days * 24 * 60 + hours * 60 + mins
}

export default function StepEditor({ step, stepOrder, onSave, onCancel }: StepEditorProps) {
  const initial = step ? minutesToDisplay(step.delayMinutes) : { days: 0, hours: 0, mins: 0 }

  const [days, setDays] = useState(initial.days)
  const [hours, setHours] = useState(initial.hours)
  const [mins, setMins] = useState(initial.mins)
  const [messageType, setMessageType] = useState<MessageType>(step?.messageType ?? 'text')
  const [messageContent, setMessageContent] = useState(step?.messageContent ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!messageContent.trim()) {
      setError('メッセージ内容を入力してください')
      return
    }
    if (messageType === 'flex') {
      try {
        JSON.parse(messageContent)
      } catch {
        setError('FlexメッセージのJSONが無効です')
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      await onSave({
        stepOrder,
        delayMinutes: displayToMinutes(days, hours, mins),
        messageType,
        messageContent,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">
        {step ? 'ステップを編集' : `ステップ ${stepOrder} を追加`}
      </h3>

      {/* Delay settings */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">
          前のステップからの待機時間
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              className="w-16 text-center"
              value={days}
              onChange={(e) => setDays(Math.max(0, parseInt(e.target.value) || 0))}
              aria-label="待機日数"
            />
            <span className="text-sm text-gray-500">日</span>
          </div>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              max={23}
              className="w-16 text-center"
              value={hours}
              onChange={(e) => setHours(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
              aria-label="待機時間"
            />
            <span className="text-sm text-gray-500">時間</span>
          </div>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              max={59}
              className="w-16 text-center"
              value={mins}
              onChange={(e) => setMins(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
              aria-label="待機分"
            />
            <span className="text-sm text-gray-500">分</span>
          </div>
          <span className="text-xs text-gray-400">
            (合計: {displayToMinutes(days, hours, mins).toLocaleString('ja-JP')} 分)
          </span>
        </div>
      </div>

      {/* Message type */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">メッセージ種別</label>
        <div className="flex gap-2">
          {(Object.keys(messageTypeLabels) as MessageType[]).map((type) => (
            <Button
              key={type}
              type="button"
              onClick={() => setMessageType(type)}
              size="sm"
              variant={messageType === type ? 'primary' : 'secondary'}
            >
              {messageTypeLabels[type]}
            </Button>
          ))}
        </div>
      </div>

      {/* Message content */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">
          メッセージ内容
          {(messageType === 'flex' || messageType === 'image') && (
            <span className="ml-1 text-gray-400">(JSON形式)</span>
          )}
        </label>

        {/* Image helper: URL inputs that auto-generate the required LINE image JSON */}
        {messageType === 'image' && (() => {
          let parsed: { originalContentUrl?: string; previewImageUrl?: string } = {}
          try { parsed = JSON.parse(messageContent) } catch { /* not yet valid */ }
          return (
            <div className="space-y-2 mb-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">元画像URL (originalContentUrl)</label>
                <Input
                  type="url"
                  placeholder="https://example.com/image.png"
                  value={parsed.originalContentUrl ?? ''}
                  onChange={(e) => {
                    const orig = e.target.value
                    const prev = parsed.previewImageUrl ?? orig
                    setMessageContent(JSON.stringify({ originalContentUrl: orig, previewImageUrl: prev }))
                  }}
                  aria-label="元画像URL"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">プレビュー画像URL (previewImageUrl)</label>
                <Input
                  type="url"
                  placeholder="https://example.com/preview.png (空欄で元画像と同じ)"
                  value={parsed.previewImageUrl ?? ''}
                  onChange={(e) => {
                    const prev = e.target.value
                    setMessageContent(JSON.stringify({ originalContentUrl: parsed.originalContentUrl ?? '', previewImageUrl: prev }))
                  }}
                  aria-label="プレビュー画像URL"
                />
              </div>
            </div>
          )
        })()}

        <InputArea
          minRows={messageType === 'flex' ? 8 : messageType === 'image' ? 3 : 4}
          placeholder={
            messageType === 'text'
              ? 'メッセージテキストを入力...'
              : messageType === 'image'
              ? '{"originalContentUrl":"...","previewImageUrl":"..."}'
              : '{"type":"bubble","body":{...}}'
          }
          value={messageContent}
          onValueChange={setMessageContent}
          style={{ fontFamily: messageType !== 'text' ? 'monospace' : 'inherit' }}
          aria-label="メッセージ内容"
        />
        {messageType === 'image' && (
          <p className="text-xs text-gray-400 mt-1">上のURLフォームか、直接JSONを編集できます</p>
        )}
      </div>

      {/* Error */}
      {error && <Banner size="sm" variant="error" title="保存できませんでした" description={error} />}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          onClick={handleSave}
          disabled={saving}
          variant="primary"
          loading={saving}
        >
          {saving ? '保存中...' : '保存'}
        </Button>
        <Button
          onClick={onCancel}
          disabled={saving}
          variant="secondary"
        >
          キャンセル
        </Button>
      </div>
    </div>
  )
}
