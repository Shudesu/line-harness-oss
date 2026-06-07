'use client'

/**
 * Phase 2-C: クロス分析画面 (UI 磨き込み v1)
 */

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
} from '@/components/ui/primitives'

interface Tag {
  id: string
  name: string
  description?: string | null
  color?: string | null
}

interface Friend {
  id: string
  line_user_id: string
  display_name: string | null
  picture_url: string | null
  is_following: number
  created_at: string
}

interface AnalysisResult {
  totalCount: number
  friends: Friend[]
  inputSummary: {
    mode: 'and' | 'or' | 'and_not'
    includeTagIds: string[]
    excludeTagIds: string[]
  }
}

type Mode = 'and' | 'or' | 'and_not'

const MODE_LABEL: Record<Mode, string> = {
  and: 'すべてのタグを持つ (AND)',
  or: 'いずれかのタグを持つ (OR)',
  and_not: '指定タグを持つが除外タグは持たない',
}

const MODE_DESC: Record<Mode, string> = {
  and: '選んだタグを「全部」持っている友だちを抽出',
  or: '選んだタグの「どれか1つ以上」を持っている友だちを抽出',
  and_not: '含めるタグは全て持ち、かつ除外タグは1つも持たない友だち',
}

export default function CrossAnalysisPage() {
  const { selectedAccountId } = useAccount()
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [includeTagIds, setIncludeTagIds] = useState<string[]>([])
  const [excludeTagIds, setExcludeTagIds] = useState<string[]>([])
  const [mode, setMode] = useState<Mode>('and')
  const [followingOnly, setFollowingOnly] = useState(true)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [tagsLoading, setTagsLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const loadTags = async () => {
    setTagsLoading(true)
    const r = await fetchApi<{ success: boolean; data: Tag[]; error?: string }>('/api/tags')
    if (r.success) setAllTags(r.data)
    else setError(r.error ?? 'タグ取得失敗')
    setTagsLoading(false)
  }

  useEffect(() => {
    loadTags()
  }, [])

  const filteredTags = allTags.filter(
    (t) => !query || t.name.toLowerCase().includes(query.toLowerCase()),
  )

  const toggleInclude = (id: string) => {
    setIncludeTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    setExcludeTagIds((prev) => prev.filter((x) => x !== id))
  }

  const toggleExclude = (id: string) => {
    setExcludeTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    setIncludeTagIds((prev) => prev.filter((x) => x !== id))
  }

  const onAnalyze = async () => {
    if (includeTagIds.length === 0) {
      setError('「含めるタグ」を最低1つ選んでください')
      return
    }
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    params.set('include', includeTagIds.join(','))
    if (mode === 'and_not' && excludeTagIds.length > 0) {
      params.set('exclude', excludeTagIds.join(','))
    }
    params.set('mode', mode)
    if (selectedAccountId) params.set('lineAccountId', selectedAccountId)
    if (followingOnly) params.set('followingOnly', '1')

    const r = await fetchApi<{ success: boolean; data: AnalysisResult; error?: string }>(
      `/api/cross-analysis?${params.toString()}`,
    )
    setLoading(false)
    if (r.success) setResult(r.data)
    else {
      setError(r.error ?? '分析失敗')
      setResult(null)
    }
  }

  const onReset = () => {
    setIncludeTagIds([])
    setExcludeTagIds([])
    setMode('and')
    setResult(null)
    setError('')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <Header
          title="クロス分析"
          description="複数タグを組み合わせて友だちを抽出 (AND / OR / AND NOT)"
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* 左: 条件選択 */}
          <div className="space-y-5 lg:col-span-2">
            {/* モード選択 */}
            <Card>
              <CardHeader>
                <CardTitle>組み合わせ方</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                    <label
                      key={m}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        mode === m
                          ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-200'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="mode"
                        checked={mode === m}
                        onChange={() => setMode(m)}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-medium">{MODE_LABEL[m]}</div>
                        <div className="text-xs text-gray-500">{MODE_DESC[m]}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* タグ検索 */}
            <Card>
              <CardHeader className="flex items-center justify-between gap-3">
                <CardTitle>タグを選ぶ</CardTitle>
                <Input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="タグ名で検索"
                  className="mt-0 w-48"
                />
              </CardHeader>
              <CardContent>
                {tagsLoading ? (
                  <p className="text-sm text-gray-500">読み込み中…</p>
                ) : filteredTags.length === 0 ? (
                  <p className="text-sm text-gray-500">該当タグがありません</p>
                ) : (
                  <div className="max-h-96 space-y-1 overflow-y-auto pr-1">
                    {filteredTags.map((t) => {
                      const isIncluded = includeTagIds.includes(t.id)
                      const isExcluded = excludeTagIds.includes(t.id)
                      return (
                        <div
                          key={t.id}
                          className={`flex items-center justify-between rounded-md border p-2 transition-colors ${
                            isIncluded
                              ? 'border-emerald-300 bg-emerald-50/60'
                              : isExcluded
                                ? 'border-red-300 bg-red-50/60'
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                          }`}
                        >
                          <span className="text-sm">{t.name}</span>
                          <div className="flex gap-1.5 text-xs">
                            <Button
                              size="sm"
                              variant={isIncluded ? 'primary' : 'outline'}
                              onClick={() => toggleInclude(t.id)}
                              className={
                                isIncluded ? 'bg-emerald-600 hover:bg-emerald-700' : undefined
                              }
                            >
                              {isIncluded ? '✓ 含める' : '含める'}
                            </Button>
                            {mode === 'and_not' && (
                              <Button
                                size="sm"
                                variant={isExcluded ? 'danger' : 'outline'}
                                onClick={() => toggleExclude(t.id)}
                              >
                                {isExcluded ? '✓ 除外' : '除外'}
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* フィルタ */}
            <Card>
              <CardHeader>
                <CardTitle>フィルタ</CardTitle>
              </CardHeader>
              <CardContent>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={followingOnly}
                    onChange={(e) => setFollowingOnly(e.target.checked)}
                  />
                  フォロー中の友だちのみ (ブロック済みを除外)
                </label>
              </CardContent>
            </Card>

            {/* 実行ボタン */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onReset} disabled={loading}>
                リセット
              </Button>
              <Button onClick={onAnalyze} disabled={loading || includeTagIds.length === 0}>
                {loading ? '分析中…' : '分析する'}
              </Button>
            </div>

            {error && <Banner tone="danger">{error}</Banner>}
          </div>

          {/* 右: 結果 */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>結果</CardTitle>
              </CardHeader>
              <CardContent>
                {!result ? (
                  <p className="text-sm text-gray-500">
                    左でタグを選んで「分析する」を押すと結果がここに出ます。
                  </p>
                ) : (
                  <>
                    <div className="mb-4 text-center">
                      <div className="text-5xl font-bold tabular-nums text-blue-600">
                        {result.totalCount.toLocaleString()}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">該当友だち件数</div>
                    </div>

                    <div className="border-t pt-3">
                      <p className="mb-2 text-xs text-gray-500">
                        上位 {Math.min(result.friends.length, 500)} 件:
                      </p>
                      {result.friends.length === 0 ? (
                        <p className="text-sm text-gray-500">該当なし</p>
                      ) : (
                        <ul className="max-h-96 space-y-1 overflow-y-auto pr-1">
                          {result.friends.map((f) => (
                            <li key={f.id} className="flex items-center gap-2 text-sm">
                              {f.picture_url && (
                                <img
                                  src={f.picture_url}
                                  alt=""
                                  className="h-6 w-6 rounded-full"
                                />
                              )}
                              <a
                                href={`/friends/${f.id}`}
                                className="truncate text-blue-600 hover:underline"
                              >
                                {f.display_name ?? '(名前未取得)'}
                              </a>
                              {!f.is_following && <Badge tone="neutral">ブロック</Badge>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Banner tone="info" title="💡 使い方の例">
              <ul className="list-disc space-y-1 pl-4 text-xs">
                <li>「フォーム回答済」AND「未対応」→ 折り返し連絡候補</li>
                <li>「無料相談済」AND NOT「成約済」→ 商談クロージング候補</li>
                <li>「広告A」OR「広告B」→ 広告流入の合計</li>
              </ul>
            </Banner>
          </div>
        </div>
      </main>
    </div>
  )
}
