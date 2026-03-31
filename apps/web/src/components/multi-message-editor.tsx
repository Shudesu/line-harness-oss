'use client'

import { useState } from 'react'
import FlexPreviewComponent from './flex-preview'
import CarouselBuilder from './carousel/carousel-builder'
import FlexTemplateGallery from './flex-editor/flex-template-gallery'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MessageItem {
  type: 'text' | 'image' | 'image_link' | 'flex' | 'carousel'
  content: string
}

export type MessageType = MessageItem['type']

const messageTypeOptions: { value: MessageType; label: string }[] = [
  { value: 'text', label: 'テキスト' },
  { value: 'image', label: '画像' },
  { value: 'image_link', label: '画像+リンク' },
  { value: 'flex', label: 'Flex' },
  { value: 'carousel', label: 'カルーセル' },
]

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** DB → UI: message_type + message_content → MessageItem[] */
export function parseMessages(type: string, content: string): MessageItem[] {
  if (type === 'multi') {
    try {
      return JSON.parse(content) as MessageItem[]
    } catch {
      return [{ type: 'text', content }]
    }
  }
  return [{ type: type as MessageType, content }]
}

/** UI → DB: MessageItem[] → { messageType, messageContent } */
export function serializeMessages(items: MessageItem[]): {
  messageType: string
  messageContent: string
} {
  if (items.length === 1) {
    return { messageType: items[0].type, messageContent: items[0].content }
  }
  return { messageType: 'multi', messageContent: JSON.stringify(items) }
}

// ─── Default content helpers ───────────────────────────────────────────────────

function defaultContent(type: MessageType): string {
  if (type === 'image') {
    return JSON.stringify(
      { originalContentUrl: '', previewImageUrl: '' },
      null,
      2,
    )
  }
  if (type === 'image_link') {
    return JSON.stringify(
      { originalContentUrl: '', previewImageUrl: '', linkUrl: '' },
      null,
      2,
    )
  }
  if (type === 'flex') {
    return JSON.stringify(
      {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [{ type: 'text', text: 'Hello' }],
        },
      },
      null,
      2,
    )
  }
  if (type === 'carousel') {
    return JSON.stringify([{ imageUrl: '', title: '', description: '', buttons: [] }])
  }
  return ''
}

// ─── Image field editor sub-component ──────────────────────────────────────────

