import Link from 'next/link'
import type { Scenario, DeliveryMode, ScenarioTriggerType } from '@line-crm/shared'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@/components/ui/primitives'

type ScenarioWithCount = Scenario & { stepCount?: number }

const triggerLabels: Record<string, string> = {
  friend_add: '友だち追加時',
  tag_added: 'タグ付与時',
  manual: '手動',
}

const triggerTones: Record<ScenarioTriggerType, 'success' | 'info' | 'neutral'> = {
  friend_add: 'success',
  tag_added: 'info',
  manual: 'neutral',
}

const deliveryModeMeta: Record<DeliveryMode, { tone: 'neutral' | 'info' | 'warning'; label: string }> = {
  relative: { tone: 'neutral', label: 'Legacy' },
  elapsed: { tone: 'info', label: '経過時間' },
  absolute_time: { tone: 'warning', label: '時刻指定' },
}

function ModeBadge({ mode }: { mode?: DeliveryMode }) {
  const m = deliveryModeMeta[mode ?? 'relative']
  return (
    <Badge tone={m.tone} className="shrink-0">
      {m.label}
    </Badge>
  )
}

interface ScenarioListProps {
  scenarios: ScenarioWithCount[]
  onToggleActive: (id: string, current: boolean) => void
  onDelete: (id: string) => void
  loading?: boolean
}

export default function ScenarioList({ scenarios, onToggleActive, onDelete, loading }: ScenarioListProps) {
  if (scenarios.length === 0) {
    return (
      <EmptyState
        title="シナリオがありません"
        description="新しいシナリオを作成してください。"
      />
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {scenarios.map((scenario) => {
        const triggerTone =
          triggerTones[scenario.triggerType as ScenarioTriggerType] ?? 'neutral'
        const triggerLabel =
          triggerLabels[scenario.triggerType] ?? scenario.triggerType

        return (
          <Card key={scenario.id} className="flex flex-col transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="leading-tight">
                  <Link
                    href={`/scenarios/detail?id=${scenario.id}`}
                    className="text-gray-900 hover:text-green-600 transition-colors"
                  >
                    {scenario.name}
                  </Link>
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  <ModeBadge mode={scenario.deliveryMode} />
                  {scenario.isActive ? (
                    <Badge tone="success" className="shrink-0">有効</Badge>
                  ) : (
                    <Badge tone="neutral" className="shrink-0">無効</Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
              {scenario.description && (
                <p className="text-xs text-gray-500 line-clamp-2">{scenario.description}</p>
              )}

              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <Badge tone={triggerTone}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {triggerLabel}
                </Badge>
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <span>ステップ数: {scenario.stepCount ?? '-'}</span>
                </span>
              </div>
            </CardContent>

            <CardFooter>
              <Link
                href={`/scenarios/detail?id=${scenario.id}`}
                className="flex-1 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1"
              >
                編集
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onToggleActive(scenario.id, scenario.isActive)}
                disabled={loading}
                className="min-h-[44px] flex-1"
              >
                {scenario.isActive ? '無効にする' : '有効にする'}
              </Button>
              {/* 削除 は赤系の tertiary なので primitives.tsx の Button variant とは色衝突する。
                  primitives 側に dangerGhost を足すまでは生 button で対応する。 */}
              <button
                type="button"
                onClick={() => {
                  if (confirm(`「${scenario.name}」を削除してもよいですか？`)) {
                    onDelete(scenario.id)
                  }
                }}
                disabled={loading}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                削除
              </button>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}
