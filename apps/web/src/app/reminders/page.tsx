'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import MultiMessageEditor, {
  type MessageItem,
  parseMessages,
  serializeMessages,
} from '@/components/multi-message-editor'

// ----- Types -----

interface Reminder {
  id: string
  name: string
  description: string | null
  isActive: boolean
  eventDate: string | null
  eventLabel: string
  createdAt: string
  updatedAt: string
}

type StepTimingType = 'relative' | 'day_time'

interface ReminderStep {
  id: string
  reminderId: string
  offsetMinutes: number
  timingType: StepTimingType
  daysOffset: number | null
  sendHour: number | null
  sendMinute: number | null
  messageType: string
  messageContent: string
  createdAt: string
}

interface ReminderWithSteps extends Reminder {
  steps: ReminderStep[]
}

interface Enrollment {
  id: string
  friendId: string
  reminderId: string
  targetDate: string
  status: string
  displayName: string
  pictureUrl: string | null
  isFollowing: boolean
  createdAt: string
}

interface FriendOption {
  id: string
  displayName: string
}

interface CreateFormState {
  name: string
  description: string
  eventDate: string
  eventLabel: string
}

interface StepFormState {
  timingType: StepTimingType
  daysValue: number
  daysDirection: 'before' | 'after' | 'same'
  sendHour: number
  sendMinute: number
  relativeValue: number
  relativeUnit: 'minutes' | 'hours'
  relativeDirection: 'before' | 'after'
  messages: MessageItem[]
}

// ----- Helpers -----

const eventLabelOptions = [
  'セミナー開催日時',
  'イベント日時',
  '予約日時',
  '申込期限',
  'カスタム',
]

function formatStepTiming(step: ReminderStep): string {
  if (step.timingType === 'day_time' && step.daysOffset !== null && step.sendHour !== null) {
    const days = Math.abs(step.daysOffset)
    const h = String(step.sendHour).padStart(2, '0')
    const m = String(step.sendMinute ?? 0).padStart(2, '0')
    if (step.daysOffset === 0) return `当日 ${h}:${m}`
    if (step.daysOffset < 0) return `${days}日前 ${h}:${m}`
    return `${days}日後 ${h}:${m}`
  }
  return formatOffset(step.offsetMinutes)
}

function formatOffset(minutes: number): string {
  const abs = Math.abs(minutes)
  if (abs === 0) return 'ゴール時刻'
  if (abs < 60) return minutes < 0 ? `${abs}分前` : `${abs}分後`
  if (abs % 1440 === 0) {
    const days = abs / 1440
    return minutes < 0 ? `${days}日前` : `${days}日後`
  }
  if (abs % 60 === 0) {
    const hours = abs / 60
    return minutes < 0 ? `${hours}時間前` : `${hours}時間後`
  }
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  return minutes < 0 ? `${hours}時間${mins}分前` : `${hours}時間${mins}分後`
}

function stepFormToApi(form: StepFormState) {
  if (form.timingType === 'day_time') {
    const daysOffset = form.daysDirection === 'before' ? -form.daysValue
      : form.daysDirection === 'after' ? form.daysValue : 0
    const offsetMinutes = daysOffset * 1440 + (form.sendHour * 60 + form.sendMinute)
    return {
      timingType: 'day_time' as const,
      daysOffset,
      sendHour: form.sendHour,
      sendMinute: form.sendMinute,
      offsetMinutes,
    }
  }
  const totalMinutes = form.relativeUnit === 'hours'
    ? form.relativeValue * 60
    : form.relativeValue
  const offsetMinutes = form.relativeDirection === 'before' ? -totalMinutes : totalMinutes
  return {
    timingType: 'relative' as const,
    daysOffset: null,
    sendHour: null,
    sendMinute: null,
    offsetMinutes,
  }
}

