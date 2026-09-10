import React from 'react'
import type { UpdateEvent } from '@line-harness/update-engine'
import { Button } from '@cloudflare/kumo/components/button'
import type { MigrationOutcome, ProgressRow, ProgressStepRow } from './progress-rows'

export interface UpdateFinalState {
  status: 'success' | 'rolled_back' | 'failed'
  error: string | null
}

const OUTCOME_LABELS: Record<MigrationOutcome, string> = {
  applied: '実行済み',
  skipped: '適用済みのためスキップ',
  adopted: '既存状態を確認して記録（実行なし）',
}

function StepDetails({ row }: { row: ProgressStepRow }) {
  return (
    <>
      {row.notes.map((note) => <div key={note} className="text-xs text-gray-600 whitespace-pre-wrap break-words">{note}</div>)}
      {row.secrets.length > 0 && (
        <div className="text-xs text-gray-600 break-words">新しく必要になるsecret: {row.secrets.join(', ')}</div>
      )}
      {row.outcomeHistory.length > 0 && (
        <div className="text-xs text-gray-600">{row.outcomeHistory.map((outcome) => OUTCOME_LABELS[outcome]).join(' → ')}</div>
      )}
      {row.errors.map((error) => <div key={error} className="text-xs text-red-700 whitespace-pre-wrap break-words">{error}</div>)}
    </>
  )
}

/** The scrollable evidence and the fixed close footer are separate flex children. */
export function ProgressModalView({
  rows, final, mode, titleId, onClose,
}: {
  rows: ProgressRow[]
  final: UpdateFinalState | null
  mode: 'sse' | 'polling'
  titleId: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="bg-white text-gray-900 rounded-lg shadow-xl w-full max-w-lg max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden">
        <header className="shrink-0 px-6 pt-6 pb-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {final ? 'アップデート結果' : 'アップデート中'}{' '}
            {mode === 'polling' && <span className="text-xs text-gray-500">(polling)</span>}
          </h2>
        </header>
        <div data-progress-scroll="true" role="region" aria-label="更新の進捗と詳細" tabIndex={0}
          className="min-h-0 overflow-y-auto overscroll-contain px-6 pb-6 [overflow-wrap:anywhere]">
          <ul className="space-y-2 font-mono text-sm">
            {rows.length === 0 && <li className="text-gray-500">接続中...</li>}
            {rows.map((row) => row.kind === 'migration-summary' ? (
              <li key={row.key}>
                <span aria-hidden="true">✓ </span>Migration — {row.total}件完了
                <div className="text-xs text-gray-600">
                  実行 {row.applied}件 / 適用済みスキップ {row.skipped}件 / 既存状態を確認して記録 {row.adopted}件
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-gray-600">対象と処理結果を確認</summary>
                  <ul className="mt-2 space-y-2 border-l border-gray-200 pl-3">
                    {row.completed.map((completed) => (
                      <li key={completed.key}>
                        <span>{completed.name || '名前のないmigration'}</span>
                        <StepDetails row={completed} />
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ) : (
              <li key={row.key} className="flex items-start gap-2">
                <span aria-hidden="true" className="w-5 shrink-0">{iconFor(row.status)}</span>
                <div className="min-w-0">
                  {labelFor(row.step)}{row.name ? ` — ${row.name}` : ''}
                  <span className="ml-2 text-xs text-gray-500">{statusFor(row.status, final !== null)}</span>
                  <StepDetails row={row} />
                </div>
              </li>
            ))}
          </ul>
          {final && (
            <div className="mt-4 p-3 rounded bg-gray-50" role="status">
              {final.status === 'success' && <p className="text-green-700 font-semibold">完了しました 🎉</p>}
              {final.status === 'rolled_back' && <p className="text-amber-700">失敗。前バージョンに復旧済み。</p>}
              {final.status === 'failed' && <p className="text-red-700">失敗 + 復旧失敗。手動対応が必要です。</p>}
              {final.error && <p className="mt-1 text-xs text-gray-600 whitespace-pre-wrap break-words">{final.error}</p>}
            </div>
          )}
        </div>
        {final && (
          <footer data-progress-footer="true" className="shrink-0 border-t border-gray-200 px-6 py-4">
            <Button type="button" onClick={onClose} size="sm" variant="secondary">閉じる</Button>
          </footer>
        )}
      </div>
    </div>
  )
}

function iconFor(status: UpdateEvent['status']): string {
  return status === 'done' ? '✓' : status === 'running' ? '⏳' : status === 'failed' ? '✗' : '○'
}

function statusFor(status: UpdateEvent['status'], finished: boolean): string {
  if (status === 'running') return finished ? '未完了の記録' : '実行中'
  return status === 'done' ? '完了' : status === 'failed' ? '失敗' : '待機中'
}

function labelFor(step: UpdateEvent['step']): string {
  const labels: Record<UpdateEvent['step'], string> = {
    preflight: 'Pre-flight', migration: 'Migration', worker: 'Worker デプロイ',
    admin: 'Admin デプロイ', liff: 'LIFF デプロイ', verify: 'ヘルスチェック',
    rollback: 'Rollback', complete: '完了',
  }
  return labels[step] ?? step
}
