import Link from 'next/link'
import type { Scenario } from '@line-crm/shared'

type ScenarioWithCount = Scenario & { stepCount?: number }

const triggerLabels: Record<string, string> = {
  friend_add: '友だち追加時',
  tag_added: 'タグ付与時',
  manual: '手動',
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
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
        <p className="text-gray-500">シナリオがありません。新しいシナリオを作成してください。</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {scenarios.map((scenario) => (
        <div key={scenario.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/scenarios/detail?id=${scenario.id}`}
              className="text-sm font-semibold text-gray-900 hover:text-green-600 transition-colors leading-tight"
            >
              {scenario.name}
            </Link>
            <span
              className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                scenario.isActive
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {scenario.isActive ? '有効' : '無効'}
            </span>
          </div>

          {/* Description */}
          {scenario.description && (
            <p className="text-xs text-gray-500 line-clamp-2">{scenario.description}</p>
          )}

          {/* Metadata */}
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>トリガー: {triggerLabels[scenario.triggerType] ?? scenario.triggerType}</span>
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span>ステップ数: {scenario.stepCount ?? '-'}</span>
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
            <Link
              href={`/scenarios/detail?id=${scenario.id}`}
              className="flex-1 text-center text-xs font-medium text-green-600 hover:text-green-700 py-1 min-h-[44px] flex items-center justify-center rounded-md hover:bg-green-50 transition-colors"
            >
              編集
            </Link>
            <button
              onClick={() => onToggleActive(scenario.id, scenario.isActive)}
              disabled={loading}
              className="flex-1 text-xs font-medium text-gray-600 hover:text-gray-900 py-1 min-h-[44px] flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors disabled:opacity-40"
            >
              {scenario.isActive ? '無効にする' : '有効にする'}
            </button>
            <button
              onClick={() => {
                if (confirm(`「${scenario.name}」を削除してもよいですか？`)) {
                  onDelete(scenario.id)
                }
              }}
              disabled={loading}
              className="flex-1 text-xs font-medium text-red-500 hover:text-red-700 py-1 min-h-[44px] flex items-center justify-center rounded-md hover:bg-red-50 transition-colors disabled:opacity-40"
            >
              削除
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