/** step → form state (for editing) */
function stepToFormState(step: ReminderStep): StepFormState {
  const messages = parseMessages(step.messageType, step.messageContent)
  if (step.timingType === 'day_time' && step.daysOffset !== null && step.sendHour !== null) {
    return {
      timingType: 'day_time',
      daysValue: Math.abs(step.daysOffset),
      daysDirection: step.daysOffset < 0 ? 'before' : step.daysOffset > 0 ? 'after' : 'same',
      sendHour: step.sendHour,
      sendMinute: step.sendMinute ?? 0,
      relativeValue: 1, relativeUnit: 'hours', relativeDirection: 'before',
      messages,
    }
  }
  // relative
  const abs = Math.abs(step.offsetMinutes)
  const isHours = abs >= 60 && abs % 60 === 0
  return {
    timingType: 'relative',
    daysValue: 1, daysDirection: 'before', sendHour: 10, sendMinute: 0,
    relativeValue: isHours ? abs / 60 : abs,
    relativeUnit: isHours ? 'hours' : 'minutes',
    relativeDirection: step.offsetMinutes < 0 ? 'before' : 'after',
    messages,
  }
}

const messageTypeLabels: Record<string, string> = {
  text: 'テキスト', image: '画像', image_link: '画像+リンク',
  flex: 'Flex', carousel: 'カルーセル', multi: '複数吹き出し',
}

const statusLabels: Record<string, { label: string; color: string }> = {
  active: { label: '配信中', color: 'bg-green-100 text-green-700' },
  completed: { label: '完了', color: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'キャンセル', color: 'bg-gray-100 text-gray-500' },
}

const ccPrompts = [
  { title: 'リマインダー作成', prompt: `新しいリマインダーの作成をサポートしてください。\n1. リマインダーの用途別テンプレート（セミナー、予約、フォローアップ）を提案\n2. 効果的なリマインダー名と説明文の書き方\n3. 有効化タイミングと対象者設定のベストプラクティス` },
  { title: 'ステップ設計', prompt: `リマインダーのステップ配信を設計してください。\n1. 配信タイミングの最適な設定（例: 3日前10:00, 1日前18:00, 当日9:00）\n2. 各ステップのメッセージ内容テンプレートを作成\n3. テキスト・画像・Flexメッセージの使い分けガイド` },
]

const defaultStepForm: StepFormState = {
  timingType: 'day_time', daysValue: 1, daysDirection: 'before',
  sendHour: 10, sendMinute: 0, relativeValue: 1, relativeUnit: 'hours',
  relativeDirection: 'before', messages: [{ type: 'text', content: '' }],
}

// ----- Step Timing Picker (reusable) -----

