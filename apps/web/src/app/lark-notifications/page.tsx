'use client'

/**
 * Phase 3-F1 (Lark連携): 通知設定画面
 *
 * hyhome Harness の各種イベント (友だち追加・ブロック・フォーム回答・未返信タイムアウト) を
 * Lark の指定チャットに自動通知する設定を管理する。
 */

import { useEffect, useMemo, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

type LarkEventType =
  | 'friend_added'
  | 'friend_blocked'
  | 'form_submitted'
  | 'unread_timeout'
  | 'daily_summary'

type LarkTargetType = 'chat' | 'user' | 'email'

interface LarkNotification {
  id: string
  line_account_id: string
  name: string
  event_type: LarkEventType
  target_type: LarkTargetType
  target_id: string
  template_text: string | null
  filter_form_id: string | null
  unread_threshold_minutes: number
  is_enabled: number
  memo: string | null
  created_at: string
}

const EVENT_LABEL: Record<LarkEventType, string> = {
  friend_added: '友だち追加',
  friend_blocked: 'ブロック',
  form_submitted: 'フォーム回答',
  unread_timeout: '未返信タイムアウト',
  daily_summary: '日次サマリ',
}

const TARGET_LABEL: Record<LarkTargetType, string> = {
  chat: 'グループチャット (oc_*)',
  user: '個人IM (ou_*)',
  email: 'メールアドレス',
}

const TARGET_PLACEHOLDER: Record<LarkTargetType, string> = {
  chat: 'oc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  user: 'ou_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  email: 'name@hyhome.co.jp',
}

export default function LarkNotificationsPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<LarkNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [health, setHealth] = useState<
    | { configured: boolean; ok: boolean; error?: string }
    | null
  >(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formEvent, setFormEvent] = useState<LarkEventType>('friend_added')
  const [formTargetType, setFormTargetType] = useState<LarkTargetType>('chat')
  const [formTargetId, setFormTargetId] = useState('')
  const [formTemplate, setFormTemplate] = useState('')
  const [formMinutes, setFormMinutes] = useState(30)
  const [formMemo, setFormMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const qs = selectedAccountId
      ? `?lineAccountId=${encodeURIComponent(selectedAccountId)}`
      : ''
    const r = await fetchApi<{ success: boolean; data: LarkNotification[]; error?: string }>(
      `/api/lark-notifications${qs}`,
    )
    if (r.success) setItems(r.data)
    else setError(r.error ?? '取得失敗')
    setLoading(false)
  }

  const loadHealth = async () => {
    const r = await fetchApi<{
      success: boolean
      configured?: boolean
      error?: string
    }>(`/api/lark-notifications/health`)
    setHealth({
      configured: r.configured ?? false,
      ok: r.success,
      error: r.error,
    })
  }

  useEffect(() => {
    load()
    loadHealth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])

  const resetForm = () => {
    setEditingId(null)
    setFormName('')
    setFormEvent('friend_added')
    setFormTargetType('chat')
    setFormTargetId('')
    setFormTemplate('')
    setFormMinutes(30)
    setFormMemo('')
  }

  const onOpenNew = () => {
    resetForm()
    setShowForm(true)
  }

  const onOpenEdit = (item: LarkNotification) => {
    setEditingId(item.id)
    setFormName(item.name)
    setFormEvent(item.event_type)
    setFormTargetType(item.target_type)
    setFormTargetId(item.target_id)
    setFormTemplate(item.template_text ?? '')
    setFormMinutes(item.unread_threshold_minutes)
    setFormMemo(item.memo ?? '')
    setShowForm(true)
  }

  const onSave = async () => {
    if (!selectedAccountId) {
      alert('LINE アカウントを選択してください')
      return
    }
    if (!formName.trim() || !formTargetId.trim()) {
      alert('名前と送信先 ID は必須です')
      return
    }
    setSaving(true)
    const payload = {
      lineAccountId: selectedAccountId,
      name: formName.trim(),
      eventType: formEvent,
      targetType: formTargetType,
      targetId: formTargetId.trim(),
      templateText: formTemplate.trim() || null,
      unreadThresholdMinutes: formMinutes,
      memo: formMemo.trim() || null,
    }
    const r = editingId
      ? await fetchApi<{ success: boolean; error?: string }>(`/api/lark-notifications/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      : await fetchApi<{ success: boolean; error?: string }>(`/api/lark-notifications`, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
    setSaving(false)
    if (r.success) {
      setShowForm(false)
      resetForm()
      load()
    } else {
      alert(r.error ?? '保存失敗')
    }
  }

  const onToggle = async (item: LarkNotification) => {
    const r = await fetchApi<{ success: boolean }>(`/api/lark-notifications/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isEnabled: !item.is_enabled }),
    })
    if (r.success) load()
  }

  const onDelete = async (item: LarkNotification) => {
    if (!confirm(`「${item.name}」を削除しますか?`)) return
    const r = await fetchApi<{ success: boolean }>(`/api/lark-notifications/${item.id}`, {
      method: 'DELETE',
    })
    if (r.success) load()
  }

  const onTest = async (item: LarkNotification) => {
    if (
      !confirm(
        `「${item.name}」の送信先 (${TARGET_LABEL[item.target_type]}: ${item.target_id}) に\nテストメッセージを実際に投稿します。よろしいですか?`,
      )
    ) {
      return
    }
    setTestingId(item.id)
    const r = await fetchApi<{ success: boolean; error?: string; messageId?: string }>(
      `/api/lark-notifications/${item.id}/test`,
      { method: 'POST' },
    )
    setTestingId(null)
    if (r.success) {
      alert(`✅ 送信成功\nLark で受信を確認してください。\nmessage_id: ${r.messageId ?? ''}`)
    } else {
      alert(`❌ 送信失敗\n${r.error ?? '不明なエラー'}`)
    }
  }

  const healthBanner = useMemo(() => {
    if (!health) return null
    if (!health.configured) {
      return (
        <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium mb-1">⚠️ Lark 認証情報が未設定です</p>
          <p>
            Cloudflare Worker secrets に <code>LARK_APP_ID</code> と{' '}
            <code>LARK_APP_SECRET</code> を登録してください。<br />
            設定するまで、ここで作った通知設定は <strong>すべて skip log</strong> になります。
          </p>
        </div>
      )
    }
    if (!health.ok) {
      return (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium mb-1">⚠️ Lark API 接続失敗</p>
          <p>{health.error ?? '不明なエラー'}</p>
        </div>
      )
    }
    return (
      <div className="mb-4 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        ✅ Lark 認証 OK。通知が送れる状態です。
      </div>
    )
  }, [health])

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Header
          title="Lark 通知設定"
          description="友だち追加 / ブロック / フォーム回答 / 未返信タイムアウト等を、Lark の指定チャットに自動通知します。"
          action={
            <button
              type="button"
              onClick={onOpenNew}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              ＋ 新規追加
            </button>
          }
        />

        {healthBanner}

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">
            読み込み中…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">
            通知設定はまだありません。「新規追加」で Lark チャット ID を登録してください。
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">名前</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">イベント</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">送信先</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">状態</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">アクション</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{it.name}</div>
                      {it.memo && (
                        <div className="text-xs text-gray-500">{it.memo}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {EVENT_LABEL[it.event_type]}
                      </span>
                      {it.event_type === 'unread_timeout' && (
                        <div className="mt-1 text-xs text-gray-500">
                          {it.unread_threshold_minutes} 分経過後
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-gray-500">{TARGET_LABEL[it.target_type]}</div>
                      <div className="font-mono text-xs break-all">{it.target_id}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {it.is_enabled ? (
                        <span className="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          有効
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          無効
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => onTest(it)}
                          disabled={testingId === it.id || !(health?.ok)}
                          className="rounded border border-blue-300 px-2 py-1 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                          title={health?.ok ? '実際に Lark へテスト投稿します' : 'Lark 認証が未設定です'}
                        >
                          {testingId === it.id ? '送信中…' : 'テスト送信'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenEdit(it)}
                          className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggle(it)}
                          className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                        >
                          {it.is_enabled ? '無効化' : '有効化'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(it)}
                          className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
            <div className="mt-12 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {editingId ? '通知設定を編集' : '通知設定を追加'}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    resetForm()
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">名前</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="例: 友だち追加 → 営業チーム"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">通知するイベント</label>
                  <select
                    value={formEvent}
                    onChange={(e) => setFormEvent(e.target.value as LarkEventType)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    disabled={!!editingId}
                  >
                    {(Object.keys(EVENT_LABEL) as LarkEventType[]).map((k) => (
                      <option key={k} value={k}>
                        {EVENT_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  {editingId && (
                    <p className="mt-1 text-xs text-gray-500">
                      イベント種別は作成後は変更できません (削除して作り直してください)
                    </p>
                  )}
                </div>

                {formEvent === 'unread_timeout' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      何分応答なしで通知するか
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={formMinutes}
                      onChange={(e) => setFormMinutes(Number(e.target.value))}
                      className="mt-1 w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    <span className="ml-2 text-sm text-gray-600">分</span>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700">送信先タイプ</label>
                  <select
                    value={formTargetType}
                    onChange={(e) => setFormTargetType(e.target.value as LarkTargetType)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    {(Object.keys(TARGET_LABEL) as LarkTargetType[]).map((k) => (
                      <option key={k} value={k}>
                        {TARGET_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">送信先 ID</label>
                  <input
                    type="text"
                    value={formTargetId}
                    onChange={(e) => setFormTargetId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono text-xs"
                    placeholder={TARGET_PLACEHOLDER[formTargetType]}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Lark チャットの「メンバー追加」画面で Bot を招待した後、Bot コマンドで
                    chat_id / open_id を取得できます。
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    通知本文 (省略時はデフォルト文言)
                  </label>
                  <textarea
                    value={formTemplate}
                    onChange={(e) => setFormTemplate(e.target.value)}
                    rows={4}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                    placeholder={'例: {{friend_name}} さんが追加されました\n詳細: {{friend_url}}'}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    使えるプレースホルダ: <code>{'{{friend_name}}'}</code> <code>{'{{friend_url}}'}</code>{' '}
                    <code>{'{{account_name}}'}</code> <code>{'{{form_name}}'}</code> <code>{'{{minutes}}'}</code>
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">メモ</label>
                  <input
                    type="text"
                    value={formMemo}
                    onChange={(e) => setFormMemo(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="任意"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    resetForm()
                  }}
                  disabled={saving}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? '保存中…' : editingId ? '更新' : '追加'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
