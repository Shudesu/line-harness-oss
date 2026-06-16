'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { LineMessageBubble } from '@/components/line-message-bubble'

type ChatMessage = {
  id: string
  content: string
  messageType?: string | null
  direction?: 'incoming' | 'outgoing' | null
  senderType?: string | null
  createdAt?: string | null
}

type ChatDetail = {
  id: string
  friendId: string
  friendName: string
  friendPictureUrl?: string | null
  messages: ChatMessage[]
}

type RawChatDetail = Partial<ChatDetail> & {
  messages?: Array<Partial<ChatMessage>>
}

type ReservationChatModalProps = {
  friendId: string | null
  customerName: string
  onClose: () => void
}

function normalizeChat(raw: unknown, fallbackFriendId: string, fallbackName: string): ChatDetail {
  const item = raw as RawChatDetail
  return {
    id: String(item.id ?? fallbackFriendId),
    friendId: String(item.friendId ?? fallbackFriendId),
    friendName: String(item.friendName ?? (fallbackName || '名前未登録')),
    friendPictureUrl: item.friendPictureUrl ?? null,
    messages: Array.isArray(item.messages)
      ? item.messages.map((message, index) => ({
          id: String(message.id ?? `message-${index}`),
          content: String(message.content ?? ''),
          messageType: typeof message.messageType === 'string' ? message.messageType : null,
          direction: message.direction === 'incoming' || message.direction === 'outgoing' ? message.direction : null,
          senderType: typeof message.senderType === 'string' ? message.senderType : null,
          createdAt: typeof message.createdAt === 'string' ? message.createdAt : null,
        }))
      : [],
  }
}

export function ReservationChatModal({ friendId, customerName, onClose }: ReservationChatModalProps) {
  const [chat, setChat] = useState<ChatDetail | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadChat = useCallback(async () => {
    if (!friendId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.chats.get(friendId, { recentDays: 30 })
      if (!res.success) throw new Error(res.error || 'チャット履歴の取得に失敗しました')
      setChat(normalizeChat(res.data, friendId, customerName))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'チャット履歴の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [customerName, friendId])

  useEffect(() => {
    void loadChat()
  }, [loadChat])

  const send = async () => {
    if (!friendId || !message.trim()) return
    if (!confirm(`${customerName || 'お客様'} にLINEで送信します。よいですか？`)) return
    setSaving(true)
    setError('')
    try {
      const res = await api.chats.send(friendId, { content: message.trim(), messageType: 'text' })
      if (!res.success) throw new Error(res.error || '送信に失敗しました')
      setMessage('')
      await loadChat()
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:mx-auto sm:max-w-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-green-700">LINEチャット</p>
            <h3 className="truncate text-lg font-bold text-gray-900">{chat?.friendName || customerName || 'お客様'}</h3>
            <p className="mt-1 text-xs text-gray-500">
              予約詳細から開いています。送信するとLINEのPush APIで相手に届きます。
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700">
            閉じる
          </button>
        </div>

        {!friendId ? (
          <div className="p-4 text-sm text-gray-600">
            この予約はLINE友だちと紐づいていないため、チャットを開始できません。Web予約や外部予約の場合は、LINE連携後に利用できます。
          </div>
        ) : (
          <>
            {error && <div className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <div className="h-[52vh] space-y-2 overflow-y-auto bg-[#7494C0] p-4">
              {loading ? (
                <p className="text-sm text-white/80">チャット履歴を読み込み中...</p>
              ) : !chat || chat.messages.length === 0 ? (
                <p className="rounded-lg bg-white/90 p-3 text-sm text-gray-600">直近30日のチャット履歴はありません。</p>
              ) : (
                chat.messages.map((item) => (
                  <LineMessageBubble
                    key={item.id}
                    content={item.content}
                    messageType={item.messageType}
                    outgoing={item.direction === 'outgoing' || item.senderType === 'operator'}
                    createdAt={item.createdAt}
                    avatarUrl={chat.friendPictureUrl}
                    maxWidth={360}
                  />
                ))
              )}
            </div>
            <div className="border-t border-gray-100 p-4">
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={3}
                className="w-full rounded-xl border border-gray-300 p-3 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
                placeholder="返信内容を入力"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">誤送信防止のため、送信前に確認ダイアログを出します。</p>
                <button
                  type="button"
                  disabled={saving || !message.trim()}
                  onClick={send}
                  className="shrink-0 rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  LINEに送信
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
