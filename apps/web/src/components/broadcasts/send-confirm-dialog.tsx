'use client'

import { useState, useEffect } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Loader } from '@cloudflare/kumo/components/loader'

interface PerAccountBreakdown {
  accountId: string
  accountName: string
  sendCount: number
}

interface SendConfirmDialogProps {
  title: string
  targetCount: number
  accountName: string
  /** true で multi-account 配信としてレンダリングする (perAccount=[] でも単アカ表示にしない). */
  isMultiAccount?: boolean
  perAccount?: PerAccountBreakdown[]
  onConfirm: () => void
  onCancel: () => void
}

export default function SendConfirmDialog({ title, targetCount, accountName, isMultiAccount, perAccount, onConfirm, onCancel }: SendConfirmDialogProps) {
  const [countdown, setCountdown] = useState(3)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const showBreakdown = isMultiAccount === true

  return (
    <Dialog.Root role="alertdialog" open onOpenChange={(open) => { if (!open) onCancel() }}>
      <Dialog size="base" className="p-6">
        <Dialog.Title className="text-lg font-semibold text-kumo-strong">配信を送信しますか？</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-kumo-subtle">送信後は取り消せません。対象とアカウントを確認してください。</Dialog.Description>
        <dl className="my-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-kumo-subtle">タイトル</dt>
            <dd className="font-medium text-kumo-strong">{title}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-kumo-subtle">対象</dt>
            <dd className="font-medium text-kumo-strong">{targetCount.toLocaleString('ja-JP')}人</dd>
          </div>
          {showBreakdown ? (
            <div>
              <dt className="mb-1 text-kumo-subtle">配信先</dt>
              <dd className="mt-1 space-y-1 border-t border-kumo-line pt-2">
                {perAccount === undefined ? (
                  // データ未取得 (preview-count 読み込み中 or 失敗)。"全アカウント無効" と
                  // 誤表示しないように loading 表示にする。
                  <p className="flex items-center gap-2 text-xs text-kumo-subtle"><Loader size="sm" />読み込み中</p>
                ) : perAccount.length > 0 ? (
                  perAccount.map((p) => (
                    <div key={p.accountId} className="flex justify-between text-xs">
                      <span className="text-kumo-default">{p.accountName}</span>
                      <span className="font-medium text-kumo-strong">{p.sendCount.toLocaleString('ja-JP')}通</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-kumo-warning">送信可能なアカウントがありません（全アカウント無効）</p>
                )}
              </dd>
            </div>
          ) : (
            <div className="flex justify-between">
              <dt className="text-kumo-subtle">アカウント</dt>
              <dd className="font-medium text-kumo-strong">{accountName}</dd>
            </div>
          )}
        </dl>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={onConfirm} disabled={countdown > 0}>
            {countdown > 0 ? `送信する (${countdown})` : '送信する'}
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
