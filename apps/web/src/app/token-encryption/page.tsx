'use client'

/**
 * Phase 1-G: Channel Access Token 暗号化 管理画面
 *
 * line_accounts.channel_access_token は LINE Messaging API への push 権限を持つ高価値シークレット。
 * D1 平文保存は流出時のリスクが大きいため、AES-GCM (256bit) で暗号化保存する。
 *
 * 現状: foundation のみ展開済。webhook handler は復号対応済だが、
 * broadcast / booking / event-booking / ban-monitor / insight-fetcher は未対応 (v2 で対応予定)。
 * よって本番有効化は v2 完了後に行うこと。
 */

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

interface TokenStatus {
  keyConfigured: boolean
  total: number
  encrypted: number
  plaintext: number
}

export default function TokenEncryptionPage() {
  const [status, setStatus] = useState<TokenStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [migrating, setMigrating] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    const r = await fetchApi<{ success: boolean; data: TokenStatus; error?: string }>(
      '/api/token-encryption/status',
    )
    if (r.success) setStatus(r.data)
    else setError(r.error ?? '取得失敗')
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const onMigrate = async () => {
    if (
      !confirm(
        '【重要】本作業はまだベータ機能です。\n' +
          '実行すると全 line_accounts の channel_access_token が暗号化されます。\n' +
          'webhook 以外のサービス (broadcast / booking / event-booking 等) は\n' +
          'まだ復号対応が完全ではないため、これらの機能がエラーになる可能性があります。\n\n' +
          '本当に実行しますか?',
      )
    ) {
      return
    }
    setMigrating(true)
    setError('')
    const r = await fetchApi<{
      success: boolean
      data?: { scanned: number; encrypted: number; skipped: number; errors: number }
      error?: string
    }>('/api/token-encryption/migrate', { method: 'POST' })
    setMigrating(false)
    if (r.success && r.data) {
      alert(
        `暗号化完了:\n` +
          `走査: ${r.data.scanned} 件\n` +
          `新規暗号化: ${r.data.encrypted} 件\n` +
          `既に暗号化済: ${r.data.skipped} 件\n` +
          `エラー: ${r.data.errors} 件`,
      )
      load()
    } else {
      alert(`失敗: ${r.error ?? '不明なエラー'}`)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <Header
          title="Channel Access Token 暗号化"
          description="line_accounts.channel_access_token を AES-GCM で暗号化保存します。"
        />

        <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-medium mb-1">⚠️ ベータ機能 (本番有効化は要注意)</p>
          <p>
            現時点で復号対応済なのは webhook handler のみです。
            broadcast / booking / event-booking / ban-monitor / insight-fetcher は未対応のため、
            本番でこの暗号化を有効化するとそれらが Auth エラーで失敗します。
            <br />
            <strong>v2 (全 service の復号対応) 完了後に有効化してください。</strong>
          </p>
        </div>

        <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <p className="font-medium mb-1">📌 有効化手順 (v2 完了後)</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              <code className="bg-white px-1 rounded">openssl rand -base64 32</code> で AES-256 マスターキーを生成
            </li>
            <li>
              <code className="bg-white px-1 rounded">
                wrangler secret put LINE_TOKEN_ENC_KEY --config wrangler-prod.toml
              </code>{' '}
              で登録
            </li>
            <li>このページの「いますぐ暗号化」を実行</li>
            <li>各種送信機能が動作するか確認</li>
          </ol>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading || !status ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">読み込み中…</div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-lg border bg-white p-6">
              <h2 className="text-base font-semibold mb-3">マスターキー</h2>
              <p className="text-sm">
                Worker secret <code className="bg-gray-100 px-1 rounded">LINE_TOKEN_ENC_KEY</code>:{' '}
                {status.keyConfigured ? (
                  <span className="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                    ✅ 設定済み
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                    ⛔ 未設定 (暗号化機能オフ)
                  </span>
                )}
              </p>
            </div>

            <div className="rounded-lg border bg-white p-6">
              <h2 className="text-base font-semibold mb-3">トークン保存状況</h2>
              <dl className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-gray-500">登録 token 総数</dt>
                  <dd className="mt-1 text-2xl font-bold">{status.total}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">暗号化済み</dt>
                  <dd className="mt-1 text-2xl font-bold text-emerald-700">{status.encrypted}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">平文</dt>
                  <dd className="mt-1 text-2xl font-bold text-orange-700">{status.plaintext}</dd>
                </div>
              </dl>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={onMigrate}
                  disabled={migrating || !status.keyConfigured || status.plaintext === 0}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  title={
                    !status.keyConfigured
                      ? 'LINE_TOKEN_ENC_KEY が未設定です'
                      : status.plaintext === 0
                      ? '暗号化対象の平文 token がありません'
                      : '実行'
                  }
                >
                  {migrating ? '暗号化中…' : 'いますぐ暗号化'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
