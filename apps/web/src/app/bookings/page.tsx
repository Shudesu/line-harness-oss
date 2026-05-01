'use client'
import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'

const SCHEDULER_URL = 'https://fixx-scheduler.vercel.app'

interface Booking {
  id: string
  guest_name: string
  guest_phone: string
  start_time: string
  end_time: string
  google_meet_url: string | null
  line_user_id: string | null
  status: string
  meeting_notes: string | null
  staff_name: string | null
}

type StatusFilter = 'all' | 'confirmed' | 'completed' | 'no_show' | 'cancelled'

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  confirmed: { label: '確定', bg: 'bg-blue-100', text: 'text-blue-700' },
  completed: { label: '面談済', bg: 'bg-green-100', text: 'text-green-700' },
  no_show: { label: 'バックれ', bg: 'bg-red-100', text: 'text-red-700' },
  cancelled: { label: 'キャンセル', bg: 'bg-gray-100', text: 'text-gray-500' },
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', {
    month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  })
}

function isToday(iso: string): boolean {
  const tokyoDate = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
  const tokyoNow = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
  return tokyoDate === tokyoNow
}

function isTomorrow(iso: string): boolean {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tokyoDate = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
  const tokyoTomorrow = tomorrow.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
  return tokyoDate === tokyoTomorrow
}

