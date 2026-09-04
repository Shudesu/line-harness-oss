'use client'

import { useState, useEffect, useCallback } from 'react'

import Link from 'next/link'
import type { Scenario, ScenarioStep, ScenarioTriggerType, MessageType, DeliveryMode } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import FlexPreviewComponent from '@/components/flex-preview'
import ScheduleInput, {
  emptySchedule,
  buildSchedulePayload,
  uiFromOffsetMinutes,
  type ScheduleValue,
} from '@/components/scenarios/schedule-input'
import BulkPreviewModal from '@/components/scenarios/bulk-preview-modal'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { Radio } from '@cloudflare/kumo/components/radio'
import { Select } from '@cloudflare/kumo/components/select'

type ScenarioWithSteps = Scenario & { steps: ScenarioStep[] }

const triggerOptions: { value: ScenarioTriggerType; label: string }[] = [
  { value: 'friend_add', label: '友だち追加時' },
  { value: 'tag_added', label: 'タグ付与時' },
  { value: 'manual', label: '手動' },
]

const messageTypeOptions: { value: MessageType; label: string }[] = [
  { value: 'text', label: 'テキスト' },
  { value: 'image', label: '画像' },
  { value: 'flex', label: 'Flex' },
]

const modeBadgeStyle: Record<DeliveryMode, { bg: string; text: string; label: string }> = {
  relative: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Legacy' },
  elapsed: { bg: 'bg-blue-50', text: 'text-blue-700', label: '経過時間' },
  absolute_time: { bg: 'bg-amber-50', text: 'text-amber-700', label: '時刻指定' },
}

function formatDelay(minutes: number): string {
  if (minutes === 0) return '即時'
  if (minutes < 60) return `${minutes}分後`
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m === 0 ? `${h}時間後` : `${h}時間${m}分後`
  }
  const d = Math.floor(minutes / 1440)
  const remaining = minutes % 1440
  if (remaining === 0) return `${d}日後`
  const h = Math.floor(remaining / 60)
  return h > 0 ? `${d}日${h}時間後` : `${d}日${remaining}分後`
}

function formatScheduleLabel(mode: DeliveryMode | undefined, step: ScenarioStep): string {
  const m = mode ?? 'relative'
  if (m === 'relative') return formatDelay(step.delayMinutes)
  if (m === 'elapsed') {
    const days = step.offsetDays ?? 0
    const mins = step.offsetMinutes ?? 0
    const h = Math.floor(mins / 60)
    const r = mins % 60
    if (days === 0 && mins === 0) return '即時 (購読開始)'
    const parts: string[] = []
    if (days > 0) parts.push(`${days}日`)
    if (h > 0) parts.push(`${h}時間`)
    if (r > 0) parts.push(`${r}分`)
    return `購読開始から${parts.join('')}後`
  }
  // absolute_time
  return `購読開始から${step.offsetDays ?? 0}日後の ${step.deliveryTime ?? '00:00'}`
}

interface StepFormState {
  stepOrder: number
  schedule: ScheduleValue
  messageType: MessageType
  messageContent: string
  templateId: string | null
  onReachTagId: string | null
  inputMode: 'direct' | 'template'
}

function emptyStepForm(stepOrder: number): StepFormState {
  return {
    stepOrder,
    schedule: { ...emptySchedule },
    messageType: 'text',
    messageContent: '',
    templateId: null,
    onReachTagId: null,
    inputMode: 'direct',
  }
}

interface TemplateOpt {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
}

interface TagOpt {
  id: string
  name: string
}

interface ScenarioStats {
  enrolledTotal: number
  activeNow: number
  completed: number
  paused: number
  steps: Array<{ stepOrder: number; reachedCount: number; reachRate: number }>
}

function FlexPreview({ content }: { content: string }) {
  return <FlexPreviewComponent content={content} maxWidth={300} />
}

function ImagePreview({ content }: { content: string }) {
  try {
    const parsed = JSON.parse(content)
    const url = parsed.previewImageUrl || parsed.originalContentUrl
    return (
      <div>
        <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded mb-2 inline-block">画像</span>
        {url ? (
          <img src={url} alt="preview" className="max-w-[200px] rounded-lg border border-gray-200 mt-1" />
        ) : (
          <p className="text-xs text-gray-400">プレビューなし</p>
        )}
      </div>
    )
  } catch {
    return <p className="text-xs text-red-500">画像 JSON パースエラー</p>
  }
}

