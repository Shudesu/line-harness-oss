'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import { bookingApi, type BookingShift, type BookingStaff } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Table } from '@cloudflare/kumo/components/table'

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
const DAYS: Array<{ key: DayKey; weekday: number; label: string; tone: string }> = [
  { key: 'sun', weekday: 0, label: '日', tone: 'text-red-500' },
  { key: 'mon', weekday: 1, label: '月', tone: '' },
  { key: 'tue', weekday: 2, label: '火', tone: '' },
  { key: 'wed', weekday: 3, label: '水', tone: '' },
  { key: 'thu', weekday: 4, label: '木', tone: '' },
  { key: 'fri', weekday: 5, label: '金', tone: '' },
  { key: 'sat', weekday: 6, label: '土', tone: 'text-blue-500' },
]

type WeeklyTemplate = Record<DayKey, { start: string; end: string } | null>
const DEFAULT_TEMPLATE: WeeklyTemplate = {
  sun: null,
  mon: { start: '10:00', end: '19:00' },
  tue: { start: '10:00', end: '19:00' },
  wed: { start: '10:00', end: '19:00' },
  thu: { start: '10:00', end: '19:00' },
  fri: { start: '10:00', end: '19:00' },
  sat: { start: '10:00', end: '19:00' },
}

export default function StaffShiftsPage() {
  const sp = useSearchParams()
  const staffId = sp.get('staff_id') ?? ''
  const googleResult = sp.get('google')
  const { selectedAccountId } = useAccount()
  const [staffMember, setStaffMember] = useState<BookingStaff | null>(null)
  const [shifts, setShifts] = useState<BookingShift[]>([])
  const [template, setTemplate] = useState<WeeklyTemplate>(DEFAULT_TEMPLATE)
  const [calendarId, setCalendarId] = useState('')
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null)
  const [serviceAccountConfigured, setServiceAccountConfigured] = useState(false)
  const [oauthConfigured, setOauthConfigured] = useState(false)
  const [hasSavedWorkingHours, setHasSavedWorkingHours] = useState(true)
  const [loading, setLoading] = useState(true)
  const [savingRules, setSavingRules] = useState(false)
  const [savingCalendar, setSavingCalendar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<'disconnect' | string | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId || !staffId) return
    setLoading(true)
    setError(null)
    try {
      const [staff, dated, rules, calendar] = await Promise.all([
        bookingApi.listStaff(selectedAccountId),
        bookingApi.getShifts(selectedAccountId, staffId),
        bookingApi.getAvailabilityRules(selectedAccountId, staffId),
        bookingApi.getGoogleCalendar(selectedAccountId, staffId),
      ])
      setStaffMember(staff.staff.find((item) => item.id === staffId) ?? null)
      setShifts(dated.shifts)
      // 期限切れの日付別シフトや無効化済みルールだけでは予約枠は生まれない。
      // availability 計算と同じ「使える受付時間」の定義で警告を判定する。
      const todayJst = new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, 10)
      setHasSavedWorkingHours(
        rules.rules.some((rule) => rule.is_active === 1) ||
        dated.shifts.some((shift) => shift.work_date >= todayJst),
      )
      if (rules.rules.length > 0) {
        const next: WeeklyTemplate = {
          sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null,
        }
        for (const day of DAYS) {
          const rule = rules.rules.find((item) => item.weekday === day.weekday)
          if (rule) next[day.key] = { start: rule.start_time, end: rule.end_time }
        }
        setTemplate(next)
      }
      setCalendarId(calendar.connection?.calendar_id ?? '')
      setCalendarConnected(Boolean(calendar.connection))
      setServiceAccountEmail(calendar.service_account.email)
      setServiceAccountConfigured(calendar.service_account.configured)
      setOauthConfigured(calendar.oauth.configured)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, staffId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (googleResult === 'connected') setSuccess('Googleカレンダーに接続しました。予定ありの時間は予約枠から自動で除外されます。')
    if (googleResult === 'denied') setError('Googleカレンダーへのアクセスが許可されませんでした。')
    if (googleResult === 'error') setError('Googleカレンダーへ接続できませんでした。もう一度お試しください。')
  }, [googleResult])

  async function saveRules() {
    if (!selectedAccountId || !staffId) return
    setSavingRules(true)
    setError(null)
    setSuccess(null)
    try {
      const rules = DAYS.flatMap((day) => {
        const value = template[day.key]
        return value
          ? [{ weekday: day.weekday, start_time: value.start, end_time: value.end }]
          : []
      })
      await bookingApi.putAvailabilityRules(selectedAccountId, staffId, rules)
      const todayJst = new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, 10)
      setHasSavedWorkingHours(rules.length > 0 || shifts.some((shift) => shift.work_date >= todayJst))
      setSuccess('毎週の受付時間を保存しました。今後は期限切れせず、自動で枠が作られます。')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingRules(false)
    }
  }

  async function connectCalendar() {
    if (!selectedAccountId || !staffId) return
    setSavingCalendar(true)
    setError(null)
    setSuccess(null)
    try {
      if (oauthConfigured) {
        const result = await bookingApi.startGoogleCalendarOAuth(selectedAccountId, staffId)
        window.location.assign(result.authorization_url)
        return
      }
      if (!calendarId.trim()) return
      await bookingApi.putGoogleCalendar(selectedAccountId, staffId, calendarId.trim())
      setCalendarConnected(true)
      setSuccess('Googleカレンダーに接続しました。予定ありの時間は予約枠から自動で除外されます。')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingCalendar(false)
    }
  }

  async function disconnectCalendar() {
    if (!selectedAccountId || !staffId) return
    await bookingApi.deleteGoogleCalendar(selectedAccountId, staffId)
    setCalendarConnected(false)
    setCalendarId('')
    setSuccess('Googleカレンダー連携を解除しました。')
    setPendingAction(null)
  }

  async function deleteShift(shiftId: string) {
    if (!selectedAccountId) return
    await bookingApi.deleteShift(selectedAccountId, staffId, shiftId)
    setPendingAction(null)
    await load()
  }

  return (
    <div>
      <Header
        title="受付時間・Googleカレンダー"
        description={staffMember ? `「${staffMember.display_name}」の予約可能時間を自動管理` : '予約可能時間を自動管理'}
      />

      {error && <Banner className="mb-4" variant="error" title="操作を完了できませんでした" description={error} />}
      {success && <Banner className="mb-4" variant="default" title="完了しました" description={success} />}

      {!selectedAccountId || !staffId ? (
        <Empty title="対象スタッフが未選択です" description="スタッフ一覧から対象スタッフを選んでください。" />
      ) : loading ? (
        <LayerCard className="p-12"><Loader className="mx-auto" /></LayerCard>
      ) : (
        <div className="space-y-4">
          {!hasSavedWorkingHours && (
            <Banner variant="alert" title="受付時間がまだ保存されていません" description="下の内容を確認して「受付時間を保存」を押すまで、このスタッフの予約枠は表示されません。" />
          )}
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
              <h2 className="font-semibold text-gray-900">毎週の受付時間</h2>
              <p className="mt-1 text-sm text-gray-500">一度保存すれば、将来の日付にも自動で適用されます。週数や終了日はありません。</p>
            </div>
            <div className="space-y-3 p-5">
              {DAYS.map((day) => {
                const current = template[day.key]
                return (
                  <div key={day.key} className="flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-gray-100 px-3 py-2">
                    <Checkbox
                      aria-label={`${day.label}曜日を受付日にする`}
                      checked={current !== null}
                      onCheckedChange={(checked) => setTemplate((previous) => ({
                        ...previous,
                        [day.key]: checked ? { start: '10:00', end: '19:00' } : null,
                      }))}
                    />
                    <span className={`w-7 font-medium ${day.tone}`}>{day.label}</span>
                    {current ? (
                      <>
                        <Input aria-label={`${day.label}曜日の開始時刻`} type="time" value={current.start} onChange={(event) => setTemplate((previous) => ({ ...previous, [day.key]: { ...current, start: event.target.value } }))} className="w-32 tabular-nums" />
                        <span className="text-gray-400">〜</span>
                        <Input aria-label={`${day.label}曜日の終了時刻`} type="time" value={current.end} onChange={(event) => setTemplate((previous) => ({ ...previous, [day.key]: { ...current, end: event.target.value } }))} className="w-32 tabular-nums" />
                      </>
                    ) : <span className="text-sm text-gray-400">受付しない</span>}
                  </div>
                )
              })}
              <div className="flex justify-end pt-2">
                <Button type="button" variant="primary" loading={savingRules} onClick={saveRules} disabled={savingRules}>受付時間を保存</Button>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-gray-900">Googleカレンダー連携</h2>
                  <p className="mt-1 text-sm text-gray-500">予定との重複を防ぎ、確定した予約をGoogleカレンダーにも登録します。</p>
                </div>
                <Badge variant={calendarConnected ? 'success' : 'neutral'}>{calendarConnected ? '接続済み' : '未接続'}</Badge>
              </div>
            </div>
            <div className="space-y-4 p-5">
              {oauthConfigured ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                  Googleアカウント本人の許可で安全に接続します。サービスアカウントキーやカレンダー共有は不要です。
                </div>
              ) : !serviceAccountConfigured && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  管理者によるGoogle OAuthまたはサービスアカウント設定が必要です。
                </div>
              )}
              {!oauthConfigured && serviceAccountEmail && (
                <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-900">
                  Googleカレンダーの「設定と共有」で、次のメールアドレスに「予定の変更」権限を付けて共有してください。<br />
                  <code className="mt-2 inline-block break-all rounded bg-white px-2 py-1 text-xs">{serviceAccountEmail}</code>
                </div>
              )}
              {!oauthConfigured && <div>
                <Input
                  label="GoogleカレンダーID"
                  value={calendarId}
                  onChange={(event) => setCalendarId(event.target.value)}
                  placeholder="例: example@gmail.com または xxx@group.calendar.google.com"
                />
                <span className="mt-1.5 block text-xs text-gray-500">Googleカレンダー → 設定と共有 → カレンダーの統合 → カレンダーID</span>
              </div>}
              <div className="flex justify-end gap-2">
                {calendarConnected && <Button type="button" variant="destructive" onClick={() => setPendingAction('disconnect')}>連携解除</Button>}
                <Button type="button" variant="primary" loading={savingCalendar} onClick={connectCalendar} disabled={savingCalendar || (!oauthConfigured && (!calendarId.trim() || !serviceAccountConfigured))}>
                  {oauthConfigured ? (calendarConnected ? 'Googleアカウントを再接続' : 'Googleアカウントで接続') : (calendarConnected ? '再接続して確認' : '接続して確認')}
                </Button>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
              <h2 className="font-semibold text-gray-900">日付別の応急枠 ({shifts.length}件)</h2>
              <p className="mt-1 text-sm text-gray-500">以前に作成した枠です。同じ日付では毎週設定よりこちらを優先します。</p>
            </div>
            {shifts.length === 0 ? <Empty title="応急枠はありません" description="毎週の受付時間が通常の予約枠として使われます。" /> : (
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <Table.Header><Table.Row><Table.Head>日付</Table.Head><Table.Head>時間</Table.Head><Table.Head className="text-right">操作</Table.Head></Table.Row></Table.Header>
                  <Table.Body>{shifts.map((shift) => <Table.Row key={shift.id}><Table.Cell className="tabular-nums">{shift.work_date}</Table.Cell><Table.Cell className="tabular-nums">{shift.start_time}〜{shift.end_time}</Table.Cell><Table.Cell className="text-right"><Button type="button" size="xs" variant="destructive" onClick={() => setPendingAction(shift.id)}>削除</Button></Table.Cell></Table.Row>)}</Table.Body>
                </Table>
              </div>
            )}
          </section>
        </div>
      )}
      <Dialog.Root role="alertdialog" open={pendingAction !== null} onOpenChange={(open) => { if (!open) setPendingAction(null) }}>
        <Dialog>
          <Dialog.Title>{pendingAction === 'disconnect' ? 'Googleカレンダー連携を解除しますか？' : '応急枠を削除しますか？'}</Dialog.Title>
          <Dialog.Description className="mt-2">{pendingAction === 'disconnect' ? '予定との重複防止と予約登録が停止します。' : 'この日付だけに設定された予約枠を削除します。'}</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPendingAction(null)}>キャンセル</Button>
            <Button type="button" variant="destructive" onClick={() => pendingAction === 'disconnect' ? void disconnectCalendar() : pendingAction ? void deleteShift(pendingAction) : undefined}>実行する</Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}
