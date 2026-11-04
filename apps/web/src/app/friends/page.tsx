'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import type { FriendListItem, SurveyFilter, SurveyGroupKey } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendListTable from '@/components/friends/friend-list-table'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'

const ccPrompts = [
  {
    title: '友だちのセグメント分析',
    prompt: `友だち一覧のデータを分析してください。
1. タグ別の友だち数を集計
2. アクティブ率の高いセグメントを特定
3. エンゲージメントが低い層への施策を提案
レポート形式で出力してください。`,
  },
  {
    title: 'タグ一括管理',
    prompt: `友だちのタグを一括管理してください。
1. 未タグの友だちを特定
2. 行動履歴に基づいたタグ付け提案
3. 不要タグの整理
作業手順を示してください。`,
  },
]

const PAGE_SIZE = 20

type SortMode = 'recent' | 'oldest'
type ResponseFilter = 'all' | 'unhandled'
type FollowFilter = 'all' | 'following' | 'blocked'
type SurveyAnswers = Record<SurveyGroupKey, string>
type SurveyGroups = Record<SurveyGroupKey, Array<{ value: string; count: number }>>

const NO_ANSWERS: SurveyAnswers = { university_name: '', grade: '', graduation_year: '' }
const NO_GROUPS: SurveyGroups = { university_name: [], grade: [], graduation_year: [] }
const SURVEY_GROUP_LABEL: Record<SurveyGroupKey, string> = {
  university_name: '大学',
  grade: '学年',
  graduation_year: '卒業予定',
}
const SURVEY_GROUP_KEYS: SurveyGroupKey[] = ['university_name', 'grade', 'graduation_year']
const surveyValueLabel = (key: SurveyGroupKey, value: string) => (key === 'graduation_year' ? `${value}年` : value)

