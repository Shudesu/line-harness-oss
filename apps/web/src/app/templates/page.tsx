'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { FloppyDiskIcon, PlusIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'
import { Table } from '@cloudflare/kumo/components/table'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import FlexPreviewComponent from '@/components/flex-preview'
import CcPromptButton from '@/components/cc-prompt-button'
import ImageUploader from '@/components/shared/image-uploader'

interface Template {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  usageCount: number
  createdAt: string
  updatedAt: string
}

interface TemplateDetail {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  usedBy: {
    autoReplies: Array<{ id: string; keyword: string; matchType: 'exact' | 'contains'; lineAccountId: string | null }>
    automations: Array<{ id: string; name: string; eventType: string }>
  }
  createdAt: string
  updatedAt: string
}

type TypeFilter = 'all' | 'text' | 'flex' | 'image' | 'unused'

const messageTypeLabels: Record<string, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flex',
  carousel: 'Carousel',
}

const filterOptions: Array<{ key: TypeFilter; label: string }> = [
  { key: 'all', label: '全て' },
  { key: 'text', label: 'テキスト' },
  { key: 'flex', label: 'Flex' },
  { key: 'image', label: '画像' },
  { key: 'unused', label: '未使用' },
]

const messageTypeItems = [
  { value: 'text', label: 'テキスト' },
  { value: 'flex', label: 'Flex' },
  { value: 'image', label: '画像' },
]

