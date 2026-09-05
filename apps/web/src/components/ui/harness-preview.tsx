import { Badge } from '@cloudflare/kumo/components/badge'
import { Surface } from '@cloudflare/kumo/components/surface'
import { HarnessPageHeader, HarnessStatCard } from './harness-ui'

export interface HarnessPreviewMetric {
  title: string
  value: number
  subtitle: string
  accentColor: string
  icon: string
}

export interface HarnessPreviewDashboardProps {
  product: string
  brandColor: string
  description: string
  metrics: HarnessPreviewMetric[]
  navItems: string[]
}

export function HarnessPreviewDashboard({
  product,
  brandColor,
  description,
  metrics,
  navItems,
}: HarnessPreviewDashboardProps) {
  return (
    <div className="min-h-screen border-t-4 bg-harness-canvas lg:flex" style={{ borderTopColor: brandColor }}>
      <aside className="border-b border-harness-line bg-white px-5 py-5 lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg text-lg font-black text-white" style={{ backgroundColor: brandColor }}>
            &gt;
          </span>
          <div>
            <p className="font-bold tracking-tight text-harness-ink">{product} Harness</p>
            <p className="text-[10px] font-bold tracking-[0.16em] text-gray-400">MANAGEMENT CONSOLE</p>
          </div>
        </div>

        <nav className="mt-7 grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1" aria-label={`${product}プレビュー`}>
          {navItems.map((item, index) => (
            <span
              key={item}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${index === 0 ? '' : 'text-gray-500'}`}
              style={index === 0 ? { backgroundColor: `${brandColor}12`, color: brandColor } : undefined}
            >
              {item}
            </span>
          ))}
        </nav>

        <div className="mt-7 rounded-lg border border-dashed border-harness-line p-3 text-xs leading-5 text-gray-500">
          <strong className="block text-gray-700">UI PREVIEW</strong>
          サンプルデータです。外部送信は行いません。
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-7 sm:px-7 lg:px-10">
        <HarnessPageHeader
          title="ダッシュボード"
          description={description}
          product={product}
          action={<Badge variant="neutral">DEMO MODE</Badge>}
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <HarnessStatCard
              key={metric.title}
              title={metric.title}
              value={metric.value}
              loading={false}
              href="#"
              subtitle={metric.subtitle}
              accentColor={brandColor}
              icon={<span className="text-sm font-bold">{metric.icon}</span>}
              detailLabel="サンプルを見る"
            />
          ))}
        </div>

        <Surface className="mt-6 rounded-xl border-l-4 p-5" style={{ borderLeftColor: brandColor }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-bold text-harness-ink">最近のアクティビティ</h2>
              <p className="mt-1 text-sm text-gray-500">すべてのハーネスで同じ情報設計に統一します。</p>
            </div>
            <Badge variant="neutral">直近7日</Badge>
          </div>
          <div className="mt-5 divide-y divide-harness-line">
            {['新しい反応を受信しました', '自動アクションを実行しました', 'レポートを更新しました'].map(
              (label, index) => (
                <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <span className="text-gray-700">{label}</span>
                  <span className="text-xs tabular-nums text-gray-400">{index + 1}時間前</span>
                </div>
              ),
            )}
          </div>
        </Surface>
      </main>
    </div>
  )
}
