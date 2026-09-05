'use client'

import { useEffect, useState } from 'react'
import { getApiBase } from '@/lib/api-base'
import { Badge } from '@cloudflare/kumo/components/badge'
import type { BadgeVariant } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Table } from '@cloudflare/kumo/components/table'

// 呼び出し時 (call time) に解決する — モジュールスコープの定数にすると、静的
// 書き出し（window 未定義）の時点で値が確定してしまい、共有ビルドではプレース
// ホルダーが焼き付いたまま固定される。
function apiUrl(): string {
  return getApiBase()!
}
// self-update を構成した環境 (create-line-harness セットアップ) でのみ設定される。
// 未設定 = 自動アップデート非構成環境なので、この画面は fetch せず案内のみ表示する。
const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY
const MANUAL_UPDATE_GUIDE_URL =
  'https://github.com/Shudesu/line-harness-oss/blob/main/docs/wiki/26-Manual-Update.md' 

interface Row {
  id: string
  started_at: number
  completed_at: number | null
  from_version: string
  to_version: string
  status: string
  error: string | null
  rollback_expires_at: number | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: Row[] }
  | { kind: 'unconfigured' }
  | { kind: 'error'; message: string }

async function fetchHistory(adminKey: string): Promise<Row[]> {
  const r = await fetch(`${apiUrl()}/admin/update/history`, {
    headers: { 'x-admin-api-key': adminKey },
  })
  if (!r.ok) throw new Error(`history fetch ${r.status}`)
  const j = (await r.json()) as { history: Row[] }
  return j.history
}

export default function UpdatesPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    if (!ADMIN_KEY) {
      setState({ kind: 'unconfigured' })
      return
    }
    fetchHistory(ADMIN_KEY)
      .then((rows) => setState({ kind: 'ready', rows }))
      .catch((e) => {
        // 401/403 = キー不一致 or 未構成。ネットワーク失敗も含め、
        // 運用者を驚かせる赤エラーではなく状況の説明を出す。
        const msg = e instanceof Error ? e.message : String(e)
        if (/ 40[13]$/.test(msg)) setState({ kind: 'unconfigured' })
        else setState({ kind: 'error', message: msg })
      })
  }, [])

  const rows = state.kind === 'ready' ? state.rows : []

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-4">アップデート履歴</h1>
      {state.kind === 'loading' && <LayerCard className="p-8"><Loader className="mx-auto" /></LayerCard>}
      {state.kind === 'unconfigured' && (
        <Banner className="mb-4" variant="secondary" title="自動アップデートは未構成">
          この環境では自動アップデートが構成されていないため、履歴はありません。
          <br />
          自動アップデートは <code className="text-xs">create-line-harness</code>{' '}
          でセットアップした環境で利用できます。自前でデプロイしている場合は{' '}
          <a
            className="underline"
            href={MANUAL_UPDATE_GUIDE_URL}
            target="_blank"
            rel="noreferrer"
          >
            手動アップデートガイド
          </a>{' '}
          をご覧ください。
        </Banner>
      )}
      {state.kind === 'error' && (
        <Banner className="mb-4" variant="alert" title="履歴を取得できませんでした" description={`${state.message}。時間をおいて再読み込みしてください。`} />
      )}
      {state.kind === 'ready' && rows.length === 0 && (
        <Empty title="履歴はまだありません" description="アップデートを実行するとここに記録されます。" />
      )}
      {rows.length > 0 && (
        <LayerCard className="overflow-x-auto p-0">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>開始</Table.Head>
                <Table.Head>From → To</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head>Rollback</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((r) => (
                <Table.Row key={r.id}>
                  <Table.Cell>
                    {new Date(r.started_at).toLocaleString('ja-JP', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Table.Cell>
                  <Table.Cell className="font-mono text-xs">
                    {r.from_version} → {r.to_version}
                  </Table.Cell>
                  <Table.Cell><Badge variant={statusVariant(r.status)}>{r.status}</Badge></Table.Cell>
                  <Table.Cell>
                    {r.status === 'success' &&
                    r.rollback_expires_at &&
                    Date.now() < r.rollback_expires_at ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          alert('rollback not implemented in MVP — use CLI')
                        }
                      >
                        Rollback
                      </Button>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </LayerCard>
      )}
    </div>
  )
}

function statusVariant(s: string): BadgeVariant {
  if (s === 'success') return 'success'
  if (s === 'rolled_back') return 'warning'
  if (s === 'failed') return 'error'
  if (s === 'running') return 'info'
  return 'neutral'
}