function messageTypeVariant(type: string): 'neutral' | 'info' | 'warning' {
  if (type === 'image') return 'info'
  if (type === 'carousel') return 'warning'
  return 'neutral'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ccPrompts = [
  {
    title: 'テンプレート作成',
    prompt: `新しいメッセージテンプレートの作成をサポートしてください。
1. 用途別（挨拶、キャンペーン、通知、フォローアップ）のテンプレート文例を提案
2. テキスト・Flexメッセージそれぞれの効果的な使い方
3. カテゴリ分類と命名規則のベストプラクティス
手順を示してください。`,
  },
]

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [form, setForm] = useState({ name: '', category: 'general', messageType: 'text', messageContent: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Template | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [drawerData, setDrawerData] = useState<TemplateDetail | null>(null)
  const [scenarioStepUsages, setScenarioStepUsages] = useState<Array<{
    scenarioId: string
    scenarioName: string
    stepId: string
    stepOrder: number
  }>>([])
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)
  const [editContent, setEditContent] = useState<string | null>(null)
  const [editName, setEditName] = useState<string | null>(null)
  const [editError, setEditError] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.templates.list()
      if (response.success) setTemplates(response.data)
      else setError(response.error)
    } catch {
      setError('テンプレートの読み込みに失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!drawerId) {
      setDrawerData(null)
      setDrawerError(null)
      setScenarioStepUsages([])
      return
    }

    let cancelled = false
    setDrawerLoading(true)
    setDrawerError(null)
    setDrawerData(null)
    setScenarioStepUsages([])
    Promise.all([
      api.templates.get(drawerId),
      api.templates.usages(drawerId).catch(() => null),
    ]).then(([detailResponse, usagesResponse]) => {
      if (cancelled) return
      if (detailResponse.success && detailResponse.data) setDrawerData(detailResponse.data)
      else setDrawerError((detailResponse as { error?: string }).error ?? '読み込みに失敗しました')
      if (usagesResponse?.success) setScenarioStepUsages(usagesResponse.data.scenarioSteps)
    }).catch((reason) => {
      if (!cancelled) setDrawerError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (!cancelled) setDrawerLoading(false)
    })
    return () => { cancelled = true }
  }, [drawerId])

  useEffect(() => {
    setEditContent(null)
    setEditName(null)
    setEditError('')
  }, [drawerId])

  const filteredTemplates = templates.filter((template) => {
    if (typeFilter === 'all') return true
    if (typeFilter === 'unused') return template.usageCount === 0
    return template.messageType === typeFilter
  })

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setFormError('テンプレート名を入力してください')
      return
    }
    if (!form.messageContent.trim()) {
      setFormError('メッセージ内容を入力してください')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const response = await api.templates.create(form)
      if (!response.success) {
        setFormError(response.error)
        return
      }
      setShowCreate(false)
      setForm({ name: '', category: 'general', messageType: 'text', messageContent: '' })
      await load()
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!drawerData) return
    setEditError('')
    if (editContent !== null && !editContent.trim()) {
      setEditError('内容を空にはできません')
      return
    }
    if (editName !== null && !editName.trim()) {
      setEditError('名前を空にはできません')
      return
    }
    setSavingEdit(true)
    try {
      const updates: Record<string, string> = {}
      if (editContent !== null) updates.messageContent = editContent
      if (editName !== null) updates.name = editName
      const updateResponse = await api.templates.update(drawerData.id, updates)
      if (!updateResponse.success) {
        setEditError(updateResponse.error)
        return
      }
      const detailResponse = await api.templates.get(drawerData.id)
      if (detailResponse.success && detailResponse.data) setDrawerData(detailResponse.data)
      setEditContent(null)
      setEditName(null)
      await load()
    } catch {
      setEditError('更新に失敗しました')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete || deleting) return
    setDeleting(true)
    setError('')
    try {
      const response = await api.templates.delete(pendingDelete.id)
      if (!response.success) {
        setError(response.error)
        return
      }
      if (drawerId === pendingDelete.id) setDrawerId(null)
      setPendingDelete(null)
      await load()
    } catch {
      setError('削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <Header
        title="テンプレート管理"
        description="繰り返し使うLINEメッセージを一か所で管理します。"
        action={(
          <Button type="button" variant="primary" icon={PlusIcon} onClick={() => setShowCreate(true)}>
            新規テンプレート
          </Button>
        )}
      />

      {error ? <Banner className="mb-4" variant="error" title="操作を完了できませんでした" description={error} /> : null}

      <div className="mb-4 flex flex-wrap gap-2" aria-label="テンプレートの絞り込み">
        {filterOptions.map(({ key, label }) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={typeFilter === key ? 'primary' : 'secondary'}
            aria-pressed={typeFilter === key}
            onClick={() => setTypeFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {showCreate ? (
        <LayerCard className="mb-6 p-6">
          <h2 className="mb-4 text-sm font-semibold text-kumo-strong">新規テンプレートを作成</h2>
          <form onSubmit={handleCreate} className="max-w-2xl space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="名前"
                required
                placeholder="例: コスト比較 Flex"
                value={form.name}
                onValueChange={(value) => setForm((current) => ({ ...current, name: value }))}
              />
              <Input
                label="カテゴリ"
                placeholder="例: general、挨拶、返信"
                value={form.category}
                onValueChange={(value) => setForm((current) => ({ ...current, category: value }))}
              />
            </div>
            <Select
              label="タイプ"
              value={form.messageType}
              onValueChange={(value) => setForm((current) => ({ ...current, messageType: value ?? 'text', messageContent: '' }))}
              items={messageTypeItems}
            />
            {form.messageType === 'image' ? (
              <ImageUploader
                mode="line-image"
                value={(() => {
                  try {
                    const parsed = JSON.parse(form.messageContent) as { originalContentUrl?: string; previewImageUrl?: string }
                    if (parsed.originalContentUrl) {
                      return {
                        mode: 'line-image' as const,
                        originalContentUrl: parsed.originalContentUrl,
                        previewImageUrl: parsed.previewImageUrl ?? parsed.originalContentUrl,
                      }
                    }
                  } catch { /* Invalid image JSON is treated as no selected image. */ }
                  return null
                })()}
                onChange={(value) => {
                  if (value?.mode === 'line-image') {
                    setForm((current) => ({
                      ...current,
                      messageContent: JSON.stringify({
                        originalContentUrl: value.originalContentUrl,
                        previewImageUrl: value.previewImageUrl,
                      }),
                    }))
                  } else {
                    setForm((current) => ({ ...current, messageContent: '' }))
                  }
                }}
                label="テンプレート画像"
              />
            ) : (
              <InputArea
                label={form.messageType === 'flex' ? 'Flex JSON' : 'メッセージ内容'}
                required
                value={form.messageContent}
                onValueChange={(value) => setForm((current) => ({ ...current, messageContent: value }))}
                minRows={form.messageType === 'flex' ? 10 : 4}
                maxRows={16}
                autoResize
                className="font-mono"
                placeholder={form.messageType === 'flex' ? '{"type":"bubble","body":...}' : 'メッセージ内容'}
              />
            )}
            {formError ? <Banner variant="error" title="作成できません" description={formError} /> : null}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={saving}>作成</Button>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  setShowCreate(false)
                  setFormError('')
                }}
              >
                キャンセル
              </Button>
            </div>
          </form>
        </LayerCard>
      ) : null}

      <LayerCard className="overflow-x-auto">
        {loading ? (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-kumo-subtle"><Loader size="sm" /> テンプレートを読み込み中</div>
        ) : filteredTemplates.length === 0 ? (
          <Empty
            size="sm"
            title="該当するテンプレートがありません"
            description={typeFilter === 'all' ? '最初のテンプレートを作成してください。' : '絞り込み条件を変更してください。'}
            contents={typeFilter === 'all' ? <Button type="button" variant="primary" icon={PlusIcon} onClick={() => setShowCreate(true)}>新規テンプレート</Button> : undefined}
          />
        ) : (
          <Table className="min-w-[720px]">
            <Table.Header>
              <Table.Row>
                <Table.Head>タイプ</Table.Head>
                <Table.Head>名前</Table.Head>
                <Table.Head>カテゴリ</Table.Head>
                <Table.Head className="text-right">使用数</Table.Head>
                <Table.Head>更新日</Table.Head>
                <Table.Head />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filteredTemplates.map((template) => (
                <Table.Row key={template.id} className={drawerId === template.id ? 'bg-kumo-tint' : undefined}>
                  <Table.Cell><Badge variant={messageTypeVariant(template.messageType)}>{messageTypeLabels[template.messageType] ?? template.messageType}</Badge></Table.Cell>
                  <Table.Cell>
                    <Button type="button" size="xs" variant="ghost" className="-ml-2" onClick={() => setDrawerId(template.id)}>
                      {template.name}
                    </Button>
                    <p className="max-w-md truncate text-xs text-kumo-subtle">
                      {template.messageContent.slice(0, 60)}{template.messageContent.length > 60 ? '…' : ''}
                    </p>
                  </Table.Cell>
                  <Table.Cell><Badge variant="info">{template.category}</Badge></Table.Cell>
                  <Table.Cell className="text-right font-medium text-kumo-default">{template.usageCount}</Table.Cell>
                  <Table.Cell className="text-xs text-kumo-subtle">{formatDate(template.updatedAt)}</Table.Cell>
                  <Table.Cell className="text-right whitespace-nowrap">
                    <Button type="button" size="xs" variant="secondary" onClick={() => setDrawerId(template.id)}>詳細</Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="secondary-destructive"
                      icon={TrashIcon}
                      className="ml-1"
                      onClick={() => setPendingDelete(template)}
                    >
                      削除
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </LayerCard>

      {drawerId ? (
        <>
          <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" aria-hidden="true" onClick={() => setDrawerId(null)} />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-detail-title"
            className="fixed inset-y-0 right-0 z-40 w-full overflow-y-auto border-l border-kumo-line bg-kumo-base shadow-xl lg:w-[480px]"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-kumo-line bg-kumo-base px-4 py-3">
              <div className="min-w-0 flex-1">
                {editName !== null ? (
                  <Input aria-label="テンプレート名" autoFocus value={editName} onValueChange={setEditName} />
                ) : (
                  <h3 id="template-detail-title" className="truncate text-sm font-semibold text-kumo-strong">
                    {drawerData?.name ?? '読み込み中…'}
                  </h3>
                )}
              </div>
              <Button type="button" size="xs" variant="ghost" icon={XIcon} aria-label="詳細を閉じる" onClick={() => setDrawerId(null)} />
            </div>

            {drawerLoading ? (
              <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-kumo-subtle"><Loader size="sm" /> 詳細を読み込み中</div>
            ) : drawerError ? (
              <div className="p-4"><Banner variant="error" title="詳細を読み込めませんでした" description={drawerError} /></div>
            ) : !drawerData ? null : (
              <div className="space-y-5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={messageTypeVariant(drawerData.messageType)}>{messageTypeLabels[drawerData.messageType] ?? drawerData.messageType}</Badge>
                  <Badge variant="info">{drawerData.category}</Badge>
                  <span className="text-xs text-kumo-subtle">更新: {formatDate(drawerData.updatedAt)}</span>
                  {editName === null ? <Button type="button" size="xs" variant="ghost" onClick={() => setEditName(drawerData.name)}>名前を編集</Button> : null}
                </div>

                <section>
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-kumo-subtle">プレビュー</h4>
                  <div className="overflow-x-auto rounded-lg border border-kumo-line bg-kumo-tint p-3">
                    {drawerData.messageType === 'flex' ? (
                      (() => {
                        try {
                          return <FlexPreviewComponent content={drawerData.messageContent} maxWidth={420} />
                        } catch {
                          return <p className="text-xs text-kumo-danger">Flex JSONを読み取れません</p>
                        }
                      })()
                    ) : drawerData.messageType === 'image' ? (
                      (() => {
                        try {
                          const parsed = JSON.parse(drawerData.messageContent) as { originalContentUrl?: string; previewImageUrl?: string }
                          return <img src={parsed.originalContentUrl || parsed.previewImageUrl} alt="テンプレート画像のプレビュー" className="max-w-full rounded" />
                        } catch {
                          return <pre className="whitespace-pre-wrap text-xs">{drawerData.messageContent}</pre>
                        }
                      })()
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-sm text-kumo-default">{drawerData.messageContent}</p>
                    )}
                  </div>
                </section>

                <InputArea
                  label="内容 / JSON編集"
                  value={editContent ?? drawerData.messageContent}
                  onValueChange={setEditContent}
                  minRows={drawerData.messageType === 'flex' ? 12 : 4}
                  maxRows={18}
                  autoResize
                  className="font-mono"
                />

                {editError ? <Banner variant="error" title="保存できません" description={editError} /> : null}

                {editContent !== null || editName !== null ? (
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="primary" icon={FloppyDiskIcon} loading={savingEdit} onClick={() => void handleSaveEdit()}>保存</Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={savingEdit}
                      onClick={() => {
                        setEditContent(null)
                        setEditName(null)
                        setEditError('')
                      }}
                    >
                      キャンセル
                    </Button>
                  </div>
                ) : null}

                <section>
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-kumo-subtle">
                    使用箇所 ({drawerData.usedBy.autoReplies.length + drawerData.usedBy.automations.length + scenarioStepUsages.length})
                  </h4>
                  {drawerData.usedBy.autoReplies.length === 0 && drawerData.usedBy.automations.length === 0 && scenarioStepUsages.length === 0 ? (
                    <p className="text-xs italic text-kumo-subtle">どこからも使用されていません</p>
                  ) : (
                    <>
                      <ul className="space-y-2 text-xs">
                        {drawerData.usedBy.autoReplies.map((autoReply) => (
                          <li key={`ar-${autoReply.id}`}>
                            <Link href="/auto-replies" className="text-kumo-link hover:underline">
                              自動返信: {autoReply.keyword} <span className="text-kumo-subtle">({autoReply.matchType})</span>
                            </Link>
                          </li>
                        ))}
                        {drawerData.usedBy.automations.map((automation) => (
                          <li key={`au-${automation.id}`}>
                            <Link href="/automations" className="text-kumo-link hover:underline">
                              オートメーション: {automation.name} <span className="text-kumo-subtle">({automation.eventType})</span>
                            </Link>
                          </li>
                        ))}
                        {scenarioStepUsages.map((scenarioStep) => (
                          <li key={`ss-${scenarioStep.stepId}`}>
                            <Link href={`/scenarios/detail?id=${scenarioStep.scenarioId}`} className="text-kumo-link hover:underline">
                              シナリオ: {scenarioStep.scenarioName} <span className="text-kumo-subtle">#{scenarioStep.stepOrder}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                      {scenarioStepUsages.length > 0 ? (
                        <Banner className="mt-3" variant="alert" title="変更時の注意" description="このテンプレートを修正すると、上記すべてに一斉反映されます。" />
                      ) : null}
                    </>
                  )}
                </section>
              </div>
            )}
          </aside>
        </>
      ) : null}

      <Dialog.Root
        role="alertdialog"
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null) }}
      >
        <Dialog size="base" className="p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">テンプレートを削除しますか？</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-kumo-subtle">
            {pendingDelete?.usageCount
              ? `「${pendingDelete.name}」は${pendingDelete.usageCount}箇所で使用中です。削除すると参照が解除されます。`
              : `「${pendingDelete?.name ?? ''}」を削除します。この操作は取り消せません。`}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary" disabled={deleting}>キャンセル</Button>} />
            <Button type="button" variant="destructive" loading={deleting} onClick={() => void handleDelete()}>削除する</Button>
          </div>
        </Dialog>
      </Dialog.Root>

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
