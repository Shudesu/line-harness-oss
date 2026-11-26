'use client'

import { useCallback, useEffect, useState } from 'react'
import { ApiError, fetchApi } from '@/lib/api'
import {
  SCHEDULED_STATUS_LABELS,
  formatJst,
  jstLocalInputToIso,
  toJstLocalInput,
  type ScheduledFriendMessage,
} from '@/lib/scheduled-messages'
import { Button } from '@cloudflare/kumo/components/button'
import { InputArea } from '@cloudflare/kumo/components/input'

/**
 * 友だち詳細の「予約送信」: 日時 (JST) と本文を指定して、この友だち1人にだけ
 * 後で送る。cron (5分ごと) が送信時刻以降に1回だけ送る。予約中のものは取り消せる。
 */
export default function ScheduledMessagesPanel({ friendId, isFollowing }: { friendId: string; isFollowing: boolean }) {
  const [items, setItems] = useState<ScheduledFriendMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [sendAtLocal, setSendAtLocal] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: ScheduledFriendMessage[] }>(
        `/api/friends/${friendId}/scheduled-messages`,
      )
      if (res.success) setItems(res.data)
    } catch {
      /* 一覧が取れなくても詳細の他の部分は表示する */
    }
    setLoading(false)
  }, [friendId])

  useEffect(() => {
    setOpen(false)
    setContent('')
    setError(null)
    setNotice(null)
    load()
  }, [load])

  const openForm = () => {
    // 初期値: 1時間後の正時 (JST)
    const d = new Date(Date.now() + 60 * 60 * 1000)
    d.setUTCMinutes(0, 0, 0)
    setSendAtLocal(toJstLocalInput(d))
    setOpen(true)
    setError(null)
    setNotice(null)
  }

  const submit = async () => {
    const sendAt = jstLocalInputToIso(sendAtLocal)
    if (!sendAt) return setError('日時を入れてください')
    if (Date.parse(sendAt) < Date.now() + 60_000) return setError('1分以上先の日時を選んでください')
    if (!content.trim()) return setError('本文を入れてください')
    setSaving(true)
    setError(null)
    try {
      await fetchApi(`/api/friends/${friendId}/scheduled-messages`, {
        method: 'POST',
        body: JSON.stringify({ content, sendAt, messageType: 'text' }),
      })
      setNotice(`${formatJst(sendAt)} に予約しました`)
      setContent('')
      setOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? '入力内容を確認してください（日時は1分後〜1年以内）' : '予約できませんでした')
    }
    setSaving(false)
  }

  const cancel = async (item: ScheduledFriendMessage) => {
    if (!window.confirm(`${formatJst(item.sendAt)} の予約送信を取り消しますか？`)) return
    try {
      await fetchApi(`/api/friends/${friendId}/scheduled-messages/${item.id}/cancel`, { method: 'POST' })
      setNotice('取り消しました')
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? 'すでに送信済み・送信中のため取り消せません' : '取り消せませんでした')
    }
    await load()
  }

  const pending = items.filter((i) => i.status === 'pending' || i.status === 'sending')
    .sort((a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt))
  const history = items.filter((i) => i.status !== 'pending' && i.status !== 'sending')

  return (
    <div className="p-4" data-testid="scheduled-messages-panel">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] font-medium text-gray-500">予約送信（この友だちだけ）</h4>
        {!open && (
          <Button size="xs" variant="secondary" onClick={openForm} disabled={!isFollowing}>
            ＋ 予約送信
          </Button>
        )}
      </div>
      {!isFollowing && <p className="text-[11px] text-gray-400 mb-2">ブロック中の友だちには予約できません</p>}

      {open && (
        <div className="mb-3 space-y-2 rounded border border-gray-200 p-2 bg-gray-50">
          <label className="block text-[11px] text-gray-500">
            送信日時（日本時間）
            <input
              type="datetime-local"
              value={sendAtLocal}
              onChange={(e) => setSendAtLocal(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-xs"
              aria-label="送信日時（日本時間）"
            />
          </label>
          <InputArea
            minRows={3}
            value={content}
            onValueChange={(value) => setContent(value)}
            placeholder="送る本文（テキスト）"
            aria-label="予約送信の本文"
          />
          <p className="text-[10px] text-gray-400">5分ごとの自動処理で送るため、指定時刻から最大5分ほど遅れることがあります。</p>
          <div className="flex justify-end gap-2">
            <Button size="xs" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>やめる</Button>
            <Button size="xs" variant="primary" onClick={submit} disabled={saving} loading={saving}>
              {saving ? '予約中...' : '予約する'}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 mb-2">{error}</p>}
      {notice && <p className="text-[11px] text-green-700 mb-2">{notice}</p>}

      {loading ? (
        <p className="text-[11px] text-gray-400">読み込み中...</p>
      ) : pending.length === 0 ? (
        <p className="text-[11px] text-gray-400">予約中のメッセージはありません</p>
      ) : (
        <ul className="space-y-2">
          {pending.map((item) => (
            <li key={item.id} className="rounded border border-blue-100 bg-blue-50/40 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-gray-800">{formatJst(item.sendAt)}</span>
                <span className={`px-1.5 rounded text-[10px] ${SCHEDULED_STATUS_LABELS[item.status].className}`}>
                  {SCHEDULED_STATUS_LABELS[item.status].label}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-700 line-clamp-4">{item.content}</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] text-gray-400">{item.createdBy ? `作成: ${item.createdBy}` : ''}</span>
                {item.status === 'pending' && (
                  <Button size="xs" variant="ghost" onClick={() => cancel(item)}>取り消す</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {history.length > 0 && (
        <div className="mt-2">
          <button type="button" className="text-[11px] text-gray-500 underline" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? '履歴を閉じる' : `送信済み・取消・失敗の履歴（${history.length}）`}
          </button>
          {showHistory && (
            <ul className="mt-1 space-y-1">
              {history.map((item) => (
                <li key={item.id} className="text-[11px] text-gray-600">
                  <span className={`mr-1 px-1 rounded text-[10px] ${SCHEDULED_STATUS_LABELS[item.status].className}`}>
                    {SCHEDULED_STATUS_LABELS[item.status].label}
                  </span>
                  {formatJst(item.sendAt)} {item.content.slice(0, 30)}{item.content.length > 30 ? '…' : ''}
                  {item.status === 'failed' && item.error ? <span className="block text-red-500">{item.error}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
