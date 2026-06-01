'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api, fetchApi } from '@/lib/api'
import { normalizeExternalCustomerCsvRow, parseExternalCustomerCsv } from '@/lib/external-customer-csv'
import { AnalyticsTab } from './_components/analytics-tab'
import { BroadcastTab } from './_components/broadcast-tab'
import { FooterNav } from './_components/footer-nav'
import { FormsTab } from './_components/forms-tab'
import { MainTab } from './_components/main-tab'
import { ReservationCalendarTab } from './_components/reservation-calendar-tab'
import { SupportTab } from './_components/support-tab'
import type {
  ApiBroadcast,
  ApiExternalCustomer,
  ApiExternalCustomerLink,
  ApiUserEvent,
  BroadcastDraft,
  ConsoleChat,
  ConsoleChatDetail,
  ConsoleConversionReportItem,
  ConsoleForm,
  ConsoleFriend,
  ConsoleTag,
  ConsoleTemplate,
  ConsoleTrackedLink,
  CsvImportState,
  ExternalCustomerForm,
  FormDraft,
  LoadState,
  TabId,
} from './types'
import { buildFormPresetFields } from './utils'

export default function ConsoleV2Page() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [activeTab, setActiveTab] = useState<TabId>('main')
  const [state, setState] = useState<LoadState>({ loading: true, error: '' })
  const [chats, setChats] = useState<ConsoleChat[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [chatDetail, setChatDetail] = useState<ConsoleChatDetail | null>(null)
  const [selectedFriend, setSelectedFriend] = useState<ConsoleFriend | null>(null)
  const [templates, setTemplates] = useState<ConsoleTemplate[]>([])
  const [tags, setTags] = useState<ConsoleTag[]>([])
  const [forms, setForms] = useState<ConsoleForm[]>([])
  const [trackedLinks, setTrackedLinks] = useState<ConsoleTrackedLink[]>([])
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [conversionReport, setConversionReport] = useState<ConsoleConversionReportItem[]>([])
  const [recentEvents, setRecentEvents] = useState<ApiUserEvent[]>([])
  const [friendCount, setFriendCount] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [friendResults, setFriendResults] = useState<ConsoleFriend[]>([])
  const [friendTagsById, setFriendTagsById] = useState<Record<string, ConsoleTag[]>>({})
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [updatingTagId, setUpdatingTagId] = useState<string | null>(null)
  const [externalQuery, setExternalQuery] = useState('')
  const [externalResults, setExternalResults] = useState<ApiExternalCustomer[]>([])
  const [externalLinks, setExternalLinks] = useState<ApiExternalCustomerLink[]>([])
  const [externalLoading, setExternalLoading] = useState(false)
  const [externalForm, setExternalForm] = useState<ExternalCustomerForm>({ name: '', phone: '', email: '', source: 'manual' })
  const [csvImportState, setCsvImportState] = useState<CsvImportState>({ importing: false, total: 0, imported: 0, failed: 0, message: '' })
  const [broadcastDraft, setBroadcastDraft] = useState<BroadcastDraft>({ title: '', templateId: '', targetType: 'all', targetTagId: '' })
  const [creatingBroadcast, setCreatingBroadcast] = useState(false)
  const [formDraft, setFormDraft] = useState<FormDraft>({ name: '', description: '', preset: 'inquiry', onSubmitTagId: '' })
  const [creatingForm, setCreatingForm] = useState(false)

  const loadDashboard = useCallback(async () => {
    setState({ loading: true, error: '' })
    const accountId = selectedAccountId || undefined
    const [
      chatsResult,
      friendCountResult,
      templatesResult,
      tagsResult,
      formsResult,
      trackedLinksResult,
      broadcastsResult,
      conversionReportResult,
      eventsResult,
      friendsResult,
    ] = await Promise.allSettled([
      api.chats.list({ accountId, recentDays: 30 }),
      api.friends.count({ accountId }),
      api.templates.list(),
      api.tags.list(),
      api.forms.list(),
      fetchApi<{ success: boolean; data: ConsoleTrackedLink[] }>('/api/tracked-links'),
      api.broadcasts.list({ accountId }),
      api.conversions.report(),
      api.events.list({ lineAccountId: accountId, limit: 20 }),
      api.friends.list({ accountId, recentDays: 30, limit: 500 }),
    ])

    if (chatsResult.status === 'fulfilled' && chatsResult.value.success) {
      const loaded = chatsResult.value.data as unknown as ConsoleChat[]
      setChats(loaded)
      setSelectedChatId((current) => current || loaded[0]?.id || null)
    }
    if (friendCountResult.status === 'fulfilled' && friendCountResult.value.success) {
      setFriendCount(friendCountResult.value.data.count)
    }
    if (templatesResult.status === 'fulfilled' && templatesResult.value.success) {
      setTemplates(templatesResult.value.data as unknown as ConsoleTemplate[])
    }
    if (tagsResult.status === 'fulfilled' && tagsResult.value.success) {
      setTags(tagsResult.value.data as unknown as ConsoleTag[])
    }
    if (formsResult.status === 'fulfilled' && formsResult.value.success) {
      setForms(formsResult.value.data)
    }
    if (trackedLinksResult.status === 'fulfilled' && trackedLinksResult.value.success) {
      setTrackedLinks(trackedLinksResult.value.data)
    }
    if (broadcastsResult.status === 'fulfilled' && broadcastsResult.value.success) {
      setBroadcasts(broadcastsResult.value.data)
    }
    if (conversionReportResult.status === 'fulfilled' && conversionReportResult.value.success) {
      setConversionReport(conversionReportResult.value.data)
    }
    if (eventsResult.status === 'fulfilled' && eventsResult.value.success) {
      setRecentEvents(eventsResult.value.data)
    }
    if (friendsResult.status === 'fulfilled' && friendsResult.value.success) {
      const items = friendsResult.value.data.items as unknown as ConsoleFriend[]
      setFriendTagsById(Object.fromEntries(items.map((friend) => [friend.id, friend.tags || []])))
    }

    const failed = [
      chatsResult,
      friendCountResult,
      templatesResult,
      tagsResult,
      formsResult,
      trackedLinksResult,
      broadcastsResult,
      conversionReportResult,
      eventsResult,
      friendsResult,
    ].some((result) => result.status === 'rejected')

    setState({
      loading: false,
      error: failed ? '一部の情報を読み込めませんでした。使える機能だけ表示しています。' : '',
    })
  }, [selectedAccountId])

  const loadChatDetail = useCallback(async (chatId: string) => {
    try {
      const res = await api.chats.get(chatId, { recentDays: 30 })
      if (!res.success) return
      const detail = res.data as unknown as ConsoleChatDetail
      setChatDetail(detail)
      setNotesDraft(detail.notes || '')
      if (detail.friendId) {
        const [friendRes, linksRes] = await Promise.allSettled([
          api.friends.get(detail.friendId),
          api.externalCustomers.links(detail.friendId),
        ])
        if (friendRes.status === 'fulfilled' && friendRes.value.success) {
          setSelectedFriend(friendRes.value.data as unknown as ConsoleFriend)
        }
        if (linksRes.status === 'fulfilled' && linksRes.value.success) {
          setExternalLinks(linksRes.value.data)
        }
      }
    } catch {
      setState((current) => ({ ...current, error: 'チャット詳細の読み込みに失敗しました。' }))
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    if (selectedChatId) {
      void loadChatDetail(selectedChatId)
      return
    }
    setChatDetail(null)
    setSelectedFriend(null)
    setExternalLinks([])
    setExternalResults([])
    setNotesDraft('')
  }, [selectedChatId, loadChatDetail])

  const reloadSelectedFriend = async () => {
    if (!selectedFriend) return
    const friendRes = await api.friends.get(selectedFriend.id)
    if (friendRes.success) setSelectedFriend(friendRes.data as unknown as ConsoleFriend)
  }

  const reloadExternalLinks = async () => {
    if (!selectedFriend) return
    const linksRes = await api.externalCustomers.links(selectedFriend.id)
    if (linksRes.success) setExternalLinks(linksRes.data)
  }

  const handleSearchFriends = async () => {
    const q = search.trim()
    if (!q) {
      setFriendResults([])
      return
    }
    setSearching(true)
    try {
      const res = await api.friends.list({ accountId: selectedAccountId || undefined, search: q, limit: 12, recentDays: 365 })
      if (res.success) {
        const data = res.data as unknown as { items: ConsoleFriend[] }
        setFriendResults(data.items || [])
      }
    } catch {
      setState((current) => ({ ...current, error: '顧客検索に失敗しました。' }))
    } finally {
      setSearching(false)
    }
  }

  const handleOpenFriendChat = (friend: ConsoleFriend) => {
    setSelectedFriend(friend)
    setSelectedChatId(friend.id)
    setActiveTab('messages')
  }

  const handleSendMessage = async () => {
    if (!selectedChatId || !message.trim() || sending) return
    setSending(true)
    try {
      await api.chats.send(selectedChatId, { content: message.trim(), messageType: 'text' })
      setMessage('')
      await loadChatDetail(selectedChatId)
      await loadDashboard()
    } catch {
      setState((current) => ({ ...current, error: 'メッセージ送信に失敗しました。' }))
    } finally {
      setSending(false)
    }
  }

  const handleSendTemplate = async (template: ConsoleTemplate) => {
    if (!selectedChatId || sending) return
    setSending(true)
    try {
      await api.chats.send(selectedChatId, { content: template.messageContent, messageType: template.messageType })
      await loadChatDetail(selectedChatId)
      await loadDashboard()
    } catch {
      setState((current) => ({ ...current, error: 'テンプレート送信に失敗しました。' }))
    } finally {
      setSending(false)
    }
  }

  const handleSaveNotes = async () => {
    if (!selectedChatId || savingNotes) return
    setSavingNotes(true)
    try {
      await api.chats.update(selectedChatId, { notes: notesDraft })
      await loadChatDetail(selectedChatId)
      await loadDashboard()
    } catch {
      setState((current) => ({ ...current, error: 'メモ保存に失敗しました。' }))
    } finally {
      setSavingNotes(false)
    }
  }

  const handleAddTag = async (tagId: string) => {
    if (!selectedFriend || updatingTagId) return
    setUpdatingTagId(tagId)
    try {
      await api.friends.addTag(selectedFriend.id, tagId)
      await reloadSelectedFriend()
    } catch {
      setState((current) => ({ ...current, error: 'タグ追加に失敗しました。' }))
    } finally {
      setUpdatingTagId(null)
    }
  }

  const handleRemoveTag = async (tagId: string) => {
    if (!selectedFriend || updatingTagId) return
    setUpdatingTagId(tagId)
    try {
      await api.friends.removeTag(selectedFriend.id, tagId)
      await reloadSelectedFriend()
    } catch {
      setState((current) => ({ ...current, error: 'タグ解除に失敗しました。' }))
    } finally {
      setUpdatingTagId(null)
    }
  }

  const handleSearchExternalCustomers = async () => {
    const q = externalQuery.trim()
    if (!q) {
      setExternalResults([])
      return
    }
    setExternalLoading(true)
    try {
      const res = await api.externalCustomers.search({ query: q, limit: 10 })
      if (res.success) setExternalResults(res.data)
    } catch {
      setState((current) => ({ ...current, error: '外部顧客検索に失敗しました。' }))
    } finally {
      setExternalLoading(false)
    }
  }

  const handleCreateExternalCustomer = async () => {
    if (!externalForm.name.trim() && !externalForm.phone.trim() && !externalForm.email.trim()) {
      setState((current) => ({ ...current, error: '外部顧客は名前・電話・メールのいずれかを入力してください。' }))
      return
    }
    setExternalLoading(true)
    try {
      const res = await api.externalCustomers.create(externalForm)
      if (res.success) {
        setExternalResults((current) => [res.data, ...current.filter((item) => item.id !== res.data.id)])
        setExternalForm({ name: '', phone: '', email: '', source: 'manual' })
      }
    } catch {
      setState((current) => ({ ...current, error: '外部顧客の作成に失敗しました。' }))
    } finally {
      setExternalLoading(false)
    }
  }

  const handleLinkExternalCustomer = async (customer: ApiExternalCustomer) => {
    if (!selectedFriend) return
    setExternalLoading(true)
    try {
      await api.externalCustomers.link(selectedFriend.id, { externalCustomerId: customer.id, linkMethod: 'manual' })
      await reloadExternalLinks()
    } catch {
      setState((current) => ({ ...current, error: '外部顧客の紐づけに失敗しました。' }))
    } finally {
      setExternalLoading(false)
    }
  }

  const handleUnlinkExternalCustomer = async (externalCustomerId: string) => {
    if (!selectedFriend) return
    setExternalLoading(true)
    try {
      await api.externalCustomers.unlink(selectedFriend.id, externalCustomerId)
      await reloadExternalLinks()
    } catch {
      setState((current) => ({ ...current, error: '外部顧客の紐づけ解除に失敗しました。' }))
    } finally {
      setExternalLoading(false)
    }
  }

  const handleImportExternalCustomerCsv = async (file: File | undefined) => {
    if (!file || csvImportState.importing) return
    setCsvImportState({ importing: true, total: 0, imported: 0, failed: 0, message: 'CSVを読み込み中...' })
    try {
      const rows = parseExternalCustomerCsv(await file.text())
      if (rows.length === 0) {
        setCsvImportState({ importing: false, total: 0, imported: 0, failed: 0, message: '取り込める行がありません。' })
        return
      }
      let imported = 0
      let failed = 0
      for (const row of rows) {
        const payload = normalizeExternalCustomerCsvRow(row)
        if (!payload.name && !payload.phone && !payload.email) {
          failed += 1
          continue
        }
        try {
          await api.externalCustomers.create(payload)
          imported += 1
        } catch {
          failed += 1
        }
        setCsvImportState({ importing: true, total: rows.length, imported, failed, message: `${imported + failed}/${rows.length}件を処理中...` })
      }
      setCsvImportState({ importing: false, total: rows.length, imported, failed, message: `CSV取り込み完了: 成功 ${imported}件 / 失敗 ${failed}件` })
      if (externalQuery.trim()) await handleSearchExternalCustomers()
    } catch {
      setCsvImportState({ importing: false, total: 0, imported: 0, failed: 0, message: 'CSV取り込みに失敗しました。' })
    }
  }

  const handleCreateBroadcastDraft = async () => {
    if (creatingBroadcast) return
    const template = templates.find((item) => item.id === broadcastDraft.templateId)
    if (!template) {
      setState((current) => ({ ...current, error: '配信テンプレートを選択してください。' }))
      return
    }
    if (broadcastDraft.targetType === 'tag' && !broadcastDraft.targetTagId) {
      setState((current) => ({ ...current, error: 'タグ配信では対象タグを選択してください。' }))
      return
    }
    setCreatingBroadcast(true)
    try {
      const res = await api.broadcasts.create({
        title: broadcastDraft.title.trim() || `${template.name} の配信下書き`,
        messageType: template.messageType as ApiBroadcast['messageType'],
        messageContent: template.messageContent,
        targetType: broadcastDraft.targetType as ApiBroadcast['targetType'],
        targetTagId: broadcastDraft.targetType === 'tag' ? broadcastDraft.targetTagId : null,
        status: 'draft' as ApiBroadcast['status'],
        scheduledAt: null,
        lineAccountId: selectedAccountId || null,
      })
      if (res.success) {
        setBroadcasts((current) => [res.data, ...current])
        setBroadcastDraft({ title: '', templateId: '', targetType: 'all', targetTagId: '' })
      }
    } catch {
      setState((current) => ({ ...current, error: '配信下書きの作成に失敗しました。' }))
    } finally {
      setCreatingBroadcast(false)
    }
  }

  const handleCreateSimpleForm = async () => {
    if (creatingForm || !formDraft.name.trim()) return
    setCreatingForm(true)
    try {
      const res = await api.forms.create({
        name: formDraft.name.trim(),
        description: formDraft.description.trim() || null,
        fields: buildFormPresetFields(formDraft.preset),
        onSubmitTagId: formDraft.onSubmitTagId || null,
        saveToMetadata: true,
      })
      if (res.success) {
        setForms((current) => [res.data, ...current])
        setFormDraft({ name: '', description: '', preset: 'inquiry', onSubmitTagId: '' })
      }
    } catch {
      setState((current) => ({ ...current, error: 'フォーム作成に失敗しました。' }))
    } finally {
      setCreatingForm(false)
    }
  }

  const totalClicks = trackedLinks.reduce((sum, link) => sum + (link.clickCount || 0), 0)
  const activeLinks = trackedLinks.filter((link) => link.isActive).length
  const latestTemplates = templates.slice(0, 5)
  const topLinks = [...trackedLinks].sort((a, b) => b.clickCount - a.clickCount).slice(0, 5)

  return (
    <div className="space-y-5 p-4 pb-28 sm:p-6 sm:pb-28">
      <Header title="かんたん運用コンソール" />

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Operation Console</p>
            <h2 className="mt-1 text-lg font-bold text-gray-950">{selectedAccount?.displayName || selectedAccount?.name || 'LINEアカウント未選択'}</h2>
          </div>
          <button onClick={() => void loadDashboard()} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600">
            最新化
          </button>
        </div>
      </div>

      {state.error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{state.error}</div>}

      {activeTab === 'main' && (
        <MainTab
          loading={state.loading}
          chats={chats}
          friendCount={friendCount}
          trackedLinks={trackedLinks}
          forms={forms}
          recentEvents={recentEvents}
          onOpenMessages={() => setActiveTab('messages')}
        />
      )}

      {activeTab === 'messages' && (
        <SupportTab
          chats={chats}
          chatDetail={chatDetail}
          selectedChatId={selectedChatId}
          setSelectedChatId={setSelectedChatId}
          templates={latestTemplates}
          tags={tags}
          selectedFriend={selectedFriend}
          notesDraft={notesDraft}
          setNotesDraft={setNotesDraft}
          savingNotes={savingNotes}
          onSaveNotes={handleSaveNotes}
          updatingTagId={updatingTagId}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          externalQuery={externalQuery}
          setExternalQuery={setExternalQuery}
          externalResults={externalResults}
          externalLinks={externalLinks}
          externalLoading={externalLoading}
          externalForm={externalForm}
          setExternalForm={setExternalForm}
          onSearchExternalCustomers={handleSearchExternalCustomers}
          onCreateExternalCustomer={handleCreateExternalCustomer}
          onLinkExternalCustomer={handleLinkExternalCustomer}
          onUnlinkExternalCustomer={handleUnlinkExternalCustomer}
          csvImportState={csvImportState}
          onImportExternalCustomerCsv={handleImportExternalCustomerCsv}
          message={message}
          setMessage={setMessage}
          sending={sending}
          onSendMessage={handleSendMessage}
          onSendTemplate={handleSendTemplate}
          search={search}
          setSearch={setSearch}
          searching={searching}
          friendResults={friendResults}
          onSearchFriends={handleSearchFriends}
          onOpenFriendChat={handleOpenFriendChat}
          friendTagsById={friendTagsById}
        />
      )}

      {activeTab === 'calendar' && (
        <ReservationCalendarTab />
      )}

      {activeTab === 'broadcast' && (
        <BroadcastTab templates={templates} tags={tags} broadcasts={broadcasts} draft={broadcastDraft} setDraft={setBroadcastDraft} creating={creatingBroadcast} onCreateDraft={handleCreateBroadcastDraft} />
      )}

      {activeTab === 'forms' && (
        <FormsTab forms={forms} tags={tags} draft={formDraft} setDraft={setFormDraft} creating={creatingForm} onCreateForm={handleCreateSimpleForm} />
      )}

      {activeTab === 'analytics' && (
        <AnalyticsTab trackedLinks={topLinks} activeLinks={activeLinks} totalClicks={totalClicks} conversionReport={conversionReport} recentEvents={recentEvents} />
      )}

      <FooterNav activeTab={activeTab} onChange={setActiveTab} />
    </div>
  )
}
