'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { TEMPLATES, templateToAreas } from '@/lib/rich-menu-templates'

export default function NewRichMenuPage() {
  const router = useRouter()
  const { selectedAccount } = useAccount()
  const [name, setName] = useState('')
  const [chatBarText, setChatBarText] = useState('メニュー')
  const [selected, setSelected] = useState(true)
  const [templateKey, setTemplateKey] = useState(TEMPLATES[0].key)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tmpl = TEMPLATES.find((t) => t.key === templateKey) ?? TEMPLATES[0]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAccount) {
      setError('アカウントを選択してください')
      return
    }
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.create({
        accountId: selectedAccount.id,
        name: name.trim(),
        chatBarText: chatBarText.trim(),
        size: tmpl.size,
        selected,
        pages: [
          { name: 'ページ 1', orderIndex: 0, areas: templateToAreas(tmpl) },
        ],
      })
      if (!res.success) throw new Error(res.error ?? '作成失敗')
      router.push(`/rich-menus/edit?id=${res.data.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <Header
        title="新規リッチメニュー"
        description="作成後の編集画面で画像 upload や areas 編集ができます。"
      />
      <Link
        href="/rich-menus"
        className="text-sm text-gray-500 hover:underline mb-4 inline-block"
      >
        ← 一覧に戻る
      </Link>

      <form onSubmit={handleSubmit} className="space-y-5 bg-white border border-gray-200 rounded-lg shadow-sm p-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            名前 <span className="text-gray-400">(管理用)</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="例: メインメニュー"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            トーク画面下の文言 <span className="text-gray-400">(14 文字以内)</span>
          </label>
          <input
            value={chatBarText}
            onChange={(e) => setChatBarText(e.target.value)}
            maxLength={14}
            required
            className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            ユーザーがトーク画面でメニューを開く前に表示される文言。
          </p>
        </div>

        <div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => setSelected(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-gray-700">
                トークを開いたときにメニューを表示する
              </span>
              <span className="block mt-1 text-xs text-gray-500">
                ON にすると、友だちがトーク画面を開いた直後からリッチメニューを展開します。
              </span>
            </span>
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            初期テンプレート
          </label>
          <div className="grid grid-cols-1 gap-2">
            {TEMPLATES.map((t) => (
              <label
                key={t.key}
                className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                  templateKey === t.key
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="template"
                  value={t.key}
                  checked={templateKey === t.key}
                  onChange={(e) => setTemplateKey(e.target.value)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">
                    {t.label}
                    <span className="ml-2 text-xs text-gray-500 font-normal">
                      {t.size === 'large' ? '2500×1686' : '2500×843'}
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-gray-200">
          <Link
            href="/rich-menus"
            className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            キャンセル
          </Link>
          <button
            type="submit"
            disabled={submitting || !selectedAccount}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            {submitting ? '作成中...' : '作成して編集へ'}
          </button>
        </div>
      </form>
    </main>
  )
}
