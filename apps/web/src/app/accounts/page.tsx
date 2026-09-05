'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowsDownUpIcon, CheckCircleIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Switch } from '@cloudflare/kumo/components/switch'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import TestRecipientsSetting from '@/components/accounts/test-recipients-setting'
import AccountSettingsSection from '@/components/accounts/account-settings-section'
import {
  AccountFormSections,
  emptyAccountFormState,
  type AccountFormState,
} from '@/components/accounts/account-form-fields'
import AccountSetupUrls from '@/components/accounts/account-setup-urls'
import LinkBaseUrlSetting from '@/components/accounts/link-base-url-setting'
import FollowerImportButton from '@/components/accounts/follower-import-button'

const ReorderMode = dynamic(() => import('@/components/accounts/reorder-mode'), { ssr: false })
const AccountEditModal = dynamic(() => import('@/components/accounts/account-edit-modal'), { ssr: false })

interface LineAccountListItem {
  id: string
  channelId: string
  name: string
  displayName: string
  pictureUrl: string | null
  basicId: string | null
  isActive: boolean
  loginChannelId: string | null
  liffId: string | null
  createdAt: string
  updatedAt: string
  stats: {
    friendCount: number
    activeScenarios: number
    messagesThisMonth: number
  }
  ogSiteName: string | null
  ogDefaultDescription: string | null
  ogDefaultImageUrl: string | null
}

const ccPrompts = [
  {
    title: 'LINEアカウント設定確認',
    prompt: `現在登録されているLINEアカウントのチャネル設定を確認してください。
1. 各アカウントのChannel ID・名前・有効/無効ステータスを一覧表示
2. Channel Access TokenとChannel Secretが正しく設定されているか検証
3. LINE Developers Consoleとの設定整合性をチェック
結果をレポートしてください。`,
  },
  {
    title: 'アカウント追加手順',
    prompt: `新しいLINEアカウントを追加する手順をガイドしてください。
1. LINE Developers Consoleでのチャネル作成手順を説明
2. Channel ID、Channel Access Token、Channel Secretの取得方法
3. CRMへの登録手順と初期設定のベストプラクティス
手順を示してください。`,
  },
]

