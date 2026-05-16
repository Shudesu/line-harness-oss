'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import TestRecipientsSetting from '@/components/accounts/test-recipients-setting'

interface LineAccountListItem {
  id: string
  channelId: string
  name: string
  displayName: string
  pictureUrl: string | null
  basicId: string | null
  isActive: boolean
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
  const [notice, setNotice] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ channelId: '', name: '', channelAccessToken: '', channelSecret: '' })
  const [tokenEditorId, setTokenEditorId] = useState<string | null>(null)
  const [tokenForm, setTokenForm] = useState({ channelAccessToken: '', channelSecret: '' })
  const [savingToken, setSavingToken] = useState(false)

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.channelId || !form.name || !form.channelAccessToken || !form.channelSecret) return
    try {
      await api.lineAccounts.create(form)
      setForm({ channelId: '', name: '', channelAccessToken: '', channelSecret: '' })
      setShowCreate(false)
      load()
    } catch {}
  }

  const openTokenEditor = (id: string) => {
    setError('')
    setNotice('')
    setTokenEditorId((current) => current === id ? null : id)
    setTokenForm({ channelAccessToken: '', channelSecret: '' })
  }

  const handleTokenUpdate = async (e: React.FormEvent, account: LineAccountListItem) => {
    e.preventDefault()
    const channelAccessToken = tokenForm.channelAccessToken.trim()
    const channelSecret = tokenForm.channelSecret.trim()
    if (!channelAccessToken) {
      setError('Channel access token を入力してください')
      return
    }
    setSavingToken(true)
    setError('')
    setNotice('')
    try {
      const payload: { channelAccessToken: string; channelSecret?: string } = { channelAccessToken }
      if (channelSecret) payload.channelSecret = channelSecret
      const res = await api.lineAccounts.update(account.id, payload)
      if (!res.success) throw new Error(res.error || 'Token更新に失敗しました')
      setTokenEditorId(null)
      setTokenForm({ channelAccessToken: '', channelSecret: '' })
      setNotice(`${account.displayName || account.name} のChannel access tokenを更新しました。リッチメニュー画面を再読み込みしてください。`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Token更新に失敗しました')
    } finally {
      setSavingToken(false)
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
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            {showCreate ? 'キャンセル' : '+ アカウント追加'}
          </button>
        }
      />

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {notice}
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">アカウント名</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="メインアカウント"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Channel ID</label>
              <input
                value={form.channelId}
                onChange={(e) => setForm({ ...form, channelId: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="123456789"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Channel Access Token</label>
              <input
                type="password"
                value={form.channelAccessToken}
                onChange={(e) => setForm({ ...form, channelAccessToken: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Channel Secret</label>
              <input
                type="password"
                value={form.channelSecret}
                onChange={(e) => setForm({ ...form, channelSecret: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                required
              />
            </div>
          </div>
          <button
            type="submit"
            className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            登録
          </button>
        </form>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">読み込み中...</div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          <p className="mb-2">LINEアカウントが登録されていません</p>
          <p className="text-xs text-gray-300">LINE Developers Console からChannel情報を取得して登録してください</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {accounts.map((account) => (
            <div key={account.id} className="bg-white rounded-lg border border-gray-200 p-6">
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
                  className={`text-xs px-2 py-0.5 rounded-full ${account.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                >
                  {account.isActive ? '有効' : '無効'}
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
              <TestRecipientsSetting accountId={account.id} />

              <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Channel access token</p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      リッチメニュー、チャット送信、配信で使います。既存値は安全のため表示しません。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openTokenEditor(account.id)}
                    className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    {tokenEditorId === account.id ? '閉じる' : 'Token更新'}
                  </button>
                </div>

                {tokenEditorId === account.id && (
                  <form onSubmit={(e) => handleTokenUpdate(e, account)} className="mt-3 space-y-3 border-t border-gray-200 pt-3">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-gray-600">新しい Channel access token</span>
                      <textarea
                        value={tokenForm.channelAccessToken}
                        onChange={(e) => setTokenForm({ ...tokenForm, channelAccessToken: e.target.value })}
                        className="min-h-24 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                        placeholder="LINE Developers > Messaging API > Channel access token を貼り付け"
                        required
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-gray-600">Channel Secretも更新する場合だけ入力</span>
                      <input
                        type="password"
                        value={tokenForm.channelSecret}
                        onChange={(e) => setTokenForm({ ...tokenForm, channelSecret: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        placeholder="空欄なら変更しません"
                      />
                    </label>
                    <div className="rounded-md bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                      LINE Login用のSecretではなく、Messaging APIチャネルのChannel access tokenを保存してください。
                    </div>
                    <button
                      type="submit"
                      disabled={savingToken}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      style={{ backgroundColor: '#06C755' }}
                    >
                      {savingToken ? '保存中...' : 'Tokenを保存'}
                    </button>
                  </form>
                )}
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  登録: {new Date(account.createdAt).toLocaleDateString('ja-JP')}
                </p>
                <button
                  onClick={() => handleDelete(account.id)}
                  className="text-red-500 hover:text-red-700 text-xs"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
