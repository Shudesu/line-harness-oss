'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Scenario, ScenarioTriggerType, DeliveryMode } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import ScenarioList from '@/components/scenarios/scenario-list'
import ScenarioModePicker from '@/components/scenarios/scenario-mode-picker'
import CcPromptButton from '@/components/cc-prompt-button'
import { Banner } from '@/components/ui/primitives'

const ccPrompts = [
  {
    title: '新しいシナリオを作成',
    prompt: `新しいシナリオ配信を作成してください。
1. ターゲット: [対象を指定]
2. トリガー: 友だち追加 / タグ変更 / 手動
3. ステップ数: [希望数]
4. メッセージ内容の提案もお願いします
各ステップの配信間隔も含めて構成してください。`,
  },
  {
    title: 'シナリオの効果分析',
    prompt: `現在のシナリオ配信の効果を分析してください。
1. 各シナリオの配信実績を確認
2. ステップごとの離脱率を分析
3. 改善が必要なシナリオを特定
具体的な改善案を提示してください。`,
  },
]

type ScenarioWithCount = Scenario & { stepCount?: number }

export default function ScenariosPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const router = useRouter()
  const [scenarios, setScenarios] = useState<ScenarioWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const loadScenarios = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.scenarios.list({ accountId: selectedAccountId || undefined })
      if (res.success) {
        setScenarios(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('シナリオの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    let cancelled = false
    const fetchData = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.scenarios.list({ accountId: selectedAccountId || undefined })
        if (cancelled) return
        if (res.success) {
          setScenarios(res.data)
        } else {
          setError(res.error)
        }
      } catch {
        if (cancelled) return
        setError('シナリオの読み込みに失敗しました。もう一度お試しください。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId, accountLoading])

  const handleCreate = async (input: {
    name: string
    triggerType: ScenarioTriggerType
    triggerTagId: string | null
    deliveryMode: DeliveryMode
  }) => {
    const res = await api.scenarios.create({
      name: input.name,
      description: null,
      triggerType: input.triggerType,
      triggerTagId: input.triggerTagId,
      lineAccountId: selectedAccountId,
      isActive: true,
      deliveryMode: input.deliveryMode,
    })
    if (res.success) {
      router.push(`/scenarios/detail?id=${res.data.id}`)
    } else {
      throw new Error(res.error)
    }
  }

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await api.scenarios.update(id, { isActive: !current })
      loadScenarios()
    } catch {
      setError('ステータスの変更に失敗しました')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.scenarios.delete(id)
      loadScenarios()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      {/* LINE ブランドカラー (#06C755) は primitives.tsx の Button variant に無いため、
          色衝突を避けるべく生 button を使う。primitives に brand variant が増えたら差し替え。 */}
      <Header
        title="シナリオ配信"
        action={
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規シナリオ
          </button>
        }
      />

      {error && (
        <div className="mb-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <ScenarioModePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onCreate={handleCreate}
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-full" />
              <div className="flex gap-4">
                <div className="h-3 bg-gray-100 rounded w-24" />
                <div className="h-3 bg-gray-100 rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ScenarioList
          scenarios={scenarios}
          onToggleActive={handleToggleActive}
          onDelete={handleDelete}
          loading={loading}
        />
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
