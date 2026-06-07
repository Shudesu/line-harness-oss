'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { ConversionPoint } from '@line-crm/shared'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import {
  Button,
  Card,
  CardContent,
  Badge,
  Label,
  Input,
  Select,
  EmptyState,
} from '@/components/ui/primitives'

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
          <Button
            onClick={() => setShowCreate(!showCreate)}
            variant={showCreate ? 'outline' : 'primary'}
          >
            {showCreate ? 'キャンセル' : '+ CVポイント作成'}
          </Button>
        }
      />

      {showCreate && (
        <Card className="mb-6">
          <CardContent className="pt-5">
            <form onSubmit={handleCreate}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="cv-name">CV名</Label>
                  <Input
                    id="cv-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="購入完了"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="cv-event-type">イベントタイプ</Label>
                  <Select
                    id="cv-event-type"
                    value={form.eventType}
                    onChange={(e) => setForm({ ...form, eventType: e.target.value })}
                    required
                  >
                    <option value="">選択...</option>
                    {eventTypes.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="cv-value">金額 (任意)</Label>
                  <Input
                    id="cv-value"
                    type="number"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </div>
              <Button type="submit" className="mt-4">
                作成
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Report Cards */}
      {report.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
          {report.map((r) => (
            <Card key={r.conversionPointId}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">{r.conversionPointName}</p>
                  <Badge tone="info">{r.eventType}</Badge>
                </div>
                <div className="flex items-end gap-4">
                  <div>
                    <p className="text-2xl font-bold text-gray-900 tabular-nums">{r.totalCount}</p>
                    <p className="text-xs text-gray-400">CV数</p>
                  </div>
                  {r.totalValue > 0 && (
                    <div>
                      <p className="text-lg font-semibold text-green-600 tabular-nums">{r.totalValue.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY' })}</p>
                      <p className="text-xs text-gray-400">売上</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Points Table */}
      {loading ? (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-gray-400">読み込み中...</CardContent>
        </Card>
      ) : points.length === 0 ? (
        <EmptyState title="CVポイントがまだありません" />
      ) : (
        <Card className="overflow-x-auto">
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
                    <Badge tone="info">{point.eventType}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                    {point.value !== null ? `¥${point.value.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 tabular-nums">{new Date(point.createdAt).toLocaleDateString('ja-JP')}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      onClick={() => handleDelete(point.id)}
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      削除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