function isPast(iso: string): boolean {
  return new Date(iso) < new Date()
}

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('confirmed')
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [notesText, setNotesText] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const apiKey = typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') || '' : ''

  // line_user_id → chatId のマッピング
  const [chatByLineUserId, setChatByLineUserId] = useState<Record<string, string>>({})

  useEffect(() => {
    const loadChatMap = async () => {
      try {
        const [friendsRes, chatsRes] = await Promise.all([
          api.friends.list({ limit: '2000' }),
          api.chats.list({}),
        ])
        const friendIdToLineUserId: Record<string, string> = {}
        if (friendsRes.success) {
          const items = (friendsRes.data as unknown as { items: { id: string; lineUserId: string }[] }).items
          for (const f of items) {
            friendIdToLineUserId[f.id] = f.lineUserId
          }
        }
        const map: Record<string, string> = {}
        if (chatsRes.success) {
          const chatList = chatsRes.data as unknown as { id: string; friendId: string }[]
          for (const c of chatList) {
            const lineUserId = friendIdToLineUserId[c.friendId]
            if (lineUserId) map[lineUserId] = c.id
          }
        }
        setChatByLineUserId(map)
      } catch { /* silent */ }
    }
    loadChatMap()
  }, [])

  const fetchBookings = useCallback(() => {
    setLoading(true)
    fetch(`${SCHEDULER_URL}/api/bookings/list?all=true`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Error: ${res.status}`)
        const data = await res.json()
        setBookings(data.data ?? [])
        setError(null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [apiKey])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  const updateStatus = async (id: string, status: string) => {
    if (status === 'cancelled' && !confirm('この予約をキャンセルしますか？\nGoogleカレンダーのイベントも削除されます。')) return
    if (status === 'no_show' && !confirm('バックれとしてマークしますか？')) return

    setActionLoading(id)
    try {
      const res = await fetch(`${SCHEDULER_URL}/api/bookings/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Failed')
      fetchBookings()
    } catch {
      alert('更新に失敗しました')
    } finally {
      setActionLoading(null)
    }
  }

  const saveNotes = async (id: string) => {
    setActionLoading(id)
    try {
      const res = await fetch(`${SCHEDULER_URL}/api/bookings/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_notes: notesText }),
      })
      if (!res.ok) throw new Error('Failed')
      setEditingNotes(null)
      fetchBookings()
    } catch {
      alert('保存に失敗しました')
    } finally {
      setActionLoading(null)
    }
  }

  const filtered = bookings.filter(b => filter === 'all' || b.status === filter)

  const counts = bookings.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1
    return acc
  }, {})

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <Header title="面談予約管理" description="予約の確認・ステータス変更・メモ記録" />

      <main className="flex-1 p-4 lg:p-8">
        {/* フィルタータブ */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {([
            { key: 'all', label: '全て', count: bookings.length },
            { key: 'confirmed', label: '確定', count: counts.confirmed || 0 },
            { key: 'completed', label: '面談済', count: counts.completed || 0 },
            { key: 'no_show', label: 'バックれ', count: counts.no_show || 0 },
            { key: 'cancelled', label: 'キャンセル', count: counts.cancelled || 0 },
          ] as { key: StatusFilter; label: string; count: number }[]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === tab.key
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label} <span className="ml-1 opacity-60">{tab.count}</span>
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gray-200 border-t-green-500 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-600 rounded-lg p-4 text-sm">{error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p>該当する予約はありません</p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((b) => {
              const today = isToday(b.start_time)
              const tomorrow = isTomorrow(b.start_time)
              const past = isPast(b.end_time)
              const statusCfg = STATUS_CONFIG[b.status] || STATUS_CONFIG.confirmed
              const isActioning = actionLoading === b.id
              const isEditingThis = editingNotes === b.id

              return (
                <div
                  key={b.id}
                  className={`bg-white rounded-xl border p-4 transition-shadow hover:shadow-md ${
                    today && b.status === 'confirmed' ? 'border-green-300 ring-1 ring-green-100' :
                    b.status === 'cancelled' ? 'border-gray-200 opacity-60' :
                    b.status === 'no_show' ? 'border-red-200' :
                    'border-gray-200'
                  }`}
                >
                  {/* ヘッダー: 日時 + ステータスバッジ */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${statusCfg.bg} ${statusCfg.text}`}>
                          {statusCfg.label}
                        </span>
                        {today && b.status === 'confirmed' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">
                            TODAY
                          </span>
                        )}
                        {tomorrow && b.status === 'confirmed' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700">
                            明日
                          </span>
                        )}
                        <span className="text-sm font-semibold text-gray-900">
                          {formatDate(b.start_time)}
                        </span>
                        <span className="text-sm text-gray-500">
                          {formatTime(b.start_time)} - {formatTime(b.end_time)}
                        </span>
                      </div>

                      {/* ゲスト情報 */}
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <span className="text-sm font-medium text-gray-700">{b.guest_name}</span>
                        </div>
                        {/* チャットリンク */}
                        {b.line_user_id && chatByLineUserId[b.line_user_id] && (
                          <a
                            href={`/chats?open=${chatByLineUserId[b.line_user_id]}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white transition-colors hover:opacity-80"
                            style={{ backgroundColor: '#06C755' }}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            チャット
                          </a>
                        )}
                        <div className="flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          <span className="text-sm text-gray-500">{b.guest_phone}</span>
                        </div>
                        {b.staff_name && (
                          <span className="text-xs text-gray-500">
                            担当: <span className="font-medium text-gray-700">{b.staff_name}</span>
                          </span>
                        )}
                      </div>

                      {/* 面談メモ表示 */}
                      {b.meeting_notes && !isEditingThis && (
                        <div className="mt-3 p-2.5 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-1.5 mb-1">
                            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            <span className="text-xs font-medium text-gray-500">面談メモ</span>
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{b.meeting_notes}</p>
                        </div>
                      )}

                      {/* メモ編集 */}
                      {isEditingThis && (
                        <div className="mt-3">
                          <textarea
                            value={notesText}
                            onChange={(e) => setNotesText(e.target.value)}
                            placeholder="面談メモを入力（エリア、資格、意欲、特記事項など）"
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                          />
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => saveNotes(b.id)}
                              disabled={isActioning}
                              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            >
                              {isActioning ? '保存中...' : '保存'}
                            </button>
                            <button
                              onClick={() => setEditingNotes(null)}
                              className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200"
                            >
                              キャンセル
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 右側: Meetリンク */}
                    {b.google_meet_url && b.status === 'confirmed' && (
                      <a
                        href={b.google_meet_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                        style={{ backgroundColor: '#1A73E8' }}
                      >
                        Meet
                      </a>
                    )}
                  </div>

                  {/* アクションボタン */}
                  {b.status !== 'cancelled' && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                      {/* メモボタン */}
                      {!isEditingThis && (
                        <button
                          onClick={() => { setEditingNotes(b.id); setNotesText(b.meeting_notes || '') }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          メモ
                        </button>
                      )}

                      {/* confirmed の場合: 完了・バックれ・キャンセル */}
                      {b.status === 'confirmed' && past && (
                        <>
                          <button
                            onClick={() => updateStatus(b.id, 'completed')}
                            disabled={isActioning}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            面談済
                          </button>
                          <button
                            onClick={() => updateStatus(b.id, 'no_show')}
                            disabled={isActioning}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                          >
                            バックれ
                          </button>
                        </>
                      )}

                      {b.status === 'confirmed' && (
                        <button
                          onClick={() => updateStatus(b.id, 'cancelled')}
                          disabled={isActioning}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 ml-auto"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          キャンセル
                        </button>
                      )}

                      {/* completed/no_show → confirmed に戻す */}
                      {(b.status === 'completed' || b.status === 'no_show') && (
                        <button
                          onClick={() => updateStatus(b.id, 'confirmed')}
                          disabled={isActioning}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 ml-auto"
                        >
                          元に戻す
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <p className="text-xs text-gray-400 mt-4 text-center">
            {filtered.length}件表示 / 全{bookings.length}件
          </p>
        )}
      </main>
    </div>
  )
}