export default function ScenarioDetailClient({ scenarioId }: { scenarioId: string }) {
  const id = scenarioId

  const [scenario, setScenario] = useState<ScenarioWithSteps | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', triggerType: 'friend_add' as ScenarioTriggerType, isActive: true })
  const [saving, setSaving] = useState(false)

  const [showStepForm, setShowStepForm] = useState(false)
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [stepForm, setStepForm] = useState<StepFormState>(() => emptyStepForm(1))
  const [stepSaving, setStepSaving] = useState(false)
  const [stepError, setStepError] = useState('')

  const [previewOpen, setPreviewOpen] = useState(false)

  const [stats, setStats] = useState<ScenarioStats | null>(null)
  const [templates, setTemplates] = useState<TemplateOpt[]>([])
  const [tags, setTags] = useState<TagOpt[]>([])
  const [deleteStepTarget, setDeleteStepTarget] = useState<string | null>(null)

  const deliveryMode: DeliveryMode = (scenario?.deliveryMode ?? 'relative') as DeliveryMode

  const loadScenario = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.scenarios.get(id)
      if (res.success) {
        setScenario(res.data)
        setEditForm({
          name: res.data.name,
          description: res.data.description ?? '',
          triggerType: res.data.triggerType,
          isActive: res.data.isActive,
        })
      } else {
        setError(res.error)
      }
    } catch {
      setError('シナリオの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadScenario()
  }, [loadScenario])

  // 並列で stats / templates / tags を取得（リグレッションを起こさないよう失敗は無視）
  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([
      api.scenarios.stats(id).catch(() => null),
      api.templates.list().catch(() => null),
      api.tags.list().catch(() => null),
    ]).then(([statsRes, tplRes, tagRes]) => {
      if (cancelled) return
      if (statsRes && statsRes.success) setStats(statsRes.data)
      if (tplRes && tplRes.success) {
        setTemplates(tplRes.data.map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          messageType: t.messageType,
          messageContent: t.messageContent,
        })))
      }
      if (tagRes && tagRes.success) {
        setTags(tagRes.data.map((t) => ({ id: t.id, name: t.name })))
      }
    })
    return () => { cancelled = true }
  }, [id])

  const reloadStats = useCallback(() => {
    api.scenarios.stats(id).then((r) => { if (r.success) setStats(r.data) }).catch(() => {})
  }, [id])

  const handleSaveScenario = async () => {
    if (!editForm.name.trim()) return
    setSaving(true)
    try {
      const res = await api.scenarios.update(id, {
        name: editForm.name,
        description: editForm.description || null,
        triggerType: editForm.triggerType,
        isActive: editForm.isActive,
      })
      if (res.success) {
        setEditing(false)
        loadScenario()
      } else {
        setError(res.error)
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const openAddStep = () => {
    const nextOrder = scenario ? (scenario.steps.length > 0 ? Math.max(...scenario.steps.map(s => s.stepOrder)) + 1 : 1) : 1
    setStepForm(emptyStepForm(nextOrder))
    setEditingStepId(null)
    setShowStepForm(true)
    setStepError('')
  }

  const openEditStep = (step: ScenarioStep) => {
    const ui = uiFromOffsetMinutes(step.offsetMinutes)
    setStepForm({
      stepOrder: step.stepOrder,
      schedule: {
        delayMinutes: step.delayMinutes,
        offsetDays: step.offsetDays ?? 0,
        offsetHours: ui.offsetHours,
        offsetMinutesRemainder: ui.offsetMinutesRemainder,
        deliveryTime: step.deliveryTime ?? '09:00',
      },
      messageType: step.messageType,
      messageContent: step.messageContent,
      templateId: step.templateId ?? null,
      onReachTagId: step.onReachTagId ?? null,
      inputMode: step.templateId ? 'template' : 'direct',
    })
    setEditingStepId(step.id)
    // 編集はステップ行直下にインライン表示するので、上部の新規追加フォームは閉じる
    setShowStepForm(false)
    setStepError('')
  }

  const closeStepForm = () => {
    setShowStepForm(false)
    setEditingStepId(null)
    setStepError('')
  }

  const handleSaveStep = async () => {
    // 直接入力モード: messageContent 必須 + Flex/画像 は JSON parse 検証
    if (stepForm.inputMode === 'direct') {
      if (!stepForm.messageContent.trim()) {
        setStepError('メッセージ内容を入力してください')
        return
      }
      if (stepForm.messageType === 'flex' || stepForm.messageType === 'image') {
        try {
          JSON.parse(stepForm.messageContent)
        } catch {
          setStepError(
            stepForm.messageType === 'flex'
              ? 'Flex メッセージの JSON が不正です'
              : '画像メッセージの JSON が不正です',
          )
          return
        }
      }
    } else {
      if (!stepForm.templateId) {
        setStepError('テンプレートを選択してください')
        return
      }
    }
    setStepSaving(true)
    setStepError('')
    try {
      const schedulePayload = buildSchedulePayload(deliveryMode, stepForm.schedule)
      // テンプレモード保存時は、選択中テンプレ内容を scenario_steps の messageType /
      // messageContent にスナップショットコピーする。テンプレ削除時に resolveStepContent
      // がここから正しい内容にフォールバックできるため。
      let payloadMessageType: MessageType = stepForm.messageType
      let payloadMessageContent: string = stepForm.messageContent || ' '
      if (stepForm.inputMode === 'template' && stepForm.templateId) {
        const tpl = templates.find((t) => t.id === stepForm.templateId)
        if (tpl) {
          // messageType: テンプレが image/carousel のときは scenario_steps の CHECK に
          // ('text','image','flex') の制約があるため text/image/flex のみ許容。
          // carousel が来る可能性は低いが念のため text にフォールバック。
          payloadMessageType = (['text', 'image', 'flex'].includes(tpl.messageType)
            ? tpl.messageType
            : 'text') as MessageType
          payloadMessageContent = tpl.messageContent || ' '
        }
      }
      const payload = {
        stepOrder: stepForm.stepOrder,
        ...schedulePayload,
        messageType: payloadMessageType,
        messageContent: payloadMessageContent,
        templateId: stepForm.inputMode === 'template' ? stepForm.templateId : null,
        onReachTagId: stepForm.onReachTagId,
      }
      if (editingStepId) {
        const res = await api.scenarios.updateStep(id, editingStepId, payload)
        if (!res.success) {
          setStepError(res.error)
          return
        }
      } else {
        const res = await api.scenarios.addStep(id, payload)
        if (!res.success) {
          setStepError(res.error)
          return
        }
      }
      closeStepForm()
      loadScenario()
      reloadStats()
    } catch {
      setStepError('ステップの保存に失敗しました')
    } finally {
      setStepSaving(false)
    }
  }

  const handleDeleteStep = async (stepId: string) => {
    try {
      await api.scenarios.deleteStep(id, stepId)
      if (editingStepId === stepId) closeStepForm()
      setDeleteStepTarget(null)
      loadScenario()
    } catch {
      setError('ステップの削除に失敗しました')
    }
  }

  const handleMoveStep = async (stepId: string, direction: 'up' | 'down') => {
    if (!scenario) return
    const sorted = [...scenario.steps].sort((a, b) => a.stepOrder - b.stepOrder)
    const idx = sorted.findIndex((s) => s.id === stepId)
    const swap = direction === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swap < 0 || swap >= sorted.length) return
    const a = sorted[idx]
    const b = sorted[swap]
    try {
      await api.scenarios.reorderSteps(id, [
        { stepId: a.id, stepOrder: b.stepOrder },
        { stepId: b.id, stepOrder: a.stepOrder },
      ])
      loadScenario()
      // 到達率バッジは stepOrder ベースでマッチングするので、並び替え後は stats も再取得
      reloadStats()
    } catch {
      setError('並び替えに失敗しました')
    }
  }

  // 新規追加（上部）とステップ編集（行直下インライン）の両方で使うフォーム。
  // 同時に開くのは常に片方だけなので、state は stepForm を共有する。
  const renderStepForm = () => (
    <div className={`${editingStepId ? 'mt-3' : 'mb-6'} p-4 bg-gray-50 rounded-lg border border-gray-200`}>
      <h4 className="text-sm font-medium text-gray-700 mb-3">
        {editingStepId ? 'ステップを編集' : '新しいステップを追加'}
      </h4>
      <div className="space-y-3 max-w-lg">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">ステップ順序</label>
          <Input
            label="ステップ順序"
            type="number"
            min={1}
            className="w-32"
            value={stepForm.stepOrder}
            onChange={(e) => setStepForm({ ...stepForm, stepOrder: Number(e.target.value) })}
          />
        </div>
        <ScheduleInput
          mode={deliveryMode}
          value={stepForm.schedule}
          onChange={(schedule) => setStepForm({ ...stepForm, schedule })}
        />

        {/* 入力モード切替: 直接入力 / テンプレート参照 */}
        <div className="space-y-2">
          <Radio.Group legend="メッセージの指定方法" value={stepForm.inputMode} onValueChange={(value) => setStepForm({ ...stepForm, inputMode: value, templateId: value === 'direct' ? null : stepForm.templateId })} className="flex gap-4">
            <Radio.Item value="direct" label="直接入力" />
            <Radio.Item value="template" label="テンプレートを使う" />
          </Radio.Group>
        </div>

        {stepForm.inputMode === 'template' && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">テンプレート <span className="text-red-500">*</span></label>
            <Select
              label="テンプレート"
              value={stepForm.templateId ?? ''}
              onValueChange={(value) => setStepForm({ ...stepForm, templateId: value || null })}
              placeholder="選択してください"
              items={Object.fromEntries(templates.map((template) => [template.id, `${template.name}${template.category ? ` (${template.category})` : ''}`]))}
            />
            <p className="text-xs text-amber-700 mt-1">
              ⓘ テンプレートが修正されると、このステップの内容も自動で同期されます
            </p>
          </div>
        )}

        {stepForm.inputMode === 'direct' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">メッセージタイプ</label>
              <Select
                label="メッセージタイプ"
                value={stepForm.messageType}
                onValueChange={(value) => setStepForm({ ...stepForm, messageType: (value ?? 'text') as MessageType })}
                items={Object.fromEntries(messageTypeOptions.map((option) => [option.value, option.label]))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">メッセージ内容 <span className="text-red-500">*</span></label>
              <InputArea
                label="メッセージ内容"
                minRows={4}
                placeholder="メッセージ内容を入力..."
                value={stepForm.messageContent}
                onValueChange={(value) => setStepForm({ ...stepForm, messageContent: value })}
              />
            </div>
          </>
        )}

        {/* 到達時のアクション */}
        <div className="pt-3 border-t border-gray-200 space-y-2">
          <h4 className="text-xs font-semibold text-gray-700">到達時のアクション</h4>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">到達したらタグ付与</label>
            <Select
              label="到達したらタグ付与"
              value={stepForm.onReachTagId ?? ''}
              onValueChange={(value) => setStepForm({ ...stepForm, onReachTagId: value || null })}
              placeholder="なし"
              items={Object.fromEntries(tags.map((tag) => [tag.id, tag.name]))}
            />
            <p className="text-xs text-gray-400 mt-0.5">
              このステップが配信完了したら、選んだタグを友だちに付与します
            </p>
          </div>
        </div>

        {stepError && <Banner size="sm" variant="error" title="保存できませんでした" description={stepError} />}

        <div className="flex gap-2">
          <Button type="button" variant="primary" loading={stepSaving}
            onClick={handleSaveStep}
            disabled={stepSaving}
          >
            {editingStepId ? '更新' : '追加'}
          </Button>
          <Button type="button" variant="secondary"
            onClick={closeStepForm}
          >
            キャンセル
          </Button>
        </div>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div>
        <Header title="シナリオ詳細" />
        <div className="bg-white rounded-lg border border-gray-200 p-8 animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-100 rounded w-2/3" />
          <div className="h-4 bg-gray-100 rounded w-1/2" />
        </div>
      </div>
    )
  }

  if (!scenario) {
    return (
      <div>
        <Header title="シナリオ詳細" />
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500">{error || 'シナリオが見つかりません'}</p>
          <Link href="/scenarios" className="text-sm text-green-600 hover:text-green-700 mt-4 inline-block">
            ← シナリオ一覧に戻る
          </Link>
        </div>
      </div>
    )
  }

  const sortedSteps = [...scenario.steps].sort((a, b) => a.stepOrder - b.stepOrder)
  const modeBadge = modeBadgeStyle[deliveryMode]

  return (
    <div>
      <Header
        title="シナリオ詳細"
        action={
          <Link
            href="/scenarios"
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors inline-flex items-center"
          >
            ← シナリオ一覧
          </Link>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Stats Header Bar */}
      {stats && stats.enrolledTotal > 0 && (
        <div className="mb-4 bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-4 text-sm flex-wrap">
          <span className="font-medium text-gray-700">📊 集計</span>
          <span>登録 <span className="font-semibold">{stats.enrolledTotal}</span> 人</span>
          <span className="text-gray-400">/</span>
          <span>進行中 <span className="font-semibold text-blue-700">{stats.activeNow}</span></span>
          <span className="text-gray-400">/</span>
          <span>完了 <span className="font-semibold text-green-700">{stats.completed}</span></span>
          {stats.paused > 0 && (
            <>
              <span className="text-gray-400">/</span>
              <span>一時停止 {stats.paused}</span>
            </>
          )}
        </div>
      )}

      {/* Scenario Info */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        {editing ? (
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">シナリオ名 <span className="text-red-500">*</span></label>
              <Input
                label="シナリオ名"
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">説明</label>
              <InputArea
                label="説明"
                minRows={2}
                value={editForm.description}
                onValueChange={(value) => setEditForm({ ...editForm, description: value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">トリガー</label>
              <Select
                label="トリガー"
                value={editForm.triggerType}
                onValueChange={(value) => setEditForm({ ...editForm, triggerType: (value ?? 'friend_add') as ScenarioTriggerType })}
                items={Object.fromEntries(triggerOptions.map((option) => [option.value, option.label]))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                label="有効"
                checked={editForm.isActive}
                onCheckedChange={(checked) => setEditForm({ ...editForm, isActive: checked })}
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="primary" loading={saving}
                onClick={handleSaveScenario}
                disabled={saving}
              >
                保存
              </Button>
              <Button type="button" variant="secondary"
                onClick={() => {
                  setEditing(false)
                  setEditForm({
                    name: scenario.name,
                    description: scenario.description ?? '',
                    triggerType: scenario.triggerType,
                    isActive: scenario.isActive,
                  })
                }}
              >
                キャンセル
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-4 mb-3">
              <h2 className="text-lg font-semibold text-gray-900">{scenario.name}</h2>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${modeBadge.bg} ${modeBadge.text}`}>
                  {modeBadge.label}
                </span>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    scenario.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {scenario.isActive ? '有効' : '無効'}
                </span>
                <Button type="button" size="xs" variant="ghost"
                  onClick={() => setEditing(true)}
                >
                  編集
                </Button>
              </div>
            </div>
            {scenario.description && (
              <p className="text-sm text-gray-500 mb-3">{scenario.description}</p>
            )}
            <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
              <span>トリガー: {triggerOptions.find(o => o.value === scenario.triggerType)?.label ?? scenario.triggerType}</span>
              <span>ステップ数: {scenario.steps.length}</span>
              <span>作成日: {new Date(scenario.createdAt).toLocaleDateString('ja-JP')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-800">ステップ一覧</h3>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary"
              onClick={() => setPreviewOpen(true)}
              disabled={sortedSteps.length === 0}
            >
              一括プレビュー
            </Button>
            <Button type="button" size="sm" variant="primary"
              onClick={openAddStep}
            >
              + ステップ追加
            </Button>
          </div>
        </div>

        {/* 新規ステップ追加フォーム（編集フォームは各ステップの行直下にインライン表示） */}
        {showStepForm && renderStepForm()}

        {/* Steps list */}
        {sortedSteps.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            ステップがありません。「+ ステップ追加」から追加してください。
          </div>
        ) : (
          <div className="space-y-3">
            {sortedSteps.map((step, idx) => (
              <div
                key={step.id}
                className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-kumo-brand text-xs font-bold text-kumo-inverse shrink-0"
                      >
                        {step.stepOrder}
                      </span>
                      <span className="text-xs text-gray-500">{formatScheduleLabel(deliveryMode, step)}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        step.messageType === 'text' ? 'bg-blue-50 text-blue-600' :
                        step.messageType === 'image' ? 'bg-purple-50 text-purple-600' :
                        'bg-orange-50 text-orange-600'
                      }`}>
                        {messageTypeOptions.find(o => o.value === step.messageType)?.label ?? step.messageType}
                      </span>
                      {(() => {
                        const stat = stats?.steps.find((s) => s.stepOrder === step.stepOrder)
                        return stat ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700">
                            📊 {stat.reachedCount}人到達 ({Math.round(stat.reachRate * 100)}%)
                          </span>
                        ) : null
                      })()}
                    </div>
                    {(() => {
                      // テンプレ参照時は、表示も「現在のテンプレ内容」を見せる。
                      // (templates state には list で取得済みの最新内容が入っている)
                      const tpl = step.templateId ? templates.find((t) => t.id === step.templateId) : null
                      const displayType = tpl ? tpl.messageType : step.messageType
                      const displayContent = tpl ? tpl.messageContent : step.messageContent
                      return (
                        <div className="text-sm text-gray-700 bg-gray-50 rounded-md px-3 py-2">
                          {displayType === 'text' ? (
                            <p className="whitespace-pre-wrap break-words">{displayContent}</p>
                          ) : displayType === 'flex' ? (
                            <FlexPreview content={displayContent} />
                          ) : displayType === 'image' ? (
                            <ImagePreview content={displayContent} />
                          ) : (
                            <p className="whitespace-pre-wrap break-words">{displayContent}</p>
                          )}
                        </div>
                      )
                    })()}
                    {step.templateId && (
                      <p className="mt-2 text-xs text-amber-700">
                        📋 テンプレ: {templates.find((t) => t.id === step.templateId)?.name ?? step.templateId}
                      </p>
                    )}
                    {step.onReachTagId && (
                      <p className="mt-1 text-xs text-green-700">
                        🏷 到達タグ: {tags.find((t) => t.id === step.onReachTagId)?.name ?? step.onReachTagId}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-stretch gap-1 shrink-0">
                    <div className="flex gap-1">
                      <Button type="button" size="xs" shape="square" variant="ghost" title="上へ"
                        onClick={() => handleMoveStep(step.id, 'up')}
                        disabled={idx === 0}
                        aria-label="上へ"
                      >
                        ↑
                      </Button>
                      <Button type="button" size="xs" shape="square" variant="ghost" title="下へ"
                        onClick={() => handleMoveStep(step.id, 'down')}
                        disabled={idx === sortedSteps.length - 1}
                        aria-label="下へ"
                      >
                        ↓
                      </Button>
                    </div>
                    <Button type="button" size="xs" variant="ghost"
                      onClick={() => (editingStepId === step.id ? closeStepForm() : openEditStep(step))}
                    >
                      {editingStepId === step.id ? '閉じる' : '編集'}
                    </Button>
                    <Button type="button" size="xs" variant="destructive"
                      onClick={() => setDeleteStepTarget(step.id)}
                    >
                      削除
                    </Button>
                  </div>
                </div>
                {/* インライン編集フォーム: 編集対象ステップの行直下に展開 */}
                {editingStepId === step.id && renderStepForm()}
              </div>
            ))}
          </div>
        )}
      </div>

      <BulkPreviewModal
        open={previewOpen}
        scenarioId={id}
        onClose={() => setPreviewOpen(false)}
      />
      <Dialog.Root role="alertdialog" open={deleteStepTarget !== null} onOpenChange={(open) => { if (!open) setDeleteStepTarget(null) }}><Dialog><Dialog.Title>このステップを削除しますか？</Dialog.Title><Dialog.Description className="mt-2">配信内容と到達時アクションを削除します。</Dialog.Description><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDeleteStepTarget(null)}>キャンセル</Button><Button type="button" variant="destructive" onClick={() => { if (deleteStepTarget) void handleDeleteStep(deleteStepTarget) }}>削除</Button></div></Dialog></Dialog.Root>
    </div>
  )
}