export default function AccountsPage() {
  const { selectedAccountId, setSelectedAccountId, refreshAccounts } = useAccount()
  const [accounts, setAccounts] = useState<LineAccountListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showReorder, setShowReorder] = useState(false)
  const [editing, setEditing] = useState<LineAccountListItem | null>(null)
  const [pendingDelete, setPendingDelete] = useState<LineAccountListItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [form, setForm] = useState<AccountFormState>(emptyAccountFormState)
  const [createError, setCreateError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [justCreated, setJustCreated] = useState<{ liffId: string | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.lineAccounts.list()
      if (response.success) setAccounts(response.data as unknown as LineAccountListItem[])
      else setError(response.error || 'アカウント情報の取得に失敗しました')
    } catch {
      setError('APIに接続できませんでした。サーバーが起動しているか確認してください。')
    } finally {
      setLoading(false)
    }
  }, [])

  const reloadAccounts = useCallback(async () => {
    await Promise.all([load(), refreshAccounts()])
  }, [load, refreshAccounts])

  useEffect(() => { void load() }, [load])

  const updateForm = (partial: Partial<AccountFormState>) =>
    setForm((current) => ({ ...current, ...partial }))

  const closeCreate = () => {
    setShowCreate(false)
    setForm(emptyAccountFormState)
    setCreateError('')
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    setCreateError('')
    if (!form.channelId || !form.name || !form.channelAccessToken || !form.channelSecret) {
      setCreateError('Messaging APIの必須項目を入力してください')
      return
    }
    setSubmitting(true)
    try {
      const response = await api.lineAccounts.create({
        channelId: form.channelId.trim(),
        name: form.name.trim(),
        channelAccessToken: form.channelAccessToken.trim(),
        channelSecret: form.channelSecret.trim(),
        loginChannelId: form.loginChannelId.trim() || null,
        loginChannelSecret: form.loginChannelSecret.trim() || null,
        liffId: form.liffId.trim() || null,
        ogSiteName: form.ogSiteName?.trim() || null,
        ogDefaultImageUrl: form.ogDefaultImageUrl?.trim() || null,
        ogDefaultDescription: form.ogDefaultDescription?.trim() || null,
      })
      if (!response.success) {
        setCreateError(response.error || '登録に失敗しました')
        return
      }
      setJustCreated({ liffId: form.liffId.trim() || null })
      closeCreate()
      await reloadAccounts()
    } catch {
      setCreateError('登録に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete || deleting) return
    setDeleting(true)
    setError('')
    try {
      const response = await api.lineAccounts.delete(pendingDelete.id)
      if (!response.success) {
        setError(response.error || '削除に失敗しました')
        return
      }
      setPendingDelete(null)
      await reloadAccounts()
    } catch {
      setError('削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  const handleToggle = async (account: LineAccountListItem) => {
    if (togglingId) return
    setTogglingId(account.id)
    setError('')
    try {
      const response = await api.lineAccounts.update(account.id, { isActive: !account.isActive })
      if (!response.success) {
        setError(response.error || '状態を更新できませんでした')
        return
      }
      await reloadAccounts()
    } catch {
      setError('状態を更新できませんでした')
    } finally {
      setTogglingId(null)
    }
  }

  const currentAccount = accounts.find((account) => account.id === selectedAccountId) ?? null

  return (
    <div>
      <Header
        title="LINEアカウント管理"
        description="登録、切替、Messaging API・LINE Login設定を管理します。"
        action={(
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" icon={ArrowsDownUpIcon} onClick={() => setShowReorder(true)}>
              並び替え
            </Button>
            <Button
              type="button"
              variant={showCreate ? 'secondary' : 'primary'}
              icon={showCreate ? undefined : PlusIcon}
              onClick={() => {
                if (showCreate) closeCreate()
                else setShowCreate(true)
              }}
            >
              {showCreate ? '追加を閉じる' : 'アカウント追加'}
            </Button>
          </div>
        )}
      />

      {error ? <Banner className="mb-6" variant="error" title="操作を完了できませんでした" description={error} /> : null}

      {!loading && currentAccount ? (
        <LayerCard className="mb-6 border-l-4 border-l-kumo-brand p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {currentAccount.pictureUrl ? (
                <img src={currentAccount.pictureUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-kumo-brand font-bold text-kumo-inverse">
                  {(currentAccount.displayName || currentAccount.name).charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant="success">現在操作中</Badge>
                  <span className="truncate font-semibold text-kumo-strong">{currentAccount.displayName || currentAccount.name}</span>
                </div>
                <p className="text-xs text-kumo-subtle">
                  このアカウントが友だち・配信・予約など各管理画面の対象です。
                </p>
              </div>
            </div>
            <code className="text-xs text-kumo-subtle">{currentAccount.basicId || `Channel: ${currentAccount.channelId}`}</code>
          </div>
        </LayerCard>
      ) : !loading && accounts.length > 0 ? (
        <Banner className="mb-6" variant="alert" title="操作するアカウントを選んでください" description="下のカードから対象アカウントを選択すると、サイドバーにも反映されます。" />
      ) : null}

      {justCreated ? (
        <LayerCard className="mb-6 bg-kumo-success-tint p-4">
          <div className="mb-3 flex items-center gap-2">
            <CheckCircleIcon className="text-kumo-success" size={20} weight="fill" />
            <p className="text-sm font-semibold text-kumo-strong">アカウントを登録しました</p>
          </div>
          <p className="mb-3 text-xs text-kumo-subtle">次にLINE Developers Consoleへ以下のURLを登録してください。</p>
          <AccountSetupUrls liffId={justCreated.liffId} heading="登録するURL" />
          <Button type="button" size="xs" variant="ghost" className="mt-3" onClick={() => setJustCreated(null)}>閉じる</Button>
        </LayerCard>
      ) : null}

      {showCreate ? (
        <LayerCard className="mb-6 p-6">
          <h2 className="mb-4 text-sm font-semibold text-kumo-strong">LINEアカウントを追加</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <Input
              label="アカウント名"
              required
              value={form.name}
              onValueChange={(value) => updateForm({ name: value })}
              placeholder="メインアカウント"
            />
            <AccountFormSections state={form} update={updateForm} showMessagingRequired />
            <AccountSetupUrls liffId={form.liffId.trim() || null} />
            {createError ? <Banner variant="error" title="登録できません" description={createError} /> : null}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={submitting}>登録</Button>
              <Button type="button" variant="secondary" disabled={submitting} onClick={closeCreate}>キャンセル</Button>
            </div>
          </form>
        </LayerCard>
      ) : null}

      {loading ? (
        <LayerCard className="flex min-h-48 items-center justify-center gap-2 text-sm text-kumo-subtle">
          <Loader size="sm" /> アカウントを読み込み中
        </LayerCard>
      ) : accounts.length === 0 ? (
        <Empty
          size="sm"
          title="LINEアカウントが登録されていません"
          description="LINE Developers ConsoleからChannel情報を取得して登録してください。"
          contents={<Button type="button" variant="primary" icon={PlusIcon} onClick={() => setShowCreate(true)}>アカウント追加</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {accounts.map((account) => {
            const isCurrent = account.id === selectedAccountId
            return (
              <LayerCard key={account.id} className={`p-6 ${isCurrent ? 'ring-2 ring-kumo-brand' : ''}`}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {account.pictureUrl ? (
                      <img src={account.pictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-bold text-kumo-inverse ${account.isActive ? 'bg-kumo-brand' : 'bg-kumo-inactive'}`}>
                        {(account.displayName || account.name).charAt(0) || 'L'}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-bold text-kumo-strong">{account.displayName || account.name}</h3>
                        {isCurrent ? <Badge variant="success">操作中</Badge> : null}
                      </div>
                      <p className="truncate font-mono text-xs text-kumo-subtle">
                        {account.basicId ? `${account.basicId} · ` : ''}Channel: {account.channelId}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-kumo-subtle">{account.isActive ? '有効' : '無効'}</span>
                    <Switch
                      size="sm"
                      checked={account.isActive}
                      disabled={togglingId !== null}
                      aria-label={`${account.displayName || account.name}を${account.isActive ? '無効化' : '有効化'}`}
                      onCheckedChange={() => void handleToggle(account)}
                    />
                  </div>
                </div>

                {!isCurrent ? (
                  <Button type="button" size="sm" variant="secondary" className="mb-4 w-full" onClick={() => setSelectedAccountId(account.id)}>
                    このアカウントを操作
                  </Button>
                ) : null}

                <div className="mb-4 grid grid-cols-3 gap-3 border-y border-kumo-line py-3">
                  <div className="text-center">
                    <p className="text-lg font-bold text-kumo-strong">{account.stats.friendCount}</p>
                    <p className="text-xs text-kumo-subtle">友だち</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-kumo-info">{account.stats.activeScenarios}</p>
                    <p className="text-xs text-kumo-subtle">配信中</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-kumo-success">{account.stats.messagesThisMonth}</p>
                    <p className="text-xs text-kumo-subtle">今月送信</p>
                  </div>
                </div>

                <div className="mb-3 flex flex-wrap gap-2">
                  <Badge variant={account.loginChannelId ? 'info' : 'neutral'}>Login: {account.loginChannelId ? '設定済み' : '未設定'}</Badge>
                  <Badge variant={account.liffId ? 'info' : 'neutral'}>LIFF: {account.liffId ? '設定済み' : '未設定'}</Badge>
                </div>

                <AccountSettingsSection
                  accountId={account.id}
                  initialCountry={(account as { country?: string | null }).country ?? null}
                  initialRole={(account as { role?: string | null }).role ?? null}
                  onUpdated={reloadAccounts}
                />
                <TestRecipientsSetting accountId={account.id} />
                <FollowerImportButton accountId={account.id} onImported={reloadAccounts} />

                <div className="mt-3 flex items-center justify-between border-t border-kumo-line pt-3">
                  <p className="text-xs text-kumo-subtle">登録: {new Date(account.createdAt).toLocaleDateString('ja-JP')}</p>
                  <div className="flex gap-1">
                    <Button type="button" size="xs" variant="secondary" icon={PencilSimpleIcon} onClick={() => setEditing(account)}>編集</Button>
                    <Button type="button" size="xs" variant="secondary-destructive" icon={TrashIcon} onClick={() => setPendingDelete(account)}>削除</Button>
                  </div>
                </div>
              </LayerCard>
            )
          })}
        </div>
      )}

      <section className="mt-8" aria-labelledby="global-settings-title">
        <h2 id="global-settings-title" className="mb-3 text-sm font-semibold text-kumo-strong">グローバル設定</h2>
        <LinkBaseUrlSetting />
      </section>

      <Dialog.Root
        role="alertdialog"
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null) }}
      >
        <Dialog size="base" className="p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">LINEアカウントを削除しますか？</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-kumo-subtle">
            「{pendingDelete?.displayName || pendingDelete?.name || ''}」を削除します。
            {pendingDelete?.id === selectedAccountId ? '現在操作中のため、削除後は別のアカウントへ自動で切り替わります。' : 'この操作は取り消せません。'}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary" disabled={deleting}>キャンセル</Button>} />
            <Button type="button" variant="destructive" loading={deleting} onClick={() => void handleDelete()}>削除する</Button>
          </div>
        </Dialog>
      </Dialog.Root>

      <CcPromptButton prompts={ccPrompts} />

      {showReorder ? (
        <ReorderMode
          accounts={accounts.map((account) => ({
            id: account.id,
            name: account.name,
            displayName: account.displayName,
            country: (account as { country?: string | null }).country ?? null,
          }))}
          onClose={() => setShowReorder(false)}
          onSaved={reloadAccounts}
        />
      ) : null}

      {editing ? (
        <AccountEditModal
          accountId={editing.id}
          initialName={editing.name}
          initialChannelId={editing.channelId}
          initialLoginChannelId={editing.loginChannelId}
          initialLiffId={editing.liffId}
          initialOgSiteName={editing.ogSiteName}
          initialOgDefaultDescription={editing.ogDefaultDescription}
          initialOgDefaultImageUrl={editing.ogDefaultImageUrl}
          onClose={() => setEditing(null)}
          onSaved={reloadAccounts}
        />
      ) : null}
    </div>
  )
}
