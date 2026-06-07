'use client'

/**
 * Phase 1-H: fingerprint 同意 / 保存期限ポリシー管理画面
 */

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from '@/components/ui/primitives'

interface FingerprintPolicyData {
  consent: boolean
  retentionDays: number
  stats: {
    totalWithFingerprint: number
    oldestClickedAt: string | null
  }
  audit: Array<{
    id: string
    ran_at: string
    retention_days: number
    scanned_rows: number
    cleared_rows: number
    trigger: string
    notes: string | null
  }>
}

const TRIGGER_LABEL: Record<string, string> = {
  cron: '自動 (6時間ごと)',
  manual: '手動実行',
  consent_revoked: '同意撤回による即時削除',
}

export default function FingerprintPolicyPage() {
  const [data, setData] = useState<FingerprintPolicyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [purging, setPurging] = useState(false)
  const [error, setError] = useState('')
  const [retentionInput, setRetentionInput] = useState(90)

  const load = async () => {
    setLoading(true)
    const r = await fetchApi<{ success: boolean; data: FingerprintPolicyData; error?: string }>(
      '/api/fingerprint-policy',
    )
    if (r.success) {
      setData(r.data)
      setRetentionInput(r.data.retentionDays)
    } else {
      setError(r.error ?? '取得失敗')
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const onToggleConsent = async () => {
    if (!data) return
    const willRevoke = data.consent
    if (willRevoke) {
      if (
        !confirm(
          `同意を撤回します。\n保存済みの fingerprint データ (${data.stats.totalWithFingerprint} 件) が即時削除されます。よろしいですか?`,
        )
      ) {
        return
      }
    }
    setSaving(true)
    setError('')
    const r = await fetchApi<{
      success: boolean
      error?: string
      purged?: { clearedRows: number }
    }>('/api/fingerprint-policy', {
      method: 'PUT',
      body: JSON.stringify({ consent: !data.consent }),
    })
    setSaving(false)
    if (r.success) {
      if (r.purged) {
        alert(`同意を撤回しました。${r.purged.clearedRows} 件の fingerprint を削除しました。`)
      }
      load()
    } else {
      setError(r.error ?? '更新失敗')
    }
  }

  const onSaveRetention = async () => {
    if (!data) return
    if (retentionInput === data.retentionDays) return
    setSaving(true)
    setError('')
    const r = await fetchApi<{ success: boolean; error?: string }>('/api/fingerprint-policy', {
      method: 'PUT',
      body: JSON.stringify({ retentionDays: retentionInput }),
    })
    setSaving(false)
    if (r.success) load()
    else setError(r.error ?? '保存失敗')
  }

  const onManualPurge = async () => {
    if (!data) return
    if (
      !confirm(
        `保存期限 (${data.retentionDays} 日) を過ぎた fingerprint をいますぐ削除します。よろしいですか?`,
      )
    ) {
      return
    }
    setPurging(true)
    const r = await fetchApi<{
      success: boolean
      data?: { scannedRows: number; clearedRows: number }
      error?: string
    }>('/api/fingerprint-policy/purge', { method: 'POST' })
    setPurging(false)
    if (r.success && r.data) {
      alert(`削除完了: ${r.data.clearedRows} 件をクリアしました。`)
      load()
    } else {
      alert(r.error ?? '削除失敗')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Header
          title="fingerprint データ保存ポリシー"
          description="認証スキップモードで使う user_agent / IP / fingerprint の保存と削除を管理します。"
        />

        <Banner tone="warning" title="⚠️ プライバシー情報" className="mb-5">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              認証スキップモード (skip_liff) のトラックリンクでは、広告クリック→友だち追加の突合のために
              user_agent / IP / fingerprint を一時的に保存しています。
            </li>
            <li>これは個人特定可能情報 (PII) なので、保存期限を超えたら自動削除されます。</li>
            <li>
              同意を撤回すると、保存済みデータは即時削除され、新規記録も停止します
              (=skip_liff の attribution 精度は下がります)。
            </li>
          </ul>
        </Banner>

        {error && (
          <Banner tone="danger" className="mb-4">
            {error}
          </Banner>
        )}

        {loading || !data ? (
          <Card className="p-6 text-sm text-gray-500">読み込み中…</Card>
        ) : (
          <div className="space-y-5">
            {/* 同意状態 */}
            <Card>
              <CardHeader>
                <CardTitle>同意状態</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    現在:{' '}
                    {data.consent ? (
                      <Badge tone="success">✅ 同意あり (記録中)</Badge>
                    ) : (
                      <Badge tone="neutral">⛔ 撤回中 (新規記録停止)</Badge>
                    )}
                  </div>
                  <Button
                    onClick={onToggleConsent}
                    disabled={saving}
                    variant={data.consent ? 'danger' : 'primary'}
                  >
                    {saving ? '更新中…' : data.consent ? '同意を撤回' : '同意して再開'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 保存日数 */}
            <Card>
              <CardHeader>
                <CardTitle>保存期限</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">保存日数</label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={730}
                        value={retentionInput}
                        onChange={(e) => setRetentionInput(Number(e.target.value))}
                        className="w-32"
                      />
                      <span className="text-sm text-gray-600">日</span>
                    </div>
                  </div>
                  <Button
                    onClick={onSaveRetention}
                    disabled={saving || retentionInput === data.retentionDays}
                  >
                    保存
                  </Button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  推奨: 90 日 (skip_liff 経由のCV突合は通常24h以内に完結するため、ほぼ全データはこれ以上前のもの)
                </p>
              </CardContent>
            </Card>

            {/* 在庫 */}
            <Card>
              <CardHeader>
                <CardTitle>保存状況</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-6 text-sm">
                  <div>
                    <dt className="text-gray-500">保存中の件数</dt>
                    <dd className="mt-1 text-3xl font-bold tabular-nums">
                      {data.stats.totalWithFingerprint.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">最古のクリック</dt>
                    <dd className="mt-1 font-mono text-sm text-gray-700">
                      {data.stats.oldestClickedAt ?? '—'}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex justify-end">
                  <Button
                    variant="outline"
                    onClick={onManualPurge}
                    disabled={purging}
                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                  >
                    {purging ? '削除中…' : 'いますぐ古いデータを削除'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 削除履歴 */}
            <Card>
              <CardHeader>
                <CardTitle>削除履歴 (最近 20 件)</CardTitle>
              </CardHeader>
              <CardContent>
                {data.audit.length === 0 ? (
                  <p className="text-sm text-gray-500">まだ実行履歴はありません。</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">実行日時</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">実行種別</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">対象件数</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">削除件数</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {data.audit.map((a) => (
                          <tr key={a.id}>
                            <td className="px-3 py-2 font-mono text-xs">{a.ran_at}</td>
                            <td className="px-3 py-2 text-xs">{TRIGGER_LABEL[a.trigger] ?? a.trigger}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {a.scanned_rows.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">
                              {a.cleared_rows.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