export default function FriendsPage() {
  const { selectedAccountId } = useAccount()
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all')
  const [followFilter, setFollowFilter] = useState<FollowFilter>('all')
  const [surveyFilter, setSurveyFilter] = useState<SurveyFilter | ''>('')
  const [surveyAnswers, setSurveyAnswers] = useState<SurveyAnswers>(NO_ANSWERS)
  const [surveyGroups, setSurveyGroups] = useState<SurveyGroups>(NO_GROUPS)
  const [groupBy, setGroupBy] = useState<SurveyGroupKey>('university_name')
  const [followCounts, setFollowCounts] = useState<{ following: number; blocked: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadTags = useCallback(async () => {
    try {
      const res = await api.tags.list()
      if (res.success) setAllTags(res.data)
    } catch {
      // Non-blocking — tags used for filter
    }
  }, [])

  const loadFriends = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.friends.list({
        offset: String((page - 1) * PAGE_SIZE),
        limit: PAGE_SIZE,
        tagId: selectedTagId || undefined,
        accountId: selectedAccountId || undefined,
        search: searchSubmitted || undefined,
        includeChatStatus: true,
        sort: sortMode,
        handled: responseFilter === 'unhandled' ? 'unhandled' : undefined,
        following: followFilter === 'all' ? undefined : followFilter,
        survey: surveyFilter || undefined,
        surveyAnswers,
      })
      if (res.success) {
        setFriends(res.data.items)
        setTotal(res.data.total)
        setHasNextPage(res.data.hasNextPage)
      } else {
        setError(res.error)
      }
    } catch {
      setError('友だちの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [page, selectedTagId, selectedAccountId, searchSubmitted, sortMode, responseFilter, followFilter, surveyFilter, surveyAnswers])

  // アンケートの答えごとの人数（絞り込みの選択肢と「グループで見る」）。友だちの状態の絞り込みだけ合わせる
  const loadSurveyGroups = useCallback(async () => {
    const following = followFilter === 'all' ? undefined : followFilter
    try {
      const results = await Promise.all(
        SURVEY_GROUP_KEYS.map((by) => api.friends.surveyGroups({ accountId: selectedAccountId || undefined, by, following })),
      )
      const next: SurveyGroups = { ...NO_GROUPS }
      SURVEY_GROUP_KEYS.forEach((key, i) => {
        const res = results[i]
        next[key] = res.success ? res.data : []
      })
      setSurveyGroups(next)
    } catch {
      setSurveyGroups(NO_GROUPS)
    }
  }, [selectedAccountId, followFilter])

  // 友だち・ブロック中の人数（選んでいるアカウントの全体。絞り込みとは別）
  const loadFollowCounts = useCallback(async () => {
    try {
      const res = await api.friends.count({ accountId: selectedAccountId || undefined })
      if (res.success) setFollowCounts({ following: res.data.count, blocked: res.data.blockedCount ?? 0 })
      else setFollowCounts(null)
    } catch {
      setFollowCounts(null)
    }
  }, [selectedAccountId])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  useEffect(() => {
    loadFollowCounts()
  }, [loadFollowCounts])

  useEffect(() => {
    loadSurveyGroups()
  }, [loadSurveyGroups])

  // Reset the URL-style account context to page 1 in a separate effect.
  // For user-driven filter changes (search/sort/handled/tag) we reset
  // page synchronously inside the handlers below — that avoids the
  // double-fetch race where the old `page` request resolves after the
  // new `page=1` request and overwrites the correct page-1 rows.
  useEffect(() => {
    setPage(1)
    // アカウントが変わると答えの選択肢も変わるので、アンケートの絞り込みは外す
    setSurveyAnswers(NO_ANSWERS)
  }, [selectedAccountId])

  useEffect(() => {
    loadFriends()
  }, [loadFriends])

  // Fan-out helpers: changing a filter also resets pagination synchronously,
  // so React batches both state updates into one re-render and `loadFriends`
  // fires exactly once with the new filter + page=1.
  const updateAndResetPage = (cb: () => void) => {
    cb()
    setPage(1)
  }
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateAndResetPage(() => setSearchSubmitted(searchInput.trim()))
  }
  // Clearing the input clears the active search even if the user doesn't
  // press 検索 again. Without this, "search Alice → clear input → change
  // tag" would keep filtering by Alice while the input box looks empty —
  // see codex feedback. Keeping a non-empty input that doesn't match
  // searchSubmitted is fine: the user is mid-edit, hasn't applied yet.
  const handleSearchInputChange = (v: string) => {
    setSearchInput(v)
    if (v.trim() === '' && searchSubmitted !== '') {
      updateAndResetPage(() => setSearchSubmitted(''))
    }
  }
  const handleSortChange = (v: SortMode) => updateAndResetPage(() => setSortMode(v))
  const handleResponseFilterChange = (v: ResponseFilter) => updateAndResetPage(() => setResponseFilter(v))
  const handleTagFilterChange = (v: string) => updateAndResetPage(() => setSelectedTagId(v))
  const handleFollowFilterChange = (v: FollowFilter) => updateAndResetPage(() => setFollowFilter(v))
  const handleSurveyFilterChange = (v: SurveyFilter | '') => updateAndResetPage(() => setSurveyFilter(v))
  const handleSurveyAnswerChange = (key: SurveyGroupKey, value: string) =>
    updateAndResetPage(() => setSurveyAnswers((prev) => ({ ...prev, [key]: value })))
  // グループの札を押すとその答えで絞る。もう一度押すと外す
  const handleGroupClick = (key: SurveyGroupKey, value: string) =>
    handleSurveyAnswerChange(key, surveyAnswers[key] === value ? '' : value)
  const clearSurveyFilters = () => updateAndResetPage(() => {
    setSurveyFilter('')
    setSurveyAnswers(NO_ANSWERS)
  })
  const surveyFiltered = surveyFilter !== '' || SURVEY_GROUP_KEYS.some((k) => surveyAnswers[k] !== '')
  const hasSurveyGroups = SURVEY_GROUP_KEYS.some((k) => surveyGroups[k].length > 0)

  return (
    <div>
      <Header
        title="友だちリスト"
        description="友だちの検索や、詳細情報の確認ができます。"
      />

      {/* 友だち・ブロック中の人数。押すとその人だけに絞る */}
      {followCounts && (
        <div className="flex flex-wrap gap-3 mb-4">
          <button
            type="button"
            onClick={() => handleFollowFilterChange(followFilter === 'following' ? 'all' : 'following')}
            className={`flex-1 min-w-[140px] text-left bg-white rounded-lg border px-4 py-3 transition-colors ${followFilter === 'following' ? 'border-green-500 ring-2 ring-green-100' : 'border-gray-200 hover:bg-gray-50'}`}
          >
            <p className="text-xs text-gray-500">友だち</p>
            <p className="text-xl font-bold text-gray-900">{followCounts.following.toLocaleString('ja-JP')}<span className="text-sm font-medium text-gray-500 ml-1">人</span></p>
          </button>
          <button
            type="button"
            onClick={() => handleFollowFilterChange(followFilter === 'blocked' ? 'all' : 'blocked')}
            className={`flex-1 min-w-[140px] text-left bg-white rounded-lg border px-4 py-3 transition-colors ${followFilter === 'blocked' ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-200 hover:bg-gray-50'}`}
          >
            <p className="text-xs text-gray-500">ブロック中</p>
            <p className="text-xl font-bold text-red-600">{followCounts.blocked.toLocaleString('ja-JP')}<span className="text-sm font-medium text-gray-500 ml-1">人</span></p>
          </button>
        </div>
      )}

      {/* Search + sort bar — L-step style */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            placeholder="友だち名を検索"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <select
            value={sortMode}
            onChange={(e) => handleSortChange(e.target.value as SortMode)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="recent">友だち追加の新しい順</option>
            <option value="oldest">友だち追加の古い順</option>
          </select>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            検索
          </button>
        </form>

        {/* Secondary filters — タグ + 対応マーク */}
        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 font-medium whitespace-nowrap">タグ:</label>
            <select
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={selectedTagId}
              onChange={(e) => handleTagFilterChange(e.target.value)}
            >
              <option value="">すべて</option>
              {allTags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 font-medium whitespace-nowrap">対応マーク:</label>
            <select
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={responseFilter}
              onChange={(e) => handleResponseFilterChange(e.target.value as ResponseFilter)}
            >
              <option value="all">すべて</option>
              <option value="unhandled">未対応のみ</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 font-medium whitespace-nowrap">友だちの状態:</label>
            <select
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={followFilter}
              onChange={(e) => handleFollowFilterChange(e.target.value as FollowFilter)}
            >
              <option value="all">すべて</option>
              <option value="following">友だちのみ</option>
              <option value="blocked">ブロック中のみ</option>
            </select>
          </div>
          <span className="text-xs text-gray-500 ml-auto">
            {loading ? '読み込み中...' : `${total.toLocaleString('ja-JP')} 件`}
          </span>
        </div>

        {/* アンケートの答えで絞り込む（KIDOUインターンの登録アンケート） */}
        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-gray-100">
          <span className="text-xs font-semibold text-gray-700 whitespace-nowrap">アンケート</span>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 font-medium whitespace-nowrap">回答状況:</label>
            <select
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={surveyFilter}
              onChange={(e) => handleSurveyFilterChange(e.target.value as SurveyFilter | '')}
            >
              <option value="">すべて</option>
              <option value="done">回答済み</option>
              <option value="answering">回答中</option>
              <option value="not_started">未回答</option>
            </select>
          </div>
          {SURVEY_GROUP_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <label className="text-xs text-gray-600 font-medium whitespace-nowrap">{SURVEY_GROUP_LABEL[key]}:</label>
              <select
                className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white max-w-[200px] focus:outline-none focus:ring-2 focus:ring-green-500"
                value={surveyAnswers[key]}
                onChange={(e) => handleSurveyAnswerChange(key, e.target.value)}
              >
                <option value="">すべて</option>
                {/* 選んでいる答えが人数の一覧に無くても（0人になった等）選んだままにする */}
                {surveyAnswers[key] && !surveyGroups[key].some((g) => g.value === surveyAnswers[key]) && (
                  <option value={surveyAnswers[key]}>{surveyValueLabel(key, surveyAnswers[key])}（0人）</option>
                )}
                {surveyGroups[key].map((g) => (
                  <option key={g.value} value={g.value}>{surveyValueLabel(key, g.value)}（{g.count}人）</option>
                ))}
              </select>
            </div>
          ))}
          {surveyFiltered && (
            <button
              type="button"
              onClick={clearSurveyFilters}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              アンケートの絞り込みを外す
            </button>
          )}
        </div>
      </div>

      {/* グループで見る — 答えごとの人数。札を押すとその人たちだけに絞る */}
      {hasSurveyGroups && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-gray-700 mr-1">グループで見る</span>
            {SURVEY_GROUP_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setGroupBy(key)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${groupBy === key ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
              >
                {SURVEY_GROUP_LABEL[key]}別
              </button>
            ))}
          </div>
          {surveyGroups[groupBy].length === 0 ? (
            <p className="text-xs text-gray-400">まだ答えた人がいません。</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
              {surveyGroups[groupBy].map((g) => {
                const active = surveyAnswers[groupBy] === g.value
                return (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => handleGroupClick(groupBy, g.value)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${active ? 'border-green-500 bg-green-50 text-green-800 ring-2 ring-green-100' : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'}`}
                  >
                    <span className="font-medium">{surveyValueLabel(groupBy, g.value)}</span>
                    <span className="text-gray-500">{g.count}人</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 grid grid-cols-[80px_200px_180px_120px_1fr_260px] gap-3 animate-pulse">
              <div className="h-5 bg-gray-100 rounded w-16" />
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-gray-200" />
                <div className="h-3 bg-gray-200 rounded w-24" />
              </div>
              <div className="h-3 bg-gray-100 rounded w-24" />
              <div className="h-3 bg-gray-100 rounded w-20" />
              <div className="space-y-2">
                <div className="h-3 bg-gray-100 rounded w-3/4" />
                <div className="h-2 bg-gray-100 rounded w-20" />
              </div>
              <div className="h-5 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : (
        <FriendListTable friends={friends} allTags={allTags} onRefresh={loadFriends} />
      )}

      {!loading && total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-4">
          <p className="text-sm text-gray-500">
            {((page - 1) * PAGE_SIZE) + 1}〜{Math.min(page * PAGE_SIZE, total)} 件 / 全{total.toLocaleString('ja-JP')}件
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              前へ
            </button>
            <span className="text-sm text-gray-600 px-1">{page} ページ</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNextPage}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              次へ
            </button>
          </div>
        </div>
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
