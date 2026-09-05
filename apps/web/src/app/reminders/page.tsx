'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { Select } from '@cloudflare/kumo/components/select'

interface Reminder {
  id: string
  name: string
  description: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface ReminderStep {
  id: string
  reminderId: string
  offsetMinutes: number
  messageType: string
  messageContent: string
  createdAt: string
}

interface ReminderWithSteps extends Reminder {
  steps: ReminderStep[]
}

interface CreateFormState {
  name: string
  description: string
}

interface StepFormState {
  offsetMinutes: number
  messageType: string
  messageContent: string
}

function formatOffset(minutes: number): string {
  const abs = Math.abs(minutes)
  const sign = minutes < 0 ? '' : '+'
  if (abs === 0) return '基準時刻'
  if (abs < 60) return `${sign}${minutes}分`
  if (abs % 1440 === 0) {
    const days = abs / 1440
    return minutes < 0 ? `${days}日前` : `${days}日後`
  }
  if (abs % 60 === 0) {
    const hours = abs / 60
    return minutes < 0 ? `${hours}時間前` : `${hours}時間後`
  }
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  const prefix = minutes < 0 ? '-' : '+'
  return `${prefix}${hours}時間${mins}分`
}

const messageTypeLabels: Record<string, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flex',
}

const ccPrompts = [
  {
    title: 'リマインダー作成',
    prompt: `新しいリマインダーの作成をサポートしてください。
1. リマインダーの用途別テンプレート（セミナー、予約、フォローアップ）を提案
2. 効果的なリマインダー名と説明文の書き方
3. 有効化タイミングと対象者設定のベストプラクティス
手順を示してください。`,
  },
  {
    title: 'リマインダーステップ設計',
    prompt: `リマインダーのステップ配信を設計してください。
1. オフセット時間の最適な設定（例: -24h, -1h, +30m）を提案
2. 各ステップのメッセージ内容テンプレートを作成
3. テキスト・画像・Flexメッセージの使い分けガイド
手順を示してください。`,
  },
]

