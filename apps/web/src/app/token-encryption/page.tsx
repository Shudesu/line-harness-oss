'use client'

/**
 * Phase 1-G: Channel Access Token 暗号化 管理画面
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
} from '@/components/ui/primitives'

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
        '【重要】本作業はベータ機能です。\n' +
          '実行すると全 line_accounts の channel_access_token が暗号化されます。\n' +
          '事前に LINE_TOKEN_ENC_KEY が登録され、worker が最新版にデプロイされている事を確認してください。\n\n' +
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
    }>('/api/token-encryption/migrate?confirm=force', { method: 'POST' })
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

        <Banner tone="warning" title="⚠️ ベータ機能" className="mb-4">
          <p>
            v3 で全 service の復号対応は完了済みですが、本番有効化の前に
            <strong>必ず Worker secret <code className="rounded bg-white px-1">LINE_TOKEN_ENC_KEY</code> 設定 + 最新 worker デプロイ</strong>
            を済ませてください。
          </p>
        </Banner>

        <Banner tone="info" title="📌 有効化手順" className="mb-5">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <code className="rounded bg-white px-1">openssl rand -base64 32</code> で AES-256 マスターキーを生成
            </li>
            <li>
              <code className="rounded bg-white px-1">
                wrangler secret put LINE_TOKEN_ENC_KEY --config wrangler-prod.toml
              </code>{' '}
              で登録
            </li>
            <li>worker を再デプロイ</li>
            <li>このページの「いますぐ暗号化」を実行</li>
            <li>各種送信機能が動作するか確認</li>
          </ol>
        </Banner>

        {error && (
          <Banner tone="danger" className="mb-4">
            {error}
          </Banner>
        )}

        {loading || !status ? (
          <Card className="p-6 text-sm text-gray-500">読み込み中…</Card>
        ) : (
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>マスターキー</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm">
                  Worker secret <code className="rounded bg-gray-100 px-1">LINE_TOKEN_ENC_KEY</code>:{' '}
                  {status.keyConfigured ? (
                    <Badge tone="success">✅ 設定済み</Badge>
                  ) : (
                    <Badge tone="neutral">⛔ 未設定 (暗号化オフ)</Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>トークン保存状況</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-3 gap-6 text-sm">
                  <div>
                    <dt className="text-gray-500">登録 token 総数</dt>
                    <dd className="mt-1 text-3xl font-bold tabular-nums">{status.total}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">暗号化済み</dt>
                    <dd className="mt-1 text-3xl font-bold tabular-nums text-emerald-700">
                      {status.encrypted}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">平文</dt>
                    <dd className="mt-1 text-3xl font-bold tabular-nums text-orange-700">
                      {status.plaintext}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 flex justify-end">
                  <Button
                    onClick={onMigrate}
                    disabled={migrating || !status.keyConfigured || status.plaintext === 0}
                    title={
                      !status.keyConfigured
                        ? 'LINE_TOKEN_ENC_KEY が未設定です'
                        : status.plaintext === 0
                        ? '暗号化対象の平文 token がありません'
                        : '実行'
                    }
                  >
                    {migrating ? '暗号化中…' : 'いますぐ暗号化'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
