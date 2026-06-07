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
import {
  Badge,
  Banner,
  Button,
  Card,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/primitives'

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
        <Banner tone="danger" title="⚠️ Lark 認証情報が未設定です" className="mb-4">
          <p>
            Cloudflare Worker secrets に <code>LARK_APP_ID</code> と{' '}
            <code>LARK_APP_SECRET</code> を登録してください。<br />
            設定するまで、ここで作った通知設定は <strong>すべて skip log</strong> になります。
          </p>
        </Banner>
      )
    }
    if (!health.ok) {
      return (
        <Banner tone="warning" title="⚠️ Lark API 接続失敗" className="mb-4">
          <p>{health.error ?? '不明なエラー'}</p>
        </Banner>
      )
    }
    return (
      <Banner tone="success" className="mb-4">
        ✅ Lark 認証 OK。通知が送れる状態です。
      </Banner>
    )
  }, [health])

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Header
          title="Lark 通知設定"
          description="友だち追加 / ブロック / フォーム回答 / 未返信タイムアウト等を、Lark の指定チャットに自動通知します。"
          action={
            <Button type="button" onClick={onOpenNew}>
              ＋ 新規追加
            </Button>
          }
        />

        {healthBanner}

        {error && (
          <Banner tone="danger" className="mb-4">
            {error}
          </Banner>
        )}

        {loading ? (
          <Card className="p-6 text-sm text-gray-500">読み込み中…</Card>
        ) : items.length === 0 ? (
          <Card className="p-6 text-sm text-gray-500">
            通知設定はまだありません。「新規追加」で Lark チャット ID を登録してください。
          </Card>
        ) : (
          <Card className="overflow-x-auto">
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
                      <Badge tone="neutral">{EVENT_LABEL[it.event_type]}</Badge>
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
                        <Badge tone="success">有効</Badge>
                      ) : (
                        <Badge tone="neutral">無効</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onTest(it)}
                          disabled={testingId === it.id || !(health?.ok)}
                          title={health?.ok ? '実際に Lark へテスト投稿します' : 'Lark 認証が未設定です'}
                          className="border-blue-300 text-blue-700 hover:bg-blue-50"
                        >
                          {testingId === it.id ? '送信中…' : 'テスト送信'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onOpenEdit(it)}
                        >
                          編集
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onToggle(it)}
                        >
                          {it.is_enabled ? '無効化' : '有効化'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onDelete(it)}
                          className="border-red-300 text-red-700 hover:bg-red-50"
                        >
                          削除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
            <Card className="mt-12 w-full max-w-2xl p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {editingId ? '通知設定を編集' : '通知設定を追加'}
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowForm(false)
                    resetForm()
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <Label>名前</Label>
                  <Input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="例: 友だち追加 → 営業チーム"
                  />
                </div>

                <div>
                  <Label>通知するイベント</Label>
                  <Select
                    value={formEvent}
                    onChange={(e) => setFormEvent(e.target.value as LarkEventType)}
                    disabled={!!editingId}
                  >
                    {(Object.keys(EVENT_LABEL) as LarkEventType[]).map((k) => (
                      <option key={k} value={k}>
                        {EVENT_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                  {editingId && (
                    <p className="mt-1 text-xs text-gray-500">
                      イベント種別は作成後は変更できません (削除して作り直してください)
                    </p>
                  )}
                </div>

                {formEvent === 'unread_timeout' && (
                  <div>
                    <Label>何分応答なしで通知するか</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={1440}
                        value={formMinutes}
                        onChange={(e) => setFormMinutes(Number(e.target.value))}
                        className="w-32"
                      />
                      <span className="text-sm text-gray-600">分</span>
                    </div>
                  </div>
                )}

                <div>
                  <Label>送信先タイプ</Label>
                  <Select
                    value={formTargetType}
                    onChange={(e) => setFormTargetType(e.target.value as LarkTargetType)}
                  >
                    {(Object.keys(TARGET_LABEL) as LarkTargetType[]).map((k) => (
                      <option key={k} value={k}>
                        {TARGET_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <Label>送信先 ID</Label>
                  <Input
                    type="text"
                    value={formTargetId}
                    onChange={(e) => setFormTargetId(e.target.value)}
                    placeholder={TARGET_PLACEHOLDER[formTargetType]}
                    className="font-mono text-xs"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Lark チャットの「メンバー追加」画面で Bot を招待した後、Bot コマンドで
                    chat_id / open_id を取得できます。
                  </p>
                </div>

                <div>
                  <Label>通知本文 (省略時はデフォルト文言)</Label>
                  <Textarea
                    value={formTemplate}
                    onChange={(e) => setFormTemplate(e.target.value)}
                    rows={4}
                    className="font-mono"
                    placeholder={'例: {{friend_name}} さんが追加されました\n詳細: {{friend_url}}'}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    使えるプレースホルダ: <code>{'{{friend_name}}'}</code> <code>{'{{friend_url}}'}</code>{' '}
                    <code>{'{{account_name}}'}</code> <code>{'{{form_name}}'}</code> <code>{'{{minutes}}'}</code>
                  </p>
                </div>

                <div>
                  <Label>メモ</Label>
                  <Input
                    type="text"
                    value={formMemo}
                    onChange={(e) => setFormMemo(e.target.value)}
                    placeholder="任意"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false)
                    resetForm()
                  }}
                  disabled={saving}
                >
                  キャンセル
                </Button>
                <Button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                >
                  {saving ? '保存中…' : editingId ? '更新' : '追加'}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
