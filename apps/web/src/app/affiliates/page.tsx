'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Header from '@/components/layout/header'
import { api, type AffiliateOffer, type ConversionApprovalItem } from '@/lib/api'
import type { Tag, Scenario, LineAccount } from '@line-crm/shared'

const WORKER_BASE = process.env.NEXT_PUBLIC_API_URL
if (!WORKER_BASE) {
  throw new Error('NEXT_PUBLIC_API_URL is not set. Build cannot proceed.')
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AffiliateItem {
  id: string
  name: string
  code: string
  commissionRate: number
  isActive: boolean
  createdAt: string
  friendId: string | null
}

interface AffiliateReportRow {
  affiliateId: string
  affiliateName: string
  code: string
  commissionRate: number
  totalClicks: number
  totalConversions: number
  totalRevenue: number
  linkCount: number
  friendAdds: number
}

/** Merged for the list view */
interface AffiliateListRow extends AffiliateItem {
  totalClicks: number
  totalConversions: number
  totalRevenue: number
  estimatedCommission: number
  linkCount: number
  friendAdds: number
}

interface AffiliateLink {
  id: string
  affiliate_id: string
  ref_code: string
  label: string | null
  line_account_id: string | null
  is_active: number
  created_at: string
  click_count: number
  offer_id: string | null
  offer_name: string | null
}

interface ReportV2 {
  affiliateId: string
  affiliateName: string
  code: string
  commissionRate: number
  clicks: number
  linkClicks: number
  friendAdds: number
  conversions: number
  conversionsPending: number
  conversionsApproved: number
  conversionsRejected: number
  conversionsByPoint: Array<{ conversionPointId: string; name: string; count: number; value: number }>
  revenue: number
  estimatedCommission: number
  confirmedReward: number
  byOffer: Array<{
    offerId: string
    offerName: string
    rewardAmount: number
    conversionsApproved: number
    conversionsPending: number
    confirmedReward: number
  }>
  duplicateFlags: Array<{ friendId: string; identityKey: string }>
}

interface JourneySummary {
  friendId: string
  displayName: string | null
  addedAt: string
  refCode: string | null
  touchCount: number
  formCount: number
  conversionCount: number
  lastEventAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function formatYen(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

const JOURNEY_PAGE_SIZE = 30

// ─────────────────────────────────────────────────────────────────────────────
// Page shell — 3 tabs (affiliators / offers / approvals) with ?tab= persistence
// ─────────────────────────────────────────────────────────────────────────────

type PageTab = 'affiliates' | 'offers' | 'approvals'

const TAB_LABELS: Record<PageTab, string> = {
  affiliates: 'アフィリエイター',
  offers: '案件',
  approvals: '成果承認',
}

function parseTab(raw: string | null): PageTab {
  return raw === 'offers' || raw === 'approvals' ? raw : 'affiliates'
}

export default function AffiliatesPage() {
  // ?tab= で選択タブを保持（リロードで維持）。chats ページの unanswered=1 と同じく
  // useSearchParams (Suspense 要) を避け、window.location + history.replaceState で扱う。
  const [tab, setTab] = useState<PageTab>(() => {
    if (typeof window === 'undefined') return 'affiliates'
    return parseTab(new URLSearchParams(window.location.search).get('tab'))
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const urlParams = new URLSearchParams(window.location.search)
    if (tab === 'affiliates') urlParams.delete('tab')
    else urlParams.set('tab', tab)
    const qs = urlParams.toString()
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    window.history.replaceState(null, '', url)
  }, [tab])

  return (
    <div>
      <Header
        title="アフィリエイト"
        description="アフィリエイター管理・ASP 案件・成果承認"
      />

      {/* Tab switcher */}
      <div className="mb-4 flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {(['affiliates', 'offers', 'approvals'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
              tab === t
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'affiliates' && <AffiliatorsTab />}
      {tab === 'offers' && <OffersTab />}
      {tab === 'approvals' && <ApprovalQueue />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Affiliators tab — list + inline detail panel
// ─────────────────────────────────────────────────────────────────────────────

function AffiliatorsTab() {
  // ── list ───────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<AffiliateListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── selected affiliate (detail panel) ─────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [report, setReport] = useState<ReportV2 | null>(null)
  const [links, setLinks] = useState<AffiliateLink[]>([])

  // ── create modal ────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false)

  // ── journeys (cursor-paginated) ────────────────────────────────────────────
  const [journeys, setJourneys] = useState<JourneySummary[]>([])
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [journeyMore, setJourneyMore] = useState(false)
  const [journeyLoadingMore, setJourneyLoadingMore] = useState(false)
  const journeyCursorRef = useRef<{ beforeAt: string; beforeId: string } | null>(null)

  // ── load list ──────────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [affiliatesRes, reportRes] = await Promise.all([
        api.affiliates.list(),
        api.affiliates.allReport(),
      ])
      if (!affiliatesRes.success) throw new Error('affiliates fetch failed')
      if (!reportRes.success) throw new Error('report fetch failed')

      const affiliates = affiliatesRes.data as unknown as AffiliateItem[]
      const reportMap = new Map<string, AffiliateReportRow>()
      for (const r of (reportRes.data as unknown as AffiliateReportRow[])) {
        reportMap.set(r.affiliateId, r)
      }

      const merged: AffiliateListRow[] = affiliates.map((a) => {
        const rep = reportMap.get(a.id)
        return {
          ...a,
          totalClicks: rep?.totalClicks ?? 0,
          totalConversions: rep?.totalConversions ?? 0,
          totalRevenue: rep?.totalRevenue ?? 0,
          estimatedCommission: ((rep?.totalRevenue ?? 0) * a.commissionRate) / 100,
          linkCount: rep?.linkCount ?? 0,
          friendAdds: rep?.friendAdds ?? 0,
        }
      })
      setRows(merged)
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みエラー')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadList() }, [loadList])

  // ── load detail (report v2 + links) ────────────────────────────────────────
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setReport(null)
    setLinks([])
    setJourneys([])
    setJourneyMore(false)
    journeyCursorRef.current = null
    try {
      const [reportRes, linksRes] = await Promise.all([
        api.affiliates.reportV2(id),
        api.affiliates.links(id),
      ])
      if (reportRes.success) setReport(reportRes.data as unknown as ReportV2)
      if (linksRes.success) setLinks(linksRes.data as unknown as AffiliateLink[])
    } catch { /* silent — detail is optional */ }
    setDetailLoading(false)
  }, [])

  // ── load first page of journeys ────────────────────────────────────────────
  const loadJourneys = useCallback(async (id: string) => {
    setJourneyLoading(true)
    try {
      const res = await api.affiliates.journeys(id, { limit: JOURNEY_PAGE_SIZE })
      if (res.success) {
        setJourneys(res.data)
        journeyCursorRef.current = res.nextCursor ?? null
        setJourneyMore(Boolean(res.nextCursor))
      }
    } catch { /* silent */ }
    setJourneyLoading(false)
  }, [])

  // ── load more journeys ─────────────────────────────────────────────────────
  const loadMoreJourneys = useCallback(async (id: string) => {
    if (journeyLoadingMore) return
    const cursor = journeyCursorRef.current
    if (!cursor) { setJourneyMore(false); return }
    setJourneyLoadingMore(true)
    try {
      const res = await api.affiliates.journeys(id, {
        limit: JOURNEY_PAGE_SIZE,
        beforeAt: cursor.beforeAt,
        beforeId: cursor.beforeId,
      })
      if (res.success) {
        setJourneys((prev) => {
          const seen = new Set(prev.map((j) => j.friendId))
          return [...prev, ...res.data.filter((j) => !seen.has(j.friendId))]
        })
        journeyCursorRef.current = res.nextCursor ?? null
        setJourneyMore(Boolean(res.nextCursor))
      }
    } catch { /* silent */ }
    setJourneyLoadingMore(false)
  }, [journeyLoadingMore])

  // ── row click ──────────────────────────────────────────────────────────────
  const handleRowClick = useCallback((id: string) => {
    if (selectedId === id) {
      setSelectedId(null)
      return
    }
    setSelectedId(id)
    void loadDetail(id)
    void loadJourneys(id)
  }, [selectedId, loadDetail, loadJourneys])

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
        >
          + 新規作成
        </button>
      </div>

      {createOpen && (
        <CreateAffiliateModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => { void loadList() }}
        />
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          読み込み中...
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          アフィリエイターがまだ登録されていません
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">名前</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">コード</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">友だち紐付</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">リンク数</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">クリック</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">友だち追加</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">CV</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">売上</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">参考報酬</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">率</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((row) => {
                const isExpanded = selectedId === row.id
                return (
                  <>
                    <tr
                      key={row.id}
                      className={`cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      onClick={() => handleRowClick(row.id)}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{row.name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-blue-600">{row.code}</td>
                      <td className="px-4 py-3 text-sm text-center">
                        {row.friendId
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">あり</span>
                          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">なし</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700">{row.linkCount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700">{row.totalClicks.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-blue-600">{row.friendAdds.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">{row.totalConversions.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700">{formatYen(row.totalRevenue)}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-emerald-600">{formatYen(row.estimatedCommission)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500">{row.commissionRate}%</td>
                      <td className="px-4 py-3 text-sm">
                        {row.isActive
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">有効</span>
                          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">無効</span>
                        }
                      </td>
                    </tr>

                    {/* Detail expansion row */}
                    {isExpanded && (
                      <tr key={`${row.id}-detail`}>
                        <td colSpan={11} className="px-6 py-5 bg-blue-50 border-t border-blue-100">
                          {detailLoading ? (
                            <p className="text-sm text-gray-400">読み込み中...</p>
                          ) : (
                            <div className="space-y-6">

                              {/* v2 summary cards */}
                              {report && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                  <div className="bg-white rounded-lg p-4 border border-gray-100">
                                    <p className="text-xs text-gray-500">クリック (ref_tracking)</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{report.clicks.toLocaleString()}</p>
                                  </div>
                                  <div className="bg-white rounded-lg p-4 border border-gray-100">
                                    <p className="text-xs text-gray-500">友だち追加</p>
                                    <p className="text-2xl font-bold text-blue-600 mt-1">{report.friendAdds.toLocaleString()}</p>
                                  </div>
                                  <div className="bg-white rounded-lg p-4 border border-gray-100">
                                    <p className="text-xs text-gray-500">CV 件数（却下除く）</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{report.conversions.toLocaleString()}</p>
                                  </div>
                                  <div className="bg-white rounded-lg p-4 border border-emerald-100 bg-emerald-50/40">
                                    <p className="text-xs text-gray-500">確定報酬</p>
                                    <p className="text-2xl font-bold text-emerald-600 mt-1">{formatYen(report.confirmedReward)}</p>
                                    <p className="text-[11px] text-gray-500 mt-1">
                                      承認済み {report.conversionsApproved.toLocaleString()}件 / 審査中 {report.conversionsPending.toLocaleString()}件 / 却下 {report.conversionsRejected.toLocaleString()}件
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* Per-offer breakdown */}
                              {report && report.byOffer.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">案件別内訳</p>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-[560px] text-sm">
                                      <thead>
                                        <tr className="text-left text-xs text-gray-400">
                                          <th className="pb-1 pr-4">案件</th>
                                          <th className="pb-1 pr-4 text-right">報酬単価</th>
                                          <th className="pb-1 pr-4 text-right">承認済み</th>
                                          <th className="pb-1 pr-4 text-right">審査中</th>
                                          <th className="pb-1 text-right">確定報酬</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {report.byOffer.map((o) => (
                                          <tr key={o.offerId}>
                                            <td className="py-1 pr-4 text-gray-700">{o.offerName}</td>
                                            <td className="py-1 pr-4 text-right text-gray-500">{formatYen(o.rewardAmount)}</td>
                                            <td className="py-1 pr-4 text-right font-semibold text-gray-900">{o.conversionsApproved.toLocaleString()}</td>
                                            <td className="py-1 pr-4 text-right text-gray-500">{o.conversionsPending.toLocaleString()}</td>
                                            <td className="py-1 text-right font-semibold text-emerald-600">{formatYen(o.confirmedReward)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* Duplicate flags */}
                              {report && report.duplicateFlags.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-amber-700 uppercase mb-2">
                                    重複 identity_key 検出 ({report.duplicateFlags.length} 件)
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {report.duplicateFlags.map((f) => (
                                      <span
                                        key={f.friendId}
                                        className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800"
                                      >
                                        ⚠ {f.friendId.slice(0, 8)}…
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* CV by point */}
                              {report && report.conversionsByPoint.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">CV ポイント別内訳</p>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-[400px] text-sm">
                                      <thead>
                                        <tr className="text-left text-xs text-gray-400">
                                          <th className="pb-1 pr-4">ポイント名</th>
                                          <th className="pb-1 pr-4 text-right">件数</th>
                                          <th className="pb-1 text-right">売上合計</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {report.conversionsByPoint.map((p) => (
                                          <tr key={p.conversionPointId}>
                                            <td className="py-1 pr-4 text-gray-700">{p.name}</td>
                                            <td className="py-1 pr-4 text-right font-semibold text-gray-900">{p.count}</td>
                                            <td className="py-1 text-right text-gray-700">{formatYen(p.value)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* Links table */}
                              {links.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                                    リンク別クリック ({links.length} 本)
                                  </p>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-[560px] text-sm">
                                      <thead>
                                        <tr className="text-left text-xs text-gray-400">
                                          <th className="pb-1 pr-4">ref_code</th>
                                          <th className="pb-1 pr-4">ラベル</th>
                                          <th className="pb-1 pr-4">案件</th>
                                          <th className="pb-1 pr-4 text-right">クリック</th>
                                          <th className="pb-1">状態</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {links.map((link) => (
                                          <tr key={link.id}>
                                            <td className="py-1 pr-4 font-mono text-blue-600">{link.ref_code}</td>
                                            <td className="py-1 pr-4 text-gray-600">{link.label ?? '—'}</td>
                                            <td className="py-1 pr-4">
                                              {link.offer_name ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                                  {link.offer_name}
                                                </span>
                                              ) : <span className="text-gray-400">—</span>}
                                            </td>
                                            <td className="py-1 pr-4 text-right font-semibold text-gray-900">{link.click_count.toLocaleString()}</td>
                                            <td className="py-1">
                                              {link.is_active
                                                ? <span className="text-xs text-green-600">有効</span>
                                                : <span className="text-xs text-gray-400">無効</span>
                                              }
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* Journeys */}
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                                  帰属ジャーニー ({journeys.length} 件{journeyMore ? '+' : ''})
                                </p>
                                {journeyLoading ? (
                                  <p className="text-sm text-gray-400">読み込み中...</p>
                                ) : journeys.length === 0 ? (
                                  <p className="text-sm text-gray-400">帰属された友だちがまだいません</p>
                                ) : (
                                  <>
                                    <div className="overflow-x-auto">
                                      <table className="min-w-[640px] text-sm">
                                        <thead>
                                          <tr className="text-left text-xs text-gray-400">
                                            <th className="pb-1 pr-4">友だち</th>
                                            <th className="pb-1 pr-4">追加日</th>
                                            <th className="pb-1 pr-4">ref_code</th>
                                            <th className="pb-1 pr-4 text-right">タッチ</th>
                                            <th className="pb-1 pr-4 text-right">フォーム</th>
                                            <th className="pb-1 pr-4 text-right">CV</th>
                                            <th className="pb-1">最終行動</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                          {journeys.map((j) => {
                                            const isDup = report?.duplicateFlags.some((f) => f.friendId === j.friendId)
                                            return (
                                              <tr key={j.friendId} className={isDup ? 'bg-amber-50' : ''}>
                                                <td className="py-1 pr-4 text-gray-800">
                                                  {isDup && <span className="mr-1">⚠</span>}
                                                  {j.displayName ?? <span className="text-gray-400 italic">不明</span>}
                                                </td>
                                                <td className="py-1 pr-4 text-gray-500">{formatDate(j.addedAt)}</td>
                                                <td className="py-1 pr-4 font-mono text-xs text-blue-500">{j.refCode ?? '—'}</td>
                                                <td className="py-1 pr-4 text-right text-gray-700">{j.touchCount}</td>
                                                <td className="py-1 pr-4 text-right text-gray-700">{j.formCount}</td>
                                                <td className="py-1 pr-4 text-right font-semibold text-gray-900">{j.conversionCount}</td>
                                                <td className="py-1 text-gray-400 text-xs">{formatDate(j.lastEventAt)}</td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                    {journeyMore && (
                                      <button
                                        onClick={() => { void loadMoreJourneys(row.id) }}
                                        disabled={journeyLoadingMore}
                                        className="mt-3 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100 disabled:opacity-50 rounded-md border border-blue-200"
                                      >
                                        {journeyLoadingMore ? '読み込み中...' : 'さらに読み込む'}
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>

                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Create modal — friend-bound affiliate with an auto-generated (random) code
// ─────────────────────────────────────────────────────────────────────────────

interface FriendOption {
  id: string
  displayName: string | null
}

function CreateAffiliateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<FriendOption[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<FriendOption | null>(null)
  const [commissionRate, setCommissionRate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Incremental friend search (debounced). Skipped once a friend is selected.
  useEffect(() => {
    if (selected) return
    const term = search.trim()
    if (!term) { setOptions([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await api.friends.list({ search: term, limit: 20, includeTags: false })
        if (cancelled) return
        if (res.success) {
          setOptions(
            res.data.items.map((f) => ({ id: f.id, displayName: f.displayName })),
          )
        }
      } catch { /* silent */ }
      finally { if (!cancelled) setSearching(false) }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search, selected])

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    setFormError(null)
    if (!selected) {
      setFormError('友だちを選択してください')
      return
    }
    const rate = commissionRate.trim() === '' ? undefined : Number(commissionRate)
    if (rate !== undefined && (Number.isNaN(rate) || rate < 0)) {
      setFormError('報酬率は0以上の数値で入力してください')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.affiliates.create({
        friendId: selected.id,
        commissionRate: rate,
      })
      if (!res.success) {
        // 409 → friend already an affiliate; surface the server message.
        setFormError(res.error ?? '作成に失敗しました')
        setSubmitting(false)
        return
      }
      onCreated()
      if (res.link?.url) {
        setIssuedUrl(res.link.url)
      } else {
        onClose()
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, selected, commissionRate, onCreated, onClose])

  const handleCopy = useCallback(async () => {
    if (!issuedUrl) return
    try {
      await navigator.clipboard.writeText(issuedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable — user can select manually */ }
  }, [issuedUrl])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-lg shadow-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          アフィリエイター新規作成
        </h2>

        {issuedUrl ? (
          // ── Success state: show issued link with a copy button ────────────
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              アフィリエイターを作成し、初期リンクを発行しました。
            </p>
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={issuedUrl}
                className="flex-1 px-3 py-2 text-sm font-mono border border-gray-300 rounded-md bg-gray-50 text-gray-800"
              />
              <button
                onClick={() => { void handleCopy() }}
                className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md whitespace-nowrap"
              >
                {copied ? 'コピー済' : 'コピー'}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
              >
                閉じる
              </button>
            </div>
          </div>
        ) : (
          // ── Form state ────────────────────────────────────────────────────
          <div className="space-y-4">
            {/* Friend selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                LINE 友だち <span className="text-red-500">*</span>
              </label>
              {selected ? (
                <div className="flex items-center justify-between px-3 py-2 border border-gray-300 rounded-md bg-gray-50">
                  <span className="text-sm text-gray-800">
                    {selected.displayName ?? <span className="text-gray-400 italic">不明</span>}
                  </span>
                  <button
                    onClick={() => { setSelected(null); setSearch('') }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    変更
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="名前で検索..."
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  {(searching || options.length > 0) && search.trim() && (
                    <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
                      {searching ? (
                        <div className="px-3 py-2 text-sm text-gray-400">検索中...</div>
                      ) : options.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-400">該当なし</div>
                      ) : (
                        options.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => { setSelected(f); setOptions([]) }}
                            className="block w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-blue-50"
                          >
                            {f.displayName ?? <span className="text-gray-400 italic">不明</span>}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Commission rate */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                報酬率（%・省略可）
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(e.target.value)}
                  placeholder="例: 10"
                  className="w-full px-3 py-2 pr-8 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
              </div>
            </div>

            {/* Random-code notice */}
            <p className="text-xs text-gray-500">
              アフィリコードは推測されないよう自動でランダム生成されます（手入力は不要）。
            </p>

            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
              >
                キャンセル
              </button>
              <button
                onClick={() => { void handleSubmit() }}
                disabled={submitting || !selected}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md"
              >
                {submitting ? '作成中...' : '作成'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Offers / approvals — moved from the former /affiliate-offers page
// ─────────────────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatYenNullable(n: number | null): string {
  if (n === null) return '—'
  return `¥${Math.round(n).toLocaleString('ja-JP')}`
}

// ── Offer form modal ─────────────────────────────────────────────────────────

interface OfferFormProps {
  initial?: AffiliateOffer | null
  accounts: LineAccount[]
  tags: Tag[]
  scenarios: (Scenario & { stepCount?: number })[]
  onClose: () => void
  onSaved: () => void
}

function OfferFormModal({ initial, accounts, tags, scenarios, onClose, onSaved }: OfferFormProps) {
  const isEdit = Boolean(initial)
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [rewardAmount, setRewardAmount] = useState(
    initial?.rewardAmount != null ? String(initial.rewardAmount) : '',
  )
  const [rewardMiles, setRewardMiles] = useState(
    initial?.rewardMiles != null ? String(initial.rewardMiles) : '',
  )
  const [lineAccountId, setLineAccountId] = useState(initial?.lineAccountId ?? '')
  const [tagId, setTagId] = useState(initial?.tagId ?? '')
  const [scenarioId, setScenarioId] = useState(initial?.scenarioId ?? '')
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    setFormError(null)
    if (!name.trim()) {
      setFormError('案件名は必須です')
      return
    }
    const reward =
      rewardAmount.trim() === ''
        ? undefined
        : Number(rewardAmount)
    if (reward !== undefined && (!Number.isInteger(reward) || reward < 0)) {
      setFormError('報酬額は0以上の整数で入力してください')
      return
    }
    const miles = rewardMiles.trim() === '' ? undefined : Number(rewardMiles)
    if (miles !== undefined && (!Number.isInteger(miles) || miles < 0)) {
      setFormError('付与マイルは0以上の整数で入力してください')
      return
    }

    setSubmitting(true)
    try {
      if (isEdit && initial) {
        const res = await api.affiliateOffers.update(initial.id, {
          name: name.trim(),
          description: description.trim() || null,
          rewardAmount: reward,
          rewardMiles: miles,
          lineAccountId: lineAccountId || null,
          tagId: tagId || null,
          scenarioId: scenarioId || null,
          isActive,
        })
        if (!res.success) {
          setFormError('更新に失敗しました')
          setSubmitting(false)
          return
        }
      } else {
        const res = await api.affiliateOffers.create({
          name: name.trim(),
          description: description.trim() || null,
          rewardAmount: reward,
          rewardMiles: miles,
          lineAccountId: lineAccountId || null,
          tagId: tagId || null,
          scenarioId: scenarioId || null,
        })
        if (!res.success) {
          setFormError('作成に失敗しました')
          setSubmitting(false)
          return
        }
      }
      onSaved()
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, name, description, rewardAmount, rewardMiles, lineAccountId, tagId, scenarioId, isActive, isEdit, initial, onSaved, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? '案件を編集' : '案件を新規作成'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="閉じる"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              案件名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 無料体験申込"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">説明</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="案件の説明（任意）"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">報酬額（円）</label>
            <input
              type="number"
              min="0"
              step="1"
              value={rewardAmount}
              onChange={(e) => setRewardAmount(e.target.value)}
              placeholder="例: 3000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">成果承認時の付与マイル</label>
            <input
              type="number"
              min="0"
              step="1"
              value={rewardMiles}
              onChange={(e) => setRewardMiles(e.target.value)}
              placeholder="例: 500"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-[11px] text-gray-400">承認された紹介1件ごとに紹介者へ付与します</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">誘導 LINE アカウント</label>
            <select
              value={lineAccountId}
              onChange={(e) => setLineAccountId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 選択しない —</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">タグ</label>
            <select
              value={tagId}
              onChange={(e) => setTagId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 選択しない —</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">シナリオ</label>
            <select
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 選択しない —</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {isEdit && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  isActive ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isActive ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-sm text-gray-700">{isActive ? '有効' : '無効'}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            onClick={() => { void handleSubmit() }}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
          >
            {submitting ? '保存中...' : isEdit ? '更新' : '作成'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Approval queue ───────────────────────────────────────────────────────────

type ApprovalStatus = 'pending' | 'approved' | 'rejected'

function ApprovalQueue() {
  const [status, setStatus] = useState<ApprovalStatus>('pending')
  const [items, setItems] = useState<ConversionApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actioning, setActioning] = useState<string | null>(null)

  const loadItems = useCallback(async (s: ApprovalStatus) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.conversionApprovals.list({ status: s, limit: 200 })
      if (res.success) {
        setItems(res.data)
      } else {
        setError('読み込みに失敗しました')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みエラー')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadItems(status) }, [status, loadItems])

  const handleApprove = useCallback(async (eventId: string) => {
    if (actioning) return
    setActioning(eventId)
    setError(null)
    try {
      const res = await api.conversionApprovals.approve(eventId)
      if (res.success) {
        setItems((prev) => prev.filter((i) => i.eventId !== eventId))
      } else {
        setError(res.error ?? '承認に失敗しました')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '承認に失敗しました')
    }
    setActioning(null)
  }, [actioning])

  const handleReject = useCallback(async (eventId: string) => {
    if (actioning) return
    setActioning(eventId)
    setError(null)
    try {
      const res = await api.conversionApprovals.reject(eventId)
      if (res.success) {
        setItems((prev) => prev.filter((i) => i.eventId !== eventId))
      } else {
        setError(res.error ?? '却下に失敗しました')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '却下に失敗しました')
    }
    setActioning(null)
  }, [actioning])

  return (
    <div>
      {/* Status filter tabs */}
      <div className="flex gap-2 mb-4">
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-4 py-1.5 text-sm rounded-full font-medium transition-colors ${
              status === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === 'pending' ? '承認待ち' : s === 'approved' ? '承認済み' : '却下済み'}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          読み込み中...
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          {status === 'pending' ? '承認待ちの成果がありません' : `${status === 'approved' ? '承認済み' : '却下済み'}の成果がありません`}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">日時</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">友だち</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">アフィリエイター</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">案件</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CV ポイント</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">金額</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">フラグ</th>
                {status === 'pending' && (
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.map((item) => (
                <tr key={item.eventId} className={item.duplicateFlag ? 'bg-amber-50' : ''}>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {formatDateTime(item.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {item.friendName ?? <span className="text-gray-400 italic">不明</span>}
                    <span className="block text-xs font-mono text-gray-400">{item.friendId.slice(0, 8)}…</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {item.affiliateName ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {item.offerName ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        {item.offerName}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {item.conversionPointName ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                    {formatYenNullable(item.value)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {item.duplicateFlag ? (
                      <span className="text-amber-500 text-base" title="重複 identity_key 検出">⚠</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  {status === 'pending' && (
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => { void handleApprove(item.eventId) }}
                          disabled={actioning === item.eventId}
                          className="px-3 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md"
                        >
                          承認
                        </button>
                        <button
                          onClick={() => { void handleReject(item.eventId) }}
                          disabled={actioning === item.eventId}
                          className="px-3 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-md"
                        >
                          却下
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Offers list ──────────────────────────────────────────────────────────────

function OffersList({
  offers,
  accounts,
  tags,
  scenarios,
  loading,
  error,
  onEdit,
  onRefresh,
}: {
  offers: AffiliateOffer[]
  accounts: LineAccount[]
  tags: Tag[]
  scenarios: (Scenario & { stepCount?: number })[]
  loading: boolean
  error: string | null
  onEdit: (offer: AffiliateOffer) => void
  onRefresh: () => void
}) {
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]))
  const tagMap = new Map(tags.map((t) => [t.id, t.name]))
  const scenarioMap = new Map(scenarios.map((s) => [s.id, s.name]))

  return (
    <div>
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          読み込み中...
        </div>
      ) : offers.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          案件がまだ登録されていません。右上の「+ 新規案件」から作成してください。
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">案件名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">説明</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">報酬額</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">付与マイル</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">LINEアカウント</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">タグ</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">シナリオ</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">状態</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {offers.map((offer) => (
                <tr key={offer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{offer.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate">
                    {offer.description ?? <span className="italic text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-emerald-700">
                    {formatYenNullable(offer.rewardAmount)}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-amber-600">
                    {offer.rewardMiles.toLocaleString()} mile
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {offer.lineAccountId ? accountMap.get(offer.lineAccountId) ?? offer.lineAccountId : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {offer.tagId ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        {tagMap.get(offer.tagId) ?? offer.tagId}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {offer.scenarioId ? scenarioMap.get(offer.scenarioId) ?? offer.scenarioId : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {offer.isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">有効</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">無効</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => onEdit(offer)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      編集
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 text-right">
        <button
          onClick={onRefresh}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          更新
        </button>
      </div>
    </div>
  )
}

// ── Offers tab — list + create/edit modal wiring ─────────────────────────────

function OffersTab() {
  const [offers, setOffers] = useState<AffiliateOffer[]>([])
  const [offersLoading, setOffersLoading] = useState(true)
  const [offersError, setOffersError] = useState<string | null>(null)

  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<(Scenario & { stepCount?: number })[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AffiliateOffer | null>(null)

  const loadOffers = useCallback(async () => {
    setOffersLoading(true)
    setOffersError(null)
    try {
      const res = await api.affiliateOffers.list()
      if (res.success) {
        setOffers(res.data)
      } else {
        setOffersError('案件の読み込みに失敗しました')
      }
    } catch (e) {
      setOffersError(e instanceof Error ? e.message : '読み込みエラー')
    } finally {
      setOffersLoading(false)
    }
  }, [])

  const loadOptions = useCallback(async () => {
    try {
      const [accountsRes, tagsRes, scenariosRes] = await Promise.all([
        api.lineAccounts.list(),
        api.tags.list(),
        api.scenarios.list(),
      ])
      if (accountsRes.success) setAccounts(accountsRes.data as unknown as LineAccount[])
      if (tagsRes.success) setTags(tagsRes.data as unknown as Tag[])
      if (scenariosRes.success) setScenarios(scenariosRes.data as unknown as (Scenario & { stepCount?: number })[])
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    void loadOffers()
    void loadOptions()
  }, [loadOffers, loadOptions])

  const handleOpenCreate = () => {
    setEditTarget(null)
    setFormOpen(true)
  }

  const handleEdit = (offer: AffiliateOffer) => {
    setEditTarget(offer)
    setFormOpen(true)
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          onClick={handleOpenCreate}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
        >
          + 新規案件
        </button>
      </div>

      <OffersList
        offers={offers}
        accounts={accounts}
        tags={tags}
        scenarios={scenarios}
        loading={offersLoading}
        error={offersError}
        onEdit={handleEdit}
        onRefresh={loadOffers}
      />

      {formOpen && (
        <OfferFormModal
          initial={editTarget}
          accounts={accounts}
          tags={tags}
          scenarios={scenarios}
          onClose={() => setFormOpen(false)}
          onSaved={() => { void loadOffers() }}
        />
      )}
    </div>
  )
}
