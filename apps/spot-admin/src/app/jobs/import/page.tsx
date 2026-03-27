'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, type ParsedJob } from '@/lib/api'

const BRAND = '#FF6B35'

export default function ImportJobsPage() {
  const router = useRouter()
  const [emailText, setEmailText] = useState('')
  const [parsed, setParsed] = useState<ParsedJob[]>([])
  const [selected, setSelected] = useState<boolean[]>([])
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')

  const handleParse = async () => {
    if (!emailText.trim()) return
    setParsing(true)
    setError('')
    setParsed([])
    setResult('')

    try {
      const res = await api.jobs.parseEmail(emailText)
      if (res.success && res.data.length > 0) {
        setParsed(res.data)
        setSelected(res.data.map(() => true))
      } else {
        setError('求人情報を抽出できませんでした')
      }
    } catch {
      setError('解析に失敗しました')
    } finally {
      setParsing(false)
    }
  }

  const handleSubmit = async () => {
    const jobs = parsed.filter((_, i) => selected[i])
    if (jobs.length === 0) return

    setSubmitting(true)
    setError('')

    try {
      const res = await api.jobs.batch(jobs)
      if (res.success) {
        setResult(`${res.count}件の求人を作成しました`)
        setParsed([])
        setEmailText('')
      } else {
        setError('登録に失敗しました')
      }
    } catch {
      setError('登録に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleSelect = (i: number) => {
    setSelected((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
  }

  const selectedCount = selected.filter(Boolean).length

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">求人一括取込</h1>
        <button
          onClick={() => router.push('/jobs')}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← 求人一覧に戻る
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
      {result && <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm rounded-lg">{result}</div>}

      {/* Step 1: メール文面入力 */}
      {parsed.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            メール文面を貼り付け
          </label>
          <p className="text-xs text-gray-500 mb-3">
            園からのメールをそのまま貼り付けてください。複数園分まとめてもOKです。
          </p>
          <textarea
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            rows={12}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none font-mono"
            placeholder={`例:\nお世話になっております。○○保育園の田中です。\n下記日程でスポット保育士をお願いしたいです。\n\n4/3（木）9:00〜17:00 1名\n4/5（土）8:30〜16:30 2名 時給1,300円\n\n業務内容: 0〜2歳児クラスの保育補助\nよろしくお願いいたします。`}
            autoFocus
          />
          <div className="flex justify-end mt-4">
            <button
              onClick={handleParse}
              disabled={parsing || !emailText.trim()}
              className="px-6 py-2.5 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              {parsing ? 'AI解析中...' : 'AIで求人を抽出'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: 解析結果プレビュー */}
      {parsed.length > 0 && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-medium text-gray-900">
                抽出結果（{parsed.length}件）
              </h2>
              <button
                onClick={() => { setParsed([]); setSelected([]) }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                やり直す
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3 text-left w-10">
                      <input
                        type="checkbox"
                        checked={selectedCount === parsed.length}
                        onChange={() => {
                          const allSelected = selectedCount === parsed.length
                          setSelected(parsed.map(() => !allSelected))
                        }}
                        className="rounded"
                      />
                    </th>
                    <th className="px-4 py-3 text-left">園名</th>
                    <th className="px-4 py-3 text-left">日付</th>
                    <th className="px-4 py-3 text-left">時間</th>
                    <th className="px-4 py-3 text-right">時給</th>
                    <th className="px-4 py-3 text-right">定員</th>
                    <th className="px-4 py-3 text-left">備考</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {parsed.map((job, i) => (
                    <tr
                      key={i}
                      className={`${selected[i] ? 'bg-white' : 'bg-gray-50 opacity-50'} hover:bg-orange-50 transition-colors cursor-pointer`}
                      onClick={() => toggleSelect(i)}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected[i]}
                          onChange={() => toggleSelect(i)}
                          className="rounded"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {job.nurseryName}
                        {job.nurseryId && (
                          <span className="ml-1 text-xs text-green-600">✓ 登録済</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{job.workDate}</td>
                      <td className="px-4 py-3 text-gray-700">{job.startTime}〜{job.endTime}</td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {job.hourlyRate ? `¥${job.hourlyRate.toLocaleString()}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{job.capacity}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                        {job.description || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {selectedCount}件を登録します
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setParsed([]); setSelected([]) }}
                className="px-6 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || selectedCount === 0}
                className="px-6 py-2.5 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: BRAND }}
              >
                {submitting ? '登録中...' : `${selectedCount}件を一括登録`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
