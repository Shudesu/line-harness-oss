'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import TestRecipientsSetting from '@/components/accounts/test-recipients-setting'
import AccountSettingsSection from '@/components/accounts/account-settings-section'
import ReorderMode from '@/components/accounts/reorder-mode'
import {
  AccountFormSections,
  emptyAccountFormState,
  type AccountFormState,
} from '@/components/accounts/account-form-fields'
import AccountSetupUrls from '@/components/accounts/account-setup-urls'
import AccountEditModal from '@/components/accounts/account-edit-modal'
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
} from '@/components/ui/primitives'

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
  const [accounts, setAccounts] = useState<LineAccountListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showReorder, setShowReorder] = useState(false)
  const [editing, setEditing] = useState<LineAccountListItem | null>(null)
  const [form, setForm] = useState<AccountFormState>(emptyAccountFormState)
  const [createError, setCreateError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [justCreated, setJustCreated] = useState<{ liffId: string | null } | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.lineAccounts.list()
      if (res.success) {
        setAccounts(res.data as unknown as LineAccountListItem[])
      } else {
        setError('アカウント情報の取得に失敗しました')
      }
    } catch {
      setError('APIに接続できませんでした。サーバーが起動しているか確認してください。')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const updateForm = (partial: Partial<AccountFormState>) =>
    setForm((s) => ({ ...s, ...partial }))

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    if (!form.channelId || !form.name || !form.channelAccessToken || !form.channelSecret) {
      setCreateError('Messaging API の必須項目を入力してください')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.lineAccounts.create({
        channelId: form.channelId.trim(),
        name: form.name.trim(),
        channelAccessToken: form.channelAccessToken.trim(),
        channelSecret: form.channelSecret.trim(),
        loginChannelId: form.loginChannelId.trim() || null,
        loginChannelSecret: form.loginChannelSecret.trim() || null,
        liffId: form.liffId.trim() || null,
      })
      if (res.success) {
        setJustCreated({ liffId: form.liffId.trim() || null })
        setForm(emptyAccountFormState)
        setShowCreate(false)
        load()
      } else {
        setCreateError(res.error || '登録に失敗しました')
      }
    } catch {
      setCreateError('登録に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このLINEアカウントを削除しますか？')) return
    await api.lineAccounts.delete(id)
    load()
  }

  const handleToggle = async (id: string, currentActive: boolean) => {
    await api.lineAccounts.update(id, { isActive: !currentActive })
    load()
  }

  return (
    <div>
      <Header
        title="LINEアカウント管理"
        description="マルチアカウント設定"
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowReorder(true)}>
              並び替えモード
            </Button>
            <Button
              onClick={() => {
                const next = !showCreate
                setShowCreate(next)
                if (!next) {
                  setForm(emptyAccountFormState)
                  setCreateError('')
                }
              }}
              className="text-white"
              style={{ backgroundColor: '#06C755' }}
            >
              {showCreate ? 'キャンセル' : '+ アカウント追加'}
            </Button>
          </div>
        }
      />

      {error && (
        <Banner tone="danger" className="mb-6">
          {error}
        </Banner>
      )}

      {justCreated && (
        <Banner tone="success" title="✓ アカウントを登録しました" className="mb-6">
          <p className="text-xs mb-3">
            次に LINE Developers Console で以下の URL を貼り付けてください。
          </p>
          <AccountSetupUrls liffId={justCreated.liffId} heading="登録すべき URL" />
          <button
            onClick={() => setJustCreated(null)}
            className="mt-3 text-xs underline"
          >
            閉じる
          </button>
        </Banner>
      )}

      {showCreate && (
        <Card className="mb-6">
          <CardContent className="pt-5">
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <Label>
                  アカウント名 <span className="text-red-500">*</span>
                </Label>
                <Input
                  value={form.name}
                  onChange={(e) => updateForm({ name: e.target.value })}
                  placeholder="メインアカウント"
                  required
                />
              </div>

              <AccountFormSections
                state={form}
                update={updateForm}
                showMessagingRequired={true}
              />

              <AccountSetupUrls liffId={form.liffId.trim() || null} />

              {createError && (
                <Banner tone="danger">{createError}</Banner>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="text-white"
                style={{ backgroundColor: '#06C755' }}
              >
                {submitting ? '登録中...' : '登録'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-gray-400">
            読み込み中...
          </CardContent>
        </Card>
      ) : accounts.length === 0 ? (
        <EmptyState
          title="LINEアカウントが登録されていません"
          description="LINE Developers Console からChannel情報を取得して登録してください"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {accounts.map((account) => (
            <Card key={account.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {account.pictureUrl ? (
                      <img
                        src={account.pictureUrl}
                        alt={account.displayName}
                        className="w-10 h-10 rounded-lg object-cover"
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                        style={{ backgroundColor: account.isActive ? '#06C755' : '#9CA3AF' }}
                      >
                        {account.displayName?.charAt(0) || 'L'}
                      </div>
                    )}
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">{account.displayName}</h3>
                      <p className="text-xs text-gray-400 font-mono">
                        {account.basicId ? `${account.basicId} · ` : ''}Channel: {account.channelId}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggle(account.id, account.isActive)}
                    className="focus:outline-none"
                  >
                    <Badge tone={account.isActive ? 'success' : 'neutral'}>
                      {account.isActive ? '有効' : '無効'}
                    </Badge>
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4 py-3 border-t border-b border-gray-100">
                  <div className="text-center">
                    <p className="text-lg font-bold text-gray-900">{account.stats.friendCount}</p>
                    <p className="text-xs text-gray-400">友だち</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-blue-600">{account.stats.activeScenarios}</p>
                    <p className="text-xs text-gray-400">配信中</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-green-600">{account.stats.messagesThisMonth}</p>
                    <p className="text-xs text-gray-400">今月送信</p>
                  </div>
                </div>

                {/* Login/LIFF status badges — at-a-glance signal that an account
                    is fully wired. Important because SQL-only setup historically
                    left rows half-configured (Login/LIFF blank). */}
                <div className="flex gap-2 mb-3">
                  <Badge tone={account.loginChannelId ? 'info' : 'neutral'}>
                    Login: {account.loginChannelId ? '設定済' : '未設定'}
                  </Badge>
                  <Badge tone={account.liffId ? 'default' : 'neutral'}>
                    LIFF: {account.liffId ? '設定済' : '未設定'}
                  </Badge>
                </div>

                <AccountSettingsSection
                  accountId={account.id}
                  initialCountry={(account as { country?: string | null }).country ?? null}
                  initialRole={(account as { role?: string | null }).role ?? null}
                  onUpdated={load}
                />
                <TestRecipientsSetting accountId={account.id} />

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-400">
                    登録: {new Date(account.createdAt).toLocaleDateString('ja-JP')}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={() => setEditing(account)}>
                      編集
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleDelete(account.id)}>
                      削除
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <CcPromptButton prompts={ccPrompts} />
      {showReorder && (
        <ReorderMode
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            displayName: a.displayName,
            country: (a as { country?: string | null }).country ?? null,
          }))}
          onClose={() => setShowReorder(false)}
          onSaved={load}
        />
      )}
      {editing && (
        <AccountEditModal
          accountId={editing.id}
          initialName={editing.name}
          initialChannelId={editing.channelId}
          initialLoginChannelId={editing.loginChannelId}
          initialLiffId={editing.liffId}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}
