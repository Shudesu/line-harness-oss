'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { api, type ApiBroadcast, type BroadcastInsight } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import FlexPreviewComponent from '@/components/flex-preview'
import TestSendSection from '@/components/broadcasts/test-send-section'
import ProgressBar from '@/components/broadcasts/progress-bar'
import SendConfirmDialog from '@/components/broadcasts/send-confirm-dialog'
import SegmentBuilder from '@/components/broadcasts/segment-builder'
import type { Tag } from '@line-crm/shared'

interface BroadcastDetailProps {
  broadcastId: string
}

export default function BroadcastDetail({ broadcastId }: BroadcastDetailProps) {
  const id = broadcastId
  const router = useRouter()
  const { selectedAccount, accounts } = useAccount()
  // 別 broadcast に SPA navigation した直後に、前の broadcast の async response が
  // 戻ってきて state を上書きする race を防ぐ。最新の id をここで保持し、.then 内で照合。
  // useEffect だと「新 render 完了 → effect 実行」の間に古い promise が resolve して
  // ref がまだ古い id のまま素通りする race があるため、render 中に同期更新する。
  const latestIdRef = useRef(id)
  latestIdRef.current = id
  const [broadcast, setBroadcast] = useState<ApiBroadcast | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [insight, setInsight] = useState<BroadcastInsight | null>(null)
  const [targetCount, setTargetCount] = useState<number | null>(null)
  const [perAccountBreakdown, setPerAccountBreakdown] = useState<Array<{ accountId: string; sendCount: number }> | null>(null)
  const [perAccountStats, setPerAccountStats] = useState<Array<{
    accountId: string;
    accountName: string;
    sent: number;
    uniqueImpression: number | null;
    uniqueClick: number | null;
  }> | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [showSegmentBuilder, setShowSegmentBuilder] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    // SPA routing で別 broadcast を開いた時に前回の breakdown / per-account stats / insight が
    // 残ると confirm modal や本文に別 broadcast の数値が表示されてしまう。draft データを
    // 取り直す前に全部クリアする。
    setPerAccountBreakdown(null)
    setPerAccountStats(null)
    setInsight(null)
    setTargetCount(null)
    try {
      const [res, tagsRes] = await Promise.all([
        api.broadcasts.get(id),
        api.tags.list(),
      ])
      if (res.success && res.data) {
        setBroadcast(res.data)
        if (res.data.totalCount > 0) {
          setTargetCount(res.data.totalCount)
        } else if (res.data.status === 'draft' || res.data.status === 'scheduled') {
          // draft 中は totalCount=0 のまま。送信前の対象人数を preview-count API で取りに行く。
          // confirm modal の「対象 X人」表示と「送信ボタンの (X人)」表示で使う。
          const requestId = id
          api.broadcasts.previewCount(id).then((r) => {
            // race guard: 古い id の応答は無視する。
            if (requestId !== latestIdRef.current) return
            if (r.success && r.data) {
              setTargetCount(r.data.count)
              if (r.data.perAccount) setPerAccountBreakdown(r.data.perAccount)
            }
          }).catch(() => {/* ignore — fall back to 0 */})
        }
      } else {
        setError('配信が見つかりません')
      }
      if (tagsRes.success) setTags(tagsRes.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // Poll progress while sending
  useEffect(() => {
    if (broadcast?.status !== 'sending') return
    const interval = setInterval(async () => {
      const res = await api.broadcasts.getProgress(id)
      if (res.success && res.data) {
        setBroadcast(prev => prev ? {
          ...prev,
          status: res.data!.status as ApiBroadcast['status'],
          totalCount: res.data!.totalCount,
          successCount: res.data!.successCount,
        } : prev)
        if (res.data.status === 'sent') {
          clearInterval(interval)
          load()
        }
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [broadcast?.status, id, load])

  // Load insight for sent broadcasts
  useEffect(() => {
    if (broadcast?.status !== 'sent') return
    api.broadcasts.getInsight(id).then(res => {
      if (res.success && res.data) setInsight(res.data)
    })
  }, [broadcast?.status, id])

  // Load per-account stats — 送信中 (進捗) + 送信完了 (実績) どちらでも取得する。
  // multi-account-dedup 以外の broadcast でも 1 行返るので最終的にテーブル表示するかは
  // 描画側で targetType チェックして判断する。送信完了時は LINE Insight が
  // each account token で fetch されるので時間かかる (3-5 秒/アカ) — fire-and-forget。
  useEffect(() => {
    const status = broadcast?.status
    if (status !== 'sending' && status !== 'sent') return

    let cancelled = false
    const requestId = id

    const fetchStats = () => {
      api.broadcasts.perAccountStats(requestId).then((r) => {
        // race guard: 別 broadcast に navigate していたら捨てる (response の遅延上書きを防止)
        if (cancelled || requestId !== latestIdRef.current) return
        if (r.success && r.data) setPerAccountStats(r.data)
      }).catch(() => {/* ignore */})
    }

    fetchStats()

    // 送信中は 3s ごとに再 fetch して per-account 進捗を更新する。
    // 既存の successCount poll と同期させる目的。送信完了 (sent) では再 fetch 不要。
    if (status === 'sending') {
      const interval = setInterval(fetchStats, 3000)
      return () => {
        cancelled = true
        clearInterval(interval)
      }
    }
    return () => { cancelled = true }
  }, [broadcast?.status, id])

  const handleSend = async () => {
    setShowConfirm(false)
    setSending(true)
    try {
      await api.broadcasts.send(id)
      load()
    } catch {
      setError('送信に失敗しました')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div>
        <Header title="配信詳細" />
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="h-40 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  if (!broadcast) {
    return (
      <div>
        <Header title="配信詳細" />
        <p className="text-gray-500">{error || '配信が見つかりません'}</p>
      </div>
    )
  }

  const raw = broadcast as unknown as Record<string, unknown>
  const accountId = raw.lineAccountId as string | null

  return (
    <div>
      <Header
        title={broadcast.title}
        action={
          <button
            onClick={() => router.push('/broadcasts', { scroll: false })}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
          >
            ← 一覧に戻る
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Left: Preview */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">メッセージプレビュー</h3>
          {broadcast.messageType === 'flex' ? (
            <FlexPreviewComponent content={broadcast.messageContent} maxWidth={300} />
          ) : broadcast.messageType === 'image' ? (
            (() => {
              try {
                const img = JSON.parse(broadcast.messageContent)
                return <img src={img.originalContentUrl} alt="" className="max-w-[300px] rounded-lg" />
              } catch { return <p className="text-gray-400 text-sm">画像プレビュー不可</p> }
            })()
          ) : (
            <div className="bg-green-500 text-white rounded-2xl rounded-tl-sm px-4 py-3 max-w-[300px] text-sm whitespace-pre-wrap">
              {broadcast.messageContent}
            </div>
          )}
        </div>

        {/* Right: Settings */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">配信設定</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">種別</dt>
              <dd className="text-gray-900">{broadcast.messageType === 'text' ? 'テキスト' : broadcast.messageType === 'image' ? '画像' : 'Flex'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">対象</dt>
              <dd className="text-gray-900">
                {broadcast.targetType === 'all' ? '全員' : `タグ: ${broadcast.targetTagId ?? '-'}`}
                {targetCount != null && <span className="ml-1 text-gray-500">({targetCount.toLocaleString('ja-JP')}人)</span>}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">ステータス</dt>
              <dd>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  broadcast.status === 'draft' ? 'bg-gray-100 text-gray-600' :
                  broadcast.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                  broadcast.status === 'sending' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-green-100 text-green-700'
                }`}>
                  {broadcast.status === 'draft' ? '下書き' : broadcast.status === 'scheduled' ? '予約済み' : broadcast.status === 'sending' ? '送信中' : '送信完了'}
                </span>
              </dd>
            </div>
            {broadcast.scheduledAt && (
              <div className="flex justify-between">
                <dt className="text-gray-500">予約日時</dt>
                <dd className="text-gray-900">{new Date(broadcast.scheduledAt).toLocaleString('ja-JP')}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* Segment Builder */}
      {broadcast.status === 'draft' && (
        <div className="mb-4">
          {!showSegmentBuilder ? (
            <button
              onClick={() => setShowSegmentBuilder(true)}
              className="text-xs text-blue-500 hover:text-blue-700"
            >
              セグメント条件を編集
            </button>
          ) : (
            <SegmentBuilder
              tags={tags}
              accountId={accountId}
              onApply={async (conditions) => {
                await api.broadcasts.update(id, { segmentConditions: JSON.stringify(conditions) } as unknown as Parameters<typeof api.broadcasts.update>[1])
                setShowSegmentBuilder(false)
                load()
              }}
              onCancel={() => setShowSegmentBuilder(false)}
            />
          )}
        </div>
      )}

      {/* Link tracking toggle — 送信前 (draft/scheduled) に最終切替できる */}
      {(broadcast.status === 'draft' || broadcast.status === 'scheduled') && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={broadcast.trackLinks}
              onChange={async (e) => {
                const trackLinks = e.target.checked
                try {
                  await api.broadcasts.update(id, { trackLinks })
                  load()
                } catch { /* keep previous state on failure */ }
              }}
            />
            このメッセージでリンクを短縮する（クリック計測）
          </label>
          <p className="text-xs text-gray-500 mt-1 ml-6">
            OFFにすると本文のURLを計測用リンク（/t/…）に変換せず、そのまま送信します。
          </p>
        </div>
      )}

      {/* Test Send */}
      {broadcast.status === 'draft' && accountId && (
        <div className="mb-4">
          <TestSendSection broadcastId={id} accountId={accountId} disabled={false} />
        </div>
      )}

      {/* Send Progress */}
      {broadcast.status === 'sending' && (
        <div className="mb-4">
          <ProgressBar totalCount={broadcast.totalCount} successCount={broadcast.successCount} />
        </div>
      )}

      {/* Insight */}
      {broadcast.status === 'sent' && insight && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">配信実績</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-gray-900">{insight.delivered?.toLocaleString('ja-JP') ?? '-'}</p>
              <p className="text-xs text-gray-500">配信</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">{insight.uniqueImpression?.toLocaleString('ja-JP') ?? '-'}</p>
              <p className="text-xs text-gray-500">開封 {insight.openRate != null ? `(${(insight.openRate * 100).toFixed(1)}%)` : ''}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{insight.uniqueClick?.toLocaleString('ja-JP') ?? '-'}</p>
              <p className="text-xs text-gray-500">クリック {insight.clickRate != null ? `(${(insight.clickRate * 100).toFixed(1)}%)` : ''}</p>
            </div>
          </div>
        </div>
      )}

      {/* Per-account breakdown — multi-account-dedup の sending/sent 状態でのみ表示 */}
      {broadcast.targetType === 'multi-account-dedup' &&
        (broadcast.status === 'sending' || broadcast.status === 'sent') &&
        perAccountStats && perAccountStats.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">アカウント別内訳</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">アカウント</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500">送信</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500">開封</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500">クリック</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {perAccountStats.map((row) => {
                  // accounts list から displayName を引く (なければ row.accountName 内部ラベル)
                  const acc = accounts.find((a) => a.id === row.accountId)
                  const label = acc?.displayName ?? acc?.name ?? row.accountName
                  const openRate = row.uniqueImpression != null && row.sent > 0
                    ? (row.uniqueImpression / row.sent) * 100
                    : null
                  const clickRate = row.uniqueClick != null && row.sent > 0
                    ? (row.uniqueClick / row.sent) * 100
                    : null
                  return (
                    <tr key={row.accountId}>
                      <td className="px-2 py-2 text-gray-900">{label}</td>
                      <td className="px-2 py-2 text-right text-gray-900">{row.sent.toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right">
                        {row.uniqueImpression != null ? (
                          <span className="text-blue-600">
                            {row.uniqueImpression.toLocaleString('ja-JP')}
                            {openRate != null && (
                              <span className="ml-1 text-xs text-gray-400">({openRate.toFixed(1)}%)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {row.uniqueClick != null ? (
                          <span className="text-green-600">
                            {row.uniqueClick.toLocaleString('ja-JP')}
                            {clickRate != null && (
                              <span className="ml-1 text-xs text-gray-400">({clickRate.toFixed(1)}%)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {/* Totals row */}
                {(() => {
                  const totalSent = perAccountStats.reduce((s, r) => s + r.sent, 0)
                  // 開封・クリックの合計は **送信が発生したアカウントすべてで insight が揃った時** に表示する。
                  // 一部アカが insight 取得失敗 (null のまま) だと、null を 0 として加算してしまい
                  // 「partial を completed として見せる」誤誘導が起きるため、それを避ける。
                  // sent=0 のアカウント (configured but inactive 等) は判定から除外する — そうしないと
                  // 送信ゼロ理由で永遠に insight=null となり合計が「-」のまま固まる。
                  const sentRows = perAccountStats.filter((r) => r.sent > 0)
                  const allHaveImpr = sentRows.length > 0 && sentRows.every((r) => r.uniqueImpression != null)
                  const allHaveClick = sentRows.length > 0 && sentRows.every((r) => r.uniqueClick != null)
                  const totalImpr = allHaveImpr
                    ? perAccountStats.reduce((s, r) => s + (r.uniqueImpression ?? 0), 0)
                    : null
                  const totalClick = allHaveClick
                    ? perAccountStats.reduce((s, r) => s + (r.uniqueClick ?? 0), 0)
                    : null
                  const totalOpenRate = totalImpr != null && totalSent > 0 ? (totalImpr / totalSent) * 100 : null
                  const totalClickRate = totalClick != null && totalSent > 0 ? (totalClick / totalSent) * 100 : null
                  return (
                    <tr className="bg-gray-50 font-medium">
                      <td className="px-2 py-2 text-gray-900">合計</td>
                      <td className="px-2 py-2 text-right text-gray-900">{totalSent.toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right">
                        {totalImpr != null ? (
                          <span className="text-blue-600">
                            {totalImpr.toLocaleString('ja-JP')}
                            {totalOpenRate != null && (
                              <span className="ml-1 text-xs text-gray-400">({totalOpenRate.toFixed(1)}%)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {totalClick != null ? (
                          <span className="text-green-600">
                            {totalClick.toLocaleString('ja-JP')}
                            {totalClickRate != null && (
                              <span className="ml-1 text-xs text-gray-400">({totalClickRate.toFixed(1)}%)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>
          </div>
          {broadcast.status === 'sent' && perAccountStats.some((r) => r.sent > 0 && r.uniqueImpression == null) && (
            <p className="text-xs text-gray-400 mt-2">
              開封・クリックは LINE 側の集計反映に〜30分程度かかります。後でリロードしてください。
              <br />
              送信数が約 200 未満のアカウントは LINE の仕様で per-account 数値が出ません。
            </p>
          )}
        </div>
      )}

      {/* Send Button */}
      {broadcast.status === 'draft' && (
        <button
          onClick={() => setShowConfirm(true)}
          disabled={sending}
          className="w-full px-4 py-3 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: '#06C755' }}
        >
          {sending ? '送信中...' : `この配信を送信する${targetCount != null ? ` (${targetCount.toLocaleString('ja-JP')}人)` : ''}`}
        </button>
      )}

      {/* Confirm Dialog */}
      {showConfirm && (
        <SendConfirmDialog
          title={broadcast.title}
          targetCount={targetCount ?? broadcast.totalCount}
          accountName={selectedAccount?.displayName ?? selectedAccount?.name ?? '-'}
          isMultiAccount={broadcast.targetType === 'multi-account-dedup'}
          perAccount={
            broadcast.targetType === 'multi-account-dedup' && perAccountBreakdown
              ? perAccountBreakdown.map((p) => {
                  const acc = accounts.find((a) => a.id === p.accountId)
                  return {
                    accountId: p.accountId,
                    accountName: acc?.displayName ?? acc?.name ?? p.accountId,
                    sendCount: p.sendCount,
                  }
                })
              : undefined
          }
          onConfirm={handleSend}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}
