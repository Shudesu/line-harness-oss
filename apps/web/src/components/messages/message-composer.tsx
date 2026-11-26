'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { InputArea } from '@cloudflare/kumo/components/input'
import { Select } from '@cloudflare/kumo/components/select'
import { messageItems, packMessageItems, MAX_MESSAGE_ITEMS, type MessageItem } from '@line-crm/shared'
import ImageUploader from '../shared/image-uploader'
import FlexPreview from '../flex-preview'

export function MessagePreview({ messageType, messageContent }: { messageType: string; messageContent: string }) {
  let items: MessageItem[]
  try { items = messageItems(messageType, messageContent) } catch { return <p role="alert">メッセージの形式を確認してください</p> }
  return <div className="space-y-2">{items.map((item, index) => <div key={index}>
    {item.messageType === 'flex' ? <FlexPreview content={item.messageContent} /> : item.messageType === 'image' ? (() => {
      try {
        const value = JSON.parse(item.messageContent)
        return <img src={value.previewImageUrl || value.originalContentUrl} alt={`${index + 1}つ目の画像`} className="max-w-full max-h-64 rounded-lg object-contain" />
      } catch { return <p className="text-sm text-gray-500">画像を選択してください</p> }
    })() : <p className="whitespace-pre-wrap break-words rounded-lg bg-green-50 px-3 py-2 text-gray-900">{item.messageContent}</p>}
  </div>)}</div>
}

export default function MessageComposer({ messageType, messageContent, onChange }: {
  messageType: string
  messageContent: string
  onChange: (message: MessageItem) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const ids = useRef<string[]>([])
  const latest = useRef<MessageItem[]>([])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  let items: MessageItem[]
  try { items = messageItems(messageType, messageContent) } catch { return <p role="alert">保存されているメッセージの形式が不正です。</p> }
  latest.current = items
  while (ids.current.length < items.length) ids.current.push(crypto.randomUUID())
  ids.current.length = items.length
  const update = (id: string, item: MessageItem, expectedType?: string) => {
    const index = ids.current.indexOf(id)
    if (!mounted.current || index < 0 || (expectedType && latest.current[index]?.messageType !== expectedType)) return
    onChange(packMessageItems(latest.current.map((previous, i) => i === index ? item : previous)))
  }
  const move = (index: number, delta: number) => {
    const next = [...items]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    ;[ids.current[index], ids.current[index + delta]] = [ids.current[index + delta], ids.current[index]]
    onChange(packMessageItems(next))
  }
  return <div className="space-y-3">
    <p className="text-xs text-gray-500">最大5つをまとめて送信できます。まとめた送信は受信者1人あたり1通としてカウントされます。</p>
    {items.map((item, index) => {
      const id = ids.current[index]
      return <div key={id} className="space-y-3 rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">メッセージ {index + 1} / {items.length}</span>
        <div className="flex gap-1">
          <Button type="button" size="xs" variant="ghost" aria-label={`${index + 1}つ目を上へ`} disabled={index === 0} onClick={() => move(index, -1)}>↑</Button>
          <Button type="button" size="xs" variant="ghost" aria-label={`${index + 1}つ目を下へ`} disabled={index === items.length - 1} onClick={() => move(index, 1)}>↓</Button>
          <Button type="button" size="xs" variant="ghost" disabled={items.length === 1} onClick={() => { ids.current.splice(index, 1); onChange(packMessageItems(items.filter((_, i) => i !== index))) }}>削除</Button>
        </div>
      </div>
      <Select label={`${index + 1}つ目のメッセージタイプ`} value={item.messageType} items={{ text: 'テキスト', image: '画像', flex: 'Flex' }} onValueChange={value => {
        const type = (value ?? 'text') as MessageItem['messageType']
        if (type === item.messageType) return
        setDrafts(previous => ({ ...previous, [`${id}:${item.messageType}`]: item.messageContent }))
        update(id, { messageType: type, messageContent: drafts[`${id}:${type}`] ?? '' })
      }} />
      {item.messageType === 'image' ? <ImageUploader mode="line-image" label="送信する画像" value={(() => {
        try { const image = JSON.parse(item.messageContent); return image.originalContentUrl ? { mode: 'line-image' as const, ...image } : null } catch { return null }
      })()} onChange={image => update(id, { ...item, messageContent: image?.mode === 'line-image' ? JSON.stringify({ originalContentUrl: image.originalContentUrl, previewImageUrl: image.previewImageUrl }) : '' }, 'image')} /> : <>
        <InputArea label={item.messageType === 'flex' ? 'Flex JSON' : 'メッセージ内容'} minRows={item.messageType === 'flex' ? 6 : 3} value={item.messageContent} placeholder={item.messageType === 'flex' ? '{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"text","text":"こんにちは"}]}}' : '送信するメッセージを入力'} onValueChange={content => update(id, { ...item, messageContent: content })} />
        {item.messageType === 'flex' && <>
          <p className="text-xs text-gray-500">LINE Flex Message Simulatorで作成したbubbleまたはcarouselのJSONを貼り付けてください。</p>
          {item.messageContent && <MessagePreview {...item} />}
        </>}
      </>}
    </div>})}
    <Button type="button" variant="secondary" disabled={items.length >= MAX_MESSAGE_ITEMS} onClick={() => onChange(packMessageItems([...items, { messageType: 'text', messageContent: '' }]))}>＋ メッセージを追加（{items.length}/5）</Button>
  </div>
}
