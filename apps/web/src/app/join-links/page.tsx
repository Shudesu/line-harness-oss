'use client'

// KIDOUインターンの友だち追加リンク。大本のリンクと QR、どこから来たかを数える経路リンクの発行と人数
import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'

interface JoinLink {
  id: string
  refCode: string
  name: string
  tagId: string | null
  isActive: boolean
  createdAt: string
  openedCount: number
  friendCount: number
  followingCount: number
  latestFriendAt: string | null
}

interface JoinLinksData {
  links: JoinLink[]
  totalFriends: number
  friendsWithoutLink: number
  ready: boolean
  botBasicId: string
  friendAddUrl: string
  linkBase: string
}

interface TagRow {
  id: string
  name: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''
const INFLOW_TAG_PREFIX = 'ズ_流入_'

function qrSrc(url: string, size = 200) {
  return `${API_URL}/api/qr?size=${size}x${size}&data=${encodeURIComponent(url)}`
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
}

function CopyButton({ text, label = 'コピー' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          window.prompt('コピーしてください', text)
        }
      }}
      className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
    >
      {copied ? 'コピーしました' : label}
    </button>
  )
}

export default function JoinLinksPage() {
  const [data, setData] = useState<JoinLinksData | null>(null)
  const [tags, setTags] = useState<TagRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [tagId, setTagId] = useState('')
  const [saving, setSaving] = useState(false)
  const [qrFor, setQrFor] = useState<string | null>(null)

  const load = async () => {
    setError('')
    try {
      const [res, tagRes] = await Promise.all([
        fetchApi<{ success: boolean; data?: JoinLinksData; error?: string }>('/api/intern/join-links'),
        fetchApi<{ success: boolean; data?: TagRow[] }>('/api/tags').catch(() => ({ success: false, data: [] as TagRow[] })),
      ])
      if (res.success && res.data) setData(res.data)
      else setError(res.error ?? '読み込めませんでした')
      if (tagRes.success && tagRes.data) setTags(tagRes.data.filter((t) => t.name.startsWith(INFLOW_TAG_PREFIX)))
    } catch {
      setError('読み込めませんでした。時間をおいてもう一度お試しください')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>('/api/intern/join-links', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), tagId: tagId || null }),
      })
      if (!res.success) {
        setError(res.error ?? 'リンクを作れませんでした')
        return
      }
      setName('')
      setTagId('')
      await load()
    } catch {
      setError('リンクを作れませんでした。時間をおいてもう一度お試しください')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (link: JoinLink) => {
    const next = !link.isActive
    if (!next && !window.confirm(`「${link.name}」を止めますか？\n止めても、リンクを押した人はふつうの友だち追加に進みます（人数は数えなくなります）。`)) return
    try {
      await fetchApi('/api/intern/join-links/' + link.id, { method: 'PATCH', body: JSON.stringify({ isActive: next }) })
      await load()
    } catch {
      setError('切り替えられませんでした')
    }
  }

  const rename = async (link: JoinLink) => {
    const value = window.prompt('リンクの名前', link.name)
    if (value === null || !value.trim() || value.trim() === link.name) return
    try {
      await fetchApi('/api/intern/join-links/' + link.id, { method: 'PATCH', body: JSON.stringify({ name: value.trim() }) })
      await load()
    } catch {
      setError('名前を変えられませんでした')
    }
  }

  const tagName = (id: string | null) => {
    if (!id) return null
    const t = tags.find((x) => x.id === id)
    return t ? t.name.replace(INFLOW_TAG_PREFIX, '') : null
  }

  const inputClass =
    'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500'

  return (
    <div>
      <Header
        title="友だち追加リンク"
        description="KIDOUインターンの友だち追加リンクです。SNS ごとに経路リンクを作ると、どこから何人が友だちになったかを数えられます。"
      />

      {loading && <p className="text-sm text-gray-500">読み込んでいます…</p>}
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {data && (
        <div className="space-y-6">
          {/* 大本のリンク */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-1 text-base font-bold text-gray-900">大本の友だち追加リンク</h2>
            <p className="mb-4 text-sm text-gray-500">どこから来たかは数えません。経路を数えたいときは、下で経路リンクを作ってください。</p>
            <div className="flex flex-col gap-6 sm:flex-row">
              <div className="flex-1 space-y-3">
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500">リンク</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800">{data.friendAddUrl}</code>
                    <CopyButton text={data.friendAddUrl} />
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500">ID で探してもらうとき</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800">{data.botBasicId}</code>
                    <CopyButton text={data.botBasicId} />
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  いまの友だち：<span className="font-bold text-gray-900">{data.totalFriends}</span> 人（そのうち経路リンクを通らずに追加した人：{data.friendsWithoutLink} 人）
                </p>
              </div>
              <div className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrSrc(data.friendAddUrl, 240)} alt="友だち追加の QR コード" width={160} height={160} className="mx-auto rounded border border-gray-100" />
                <a href={qrSrc(data.friendAddUrl, 600)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-green-700 underline">
                  大きい QR を開く
                </a>
              </div>
            </div>
          </section>

          {/* 経路リンクを作る */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-1 text-base font-bold text-gray-900">経路リンクを作る</h2>
            <p className="mb-4 text-sm text-gray-500">
              SNS や貼る場所ごとに1本ずつ作ります。押した人ははじめに LINE の「許可する」画面を通ってから、友だち追加に進みます。
            </p>
            {!data.ready && (
              <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                経路を数える準備（LINE 側の設定）がまだ終わっていません。いま作ったリンクは、押すとふつうの友だち追加になり、人数は数えません。準備が終わると、同じリンクのまま数え始めます。
              </p>
            )}
            <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-500">名前（例：TikTok プロフィール）</label>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputClass} placeholder="TikTok プロフィール" />
              </div>
              <div className="sm:w-56">
                <label className="mb-1 block text-xs font-medium text-gray-500">付けるタグ（なくてもよい）</label>
                <select value={tagId} onChange={(e) => setTagId(e.target.value)} className={inputClass}>
                  <option value="">付けない</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name.replace(INFLOW_TAG_PREFIX, '流入：')}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? '作っています…' : 'リンクを作る'}
              </button>
            </form>
          </section>

          {/* 経路ごとの人数 */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-base font-bold text-gray-900">経路ごとの人数</h2>
            {data.links.length === 0 ? (
              <p className="text-sm text-gray-500">まだ経路リンクがありません。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                      <th className="py-2 pr-4 font-medium">名前</th>
                      <th className="py-2 pr-4 font-medium">リンク</th>
                      <th className="py-2 pr-4 text-right font-medium">開いた人</th>
                      <th className="py-2 pr-4 text-right font-medium">友だちになった人</th>
                      <th className="py-2 pr-4 text-right font-medium">いまも友だち</th>
                      <th className="py-2 pr-4 font-medium">最後の追加</th>
                      <th className="py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.links.map((link) => {
                      const url = data.linkBase + link.refCode
                      const tag = tagName(link.tagId)
                      return (
                        <tr key={link.id} className={`border-b border-gray-100 align-top ${link.isActive ? '' : 'opacity-50'}`}>
                          <td className="py-3 pr-4">
                            <button type="button" onClick={() => rename(link)} className="text-left font-medium text-gray-900 hover:underline">
                              {link.name}
                            </button>
                            {tag && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{tag}</span>}
                            {!link.isActive && <span className="ml-2 text-xs text-gray-500">止めています</span>}
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2">
                              <code className="max-w-[16rem] truncate text-xs text-gray-700">{url}</code>
                              <CopyButton text={url} />
                              <button
                                type="button"
                                onClick={() => setQrFor(qrFor === link.id ? null : link.id)}
                                className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                QR
                              </button>
                            </div>
                            {qrFor === link.id && (
                              <div className="mt-3">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={qrSrc(url, 240)} alt={`${link.name} の QR コード`} width={140} height={140} className="rounded border border-gray-100" />
                                <a href={qrSrc(url, 600)} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-green-700 underline">
                                  大きい QR を開く
                                </a>
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums">{link.openedCount}</td>
                          <td className="py-3 pr-4 text-right font-bold tabular-nums text-gray-900">{link.friendCount}</td>
                          <td className="py-3 pr-4 text-right tabular-nums">{link.followingCount}</td>
                          <td className="py-3 pr-4 text-gray-600">{formatDate(link.latestFriendAt)}</td>
                          <td className="py-3 text-right">
                            <button type="button" onClick={() => toggleActive(link)} className="text-xs text-gray-500 hover:text-gray-800 hover:underline">
                              {link.isActive ? '止める' : '再開する'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-4 text-xs text-gray-500">
              「開いた人」は、リンクを押して LINE の画面まで進んだ人です。前から友だちだった人は「友だちになった人」には入りません。
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
