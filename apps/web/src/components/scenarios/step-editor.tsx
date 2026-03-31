'use client'

import { useState } from 'react'
import type { ScenarioStep, MessageType } from '@line-crm/shared'

interface StepEditorProps {
  step?: ScenarioStep
  stepOrder: number
  onSave: (data: { stepOrder: number; delayMinutes: number; messageType: MessageType; messageContent: string }) => Promise<void>
  onCancel: () => void
}

const messageTypeLabels: Record<MessageType, string> = {
  text: 'テキスト',
  image: '画像',
  image_link: '画像+リンク',
  flex: 'Flexメッセージ',
  carousel: 'カルーセル',
  multi: '複数吹き出し',
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
            <input
              type="number"
              min={0}
              className="w-16 border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 text-center"
              value={days}
              onChange={(e) => setDays(Math.max(0, parseInt(e.target.value) || 0))}
            />
            <span className="text-sm text-gray-500">日</span>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={23}
              className="w-16 border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 text-center"
              value={hours}
              onChange={(e) => setHours(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
            />
            <span className="text-sm text-gray-500">時間</span>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={59}
              className="w-16 border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 text-center"
              value={mins}
              onChange={(e) => setMins(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
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
            <button
              key={type}
              type="button"
              onClick={() => setMessageType(type)}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                messageType === type
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
                <input
                  type="url"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="https://example.com/image.png"
                  value={parsed.originalContentUrl ?? ''}
                  onChange={(e) => {
                    const orig = e.target.value
                    const prev = parsed.previewImageUrl ?? orig
                    setMessageContent(JSON.stringify({ originalContentUrl: orig, previewImageUrl: prev }))
                  }}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">プレビュー画像URL (previewImageUrl)</label>
                <input
                  type="url"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="https://example.com/preview.png (空欄で元画像と同じ)"
                  value={parsed.previewImageUrl ?? ''}
                  onChange={(e) => {
                    const prev = e.target.value
                    setMessageContent(JSON.stringify({ originalContentUrl: parsed.originalContentUrl ?? '', previewImageUrl: prev }))
                  }}
                />
              </div>
            </div>
          )
        })()}

        <textarea
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
          rows={messageType === 'flex' ? 8 : messageType === 'image' ? 3 : 4}
          placeholder={
            messageType === 'text'
              ? 'メッセージテキストを入力...'
              : messageType === 'image'
              ? '{"originalContentUrl":"...","previewImageUrl":"..."}'
              : '{"type":"bubble","body":{...}}'
          }
          value={messageContent}
          onChange={(e) => setMessageContent(e.target.value)}
          style={{ fontFamily: messageType !== 'text' ? 'monospace' : 'inherit' }}
        />
        {messageType === 'image' && (
          <p className="text-xs text-gray-400 mt-1">上のURLフォームか、直接JSONを編集できます</p>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: '#06C755' }}
        >
          {saving ? '保存中...' : '保存'}
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
  )
}
