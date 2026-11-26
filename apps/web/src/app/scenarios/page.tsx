'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { PlusIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import type { Scenario, ScenarioTriggerType, DeliveryMode } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import ScenarioList from '@/components/scenarios/scenario-list'
import ScenarioModePicker from '@/components/scenarios/scenario-mode-picker'
import CcPromptButton from '@/components/cc-prompt-button'

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
      const response = await api.scenarios.update(id, { isActive: !current })
      if (!response.success) throw new Error(response.error)
      await loadScenarios()
    } catch {
      setError('ステータスの変更に失敗しました')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const response = await api.scenarios.delete(id)
      if (!response.success) throw new Error(response.error)
      await loadScenarios()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="シナリオ配信"
        description="友だちの行動をきっかけに、複数のメッセージを順番に届けます。"
        action={<Button type="button" variant="primary" icon={PlusIcon} onClick={() => setPickerOpen(true)}>新規シナリオ</Button>}
      />

      {error ? <Banner className="mb-4" variant="error" title="操作を完了できませんでした" description={error} /> : null}

      <ScenarioModePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onCreate={handleCreate}
      />

      {loading ? (
        <LayerCard className="flex min-h-48 items-center justify-center gap-2 text-sm text-kumo-subtle"><Loader size="sm" />シナリオを読み込み中</LayerCard>
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