function ImageFields({
  content,
  onChange,
  withLink,
}: {
  content: string
  onChange: (c: string) => void
  withLink?: boolean
}) {
  let parsed = { originalContentUrl: '', previewImageUrl: '', linkUrl: '' }
  try {
    parsed = { ...parsed, ...JSON.parse(content) }
  } catch {
    // ignore
  }

  const update = (field: string, value: string) => {
    const next = { ...parsed, [field]: value }
    onChange(JSON.stringify(next))
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">画像URL</label>
        <input
          type="text"
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="https://example.com/image.jpg"
          value={parsed.originalContentUrl}
          onChange={(e) => update('originalContentUrl', e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">
          プレビュー画像URL（省略可）
        </label>
        <input
          type="text"
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="https://example.com/preview.jpg（空欄なら画像URLと同じ）"
          value={parsed.previewImageUrl}
          onChange={(e) => update('previewImageUrl', e.target.value)}
        />
      </div>
      {withLink && (
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">
            タップ時リンクURL
          </label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="https://example.com/landing-page"
            value={parsed.linkUrl}
            onChange={(e) => update('linkUrl', e.target.value)}
          />
        </div>
      )}
      {/* Image preview */}
      {parsed.originalContentUrl && (
        <div className="mt-1">
          <img
            src={parsed.originalContentUrl}
            alt="preview"
            className="max-h-32 rounded border border-gray-200"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Flex editor with template gallery ──────────────────────────────────────────

function FlexEditor({ content, onChange }: { content: string; onChange: (c: string) => void }) {
  const [showGallery, setShowGallery] = useState(false)

  if (showGallery) {
    return (
      <FlexTemplateGallery
        onSelect={(json) => {
          onChange(json)
          setShowGallery(false)
        }}
        onClose={() => setShowGallery(false)}
      />
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowGallery(true)}
          className="text-xs text-green-600 hover:text-green-700 px-2 py-1 rounded hover:bg-green-50 transition-colors"
        >
          テンプレートから作成
        </button>
      </div>
      <textarea
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
        rows={6}
        placeholder="Flex Message JSON"
        value={content}
        onChange={(e) => onChange(e.target.value)}
      />
      {(() => {
        try {
          JSON.parse(content)
          return (
            <div className="border border-gray-200 rounded p-2 bg-white">
              <p className="text-xs text-gray-400 mb-1">プレビュー</p>
              <FlexPreviewComponent content={content} />
            </div>
          )
        } catch {
          return null
        }
      })()}
    </div>
  )
}

// ─── Single message item editor ────────────────────────────────────────────────

function MessageItemEditor({
  item,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  item: MessageItem
  index: number
  total: number
  onChange: (item: MessageItem) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const handleTypeChange = (newType: MessageType) => {
    if (newType === item.type) return
    onChange({ type: newType, content: defaultContent(newType) })
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">
            吹き出し {index + 1}
          </span>
          <select
            className="border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
            value={item.type}
            onChange={(e) => handleTypeChange(e.target.value as MessageType)}
          >
            {messageTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="px-1.5 py-0.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30"
            title="上へ"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="px-1.5 py-0.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30"
            title="下へ"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={total <= 1}
            className="px-1.5 py-0.5 text-xs text-red-400 hover:text-red-600 disabled:opacity-30"
            title="削除"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content editor based on type */}
      {item.type === 'text' && (
        <textarea
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
          rows={3}
          placeholder="メッセージを入力..."
          value={item.content}
          onChange={(e) => onChange({ ...item, content: e.target.value })}
        />
      )}

      {item.type === 'image' && (
        <ImageFields
          content={item.content}
          onChange={(c) => onChange({ ...item, content: c })}
        />
      )}

      {item.type === 'image_link' && (
        <ImageFields
          content={item.content}
          onChange={(c) => onChange({ ...item, content: c })}
          withLink
        />
      )}

      {item.type === 'flex' && (
        <FlexEditor
          content={item.content}
          onChange={(c) => onChange({ ...item, content: c })}
        />
      )}

      {item.type === 'carousel' && (
        <CarouselBuilder
          content={item.content}
          onChange={(c) => onChange({ ...item, content: c })}
        />
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

interface MultiMessageEditorProps {
  messages: MessageItem[]
  onChange: (messages: MessageItem[]) => void
}

export default function MultiMessageEditor({
  messages,
  onChange,
}: MultiMessageEditorProps) {
  const handleItemChange = (index: number, item: MessageItem) => {
    const next = [...messages]
    next[index] = item
    onChange(next)
  }

  const handleRemove = (index: number) => {
    if (messages.length <= 1) return
    onChange(messages.filter((_, i) => i !== index))
  }

  const handleMoveUp = (index: number) => {
    if (index === 0) return
    const next = [...messages]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    onChange(next)
  }

  const handleMoveDown = (index: number) => {
    if (index === messages.length - 1) return
    const next = [...messages]
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
    onChange(next)
  }

  const handleAdd = () => {
    if (messages.length >= 5) return
    onChange([...messages, { type: 'text', content: '' }])
  }

  return (
    <div className="space-y-3">
      {messages.map((item, i) => (
        <MessageItemEditor
          key={i}
          item={item}
          index={i}
          total={messages.length}
          onChange={(updated) => handleItemChange(i, updated)}
          onRemove={() => handleRemove(i)}
          onMoveUp={() => handleMoveUp(i)}
          onMoveDown={() => handleMoveDown(i)}
        />
      ))}

      {messages.length < 5 && (
        <button
          type="button"
          onClick={handleAdd}
          className="w-full py-2 text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg hover:border-green-400 hover:text-green-600 transition-colors"
        >
          + 吹き出しを追加（{messages.length}/5）
        </button>
      )}
    </div>
  )
}
