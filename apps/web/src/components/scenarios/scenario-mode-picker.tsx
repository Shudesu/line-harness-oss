'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, ClockIcon, HourglassIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { Radio } from '@cloudflare/kumo/components/radio'
import { Select } from '@cloudflare/kumo/components/select'
import type { DeliveryMode, ScenarioTriggerType, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (input: {
    name: string
    triggerType: ScenarioTriggerType
    triggerTagId: string | null
    deliveryMode: DeliveryMode
  }) => Promise<void>
}

const triggerOptions: Array<{ value: ScenarioTriggerType; label: string; description: string }> = [
  { value: 'friend_add', label: '友だち追加時', description: '新規友だち追加のタイミングで自動開始' },
  { value: 'tag_added', label: 'タグ付与時', description: '指定タグが付いたタイミングで自動開始' },
  { value: 'manual', label: '手動', description: '管理画面またはAPIから開始したときだけ流れる' },
]

export default function ScenarioModePicker({ open, onClose, onCreate }: Props) {
  const [stage, setStage] = useState<'pick' | 'name'>('pick')
  const [mode, setMode] = useState<DeliveryMode>('elapsed')
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState<ScenarioTriggerType>('friend_add')
  const [triggerTagId, setTriggerTagId] = useState('')
  const [tags, setTags] = useState<Tag[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [tagsState, setTagsState] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    if (!open) return
    setTagsState('loading')
    api.tags.list().then((res) => {
      if (res.success) {
        setTags(res.data)
        setTagsState('ready')
      } else setTagsState('failed')
    }).catch(() => setTagsState('failed'))
  }, [open])

  const reset = () => {
    setStage('pick')
    setName('')
    setMode('elapsed')
    setTriggerType('friend_add')
    setTriggerTagId('')
    setError('')
  }

  const handleClose = () => {
    if (submitting) return
    reset()
    onClose()
  }

  const chooseMode = (nextMode: DeliveryMode) => {
    setMode(nextMode)
    setStage('name')
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('シナリオ名を入力してください')
      return
    }
    if (triggerType === 'tag_added' && !triggerTagId) {
      setError('トリガータグを選択してください')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onCreate({ name, triggerType, triggerTagId: triggerType === 'tag_added' ? triggerTagId : null, deliveryMode: mode })
      reset()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const modeLabel = mode === 'absolute_time' ? '時刻で指定' : mode === 'elapsed' ? '経過時間で指定' : '既存方式'

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleClose() }}>
      <Dialog size="lg" className="max-h-[90vh] overflow-y-auto p-6">
        {stage === 'pick' ? (
          <>
            <Dialog.Title className="text-lg font-semibold text-kumo-strong">配信方式を選択</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-kumo-subtle">友だちへ届ける時間の決め方を選びます。</Dialog.Description>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Button type="button" variant="secondary" className="h-auto items-start justify-start p-5 text-left" onClick={() => chooseMode('absolute_time')}>
                <ClockIcon className="mt-0.5 shrink-0 text-kumo-warning" size={24} />
                <span>
                  <span className="block font-semibold text-kumo-strong">毎日◯時に配信</span>
                  <span className="mt-1 block text-sm text-kumo-subtle">例：翌日の朝9:00。深夜配信を避けやすい方式です。</span>
                </span>
              </Button>
              <Button type="button" variant="secondary" className="h-auto items-start justify-start p-5 text-left" onClick={() => chooseMode('elapsed')}>
                <HourglassIcon className="mt-0.5 shrink-0 text-kumo-info" size={24} />
                <span>
                  <span className="block font-semibold text-kumo-strong">追加◯時間後に配信</span>
                  <span className="mt-1 block text-sm text-kumo-subtle">例：追加から5時間後。開始時刻によっては深夜配信になります。</span>
                </span>
              </Button>
            </div>
            <div className="mt-5 flex items-center justify-between gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => chooseMode('relative')}>既存方式で作成</Button>
              <Button type="button" variant="secondary" onClick={handleClose}>キャンセル</Button>
            </div>
          </>
        ) : (
          <>
            <Dialog.Title className="text-lg font-semibold text-kumo-strong">シナリオを作成</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-kumo-subtle">配信方式：{modeLabel}</Dialog.Description>
            <div className="mt-5 space-y-4">
              <Input
                autoFocus
                label="シナリオ名"
                required
                placeholder="例：友だち追加ウェルカム"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && triggerType !== 'tag_added' && !submitting) void handleCreate() }}
              />
              <Radio.Group
                legend="いつ開始する？"
                appearance="card"
                value={triggerType}
                onValueChange={(value) => setTriggerType(value)}
                className="grid gap-2"
              >
                {triggerOptions.map((option) => (
                  <Radio.Item key={option.value} value={option.value} label={option.label} description={option.description} />
                ))}
              </Radio.Group>

              {triggerType === 'tag_added' ? (
                <Select
                  label="トリガータグ"
                  required
                  value={triggerTagId}
                  onValueChange={(value) => setTriggerTagId(value ?? '')}
                  disabled={tagsState !== 'ready' || tags.length === 0}
                  placeholder={tagsState === 'loading' ? '読み込み中' : tagsState === 'failed' ? '取得できませんでした' : tags.length === 0 ? 'タグがまだありません' : '選択してください'}
                  items={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
                  description={tagsState === 'ready' && tags.length > 0 ? 'このタグが付いた友だちへ自動で開始します。' : undefined}
                  error={tagsState === 'failed' ? 'タグ一覧を取得できませんでした。再読み込みしてください。' : undefined}
                />
              ) : null}
              {triggerType === 'tag_added' && tagsState === 'ready' && tags.length === 0 ? (
                <Banner
                  size="sm"
                  variant="alert"
                  title="タグがまだ1つもありません"
                  description={<span>先に<Link href="/tags" className="mx-1 font-medium underline">タグ管理</Link>でタグを作成してください。</span>}
                />
              ) : null}
              {error ? <Banner size="sm" variant="error" title="作成できません" description={error} /> : null}
            </div>
            <div className="mt-6 flex justify-between gap-2">
              <Button type="button" variant="secondary" icon={ArrowLeftIcon} disabled={submitting} onClick={() => setStage('pick')}>戻る</Button>
              <Button type="button" variant="primary" loading={submitting} onClick={() => void handleCreate()}>作成して編集へ</Button>
            </div>
          </>
        )}
      </Dialog>
    </Dialog.Root>
  )
}
