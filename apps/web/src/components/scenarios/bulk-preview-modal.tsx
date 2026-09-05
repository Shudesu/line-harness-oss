'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'

interface Props {
  open: boolean
  scenarioId: string
  onClose: () => void
}

interface PreviewStep {
  stepOrder: number
  deliveryAt: string
  deliveryAtLabel: string
  messageType: string
  messageContent: string
}

function nowJstAsLocalInput(): string {
  // JST clock-time as YYYY-MM-DDTHH:MM for the datetime-local field.
  const d = new Date(Date.now() + 9 * 60 * 60_000)
  return d.toISOString().slice(0, 16)
}

export default function BulkPreviewModal({ open, scenarioId, onClose }: Props) {
  const [startAt, setStartAt] = useState(() => nowJstAsLocalInput())
  const [steps, setSteps] = useState<PreviewStep[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    const iso = startAt + ':00+09:00'
    api.scenarios
      .preview(scenarioId, iso)
      .then((res) => {
        if (res.success) setSteps(res.data.steps)
        else setError(res.error)
      })
      .catch(() => setError('プレビューの読み込みに失敗しました'))
      .finally(() => setLoading(false))
  }, [open, scenarioId, startAt])

  if (!open) return null

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <Dialog className="max-h-[80vh] w-full max-w-2xl overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">一括プレビュー</Dialog.Title>
          <Button
            type="button"
            onClick={onClose}
            size="xs"
            shape="square"
            variant="ghost"
            aria-label="閉じる"
          >
            ✕
          </Button>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            起点 (購読開始日時)
          </label>
          <Input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            aria-label="購読開始日時"
          />
        </div>

        {error && <Banner className="mb-3" size="sm" variant="error" title="プレビューを表示できませんでした" description={error} />}

        {loading ? (
          <p className="text-sm text-gray-400">読み込み中...</p>
        ) : steps && steps.length > 0 ? (
          <div className="space-y-2">
            {steps.map((s) => (
              <details
                key={s.stepOrder}
                className="border border-gray-200 rounded-lg p-3 group"
              >
                <summary className="cursor-pointer text-sm flex items-center gap-2 list-none">
                  <span className="font-mono text-gray-500 w-8">#{s.stepOrder}</span>
                  <span className="text-gray-700 flex-1">{s.deliveryAtLabel}</span>
                  <span className="text-xs text-blue-600">{s.messageType}</span>
                  <span className="text-gray-400 group-open:rotate-90 transition-transform">▶</span>
                </summary>
                <pre className="mt-2 text-xs text-gray-700 whitespace-pre-wrap break-words bg-gray-50 p-2 rounded max-h-48 overflow-y-auto">
                  {s.messageContent}
                </pre>
              </details>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">ステップがありません</p>
        )}

        <div className="mt-6 flex justify-end">
          <Button
            type="button"
            onClick={onClose}
            variant="secondary"
          >
            閉じる
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
