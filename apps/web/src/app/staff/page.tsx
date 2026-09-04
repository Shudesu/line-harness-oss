'use client'

import { useEffect, useState } from 'react'
import { KeyIcon, PlusIcon, TrashIcon, UserPlusIcon } from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { ClipboardText } from '@cloudflare/kumo/components/clipboard-text'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'
import { Table } from '@cloudflare/kumo/components/table'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import type { ApiResponse, StaffMember } from '@line-crm/shared'

type NewApiKey = { apiKey: string; staffId: string }
type PendingAction = { kind: 'regenerate' | 'delete'; member: StaffMember }

function RoleBadge({ role }: { role: string }) {
  const variant = role === 'owner' ? 'warning' : role === 'admin' ? 'info' : 'neutral'
  const label = role === 'owner' ? 'オーナー' : role === 'admin' ? '管理者' : 'スタッフ'
  return <Badge variant={variant}>{label}</Badge>
}

function maskKey(key: string): string {
  if (!key || key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}

export default function StaffPage() {
  const [members, setMembers] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newKey, setNewKey] = useState<NewApiKey | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formRole, setFormRole] = useState<'admin' | 'staff'>('staff')
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [confirming, setConfirming] = useState(false)

  const loadMembers = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetchApi<ApiResponse<StaffMember[]>>('/api/staff')
      if (response.success) setMembers(response.data)
      else setError(response.error ?? 'スタッフの読み込みに失敗しました')
    } catch {
      setError('スタッフの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadMembers() }, [])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormLoading(true)
    setFormError('')
    try {
      const body: { name: string; role: 'admin' | 'staff'; email?: string } = {
        name: formName,
        role: formRole,
      }
      if (formEmail) body.email = formEmail

      const response = await fetchApi<ApiResponse<StaffMember & { apiKey?: string }>>('/api/staff', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (response.success) {
        if (response.data.apiKey) setNewKey({ apiKey: response.data.apiKey, staffId: response.data.id })
        setFormName('')
        setFormEmail('')
        setFormRole('staff')
        setShowForm(false)
        await loadMembers()
      } else {
        setFormError(response.error ?? '作成に失敗しました')
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setFormLoading(false)
    }
  }

  const handleToggleActive = async (member: StaffMember) => {
    try {
      await fetchApi<ApiResponse<StaffMember>>(`/api/staff/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !member.isActive }),
      })
      await loadMembers()
    } catch {
      setError('更新に失敗しました')
    }
  }

  const handleConfirmedAction = async () => {
    if (!pendingAction || confirming) return
    setConfirming(true)
    setError('')
    try {
      if (pendingAction.kind === 'regenerate') {
        const response = await fetchApi<ApiResponse<{ apiKey: string }>>(
          `/api/staff/${pendingAction.member.id}/regenerate-key`,
          { method: 'POST' },
        )
        if (response.success) {
          setNewKey({ apiKey: response.data.apiKey, staffId: pendingAction.member.id })
        } else {
          setError(response.error ?? 'キー再生成に失敗しました')
        }
      } else {
        await fetchApi<ApiResponse<null>>(`/api/staff/${pendingAction.member.id}`, { method: 'DELETE' })
        await loadMembers()
      }
      setPendingAction(null)
    } catch {
      setError(pendingAction.kind === 'delete' ? '削除に失敗しました' : 'キー再生成に失敗しました')
      setPendingAction(null)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div>
      <Header
        title="スタッフ管理"
        description="操作権限とスタッフ用APIキーを管理します。"
        action={(
          <Button type="button" variant="primary" icon={PlusIcon} onClick={() => setShowForm((current) => !current)}>
            スタッフを追加
          </Button>
        )}
      />

      {newKey ? (
        <LayerCard className="mb-6 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-kumo-strong">APIキーが発行されました</h2>
              <p className="mt-1 text-sm text-kumo-subtle">このキーは一度しか表示されません。安全な場所へ保存してください。</p>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setNewKey(null)}>閉じる</Button>
          </div>
          <ClipboardText className="mt-4" text={newKey.apiKey} />
        </LayerCard>
      ) : null}

      {showForm ? (
        <LayerCard className="mb-6 p-5">
          <h2 className="mb-4 text-sm font-semibold text-kumo-strong">新しいスタッフを追加</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="名前"
                type="text"
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                required
                placeholder="田中 太郎"
              />
              <Input
                label="メールアドレス"
                type="email"
                value={formEmail}
                onChange={(event) => setFormEmail(event.target.value)}
                placeholder="taro@example.com"
                required={false}
              />
              <Select
                label="ロール"
                value={formRole}
                onValueChange={(value) => setFormRole((value ?? 'staff') as 'admin' | 'staff')}
                items={{ staff: 'スタッフ', admin: '管理者' }}
              />
            </div>
            {formError ? <Banner size="sm" variant="error" title="作成できませんでした" description={formError} /> : null}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={formLoading} disabled={!formName}>作成</Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowForm(false)
                  setFormError('')
                }}
              >
                キャンセル
              </Button>
            </div>
          </form>
        </LayerCard>
      ) : null}

      {error ? (
        <Banner className="mb-4" variant="error" title="操作を完了できませんでした" description={error} />
      ) : null}

      <LayerCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <Table.Header>
              <Table.Row>
                <Table.Head>名前</Table.Head>
                <Table.Head className="hidden sm:table-cell">メール</Table.Head>
                <Table.Head>ロール</Table.Head>
                <Table.Head className="hidden md:table-cell">APIキー</Table.Head>
                <Table.Head>状態</Table.Head>
                <Table.Head className="text-right">操作</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {loading ? (
                <Table.Row>
                  <Table.Cell colSpan={6} className="py-12 text-center">
                    <span className="inline-flex items-center gap-2 text-sm text-kumo-subtle"><Loader size="sm" /> 読み込み中</span>
                  </Table.Cell>
                </Table.Row>
              ) : members.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={6} className="p-0">
                    <Empty
                      size="sm"
                      icon={<UserPlusIcon size={32} />}
                      title="スタッフがいません"
                      description="最初のスタッフを追加して、操作権限を割り当てます。"
                      contents={(
                        <Button type="button" variant="primary" icon={PlusIcon} onClick={() => setShowForm(true)}>
                          スタッフを追加
                        </Button>
                      )}
                    />
                  </Table.Cell>
                </Table.Row>
              ) : members.map((member) => (
                <Table.Row key={member.id}>
                  <Table.Cell className="font-medium text-kumo-strong">{member.name}</Table.Cell>
                  <Table.Cell className="hidden text-kumo-subtle sm:table-cell">{member.email ?? '—'}</Table.Cell>
                  <Table.Cell><RoleBadge role={member.role} /></Table.Cell>
                  <Table.Cell className="hidden font-mono text-xs text-kumo-subtle md:table-cell">{maskKey(member.apiKey ?? '')}</Table.Cell>
                  <Table.Cell>
                    <Badge variant={member.isActive ? 'success' : 'neutral'} appearance="dot">
                      {member.isActive ? '有効' : '無効'}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center justify-end gap-2">
                      {member.role !== 'owner' ? (
                        <>
                          <Button type="button" size="xs" variant="secondary" onClick={() => handleToggleActive(member)}>
                            {member.isActive ? '無効化' : '有効化'}
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="secondary"
                            icon={KeyIcon}
                            onClick={() => setPendingAction({ kind: 'regenerate', member })}
                          >
                            キー再生成
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="secondary-destructive"
                            icon={TrashIcon}
                            onClick={() => setPendingAction({ kind: 'delete', member })}
                          >
                            削除
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      </LayerCard>

      <Dialog.Root
        role="alertdialog"
        open={pendingAction !== null}
        onOpenChange={(open) => { if (!open && !confirming) setPendingAction(null) }}
      >
        <Dialog size="base" className="p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">
            {pendingAction?.kind === 'delete' ? 'スタッフを削除しますか？' : 'APIキーを再生成しますか？'}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-kumo-subtle">
            {pendingAction?.kind === 'delete'
              ? `${pendingAction.member.name} を削除します。この操作は取り消せません。`
              : `${pendingAction?.member.name ?? ''} の現在のAPIキーは無効になります。`}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close
              render={(props) => <Button {...props} type="button" variant="secondary" disabled={confirming}>キャンセル</Button>}
            />
            <Button
              type="button"
              variant={pendingAction?.kind === 'delete' ? 'destructive' : 'primary'}
              loading={confirming}
              onClick={handleConfirmedAction}
            >
              {pendingAction?.kind === 'delete' ? '削除する' : '再生成する'}
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}
