import Link from 'next/link'
import { useState } from 'react'
import type { ApiUserEvent, ConsoleConversionReportItem, ConsoleTrackedLink } from '../types'
import { formatDateTime } from '../utils'
import { MiniList, MiniListItem, SummaryCard } from './shared'

export function AnalyticsTab({
  trackedLinks,
  activeLinks,
  totalClicks,
  conversionReport,
  recentEvents,
}: {
  trackedLinks: ConsoleTrackedLink[]
  activeLinks: number
  totalClicks: number
  conversionReport: ConsoleConversionReportItem[]
  recentEvents: ApiUserEvent[]
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const totalConversions = conversionReport.reduce((sum, item) => sum + item.totalCount, 0)
  const totalConversionValue = conversionReport.reduce((sum, item) => sum + item.totalValue, 0)
  const eventCounts = recentEvents.reduce<Record<string, number>>((acc, event) => {
    acc[event.eventType] = (acc[event.eventType] || 0) + 1
    return acc
  }, {})
  const topEventTypes = Object.entries(eventCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-gray-950">流入とCVを見る</p>
            <p className="mt-1 text-sm text-gray-500">数字だけを見て、施策の反応を判断します。</p>
          </div>
          <button onClick={() => setSettingsOpen(true)} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">
            設定
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <SummaryCard label="有効リンク" value={activeLinks} tone="green" />
          <SummaryCard label="総クリック" value={totalClicks} tone="blue" />
          <SummaryCard label="CV数" value={totalConversions} tone="amber" />
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-gray-900">CVレポート</p>
            </div>
            {conversionReport.length > 0 ? (
              <div className="mt-3 space-y-2">
                {conversionReport.slice(0, 5).map((item) => (
                  <div key={item.conversionPointId} className="rounded-lg bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-gray-900">{item.conversionPointName}</p>
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">{item.totalCount}件</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">{item.eventType}{item.totalValue > 0 ? ` / ¥${item.totalValue.toLocaleString()}` : ''}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-lg bg-white p-3 text-sm text-gray-500">CVポイントが未設定です。フォーム完了や予約導線クリックをCVとして設定してください。</div>
            )}
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-gray-900">直近イベント</p>
            </div>
            {recentEvents.length > 0 ? (
              <div className="mt-3 space-y-2">
                {recentEvents.slice(0, 6).map((event) => (
                  <div key={event.id} className="rounded-lg bg-white px-3 py-2">
                    <p className="truncate text-sm font-semibold text-gray-900">{event.eventName || event.eventType}</p>
                    <p className="mt-1 text-xs text-gray-400">{event.eventSource} / {formatDateTime(event.createdAt)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-lg bg-white p-3 text-sm text-gray-500">直近イベントはありません。</div>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="text-sm font-bold text-gray-900">経営改善で次に見る指標</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {[
              ['友だち追加率', 'QR/URLからLINE追加に進んだ割合'],
              ['フォーム完了率', '申込・問診フォームを最後まで送信した割合'],
              ['配信クリック率', '配信から予約/問い合わせに進んだ割合'],
              ['タグ別CV率', '来店済み/未経験など属性ごとの成果差'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-lg bg-white px-3 py-2">
                <p className="text-sm font-semibold text-gray-900">{title}</p>
                <p className="mt-1 text-xs text-gray-500">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <MiniList title="クリック上位" href="/tracked-links" empty="リンクなし">
          {trackedLinks.map((link) => <MiniListItem key={link.id} title={link.name} sub={`${link.clickCount}クリック`} />)}
        </MiniList>
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-950">イベント種別</p>
          <div className="mt-3 space-y-2">
            {topEventTypes.length > 0 ? (
              topEventTypes.map(([eventType, count]) => (
                <div key={eventType} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
                  <p className="truncate text-sm font-semibold text-gray-800">{eventType}</p>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-gray-600">{count}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">イベントなし</p>
            )}
          </div>
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-950">設定する順番</p>
          <ol className="mt-3 space-y-2 text-sm text-gray-600">
            <li>1. トラッキングリンクを作る</li>
            <li>2. フォーム完了をCVにする</li>
            <li>3. イベントでタグ付けする</li>
            <li>4. タグ別に配信する</li>
          </ol>
          {totalConversionValue > 0 && (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">CV金額合計: ¥{totalConversionValue.toLocaleString()}</p>
          )}
        </section>
      </aside>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:p-4">
          <section className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:mx-auto sm:max-w-lg sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-black text-gray-950">分析設定</p>
                <p className="mt-1 text-sm text-gray-500">CVやイベントの細かい設定は既存の開発者向け画面で行います。</p>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-700">閉じる</button>
            </div>
            <div className="mt-4 grid gap-2">
              <SettingsLink href="/tracked-links" title="トラッキングリンク" body="Instagram、Google Map、広告などの流入URLを管理します。" />
              <SettingsLink href="/conversions" title="CVポイント" body="フォーム完了、予約導線クリックなどの成果地点を設定します。" />
              <SettingsLink href="/tags-events" title="イベント・タグ" body="イベント発火、タグ付けルール、計測イベントを設定します。" />
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function SettingsLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 hover:bg-gray-100">
      <p className="text-sm font-black text-gray-950">{title}</p>
      <p className="mt-1 text-xs leading-5 text-gray-500">{body}</p>
    </Link>
  )
}
