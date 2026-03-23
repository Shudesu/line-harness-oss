'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { ConversionPoint } from '@line-crm/shared'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'

interface ConversionReportItem {
  conversionPointId: string
  conversionPointName: string
  eventType: string
  totalCount: number
  totalValue: number
}

const ccPrompts = [
  {
    title: 'CV計測ポイント設定',
    prompt: `コンバージョン計測ポイントの設定をサポートしてください。
1. 主要なイベントタイプ（友だち追加、URLクリック、購入完了等）の説明
2. 各CVポイントに設定すべき金額の目安を提案
3. CVファネル全体の計測設計のベストプラクティス
手順を示してください。`,
  },
  {
    title: 'コンバージョン分析',
    prompt: `現在のコンバージョンデータを分析してください。
1. CVポイント別の発火回数と金額を集計
2. イベントタイプ別のCV率とトレンドを分析
3. CV率向上のための改善施策を提案
結果をレポートしてください。`,
  },
]

export default function ConversionsPage() {
  const [points, setPoints] = useState<ConversionPoint[]>([])
  const [report, setReport] = useState<ConversionReportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', eventType: '', value: '' })

  const load = async () => {
    setLoading(true)
    try {
      const [pointsRes, reportRes] = await Promise.allSettled([
        api.conversions.points(),
        api.conversions.report(),
      ])
      if (pointsRes.status === 'fulfilled' && pointsRes.value.success) setPoints(pointsRes.value.data)
      if (reportRes.status === 'fulfilled' && reportRes.value.success) setReport(reportRes.value.data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.eventType) return
    try {
      await api.conversions.createPoint({
        name: form.name,
        eventType: form.eventType,
        value: form.value ? Number(form.value) : null,
      })
      setForm({ name: '', eventType: '', value: '' })
      setShowCreate(false)
      load()
    } catch {}
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このCVポイントを削除しますか？')) return
    await api.conversions.deletePoint(id)
    load()
  }

  const eventTypes = [
    { value: 'friend_add', label: '友だち追加' },
    { value: 'rich_menu_tap', label: 'リッチメニュータップ' },
    { value: 'url_click', label: 'URLクリック' },
    { value: 'form_submit', label: 'フォーム送信' },
    { value: 'keyword_sent', label: 'キーワード送信' },
    { value: 'scenario_step', label: 'シナリオステップ到達' },
    { value: 'liff_view', label: 'LIFF閲覧' },
    { value: 'purchase', label: '購入完了' },
    { value: 'custom', label: 'カスタム' },
  ]

  return (
    <div>
      <Header
        title="コンバージョン計測"
        description="CVポイント定義 & レポート"
        action={
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 min-h-[44px] rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            {showCreate ? 'キャンセル' : '+ CVポイント作成'}
          </button>
        }
      />

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CV名</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="購入完了"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">イベントタイプ</label>
              <select
                value={form.eventType}
                onChange={(e) => setForm({ ...form, eventType: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                required
              >
                <option value="">選択...</option>
                {eventTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">金額 (任意)</label>
              <input
                type="number"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="0"
              />
            </div>
          </div>
          <button
            type="submit"
            className="mt-4 px-4 py-2 min-h-[44px] rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            作成
          </button>
        </form>
      )}

      {/* Report Cards */}
      {report.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
          {report.map((r) => (
            <div key={r.conversionPointId} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">{r.conversionPointName}</p>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{r.eventType}</span>
              </div>
              <div className="flex items-end gap-4">
                <div>
                  <p className="text-2xl font-bold text-gray-900">{r.totalCount}</p>
                  <p className="text-xs text-gray-400">CV数</p>
                </div>
                {r.totalValue > 0 && (
                  <div>
                    <p className="text-lg font-semibold text-green-600">{r.totalValue.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY' })}</p>
                    <p className="text-xs text-gray-400">売上</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Points Table */}
      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">読み込み中...</div>
      ) : points.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">CVポイントがまだありません</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CV名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">イベントタイプ</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">金額</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">作成日</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {points.map((point) => (
                <tr key={point.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{point.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{point.eventType}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {point.value !== null ? `¥${point.value.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(point.createdAt).toLocaleDateString('ja-JP')}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(point.id)}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
