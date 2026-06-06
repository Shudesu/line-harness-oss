'use client'

/**
 * 監査 H1 対応: 外部 CRM 転送設定画面
 *
 * エルメ等の外部 CRM の webhook URL を登録すると、harness が受けた LINE webhook が
 * 同じ payload で転送される。エルメ → harness 移行中の並行運用に使う。
 */

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

interface CrmForward {
  id: string
  line_account_id: string
  name: string
  webhook_url: string
  is_enabled: number
  attach_line_signature: number
  max_retries: number
  memo: string | null
  created_at: string
  updated_at: string
}

export default function CrmForwardsPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<CrmForward[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formAttachSig, setFormAttachSig] = useState(true)
  const [formMemo, setFormMemo] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    const qs = selectedAccountId
      ? `?lineAccountId=${encodeURIComponent(selectedAccountId)}`
      : ''
    const r = await fetchApi<{ success: boolean; data: CrmForward[]; error?: string }>(
      `/api/crm-forwards${qs}`,
    )
    if (r.success) setItems(r.data)
    else setError(r.error ?? '取得失敗')
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])

  const onCreate = async () => {
    if (!selectedAccountId) {
      alert('LINE アカウントを選択してください')
      return
    }
    if (!formName.trim() || !formUrl.trim()) return
    setSaving(true)
    const r = await fetchApi<{ success: boolean; data: CrmForward; error?: string }>(
      `/api/crm-forwards`,
      {
        method: 'POST',
        body: JSON.stringify({
          lineAccountId: selectedAccountId,
          name: formName.trim(),
          webhookUrl: formUrl.trim(),
          attachLineSignature: formAttachSig,
          memo: formMemo.trim() || null,
        }),
      },
    )
    setSaving(false)
    if (r.success) {
      setShowForm(false)
      setFormName('')
      setFormUrl('')
      setFormMemo('')
      load()
    } else {
      alert(r.error ?? '作成失敗')
    }
  }

  const onToggle = async (item: CrmForward) => {
    const r = await fetchApi<{ success: boolean }>(`/api/crm-forwards/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isEnabled: !item.is_enabled }),
    })
    if (r.success) load()
  }

  const onDelete = async (item: CrmForward) => {
    if (!confirm(`「${item.name}」を削除しますか?`)) return
    const r = await fetchApi<{ success: boolean }>(`/api/crm-forwards/${item.id}`, {
      method: 'DELETE',
    })
    if (r.success) load()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Header
          title="外部 CRM 転送設定"
          description="harness が受けた LINE webhook を、エルメ等の外部 CRM にも転送する設定。エルメ移行中の並行運用に使う。"
          action={
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              ＋ 新規追加
            </button>
          }
        />

        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium mb-1">⚠️ 並行運用について</p>
          <p>
            ここに登録した URL に LINE webhook が転送されます。エルメに移行データを保ちつつ、
            harness で機能拡充できます。**移行完了したら必ず無効化してください**
            (2つの CRM が同じ友だち情報を持つと整合性が崩れます)。
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">
            読み込み中…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">
            転送設定はまだありません。「新規追加」でエルメ等の webhook URL を登録してください。
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">名前</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">URL</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">署名付与</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">状態</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">アクション</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-4 py-3 font-medium">{it.name}</td>
                    <td className="px-4 py-3 font-mono text-xs break-all">{it.webhook_url}</td>
                    <td className="px-4 py-3 text-center">{it.attach_line_signature ? '✓' : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {it.is_enabled ? (
                        <span className="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          有効
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          無効
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => onToggle(it)}
                          className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                        >
                          {it.is_enabled ? '無効化' : '有効化'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(it)}
                          className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
            <div className="mt-12 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">転送先を追加</h2>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">名前</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="例: エルメ転送"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Webhook URL (https のみ)
                  </label>
                  <input
                    type="url"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono text-xs"
                    placeholder="https://elme.example.com/webhook/..."
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    エルメの「外部連携 URL」欄に入れていた URL をそのまま貼り付けてください
                  </p>
                </div>
                <div>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formAttachSig}
                      onChange={(e) => setFormAttachSig(e.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      <strong>X-Line-Signature を再計算して付与する</strong>
                      <p className="text-xs text-gray-500">
                        エルメ等 LINE 公式 webhook 互換の転送先は ON 推奨
                      </p>
                    </span>
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">メモ</label>
                  <input
                    type="text"
                    value={formMemo}
                    onChange={(e) => setFormMemo(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  disabled={saving}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={onCreate}
                  disabled={saving}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? '作成中…' : '追加'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
