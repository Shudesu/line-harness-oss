'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api, webinarApi } from '@/lib/api'
import { getApiBase } from '@/lib/api-base'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Badge } from '@cloudflare/kumo/components/badge'

interface StepState {
  done: boolean
  detail: string
}

export default function VideoFeatureSetupChecklist() {
  const [loading, setLoading] = useState(true)
  const [steps, setSteps] = useState<{
    webhook: StepState
    webinar: StepState
    mileage: StepState
    pool: StepState
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [friendsRes, webinarsRes, mileageRes, poolsRes, routesRes] = await Promise.allSettled([
          api.friends.count(),
          webinarApi.list(),
          api.mileage.rules(),
          api.pools.list(),
          api.entryRoutes.list(),
        ])

        const friendCount =
          friendsRes.status === 'fulfilled' && friendsRes.value.success
            ? friendsRes.value.data.count
            : 0

        const webinars =
          webinarsRes.status === 'fulfilled' && webinarsRes.value.data
            ? webinarsRes.value.data
            : []
        const publishedWebinar = webinars.some((w) => Boolean(w.videoPrefix?.trim()))

        const mileageRules =
          mileageRes.status === 'fulfilled' && mileageRes.value.success
            ? mileageRes.value.data.length
            : 0

        const poolCount =
          poolsRes.status === 'fulfilled' && poolsRes.value.success
            ? poolsRes.value.data.length
            : 0
        const routeCount =
          routesRes.status === 'fulfilled' && routesRes.value.success
            ? routesRes.value.data.length
            : 0

        const base = (getApiBase() ?? '').replace(/\/$/, '')
        const webhookHint = base ? `${base}/webhook` : 'Worker URL/webhook'

        if (!cancelled) {
          setSteps({
            webhook: {
              done: friendCount > 0,
              detail:
                friendCount > 0
                  ? `友だち ${friendCount} 人 — Webhook 受信済みとみなします`
                  : `LINE に Webhook を ${webhookHint} へ設定し、テスト友だちを追加`,
            },
            webinar: {
              done: publishedWebinar,
              detail: publishedWebinar
                ? `公開済み動画付きウェビナーあり（全 ${webinars.length} 件）`
                : webinars.length > 0
                  ? 'ウェビナーはあるが HLS 未公開 — Cursor MCP で manage_webinar_video'
                  : 'ウェビナーを作成し HLS をアップロード',
            },
            mileage: {
              done: mileageRules > 0,
              detail: mileageRules > 0
                ? `マイルルール ${mileageRules} 件（90% 視聴付与など）`
                : 'マイル画面でルールを有効化',
            },
            pool: {
              done: poolCount > 0 && routeCount > 0,
              detail:
                poolCount > 0 && routeCount > 0
                  ? `プール ${poolCount}・流入 ${routeCount} — 振り分け準備 OK`
                  : poolCount > 0
                    ? 'プールのみ — entry_routes で /r/{ref} を登録'
                    : 'プール管理と流入リンクを設定（マルチアカウント/BAN分散）',
            },
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <LayerCard className="mb-6 p-4">
        <div className="h-24 animate-pulse rounded-lg bg-gray-100" />
      </LayerCard>
    )
  }

  if (!steps) return null

  const items = [
    { key: 'webhook', title: 'LINE Webhook・友だち追加', href: '/accounts', state: steps.webhook },
    { key: 'webinar', title: 'オートウェビナー（HLS）', href: '/webinars', state: steps.webinar },
    { key: 'mileage', title: 'マイル制度', href: '/scoring', state: steps.mileage },
    { key: 'pool', title: 'プール＋流入リンク', href: '/pools', state: steps.pool },
  ] as const

  const doneCount = items.filter((i) => i.state.done).length
  const allDone = doneCount === items.length

  return (
    <LayerCard className="mb-6 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-kumo-strong">動画機能セットアップ</p>
          <p className="text-xs text-kumo-subtle mt-0.5">
            ウェビナー・マイル・プール（OSS プレイブック Phase B〜D）
          </p>
        </div>
        <Badge variant={allDone ? 'success' : 'neutral'}>
          {doneCount}/{items.length} 完了
        </Badge>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="flex items-start gap-3 rounded-lg border border-kumo-line px-3 py-2.5 transition-colors hover:bg-gray-50"
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  item.state.done ? 'bg-kumo-success text-white' : 'bg-gray-200 text-gray-600'
                }`}
                aria-hidden
              >
                {item.state.done ? '✓' : '·'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium text-kumo-strong">{item.title}</span>
                <span className="mt-0.5 block text-xs text-kumo-subtle">{item.state.detail}</span>
              </span>
              <span className="text-xs text-kumo-brand shrink-0">開く →</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-kumo-subtle">
        手順詳細: リポジトリ内{' '}
        <span className="font-mono">docs/wiki/30-Video-Feature-Playbook.md</span>
        {' · '}
        初回デプロイ: <span className="font-mono">docs/self-host/PHASE-A-DEPLOY.md</span>
      </p>
    </LayerCard>
  )
}