export default function RemindersPage() {
  const { selectedAccountId } = useAccount()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateFormState>({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Expanded card state
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedData, setExpandedData] = useState<ReminderWithSteps | null>(null)
  const [expandLoading, setExpandLoading] = useState(false)

  // Step form state
  const [showStepForm, setShowStepForm] = useState(false)
  const [stepForm, setStepForm] = useState<StepFormState>({
    offsetMinutes: -60,
    messageType: 'text',
    messageContent: '',
  })
  const [stepSaving, setStepSaving] = useState(false)
  const [stepFormError, setStepFormError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'reminder' | 'step'; id: string } | null>(null)

  const loadReminders = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.reminders.list({ accountId: selectedAccountId || undefined })
      if (res.success) {
        setReminders(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('リマインダーの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    loadReminders()
  }, [loadReminders])

  const loadDetail = useCallback(async (id: string) => {
    setExpandLoading(true)
    try {
      const res = await api.reminders.get(id)
      if (res.success) {
        setExpandedData(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('詳細の読み込みに失敗しました')
    } finally {
      setExpandLoading(false)
    }
  }, [])

  const handleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setExpandedData(null)
      setShowStepForm(false)
      return
    }
    setExpandedId(id)
    setExpandedData(null)
    setShowStepForm(false)
    setStepFormError('')
    loadDetail(id)
  }

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError('リマインダー名を入力してください')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const res = await api.reminders.create({
        name: form.name,
        description: form.description || undefined,
      })
      if (res.success) {
        setShowCreate(false)
        setForm({ name: '', description: '' })
        loadReminders()
      } else {
        setFormError(res.error)
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await api.reminders.update(id, { isActive: !current })
      loadReminders()
      if (expandedId === id && expandedData) {
        setExpandedData({ ...expandedData, isActive: !current })
      }
    } catch {
      setError('ステータスの変更に失敗しました')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.reminders.delete(id)
      if (expandedId === id) {
        setExpandedId(null)
        setExpandedData(null)
      }
      loadReminders()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const handleAddStep = async () => {
    if (!expandedId) return
    if (!stepForm.messageContent.trim()) {
      setStepFormError('メッセージ内容を入力してください')
      return
    }
    setStepSaving(true)
    setStepFormError('')
    try {
      const res = await api.reminders.addStep(expandedId, {
        offsetMinutes: stepForm.offsetMinutes,
        messageType: stepForm.messageType,
        messageContent: stepForm.messageContent,
      })
      if (res.success) {
        setShowStepForm(false)
        setStepForm({ offsetMinutes: -60, messageType: 'text', messageContent: '' })
        loadDetail(expandedId)
      } else {
        setStepFormError(res.error)
      }
    } catch {
      setStepFormError('ステップの追加に失敗しました')
    } finally {
      setStepSaving(false)
    }
  }

  const handleDeleteStep = async (stepId: string) => {
    if (!expandedId) return
    try {
      await api.reminders.deleteStep(expandedId, stepId)
      loadDetail(expandedId)
    } catch {
      setError('ステップの削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="リマインダ配信"
        action={
          <Button
            type="button"
            variant="primary"
            onClick={() => setShowCreate(true)}
          >
            + 新規リマインダー
          </Button>
        }
      />

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">新規リマインダーを作成</h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">リマインダー名 <span className="text-red-500">*</span></label>
              <Input
                label="リマインダー名"
                type="text"
                required
                placeholder="例: セミナー参加リマインダー"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">説明</label>
              <InputArea
                label="説明"
                minRows={2}
                placeholder="リマインダーの説明 (省略可)"
                value={form.description}
                onValueChange={(value) => setForm({ ...form, description: value })}
              />
            </div>

            {formError && <Banner size="sm" variant="error" title="作成できませんでした" description={formError} />}

            <div className="flex gap-2">
              <Button type="button" variant="primary" loading={saving}
                onClick={handleCreate}
                disabled={saving}
              >
                作成
              </Button>
              <Button type="button" variant="secondary"
                onClick={() => { setShowCreate(false); setFormError('') }}
              >
                キャンセル
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
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
      ) : reminders.length === 0 && !showCreate ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">リマインダーがありません。「新規リマインダー」から作成してください。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {reminders.map((reminder) => {
            const isExpanded = expandedId === reminder.id

            return (
              <div
                key={reminder.id}
                className={`bg-white rounded-lg shadow-sm border border-gray-200 transition-all ${isExpanded ? 'md:col-span-2 xl:col-span-3' : ''}`}
              >
                {/* Card header */}
                <div
                  className="p-5 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => handleExpand(reminder.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-gray-900 truncate">{reminder.name}</h3>
                      {reminder.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{reminder.description}</p>
                      )}
                    </div>
                    <span
                      className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                        reminder.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {reminder.isActive ? '有効' : '無効'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                    <span>作成日: {new Date(reminder.createdAt).toLocaleDateString('ja-JP')}</span>
                    <span className="flex items-center gap-1">
                      {isExpanded ? '▲ 閉じる' : '▼ 詳細'}
                    </span>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-gray-200 p-5">
                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <Button
                        type="button"
                        size="sm"
                        variant={reminder.isActive ? 'secondary' : 'primary'}
                        onClick={(e) => { e.stopPropagation(); handleToggleActive(reminder.id, reminder.isActive) }}
                      >
                        {reminder.isActive ? '無効にする' : '有効にする'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={(e) => { e.stopPropagation(); setPendingDelete({ kind: 'reminder', id: reminder.id }) }}
                      >
                        削除
                      </Button>
                    </div>

                    {/* Steps */}
                    {expandLoading ? (
                      <div className="space-y-2 animate-pulse">
                        <div className="h-3 bg-gray-200 rounded w-32" />
                        <div className="h-10 bg-gray-100 rounded" />
                        <div className="h-10 bg-gray-100 rounded" />
                      </div>
                    ) : expandedData ? (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-semibold text-gray-700">
                            ステップ ({expandedData.steps.length}件)
                          </h4>
                          <Button type="button" size="sm" variant="primary"
                            onClick={() => { setShowStepForm(true); setStepFormError('') }}
                          >
                            + ステップ追加
                          </Button>
                        </div>

                        {expandedData.steps.length === 0 ? (
                          <p className="text-xs text-gray-400 py-4 text-center">ステップがありません。「ステップ追加」から作成してください。</p>
                        ) : (
                          <div className="space-y-2">
                            {expandedData.steps
                              .sort((a, b) => a.offsetMinutes - b.offsetMinutes)
                              .map((step) => (
                                <div
                                  key={step.id}
                                  className="flex items-start justify-between bg-gray-50 rounded-lg p-3 border border-gray-100"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                                        {formatOffset(step.offsetMinutes)}
                                      </span>
                                      <span className="text-xs text-gray-400">
                                        {messageTypeLabels[step.messageType] ?? step.messageType}
                                      </span>
                                    </div>
                                    <p className="text-xs text-gray-600 whitespace-pre-wrap break-words line-clamp-3">
                                      {step.messageContent}
                                    </p>
                                  </div>
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="destructive"
                                    onClick={() => setPendingDelete({ kind: 'step', id: step.id })}
                                    className="ml-2 shrink-0"
                                  >
                                    削除
                                  </Button>
                                </div>
                              ))}
                          </div>
                        )}

                        {/* Add step form */}
                        {showStepForm && (
                          <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
                            <h5 className="text-xs font-semibold text-gray-700 mb-3">ステップを追加</h5>
                            <div className="space-y-3 max-w-lg">
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">オフセット (分)</label>
                                <Input
                                  label="オフセット (分)"
                                  type="number"
                                  placeholder="例: -60 (1時間前), +30 (30分後)"
                                  value={stepForm.offsetMinutes}
                                  onChange={(e) => setStepForm({ ...stepForm, offsetMinutes: Number(e.target.value) })}
                                />
                                <p className="text-xs text-gray-400 mt-1">
                                  現在の値: {formatOffset(stepForm.offsetMinutes)}
                                </p>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">メッセージタイプ</label>
                                <Select
                                  label="メッセージタイプ"
                                  value={stepForm.messageType}
                                  onValueChange={(value) => setStepForm({ ...stepForm, messageType: value ?? 'text' })}
                                  items={{ text: 'テキスト', image: '画像', flex: 'Flex' }}
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">メッセージ内容 <span className="text-red-500">*</span></label>
                                <InputArea
                                  label="メッセージ内容"
                                  minRows={3}
                                  placeholder="メッセージ内容を入力"
                                  value={stepForm.messageContent}
                                  onValueChange={(value) => setStepForm({ ...stepForm, messageContent: value })}
                                />
                              </div>

                              {stepFormError && <Banner size="sm" variant="error" title="追加できませんでした" description={stepFormError} />}

                              <div className="flex gap-2">
                                <Button type="button" variant="primary" loading={stepSaving}
                                  onClick={handleAddStep}
                                  disabled={stepSaving}
                                >
                                  追加
                                </Button>
                                <Button type="button" variant="secondary"
                                  onClick={() => { setShowStepForm(false); setStepFormError('') }}
                                >
                                  キャンセル
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <Dialog.Root role="alertdialog" open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
        <Dialog>
          <Dialog.Title>{pendingDelete?.kind === 'step' ? 'このステップを削除しますか？' : 'このリマインダーを削除しますか？'}</Dialog.Title>
          <Dialog.Description className="mt-2">削除した内容は元に戻せません。</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPendingDelete(null)}>キャンセル</Button>
            <Button type="button" variant="destructive" onClick={() => { if (!pendingDelete) return; const target = pendingDelete; setPendingDelete(null); if (target.kind === 'step') void handleDeleteStep(target.id); else void handleDelete(target.id) }}>削除</Button>
          </div>
        </Dialog>
      </Dialog.Root>
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
