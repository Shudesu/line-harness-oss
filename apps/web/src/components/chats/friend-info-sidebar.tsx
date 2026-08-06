'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

interface FriendDetail {
  id: string
  displayName: string | null
  pictureUrl: string | null
  isFollowing: boolean
  metadata: Record<string, unknown>
  refCode: string | null
  createdAt: string
  tags: Array<{ id: string; name: string; color: string }>
  formSubmissions: Array<{
    id: string
    formId: string
    formName: string
    fields: Array<{ name: string; label: string }>
    data: Record<string, unknown>
    createdAt: string
  }>
}

interface ChatStatusInfo {
  status: 'unread' | 'in_progress' | 'resolved' | null
  notes: string | null
}

interface Props {
  friendId: string | null
  /** 親 (ChatDetail) が持っている chat 側の情報 — status / notes */
  chatStatus?: ChatStatusInfo
  /** 担当者名 (ChatDetail で operatorId → name 変換済を渡す想定) */
  operatorName?: string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const statusLabels: Record<NonNullable<ChatStatusInfo['status']>, { label: string; className: string }> = {
  unread: { label: '未対応', className: 'bg-red-100 text-red-700' },
  in_progress: { label: '対応中', className: 'bg-yellow-100 text-yellow-700' },
  resolved: { label: '解決済', className: 'bg-green-100 text-green-700' },
}

/** Render a metadata value safely as text. Objects/arrays → JSON, primitives → as-is. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') return value || '-'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '[unparseable]'
  }
}

export default function FriendInfoSidebar({ friendId, chatStatus, operatorName }: Props) {
  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!friendId) {
      setFriend(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api.friends.get(friendId).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setFriend(res.data as unknown as FriendDetail)
      } else {
        setError((res as { error?: string }).error ?? '友だち情報を取得できませんでした')
      }
    }).catch((err) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [friendId])

  // リッチメニュー — loading / error / data を区別して、null=未設定 を取得失敗と
  // 混同しないようにする。Codex review (P3) の指摘で導入。
  type RichMenuState =
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'data'; id: string | null; name: string | null; isDefault: boolean }
  const [richMenu, setRichMenu] = useState<RichMenuState>({ kind: 'loading' })

  useEffect(() => {
    if (!friendId) {
      setRichMenu({ kind: 'loading' })
      return
    }
    let cancelled = false
    setRichMenu({ kind: 'loading' })
    api.friends.richMenu(friendId).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setRichMenu({ kind: 'data', ...res.data })
      } else {
        setRichMenu({ kind: 'error' })
      }
    }).catch(() => {
      if (cancelled) return
      setRichMenu({ kind: 'error' })
    })
    return () => { cancelled = true }
  }, [friendId])

  if (!friendId) return null

  return (
    <div className="w-full lg:w-80 lg:flex-shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">友だち詳細</h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-3 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-32" />
                <div className="h-2 bg-gray-100 rounded w-20" />
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-red-600">{error}</div>
        ) : friend ? (
          <div className="divide-y divide-gray-100">
            {/* Profile Header */}
            <div className="p-4 flex items-start gap-3">
              {friend.pictureUrl ? (
                <img src={friend.pictureUrl} alt="" className="w-12 h-12 rounded-full flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                  <span className="text-gray-500 text-base">{(friend.displayName || '?').charAt(0)}</span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 truncate">{friend.displayName || '名前なし'}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  登録日: {formatDate(friend.createdAt)}
                </p>
                {!friend.isFollowing && (
                  <span className="inline-block mt-1 px-1.5 py-0 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                    ブロック済
                  </span>
                )}
              </div>
            </div>

            {/* Status / Operator */}
            {(chatStatus?.status || operatorName) && (
              <div className="p-4 space-y-2">
                {chatStatus?.status && statusLabels[chatStatus.status] && (
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-500">対応状況</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusLabels[chatStatus.status].className}`}>
                      {statusLabels[chatStatus.status].label}
                    </span>
                  </div>
                )}
                {operatorName && (
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-500">担当者</span>
                    <span className="text-xs text-gray-700">{operatorName}</span>
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            {chatStatus?.notes && (
              <div className="p-4">
                <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">個別メモ</h4>
                <p className="text-xs text-gray-700 whitespace-pre-wrap break-words">{chatStatus.notes}</p>
              </div>
            )}

            {/* Tags */}
            <div className="p-4">
              <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">タグ</h4>
              {friend.tags.length === 0 ? (
                <p className="text-[11px] text-gray-400 italic">タグなし</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {friend.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium"
                      style={{
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Rich Menu */}
            <div className="p-4">
              <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">リッチメニュー</h4>
              {richMenu.kind === 'loading' ? (
                <p className="text-[11px] text-gray-400 italic">読み込み中...</p>
              ) : richMenu.kind === 'error' ? (
                <p className="text-[11px] text-red-500 italic">取得に失敗しました</p>
              ) : richMenu.id === null ? (
                <p className="text-[11px] text-gray-400 italic">未設定</p>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-700">{richMenu.name ?? '(名前なし)'}</span>
                  {richMenu.isDefault && (
                    <span className="px-1.5 py-0 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                      デフォルト
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Metadata custom fields */}
            {friend.metadata && Object.keys(friend.metadata).length > 0 && (
              <div className="p-4">
                <h4 className="text-[11px] font-medium text-gray-500 mb-2">友だち情報</h4>
                <dl className="space-y-2 text-xs">
                  {Object.entries(friend.metadata).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-[10px] text-gray-400 uppercase tracking-wide">{key}</dt>
                      <dd className="text-gray-700 mt-0.5 whitespace-pre-wrap break-words">{renderValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Form answers — save_to_metadata の設定に関係なく回答履歴を表示 */}
            {friend.formSubmissions?.length > 0 && (
              <div className="p-4">
                <h4 className="text-[11px] font-medium text-gray-500 mb-2">フォーム回答</h4>
                <div className="space-y-3">
                  {friend.formSubmissions.map((submission) => {
                    const labels = new Map(submission.fields.map((field) => [field.name, field.label]))
                    const answers = Object.entries(submission.data).filter(([key]) => !key.startsWith('_'))
                    return (
                      <div key={submission.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium text-gray-700 break-words">{submission.formName}</p>
                          <time className="shrink-0 text-[10px] text-gray-400">
                            {formatDate(submission.createdAt)}
                          </time>
                        </div>
                        <dl className="mt-2 space-y-2">
                          {answers.map(([key, value]) => (
                            <div key={key}>
                              <dt className="text-[10px] text-gray-400">{labels.get(key) ?? key}</dt>
                              <dd className="mt-0.5 whitespace-pre-wrap break-words text-xs text-gray-700">
                                {renderValue(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/*
              編集導線は将来追加予定 (現在の /friends は ?id= をハンドルしないため、
              リンク先が機能しない → Codex review で指摘済 → 代わりに削除。
              編集 UI が出来たら復活させる)。
            */}
          </div>
        ) : (
          <div className="p-4 text-xs text-gray-400">友だち情報がありません</div>
        )}
      </div>
    </div>
  )
}