function StepTimingPicker({ form, onChange }: { form: StepFormState; onChange: (f: StepFormState) => void }) {
  const preview = (() => {
    if (form.timingType === 'day_time') {
      const h = String(form.sendHour).padStart(2, '0')
      const m = String(form.sendMinute).padStart(2, '0')
      if (form.daysDirection === 'same') return `起点当日 ${h}:${m} に配信`
      const label = form.daysDirection === 'before' ? '日前' : '日後'
      return `起点${form.daysValue}${label} ${h}:${m} に配信`
    }
    const label = form.relativeDirection === 'before' ? '前' : '後'
    if (form.relativeUnit === 'hours') return `起点${form.relativeValue}時間${label}に配信`
    return `起点${form.relativeValue}分${label}に配信`
  })()

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-2">配信タイミング</label>
      <div className="flex gap-2 mb-3">
        {(['day_time', 'relative'] as const).map((t) => (
          <button key={t} type="button" onClick={() => onChange({ ...form, timingType: t })}
            className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
              form.timingType === t ? 'border-green-500 text-green-700 bg-green-50' : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
            }`}
          >
            {t === 'day_time' ? '日時指定' : '相対時間'}
          </button>
        ))}
      </div>

      {form.timingType === 'day_time' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-gray-500">起点の</span>
          <input type="number" min="0" max="365"
            className="w-16 border border-gray-300 rounded-md px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-green-500"
            value={form.daysDirection === 'same' ? 0 : form.daysValue}
            onChange={(e) => {
              const v = Math.max(0, Number(e.target.value))
              onChange({ ...form, daysValue: v, daysDirection: v === 0 ? 'same' : form.daysDirection === 'same' ? 'before' : form.daysDirection })
            }}
          />
          <select className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
            value={form.daysDirection} onChange={(e) => onChange({ ...form, daysDirection: e.target.value as 'before' | 'after' | 'same' })}>
            <option value="before">日前</option>
            <option value="same">当日</option>
            <option value="after">日後</option>
          </select>
          <span className="text-xs text-gray-500">の</span>
          <input type="number" min="0" max="23"
            className="w-14 border border-gray-300 rounded-md px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-green-500"
            value={form.sendHour} onChange={(e) => onChange({ ...form, sendHour: Math.min(23, Math.max(0, Number(e.target.value))) })}
          />
          <span className="text-xs text-gray-500">:</span>
          <input type="number" min="0" max="59" step="5"
            className="w-14 border border-gray-300 rounded-md px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-green-500"
            value={form.sendMinute} onChange={(e) => onChange({ ...form, sendMinute: Math.min(59, Math.max(0, Number(e.target.value))) })}
          />
          <span className="text-xs text-gray-500">に配信</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-gray-500">起点の</span>
          <input type="number" min="1" max="9999"
            className="w-20 border border-gray-300 rounded-md px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-green-500"
            value={form.relativeValue} onChange={(e) => onChange({ ...form, relativeValue: Math.max(1, Number(e.target.value)) })}
          />
          <select className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
            value={form.relativeUnit} onChange={(e) => onChange({ ...form, relativeUnit: e.target.value as 'minutes' | 'hours' })}>
            <option value="hours">時間</option>
            <option value="minutes">分</option>
          </select>
          <select className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
            value={form.relativeDirection} onChange={(e) => onChange({ ...form, relativeDirection: e.target.value as 'before' | 'after' })}>
            <option value="before">前</option>
            <option value="after">後</option>
          </select>
          <span className="text-xs text-gray-500">に配信</span>
        </div>
      )}
      <p className="text-xs text-green-600 mt-2 font-medium">{preview}</p>
    </div>
  )
}

// ----- Main Component -----

export default function RemindersPage() {
  const { selectedAccountId } = useAccount()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateFormState>({ name: '', description: '', eventDate: '', eventLabel: 'セミナー開催日時' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedData, setExpandedData] = useState<ReminderWithSteps | null>(null)
  const [expandLoading, setExpandLoading] = useState(false)

  // Step add/edit
  const [showStepForm, setShowStepForm] = useState(false)
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [stepForm, setStepForm] = useState<StepFormState>({ ...defaultStepForm })
  const [stepSaving, setStepSaving] = useState(false)
  const [stepFormError, setStepFormError] = useState('')

  // Event date editing
  const [editingEventDate, setEditingEventDate] = useState(false)
  const [eventDateDraft, setEventDateDraft] = useState('')
  const [eventLabelDraft, setEventLabelDraft] = useState('')

  // Enrollment
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [enrollLoading, setEnrollLoading] = useState(false)
  const [showEnrollForm, setShowEnrollForm] = useState(false)
  const [enrollFriendSearch, setEnrollFriendSearch] = useState('')
  const [friendOptions, setFriendOptions] = useState<FriendOption[]>([])
  const [selectedFriendId, setSelectedFriendId] = useState('')
  const [enrollTargetDate, setEnrollTargetDate] = useState('')
  const [enrollSaving, setEnrollSaving] = useState(false)
  const [enrollError, setEnrollError] = useState('')

  const loadReminders = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await api.reminders.list({ accountId: selectedAccountId || undefined })
      if (res.success) setReminders(res.data)
      else setError(res.error)
    } catch { setError('読み込みに失敗しました') } finally { setLoading(false) }
  }, [selectedAccountId])

  useEffect(() => { loadReminders() }, [loadReminders])

  const loadDetail = useCallback(async (id: string) => {
    setExpandLoading(true)
    try {
      const res = await api.reminders.get(id)
      if (res.success) setExpandedData(res.data as ReminderWithSteps)
    } catch { setError('詳細の読み込みに失敗しました') } finally { setExpandLoading(false) }
  }, [])

  const loadEnrollments = useCallback(async (id: string) => {
    setEnrollLoading(true)
    try {
      const res = await api.reminders.enrollments(id)
      if (res.success) setEnrollments(res.data)
    } catch { /* ignore */ } finally { setEnrollLoading(false) }
  }, [])

  const handleExpand = (id: string) => {
    if (expandedId === id) { setExpandedId(null); setExpandedData(null); return }
    setExpandedId(id); setExpandedData(null); setEnrollments([])
    setShowStepForm(false); setEditingStepId(null); setShowEnrollForm(false); setEditingEventDate(false)
    loadDetail(id); loadEnrollments(id)
  }

  const handleCreate = async () => {
    if (!form.name.trim()) { setFormError('リマインダー名を入力してください'); return }
    if (!form.eventDate) { setFormError('起点日時を設定してください'); return }
    setSaving(true); setFormError('')
    try {
      const eventDate = form.eventDate + ':00.000+09:00'
      const res = await api.reminders.create({
        name: form.name,
        description: form.description || undefined,
        lineAccountId: selectedAccountId || undefined,
        eventDate,
        eventLabel: form.eventLabel,
      })
      if (res.success) { setShowCreate(false); setForm({ name: '', description: '', eventDate: '', eventLabel: 'セミナー開催日時' }); loadReminders() }
      else setFormError(res.error)
    } catch { setFormError('作成に失敗しました') } finally { setSaving(false) }
  }

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await api.reminders.update(id, { isActive: !current })
      loadReminders()
      if (expandedId === id && expandedData) setExpandedData({ ...expandedData, isActive: !current })
    } catch { setError('ステータスの変更に失敗しました') }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このリマインダーを削除してもよいですか？')) return
    try {
      await api.reminders.delete(id)
      if (expandedId === id) { setExpandedId(null); setExpandedData(null) }
      loadReminders()
    } catch { setError('削除に失敗しました') }
  }

  const handleSaveEventDate = async () => {
    if (!expandedId) return
    try {
      const eventDate = eventDateDraft ? eventDateDraft + ':00.000+09:00' : null
      await api.reminders.update(expandedId, { eventDate, eventLabel: eventLabelDraft })
      setEditingEventDate(false)
      loadReminders()
      loadDetail(expandedId)
    } catch { setError('更新に失敗しました') }
  }

  // Step handlers
  const openAddStep = () => {
    setEditingStepId(null)
    setStepForm({ ...defaultStepForm })
    setShowStepForm(true)
    setStepFormError('')
  }

  const openEditStep = (step: ReminderStep) => {
    setEditingStepId(step.id)
    setStepForm(stepToFormState(step))
    setShowStepForm(true)
    setStepFormError('')
  }

  const handleSaveStep = async () => {
    if (!expandedId) return
    const hasContent = stepForm.messages.some((m) => m.content.trim())
    if (!hasContent) { setStepFormError('メッセージ内容を入力してください'); return }
    setStepSaving(true); setStepFormError('')
    try {
      const { messageType, messageContent } = serializeMessages(stepForm.messages)
      const timing = stepFormToApi(stepForm)
      if (editingStepId) {
        // Update existing step
        const res = await api.reminders.updateStep(expandedId, editingStepId, { ...timing, messageType, messageContent })
        if (!res.success) { setStepFormError(res.error); return }
      } else {
        // Create new step
        const res = await api.reminders.addStep(expandedId, { ...timing, messageType, messageContent })
        if (!res.success) { setStepFormError(res.error); return }
      }
      setShowStepForm(false); setEditingStepId(null); setStepForm({ ...defaultStepForm })
      loadDetail(expandedId)
    } catch { setStepFormError('保存に失敗しました') } finally { setStepSaving(false) }
  }

  const handleDeleteStep = async (stepId: string) => {
    if (!expandedId || !confirm('このステップを削除してもよいですか？')) return
    try { await api.reminders.deleteStep(expandedId, stepId); loadDetail(expandedId) }
    catch { setError('ステップの削除に失敗しました') }
  }

  // Enrollment handlers
  const searchFriends = useCallback(async (query: string) => {
    if (!query.trim()) { setFriendOptions([]); return }
    const params = selectedAccountId ? `&lineAccountId=${selectedAccountId}` : ''
    try {
      const res = await fetchApi<{ success: boolean; data: { friends: FriendOption[] } }>(`/api/friends?search=${encodeURIComponent(query)}${params}&limit=10`)
      if (res.success) setFriendOptions(res.data.friends)
    } catch { /* ignore */ }
  }, [selectedAccountId])

  useEffect(() => { const t = setTimeout(() => searchFriends(enrollFriendSearch), 300); return () => clearTimeout(t) }, [enrollFriendSearch, searchFriends])

  const handleEnroll = async () => {
    if (!expandedId || !selectedFriendId) { setEnrollError('友だちを選択してください'); return }
    setEnrollSaving(true); setEnrollError('')
    try {
      // Use the reminder's event date as default, or override from form
      const dateStr = enrollTargetDate
        ? enrollTargetDate + ':00.000+09:00'
        : expandedData?.eventDate ?? ''
      if (!dateStr) { setEnrollError('ゴール日時を設定してください'); setEnrollSaving(false); return }
      const res = await api.reminders.enroll(expandedId, selectedFriendId, dateStr)
      if (res.success) {
        setShowEnrollForm(false); setSelectedFriendId(''); setEnrollTargetDate('')
        setEnrollFriendSearch(''); setFriendOptions([])
        loadEnrollments(expandedId)
      } else setEnrollError(res.error)
    } catch { setEnrollError('登録に失敗しました') } finally { setEnrollSaving(false) }
  }

  const handleCancelEnrollment = async (enrollmentId: string) => {
    if (!expandedId || !confirm('この登録をキャンセルしてもよいですか？')) return
    try { await api.reminders.cancelEnrollment(enrollmentId); loadEnrollments(expandedId) }
    catch { setError('キャンセルに失敗しました') }
  }

  return (
    <div>
      <Header
        title="リマインダ配信"
        action={
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90" style={{ backgroundColor: '#06C755' }}>
            + 新規リマインダー
          </button>
        }
      />

      {/* 仕組み説明 */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-800 mb-1">リマインダ配信の仕組み</h3>
        <p className="text-xs text-blue-700 leading-relaxed">
          <strong>起点日時</strong>（セミナー日、予約日等）をカレンダーで設定し、その日時を基準にメッセージを自動配信します。
          友だちごとに起点日時を変更することも可能です。
        </p>
        <p className="text-xs text-blue-600 mt-1">例: 起点 = 3/25 19:00（セミナー） → 「3日前10:00」「1日前18:00」「当日9:00」にリマインド送信</p>
      </div>

      {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      {/* ===== Create Form ===== */}
      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">新規リマインダーを作成</h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">リマインダー名 <span className="text-red-500">*</span></label>
              <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 3月セミナーリマインダー" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">説明</label>
              <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                rows={2} placeholder="リマインダーの説明 (省略可)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>

            {/* 起点タイプ選択 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">起点の種類</label>
              <div className="flex flex-wrap gap-2">
                {eventLabelOptions.map((label) => (
                  <button key={label} type="button" onClick={() => setForm({ ...form, eventLabel: label })}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                      form.eventLabel === label ? 'border-green-500 text-green-700 bg-green-50' : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 起点日時カレンダー */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                起点日時（{form.eventLabel}）<span className="text-red-500">*</span>
              </label>
              <input type="datetime-local" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} />
              <p className="text-xs text-gray-400 mt-1">この日時を基準に、ステップの配信タイミングが計算されます</p>
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}
            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={saving}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity" style={{ backgroundColor: '#06C755' }}>
                {saving ? '作成中...' : '作成'}
              </button>
              <button onClick={() => { setShowCreate(false); setFormError('') }}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Reminder List ===== */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-3/4" /><div className="h-3 bg-gray-100 rounded w-full" />
            </div>
          ))}
        </div>
      ) : reminders.length === 0 && !showCreate ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">リマインダーがありません。「新規リマインダー」から作成してください。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {reminders.map((reminder) => {
            const isExpanded = expandedId === reminder.id
            return (
              <div key={reminder.id}
                className={`bg-white rounded-lg shadow-sm border border-gray-200 transition-all ${isExpanded ? 'md:col-span-2 xl:col-span-3' : ''}`}>
                {/* Card header */}
                <div className="p-5 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => handleExpand(reminder.id)}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-gray-900 truncate">{reminder.name}</h3>
                      {reminder.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{reminder.description}</p>}
                      {reminder.eventDate && (
                        <p className="text-xs text-blue-600 mt-1">
                          {reminder.eventLabel}: {new Date(reminder.eventDate).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                    <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                      reminder.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>{reminder.isActive ? '有効' : '無効'}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                    <span>作成日: {new Date(reminder.createdAt).toLocaleDateString('ja-JP')}</span>
                    <span>{isExpanded ? '▲ 閉じる' : '▼ 詳細'}</span>
                  </div>
                </div>

                {/* ===== Expanded Detail ===== */}
                {isExpanded && (
                  <div className="border-t border-gray-200 p-5 space-y-6">
                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={(e) => { e.stopPropagation(); handleToggleActive(reminder.id, reminder.isActive) }}
                        className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md transition-colors ${
                          reminder.isActive ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'text-white hover:opacity-90'
                        }`} style={!reminder.isActive ? { backgroundColor: '#06C755' } : undefined}>
                        {reminder.isActive ? '無効にする' : '有効にする'}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(reminder.id) }}
                        className="px-3 py-1.5 min-h-[44px] text-xs font-medium text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors">削除</button>
                    </div>

                    {/* ===== 起点日時 (editable) ===== */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-semibold text-blue-800">起点日時（{expandedData?.eventLabel ?? reminder.eventLabel}）</h4>
                        {!editingEventDate && (
                          <button onClick={() => {
                            setEditingEventDate(true)
                            const ed = expandedData?.eventDate ?? reminder.eventDate
                            setEventDateDraft(ed ? ed.slice(0, 16) : '')
                            setEventLabelDraft(expandedData?.eventLabel ?? reminder.eventLabel ?? 'イベント日時')
                          }} className="text-xs text-blue-600 hover:text-blue-800 underline">変更</button>
                        )}
                      </div>
                      {editingEventDate ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {eventLabelOptions.map((label) => (
                              <button key={label} type="button" onClick={() => setEventLabelDraft(label)}
                                className={`px-2 py-1 text-xs rounded-md border ${
                                  eventLabelDraft === label ? 'border-blue-500 text-blue-700 bg-blue-100' : 'border-gray-300 text-gray-600'
                                }`}>{label}</button>
                            ))}
                          </div>
                          <input type="datetime-local"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={eventDateDraft} onChange={(e) => setEventDateDraft(e.target.value)} />
                          <div className="flex gap-2">
                            <button onClick={handleSaveEventDate}
                              className="px-3 py-1.5 text-xs font-medium text-white rounded-md" style={{ backgroundColor: '#06C755' }}>保存</button>
                            <button onClick={() => setEditingEventDate(false)}
                              className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md">キャンセル</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm font-medium text-blue-900">
                          {(expandedData?.eventDate ?? reminder.eventDate)
                            ? new Date(expandedData?.eventDate ?? reminder.eventDate!).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : <span className="text-gray-400">未設定</span>}
                        </p>
                      )}
                    </div>

                    {/* ===== Steps ===== */}
                    {expandLoading ? (
                      <div className="space-y-2 animate-pulse"><div className="h-3 bg-gray-200 rounded w-32" /><div className="h-10 bg-gray-100 rounded" /></div>
                    ) : expandedData ? (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-semibold text-gray-700">配信ステップ ({expandedData.steps.length}件)</h4>
                          <button onClick={openAddStep}
                            className="px-3 py-1 min-h-[44px] text-xs font-medium text-white rounded-md transition-opacity hover:opacity-90" style={{ backgroundColor: '#06C755' }}>
                            + ステップ追加
                          </button>
                        </div>

                        {expandedData.steps.length === 0 ? (
                          <p className="text-xs text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-lg">
                            ステップがありません。「ステップ追加」から配信タイミングを設定してください。
                          </p>
                        ) : (
                          <div className="relative pl-6 space-y-0">
                            <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-200" />
                            {expandedData.steps.sort((a, b) => a.offsetMinutes - b.offsetMinutes).map((step, idx) => (
                              <div key={step.id} className="relative flex items-start gap-3 py-2">
                                <div className={`absolute -left-4 top-3.5 w-3 h-3 rounded-full border-2 ${
                                  idx === 0 ? 'border-blue-500 bg-blue-100' : 'border-gray-300 bg-white'
                                }`} />
                                <div className="flex-1 bg-gray-50 rounded-lg p-3 border border-gray-100">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-100 text-blue-800">
                                        {formatStepTiming(step)}
                                      </span>
                                      <span className="text-xs text-gray-400">{messageTypeLabels[step.messageType] ?? step.messageType}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => openEditStep(step)}
                                        className="min-h-[44px] min-w-[44px] text-xs text-blue-500 hover:text-blue-700 transition-colors">編集</button>
                                      <button onClick={() => handleDeleteStep(step.id)}
                                        className="min-h-[44px] min-w-[44px] text-xs text-red-400 hover:text-red-600 transition-colors">削除</button>
                                    </div>
                                  </div>
                                  {step.messageType === 'multi' ? (
                                    <div className="mt-1 space-y-1">
                                      {parseMessages(step.messageType, step.messageContent).map((m, mi) => (
                                        <p key={mi} className="text-xs text-gray-600 whitespace-pre-wrap break-words line-clamp-2">
                                          <span className="text-gray-400">[{messageTypeLabels[m.type] ?? m.type}]</span> {m.type === 'text' ? m.content : m.content.slice(0, 50)}
                                        </p>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="mt-1 text-xs text-gray-600 whitespace-pre-wrap break-words line-clamp-3">{step.messageContent}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Step add/edit form */}
                        {showStepForm && (
                          <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
                            <h5 className="text-xs font-semibold text-gray-700 mb-3">
                              {editingStepId ? 'ステップを編集' : 'ステップを追加'}
                            </h5>
                            <div className="space-y-4 max-w-lg">
                              <StepTimingPicker form={stepForm} onChange={setStepForm} />
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">メッセージ内容 <span className="text-red-500">*</span></label>
                                <MultiMessageEditor messages={stepForm.messages} onChange={(messages) => setStepForm({ ...stepForm, messages })} />
                              </div>
                              {stepFormError && <p className="text-xs text-red-600">{stepFormError}</p>}
                              <div className="flex gap-2">
                                <button onClick={handleSaveStep} disabled={stepSaving}
                                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity" style={{ backgroundColor: '#06C755' }}>
                                  {stepSaving ? '保存中...' : editingStepId ? '更新' : '追加'}
                                </button>
                                <button onClick={() => { setShowStepForm(false); setEditingStepId(null); setStepFormError('') }}
                                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">キャンセル</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {/* ===== Enrollments ===== */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-semibold text-gray-700">登録中の友だち ({enrollments.filter((e) => e.status === 'active').length}名)</h4>
                        <button onClick={() => { setShowEnrollForm(true); setEnrollError(''); setEnrollTargetDate('') }}
                          className="px-3 py-1 min-h-[44px] text-xs font-medium text-white rounded-md transition-opacity hover:opacity-90" style={{ backgroundColor: '#06C755' }}>
                          + 友だちを登録
                        </button>
                      </div>

                      {enrollLoading ? (
                        <div className="animate-pulse space-y-2"><div className="h-8 bg-gray-100 rounded" /></div>
                      ) : enrollments.length === 0 ? (
                        <p className="text-xs text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-lg">
                          まだ友だちが登録されていません。「友だちを登録」から起点日時を設定して登録してください。
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {enrollments.map((e) => {
                            const st = statusLabels[e.status] ?? { label: e.status, color: 'bg-gray-100 text-gray-500' }
                            return (
                              <div key={e.id} className="flex items-center gap-3 bg-gray-50 rounded-lg p-2.5 border border-gray-100">
                                {e.pictureUrl ? <img src={e.pictureUrl} alt="" className="w-7 h-7 rounded-full shrink-0" />
                                  : <div className="w-7 h-7 rounded-full bg-gray-200 shrink-0" />}
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs font-medium text-gray-800 truncate block">{e.displayName}</span>
                                  <span className="text-xs text-gray-400">
                                    起点: {new Date(e.targetDate).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                                {e.status === 'active' && (
                                  <button onClick={() => handleCancelEnrollment(e.id)}
                                    className="text-xs text-red-400 hover:text-red-600 min-h-[44px] min-w-[44px] flex items-center justify-center">取消</button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Enroll form */}
                      {showEnrollForm && (
                        <div className="mt-3 bg-white border border-gray-200 rounded-lg p-4">
                          <h5 className="text-xs font-semibold text-gray-700 mb-3">友だちをリマインダーに登録</h5>
                          <div className="space-y-3 max-w-lg">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">友だちを検索</label>
                              <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                placeholder="名前で検索..." value={enrollFriendSearch} onChange={(e) => setEnrollFriendSearch(e.target.value)} />
                              {friendOptions.length > 0 && (
                                <div className="mt-1 border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                                  {friendOptions.map((f) => (
                                    <button key={f.id} type="button"
                                      onClick={() => { setSelectedFriendId(f.id); setEnrollFriendSearch(f.displayName); setFriendOptions([]) }}
                                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${selectedFriendId === f.id ? 'bg-green-50 text-green-700' : ''}`}>
                                      {f.displayName}
                                    </button>
                                  ))}
                                </div>
                              )}
                              {selectedFriendId && <p className="text-xs text-green-600 mt-1">選択済み</p>}
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                起点日時
                                <span className="ml-1 text-gray-400 font-normal">
                                  （空欄ならリマインダーの起点日時を使用: {
                                    expandedData?.eventDate
                                      ? new Date(expandedData.eventDate).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                      : '未設定'
                                  }）
                                </span>
                              </label>
                              <input type="datetime-local" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                value={enrollTargetDate} onChange={(e) => setEnrollTargetDate(e.target.value)} />
                            </div>
                            {enrollError && <p className="text-xs text-red-600">{enrollError}</p>}
                            <div className="flex gap-2">
                              <button onClick={handleEnroll} disabled={enrollSaving}
                                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity" style={{ backgroundColor: '#06C755' }}>
                                {enrollSaving ? '登録中...' : '登録'}
                              </button>
                              <button onClick={() => { setShowEnrollForm(false); setEnrollError('') }}
                                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">キャンセル</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
