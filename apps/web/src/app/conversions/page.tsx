'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { ConversionPoint } from '@line-crm/shared'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'
import { Table } from '@cloudflare/kumo/components/table'

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
  const [deleteTarget, setDeleteTarget] = useState<ConversionPoint | null>(null)
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

  const handleDelete = async () => {
    if (!deleteTarget) return
    await api.conversions.deletePoint(deleteTarget.id)
    setDeleteTarget(null)
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
            type="button"
            variant="primary"
            onClick={() => setShowCreate(!showCreate)}
          >
            {showCreate ? 'キャンセル' : '+ CVポイント作成'}
          </Button>
        }
      />

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CV名</label>
              <Input
                label="CV名"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="購入完了"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">イベントタイプ</label>
              <Select
                label="イベントタイプ"
                value={form.eventType}
                onValueChange={(value) => setForm({ ...form, eventType: value ?? '' })}
                placeholder="選択..."
                items={Object.fromEntries(eventTypes.map((type) => [type.value, type.label]))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">金額 (任意)</label>
              <Input
                label="金額 (任意)"
                type="number"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>
          <Button
            type="submit"
            variant="primary"
            className="mt-4"
          >
            作成
          </Button>
        </form>
      )}

      {/* Report Cards */}
      {report.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
          {report.map((r) => (
            <LayerCard key={r.conversionPointId} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">{r.conversionPointName}</p>
                <Badge variant="info">{r.eventType}</Badge>
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
            </LayerCard>
          ))}
        </div>
      )}

      {/* Points Table */}
      {loading ? (
        <LayerCard className="p-8"><Loader className="mx-auto" /></LayerCard>
      ) : points.length === 0 ? (
        <Empty title="CVポイントがまだありません" description="作成するとイベント別の成果を計測できます。" />
      ) : (
        <LayerCard className="overflow-x-auto p-0">
          <Table className="min-w-[640px]">
            <Table.Header>
              <Table.Row>
                <Table.Head>CV名</Table.Head>
                <Table.Head>イベントタイプ</Table.Head>
                <Table.Head>金額</Table.Head>
                <Table.Head>作成日</Table.Head>
                <Table.Head className="text-right">操作</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {points.map((point) => (
                <Table.Row key={point.id}>
                  <Table.Cell className="font-medium text-kumo-strong">{point.name}</Table.Cell>
                  <Table.Cell><Badge variant="info">{point.eventType}</Badge></Table.Cell>
                  <Table.Cell className="text-kumo-subtle">
                    {point.value !== null ? `¥${point.value.toLocaleString()}` : '-'}
                  </Table.Cell>
                  <Table.Cell className="text-kumo-subtle">{new Date(point.createdAt).toLocaleDateString('ja-JP')}</Table.Cell>
                  <Table.Cell className="text-right"><Button type="button" size="xs" variant="destructive" onClick={() => setDeleteTarget(point)}>削除</Button></Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </LayerCard>
      )}
      <Dialog.Root role="alertdialog" open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <Dialog>
          <Dialog.Title>CVポイントを削除しますか？</Dialog.Title>
          <Dialog.Description className="mt-2">「{deleteTarget?.name}」を削除します。この操作は取り消せません。</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>キャンセル</Button>
            <Button type="button" variant="destructive" onClick={handleDelete}>削除</Button>
          </div>
        </Dialog>
      </Dialog.Root>
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
