'use client'

/**
 * Phase 2-C: クロス分析画面
 *
 * 複数タグの交差・和集合・差集合で友だちを抽出する分析ツール。
 * 例: 「フォーム回答済」かつ「無料相談済」だが「成約済」ではない友だち → 商談候補
 */

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左: 条件選択 */}
          <div className="lg:col-span-2 space-y-4">
            {/* モード選択 */}
            <div className="rounded-lg border bg-white p-4">
              <h2 className="text-sm font-semibold mb-2">組み合わせ方</h2>
              <div className="space-y-2">
                {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                  <label
                    key={m}
                    className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer ${
                      mode === m ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
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
            </div>

            {/* タグ検索 */}
            <div className="rounded-lg border bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold">タグを選ぶ</h2>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="タグ名で検索"
                  className="rounded border border-gray-300 px-2 py-1 text-sm w-48"
                />
              </div>

              {tagsLoading ? (
                <p className="text-sm text-gray-500">読み込み中…</p>
              ) : filteredTags.length === 0 ? (
                <p className="text-sm text-gray-500">該当タグがありません</p>
              ) : (
                <div className="max-h-96 overflow-y-auto space-y-1">
                  {filteredTags.map((t) => {
                    const isIncluded = includeTagIds.includes(t.id)
                    const isExcluded = excludeTagIds.includes(t.id)
                    return (
                      <div
                        key={t.id}
                        className={`flex items-center justify-between rounded border p-2 ${
                          isIncluded ? 'border-emerald-300 bg-emerald-50' :
                          isExcluded ? 'border-red-300 bg-red-50' :
                          'border-gray-200'
                        }`}
                      >
                        <span className="text-sm">{t.name}</span>
                        <div className="flex gap-1 text-xs">
                          <button
                            type="button"
                            onClick={() => toggleInclude(t.id)}
                            className={`rounded px-2 py-0.5 ${
                              isIncluded ? 'bg-emerald-600 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {isIncluded ? '✓ 含める' : '含める'}
                          </button>
                          {mode === 'and_not' && (
                            <button
                              type="button"
                              onClick={() => toggleExclude(t.id)}
                              className={`rounded px-2 py-0.5 ${
                                isExcluded ? 'bg-red-600 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              {isExcluded ? '✓ 除外' : '除外'}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* フィルタ */}
            <div className="rounded-lg border bg-white p-4">
              <h2 className="text-sm font-semibold mb-2">フィルタ</h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={followingOnly}
                  onChange={(e) => setFollowingOnly(e.target.checked)}
                />
                フォロー中の友だちのみ (ブロック済みを除外)
              </label>
            </div>

            {/* 実行ボタン */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onReset}
                disabled={loading}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                リセット
              </button>
              <button
                type="button"
                onClick={onAnalyze}
                disabled={loading || includeTagIds.length === 0}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? '分析中…' : '分析する'}
              </button>
            </div>

            {error && (
              <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}
          </div>

          {/* 右: 結果 */}
          <div className="space-y-4">
            <div className="rounded-lg border bg-white p-4">
              <h2 className="text-sm font-semibold mb-3">結果</h2>
              {!result ? (
                <p className="text-sm text-gray-500">
                  左でタグを選んで「分析する」を押すと結果がここに出ます。
                </p>
              ) : (
                <>
                  <div className="mb-3 text-center">
                    <div className="text-4xl font-bold text-blue-600">{result.totalCount.toLocaleString()}</div>
                    <div className="text-xs text-gray-500">該当友だち件数</div>
                  </div>

                  <div className="border-t pt-3 max-h-96 overflow-y-auto">
                    <p className="text-xs text-gray-500 mb-2">
                      上位 {Math.min(result.friends.length, 500)} 件:
                    </p>
                    {result.friends.length === 0 ? (
                      <p className="text-sm text-gray-500">該当なし</p>
                    ) : (
                      <ul className="space-y-1">
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
                              className="text-blue-600 hover:underline truncate"
                            >
                              {f.display_name ?? '(名前未取得)'}
                            </a>
                            {!f.is_following && (
                              <span className="rounded bg-gray-100 px-1 text-xs text-gray-600">ブロック</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <p className="font-medium mb-1">💡 使い方の例</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>「フォーム回答済」AND「未対応」→ 折り返し連絡候補</li>
                <li>「無料相談済」AND NOT「成約済」→ 商談クロージング候補</li>
                <li>「広告A」OR「広告B」→ 広告流入の合計</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
