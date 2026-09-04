'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Table } from '@cloudflare/kumo/components/table'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import EditDialog, { type AutoReplyDraft } from '@/components/auto-replies/edit-dialog'

interface EffectiveAccount {
  accountId: string
  accountName: string
  status: 'reply' | 'silent' | 'not_applicable'
  via: 'inline' | 'automation' | null
}

interface AutoReply {
  id: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
  createdAt: string
  effectiveAccounts?: EffectiveAccount[]
}

interface TemplateLite {
  id: string
  name: string
  messageType: string
  messageContent: string
}

const matchTypeLabel: Record<'exact' | 'contains', string> = { exact: '完全一致', contains: '包含' }

export default function AutoRepliesPage() {
  const { selectedAccountId, accounts } = useAccount()
  const [items, setItems] = useState<AutoReply[]>([])
  const [templates, setTemplates] = useState<TemplateLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AutoReplyDraft | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AutoReply | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [autoReplyResponse, templateResponse] = await Promise.all([
        api.autoReplies.list({ accountId: selectedAccountId || undefined }),
        api.templates.list(),
      ])
      if (autoReplyResponse.success) setItems(autoReplyResponse.data)
      if (templateResponse.success) {
        setTemplates(templateResponse.data.map((template) => ({
          id: template.id,
          name: template.name,
          messageType: template.messageType,
          messageContent: template.messageContent,
        })))
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  const templateById = new Map(templates.map((template) => [template.id, template]))
  const accountById = new Map(accounts.map((account) => [account.id, account]))

  const renderEffectiveCell = (rule: AutoReply) => {
    if (!rule.effectiveAccounts || rule.effectiveAccounts.length === 0) {
      if (!rule.lineAccountId) return <span className="italic text-kumo-subtle">全アカウント</span>
      const account = accountById.get(rule.lineAccountId)
      return <span className="text-kumo-default">{account?.displayName ?? account?.name ?? rule.lineAccountId.slice(0, 8)}</span>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {rule.effectiveAccounts.map((effectiveAccount) => {
          const account = accountById.get(effectiveAccount.accountId)
          const label = account?.displayName ?? account?.name ?? effectiveAccount.accountName
          if (effectiveAccount.status === 'not_applicable') {
            return <Badge key={effectiveAccount.accountId} variant="neutral" className="line-through opacity-50">{label}</Badge>
          }
          if (effectiveAccount.status === 'reply') {
            return (
              <Badge key={effectiveAccount.accountId} variant="success">
                {label}{effectiveAccount.via === 'automation' ? ' ⚙' : ''}
              </Badge>
            )
          }
          return <Badge key={effectiveAccount.accountId} variant="warning">{label}</Badge>
        })}
      </div>
    )
  }

  const renderResponseCell = (rule: AutoReply) => {
    if (rule.responseType === 'silent') return <Badge variant="neutral">silent</Badge>
    if (rule.responseType === 'flex') return <Badge variant="purple">flex</Badge>
    if (rule.responseType === 'image') return <Badge variant="blue">image</Badge>
    return <Badge variant="neutral">text</Badge>
  }

  const renderTemplateCell = (rule: AutoReply) => {
    if (!rule.templateId) return <span className="text-xs italic text-kumo-subtle">inline</span>
    const template = templateById.get(rule.templateId)
    return (
      <Link href="/templates" className="text-xs text-kumo-link hover:underline">
        {template?.name ?? `未知 ${rule.templateId.slice(0, 6)}`}
      </Link>
    )
  }

  const openNewRule = () => {
    setEditing({
      keyword: '',
      matchType: 'exact',
      responseType: 'text',
      responseContent: '',
      templateId: null,
      lineAccountId: selectedAccountId,
      isActive: true,
    })
  }

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await api.autoReplies.delete(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch {
      setError('削除に失敗しました')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <Header
        title="自動返信ルール"
        description="キーワードに応じた返信内容と適用アカウントを管理します。"
        action={<Button type="button" variant="primary" icon={PlusIcon} onClick={openNewRule}>新規ルール</Button>}
      />

      {error ? <Banner className="mb-4" variant="error" title="操作を完了できませんでした" description={error} /> : null}

      <Banner
        className="mb-4"
        variant="default"
        title="適用アカウントの表示"
        description="緑は返信あり、黄色は返信なしのsilentルール、薄いグレーは適用外です。⚙はautomation経由を表します。"
      />

      <LayerCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[860px]">
            <Table.Header>
              <Table.Row>
                <Table.Head>キーワード</Table.Head>
                <Table.Head>一致方法</Table.Head>
                <Table.Head>返信形式</Table.Head>
                <Table.Head>テンプレート</Table.Head>
                <Table.Head>適用アカウント</Table.Head>
                <Table.Head>状態</Table.Head>
                <Table.Head />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {loading ? (
                <Table.Row>
                  <Table.Cell colSpan={7} className="py-12 text-center">
                    <span className="inline-flex items-center gap-2 text-sm text-kumo-subtle"><Loader size="sm" /> 読み込み中</span>
                  </Table.Cell>
                </Table.Row>
              ) : items.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={7} className="p-0">
                    <Empty
                      size="sm"
                      title="自動返信ルールがありません"
                      description="最初のルールを追加して、キーワードへの返信を自動化します。"
                      contents={<Button type="button" variant="primary" icon={PlusIcon} onClick={openNewRule}>新規ルール</Button>}
                    />
                  </Table.Cell>
                </Table.Row>
              ) : items.map((rule) => (
                <Table.Row key={rule.id}>
                  <Table.Cell className="font-medium text-kumo-strong">{rule.keyword}</Table.Cell>
                  <Table.Cell className="text-xs text-kumo-subtle">{matchTypeLabel[rule.matchType]}</Table.Cell>
                  <Table.Cell>{renderResponseCell(rule)}</Table.Cell>
                  <Table.Cell>{renderTemplateCell(rule)}</Table.Cell>
                  <Table.Cell>{renderEffectiveCell(rule)}</Table.Cell>
                  <Table.Cell>
                    <Badge variant={rule.isActive ? 'success' : 'neutral'} appearance="dot">
                      {rule.isActive ? '有効' : '無効'}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell className="text-right whitespace-nowrap">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      icon={PencilSimpleIcon}
                      onClick={() => setEditing({
                        id: rule.id,
                        keyword: rule.keyword,
                        matchType: rule.matchType,
                        responseType: rule.responseType,
                        responseContent: rule.responseContent,
                        templateId: rule.templateId,
                        lineAccountId: rule.lineAccountId,
                        isActive: rule.isActive,
                      })}
                    >
                      編集
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="secondary-destructive"
                      icon={TrashIcon}
                      className="ml-1"
                      onClick={() => setDeleteTarget(rule)}
                    >
                      削除
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      </LayerCard>

      {editing ? (
        <EditDialog
          draft={editing}
          templates={templates}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      ) : null}

      <Dialog.Root
        role="alertdialog"
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null) }}
      >
        <Dialog size="base" className="p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">自動返信ルールを削除しますか？</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-kumo-subtle">
            キーワード「{deleteTarget?.keyword ?? ''}」のルールを削除します。この操作は取り消せません。
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary" disabled={deleting}>キャンセル</Button>} />
            <Button type="button" variant="destructive" loading={deleting} onClick={handleDelete}>削除する</Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}
