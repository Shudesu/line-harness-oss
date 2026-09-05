'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { ClipboardText } from '@cloudflare/kumo/components/clipboard-text'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { SensitiveInput } from '@cloudflare/kumo/components/sensitive-input'
import { Switch } from '@cloudflare/kumo/components/switch'
import { Table } from '@cloudflare/kumo/components/table'
import { Tabs } from '@cloudflare/kumo/components/tabs'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import CcPromptButton from '@/components/cc-prompt-button'
import type { IncomingWebhook, OutgoingWebhook } from '@line-crm/shared'

type Tab = 'incoming' | 'outgoing'
type RotateTarget = { kind: Tab; id: string; name: string; activate: boolean }
type DeleteTarget = { kind: Tab; id: string; name: string }

const MIN_SECRET_LENGTH = 32

const ccPrompts = [
  {
    title: 'Webhook設定ガイド',
    prompt: `Webhookの設定手順をガイドしてください。
1. 受信Webhook（Incoming）の作成とエンドポイントURLの設定方法
2. 送信Webhook（Outgoing）のURL・イベントタイプ・シークレット設定
3. LINE公式アカウントとのWebhook連携設定手順
手順を示してください。`,
  },
  {
    title: 'Webhookデバッグ',
    prompt: `Webhookの動作確認とデバッグをサポートしてください。
1. 受信・送信Webhookの有効/無効ステータスを確認
2. Webhookのテスト送信と応答検証の手順
3. よくあるエラーパターンとトラブルシューティング方法
手順を示してください。`,
  },
]

function generateSecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export default function WebhooksPage() {
  const [tab, setTab] = useState<Tab>('incoming')
  const [incoming, setIncoming] = useState<IncomingWebhook[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingWebhook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [inForm, setInForm] = useState({ name: '', sourceType: '', secret: '' })
  const [outForm, setOutForm] = useState({ name: '', url: '', eventTypes: '', secret: '' })
  const [createdSecret, setCreatedSecret] = useState<{ name: string; secret: string } | null>(null)
  const [rotateTarget, setRotateTarget] = useState<RotateTarget | null>(null)
  const [rotateSecretValue, setRotateSecretValue] = useState('')
  const [rotating, setRotating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [incomingResponse, outgoingResponse] = await Promise.all([
        api.webhooks.incoming.list(),
        api.webhooks.outgoing.list(),
      ])
      if (incomingResponse.success) setIncoming(incomingResponse.data)
      else setError(incomingResponse.error)
      if (outgoingResponse.success) setOutgoing(outgoingResponse.data)
      else setError(outgoingResponse.error)
    } catch {
      setError('データの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleToggleIncoming = async (id: string, currentActive: boolean) => {
    try {
      await api.webhooks.incoming.update(id, { isActive: !currentActive })
      await load()
    } catch {
      setError('更新に失敗しました')
    }
  }

  const handleToggleOutgoing = async (id: string, currentActive: boolean) => {
    try {
      await api.webhooks.outgoing.update(id, { isActive: !currentActive })
      await load()
    } catch {
      setError('更新に失敗しました')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setError('')
    try {
      if (deleteTarget.kind === 'incoming') await api.webhooks.incoming.delete(deleteTarget.id)
      else await api.webhooks.outgoing.delete(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch {
      setError('削除に失敗しました')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleCreateIncoming = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!inForm.name) return
    if (inForm.secret.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    setSubmitting(true)
    try {
      const response = await api.webhooks.incoming.create({
        name: inForm.name,
        sourceType: inForm.sourceType || undefined,
        secret: inForm.secret,
      })
      if (!response.success) {
        setError(response.error)
        return
      }
      setCreatedSecret({ name: response.data.name, secret: response.data.secret })
      setInForm({ name: '', sourceType: '', secret: '' })
      setShowCreate(false)
      await load()
    } catch {
      setError('作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateOutgoing = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!outForm.name || !outForm.url) return
    if (!isHttpsUrl(outForm.url)) {
      setError('URLは https:// から始まる必要があります')
      return
    }
    if (outForm.secret.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    setSubmitting(true)
    try {
      const eventTypes = outForm.eventTypes.split(',').map((value) => value.trim()).filter(Boolean)
      const response = await api.webhooks.outgoing.create({
        name: outForm.name,
        url: outForm.url,
        eventTypes,
        secret: outForm.secret,
      })
      if (!response.success) {
        setError(response.error)
        return
      }
      setCreatedSecret({ name: response.data.name, secret: response.data.secret })
      setOutForm({ name: '', url: '', eventTypes: '', secret: '' })
      setShowCreate(false)
      await load()
    } catch {
      setError('作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRotateSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!rotateTarget) return
    if (rotateSecretValue.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    setRotating(true)
    try {
      const payload = { secret: rotateSecretValue, isActive: rotateTarget.activate || undefined }
      const response = rotateTarget.kind === 'incoming'
        ? await api.webhooks.incoming.update(rotateTarget.id, payload)
        : await api.webhooks.outgoing.update(rotateTarget.id, payload)
      if (!response.success) {
        setError(response.error)
        return
      }
      setRotateTarget(null)
      setRotateSecretValue('')
      await load()
    } catch {
      setError('シークレットの更新に失敗しました')
    } finally {
      setRotating(false)
    }
  }

  const endpointUrl = (id: string) =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/incoming/${id}/receive`

  const openRotate = (target: RotateTarget) => {
    setRotateTarget(target)
    setRotateSecretValue('')
    setError('')
  }

  const createButtonLabel = showCreate ? '作成を閉じる' : '新規Webhook'

  return (
    <div>
      <Header
        title="Webhook管理"
        description="外部サービスとの受信・送信Webhookを管理します。"
        action={(
          <Button
            type="button"
            variant={showCreate ? 'secondary' : 'primary'}
            icon={showCreate ? undefined : PlusIcon}
            onClick={() => setShowCreate((current) => !current)}
          >
            {createButtonLabel}
          </Button>
        )}
      />

      {error ? <Banner className="mb-4" variant="error" title="操作を完了できませんでした" description={error} /> : null}

      <Tabs
        className="mb-6 w-fit"
        value={tab}
        onValueChange={(value) => {
          setTab(value as Tab)
          setShowCreate(false)
          setError('')
        }}
        tabs={[
          { value: 'incoming', label: `受信 (${incoming.length})` },
          { value: 'outgoing', label: `送信 (${outgoing.length})` },
        ]}
      />

      {showCreate && tab === 'incoming' ? (
        <LayerCard className="mb-6 p-6">
          <h2 className="mb-4 text-sm font-semibold text-kumo-strong">受信Webhookを作成</h2>
          <form onSubmit={handleCreateIncoming} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="名前"
                value={inForm.name}
                onChange={(event) => setInForm({ ...inForm, name: event.target.value })}
                placeholder="LINE公式アカウント"
                required
              />
              <Input
                label="ソースタイプ"
                value={inForm.sourceType}
                onChange={(event) => setInForm({ ...inForm, sourceType: event.target.value })}
                placeholder="line"
                required={false}
              />
            </div>
            <div className="flex items-end gap-2">
              <SensitiveInput
                className="min-w-0 flex-1"
                label={`シークレット（最低${MIN_SECRET_LENGTH}文字）`}
                value={inForm.secret}
                onValueChange={(value) => setInForm({ ...inForm, secret: value })}
                description="X-Webhook-SignatureのHMAC-SHA256署名に使用します。"
                required
              />
              <Button type="button" variant="secondary" onClick={() => setInForm({ ...inForm, secret: generateSecret() })}>
                自動生成
              </Button>
            </div>
            <Button type="submit" variant="primary" loading={submitting}>作成</Button>
          </form>
        </LayerCard>
      ) : null}

      {showCreate && tab === 'outgoing' ? (
        <LayerCard className="mb-6 p-6">
          <h2 className="mb-4 text-sm font-semibold text-kumo-strong">送信Webhookを作成</h2>
          <form onSubmit={handleCreateOutgoing} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="名前"
                value={outForm.name}
                onChange={(event) => setOutForm({ ...outForm, name: event.target.value })}
                placeholder="外部CRM連携"
                required
              />
              <Input
                label="URL"
                type="url"
                value={outForm.url}
                onChange={(event) => setOutForm({ ...outForm, url: event.target.value })}
                placeholder="https://example.com/webhook"
                description="https://で始まるURLを指定してください。"
                pattern="https://.*"
                required
              />
            </div>
            <Input
              label="イベントタイプ"
              value={outForm.eventTypes}
              onChange={(event) => setOutForm({ ...outForm, eventTypes: event.target.value })}
              placeholder="friend.added, message.received"
              description="カンマ区切りで指定します。すべてのイベントは * を指定します。"
              required={false}
            />
            <div className="flex items-end gap-2">
              <SensitiveInput
                className="min-w-0 flex-1"
                label={`シークレット（最低${MIN_SECRET_LENGTH}文字）`}
                value={outForm.secret}
                onValueChange={(value) => setOutForm({ ...outForm, secret: value })}
                description="送信時のX-Webhook-Signature署名に使用します。"
                required
              />
              <Button type="button" variant="secondary" onClick={() => setOutForm({ ...outForm, secret: generateSecret() })}>
                自動生成
              </Button>
            </div>
            <Button type="submit" variant="primary" loading={submitting}>作成</Button>
          </form>
        </LayerCard>
      ) : null}

      <LayerCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-kumo-subtle">
              <Loader size="sm" /> 読み込み中
            </div>
          ) : tab === 'incoming' ? (
            incoming.length === 0 ? (
              <Empty
                size="sm"
                title="受信Webhookがありません"
                description="受信エンドポイントを作成して、外部サービスからイベントを受け取ります。"
                contents={<Button type="button" variant="primary" icon={PlusIcon} onClick={() => setShowCreate(true)}>新規Webhook</Button>}
              />
            ) : (
              <Table className="min-w-[820px]">
                <Table.Header>
                  <Table.Row>
                    <Table.Head>名前</Table.Head>
                    <Table.Head>ソース</Table.Head>
                    <Table.Head>エンドポイントURL</Table.Head>
                    <Table.Head>シークレット</Table.Head>
                    <Table.Head>状態</Table.Head>
                    <Table.Head>作成日</Table.Head>
                    <Table.Head />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {incoming.map((webhook) => (
                    <Table.Row key={webhook.id}>
                      <Table.Cell className="font-medium text-kumo-strong">{webhook.name}</Table.Cell>
                      <Table.Cell className="text-kumo-subtle">{webhook.sourceType || '—'}</Table.Cell>
                      <Table.Cell className="min-w-[280px]"><ClipboardText size="sm" text={endpointUrl(webhook.id)} /></Table.Cell>
                      <Table.Cell><Badge variant={webhook.hasSecret ? 'success' : 'warning'}>{webhook.hasSecret ? '設定済み' : '未設定'}</Badge></Table.Cell>
                      <Table.Cell>
                        <Switch
                          size="sm"
                          checked={webhook.isActive}
                          disabled={!webhook.hasSecret && !webhook.isActive}
                          onCheckedChange={() => void handleToggleIncoming(webhook.id, webhook.isActive)}
                          aria-label={`${webhook.name}を${webhook.isActive ? '無効化' : '有効化'}`}
                          title={!webhook.hasSecret && !webhook.isActive ? 'シークレット未設定のため有効化できません' : undefined}
                        />
                      </Table.Cell>
                      <Table.Cell className="text-sm text-kumo-subtle">{new Date(webhook.createdAt).toLocaleDateString('ja-JP')}</Table.Cell>
                      <Table.Cell className="text-right whitespace-nowrap">
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary"
                          icon={KeyIcon}
                          onClick={() => openRotate({ kind: 'incoming', id: webhook.id, name: webhook.name, activate: !webhook.hasSecret })}
                        >
                          {webhook.hasSecret ? '更新' : '設定'}
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary-destructive"
                          icon={TrashIcon}
                          className="ml-1"
                          onClick={() => setDeleteTarget({ kind: 'incoming', id: webhook.id, name: webhook.name })}
                        >
                          削除
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            )
          ) : outgoing.length === 0 ? (
            <Empty
              size="sm"
              title="送信Webhookがありません"
              description="外部サービスへイベントを通知する送信先を作成します。"
              contents={<Button type="button" variant="primary" icon={PlusIcon} onClick={() => setShowCreate(true)}>新規Webhook</Button>}
            />
          ) : (
            <Table className="min-w-[920px]">
              <Table.Header>
                <Table.Row>
                  <Table.Head>名前</Table.Head>
                  <Table.Head>URL</Table.Head>
                  <Table.Head>イベントタイプ</Table.Head>
                  <Table.Head>シークレット</Table.Head>
                  <Table.Head>状態</Table.Head>
                  <Table.Head>作成日</Table.Head>
                  <Table.Head />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {outgoing.map((webhook) => {
                  const hasValidUrl = isHttpsUrl(webhook.url)
                  const canActivate = webhook.hasSecret && hasValidUrl
                  const blockedReason = !canActivate
                    ? !webhook.hasSecret && !hasValidUrl
                      ? 'シークレット未設定かつURLがhttps://ではありません'
                      : !webhook.hasSecret
                        ? 'シークレット未設定のため有効化できません'
                        : 'URLがhttps://ではないため有効化できません'
                    : undefined
                  return (
                    <Table.Row key={webhook.id}>
                      <Table.Cell className="font-medium text-kumo-strong">{webhook.name}</Table.Cell>
                      <Table.Cell className="min-w-[240px]">
                        <code className="break-all text-xs text-kumo-default">{webhook.url}</code>
                        {!hasValidUrl ? <p className="mt-1 text-xs text-kumo-warning">https://の完全なURLに作り直してください</p> : null}
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex flex-wrap gap-1">
                          {webhook.eventTypes.map((eventType) => <Badge key={eventType} variant="info">{eventType}</Badge>)}
                        </div>
                      </Table.Cell>
                      <Table.Cell><Badge variant={webhook.hasSecret ? 'success' : 'warning'}>{webhook.hasSecret ? '設定済み' : '未設定'}</Badge></Table.Cell>
                      <Table.Cell>
                        <Switch
                          size="sm"
                          checked={webhook.isActive}
                          disabled={!canActivate && !webhook.isActive}
                          onCheckedChange={() => void handleToggleOutgoing(webhook.id, webhook.isActive)}
                          aria-label={`${webhook.name}を${webhook.isActive ? '無効化' : '有効化'}`}
                          title={blockedReason}
                        />
                      </Table.Cell>
                      <Table.Cell className="text-sm text-kumo-subtle">{new Date(webhook.createdAt).toLocaleDateString('ja-JP')}</Table.Cell>
                      <Table.Cell className="text-right whitespace-nowrap">
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary"
                          icon={KeyIcon}
                          onClick={() => openRotate({ kind: 'outgoing', id: webhook.id, name: webhook.name, activate: hasValidUrl && !webhook.hasSecret })}
                        >
                          {webhook.hasSecret ? '更新' : '設定'}
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary-destructive"
                          icon={TrashIcon}
                          className="ml-1"
                          onClick={() => setDeleteTarget({ kind: 'outgoing', id: webhook.id, name: webhook.name })}
                        >
                          削除
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          )}
        </div>
      </LayerCard>

      <Dialog.Root open={rotateTarget !== null} onOpenChange={(open) => { if (!open && !rotating) setRotateTarget(null) }}>
        <Dialog size="lg" className="p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">
            シークレットを{rotateTarget?.activate ? '設定して有効化' : '更新'}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-kumo-subtle">
            「{rotateTarget?.name ?? ''}」へ新しいシークレットを設定します。保存後は再表示されません。
          </Dialog.Description>
          <form onSubmit={handleRotateSubmit} className="mt-5 space-y-4">
            <div className="flex items-end gap-2">
              <SensitiveInput
                className="min-w-0 flex-1"
                label="新しいシークレット"
                value={rotateSecretValue}
                onValueChange={setRotateSecretValue}
                description={`最低${MIN_SECRET_LENGTH}文字必要です。`}
                autoFocus
                required
              />
              <Button type="button" variant="secondary" onClick={() => setRotateSecretValue(generateSecret())}>自動生成</Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={rotating} onClick={() => setRotateTarget(null)}>キャンセル</Button>
              <Button type="submit" variant="primary" loading={rotating}>保存</Button>
            </div>
          </form>
        </Dialog>
      </Dialog.Root>

      <Dialog.Root role="alertdialog" open={createdSecret !== null}>
        <Dialog size="lg" className="p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">シークレットを保存してください</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-kumo-subtle">
            「{createdSecret?.name ?? ''}」を作成しました。このシークレットは今後二度と表示されません。
          </Dialog.Description>
          {createdSecret ? <ClipboardText className="mt-5" text={createdSecret.secret} /> : null}
          <div className="mt-6 flex justify-end">
            <Button type="button" variant="primary" onClick={() => setCreatedSecret(null)}>保存しました</Button>
          </div>
        </Dialog>
      </Dialog.Root>

      <Dialog.Root
        role="alertdialog"
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null) }}
      >
        <Dialog size="base" className="p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">Webhookを削除しますか？</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-kumo-subtle">
            「{deleteTarget?.name ?? ''}」を削除します。この操作は取り消せません。
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary" disabled={deleting}>キャンセル</Button>} />
            <Button type="button" variant="destructive" loading={deleting} onClick={handleDelete}>削除する</Button>
          </div>
        </Dialog>
      </Dialog.Root>

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
