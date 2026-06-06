'use client'

/**
 * Phase 1-A: あいさつメッセージ (L-TRACK 互換) 設定画面
 *
 * 友だち追加直後に送る LINE メッセージを設定する。
 * referralRoute (流入経路) で intro_template_id が設定されている場合はそちらが優先され、
 * ここの設定は「普通の友だち追加」(referral 無し) の時だけ使われる。
 */

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

export default function GreetingPage() {
  const { selectedAccountId } = useAccount()
  const [text, setText] = useState('')
  const [originalText, setOriginalText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = async () => {
    if (!selectedAccountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    const r = await fetchApi<{ success: boolean; data?: { text: string | null }; error?: string }>(
      `/api/account-settings/greeting?accountId=${encodeURIComponent(selectedAccountId)}`,
    )
    if (r.success && r.data) {
      const v = r.data.text ?? ''
      setText(v)
      setOriginalText(v)
    } else if (!r.success) {
      setError(r.error ?? '取得失敗')
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])

  const onSave = async () => {
    if (!selectedAccountId) return
    setSaving(true)
    setError('')
    const r = await fetchApi<{ success: boolean; error?: string }>(
      `/api/account-settings/greeting`,
      {
        method: 'PUT',
        body: JSON.stringify({ accountId: selectedAccountId, text }),
      },
    )
    setSaving(false)
    if (r.success) {
      setOriginalText(text)
      setSavedAt(new Date().toLocaleString('ja-JP'))
    } else {
      setError(r.error ?? '保存失敗')
    }
  }

  const onClear = async () => {
    if (!confirm('あいさつメッセージを削除しますか?\n(LINE 公式の標準あいさつメッセージに戻ります)')) return
    if (!selectedAccountId) return
    setSaving(true)
    setError('')
    const r = await fetchApi<{ success: boolean; error?: string }>(
      `/api/account-settings/greeting`,
      {
        method: 'PUT',
        body: JSON.stringify({ accountId: selectedAccountId, text: '' }),
      },
    )
    setSaving(false)
    if (r.success) {
      setText('')
      setOriginalText('')
      setSavedAt(new Date().toLocaleString('ja-JP'))
    } else {
      setError(r.error ?? '削除失敗')
    }
  }

  const hasChanges = text !== originalText
  const charCount = text.length
  const isOverLimit = charCount > 5000

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <Header
          title="あいさつメッセージ"
          description="友だち追加直後に自動送信されるメッセージ。LINE 公式のあいさつ機能を上書きします。"
        />

        <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <p className="font-medium mb-1">📌 動作仕様</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>友だち追加された瞬間に push 送信されます</li>
            <li>流入経路 (referral) で別の intro が設定されている場合は、そちらが優先されます</li>
            <li>
              プレースホルダ <code className="bg-white px-1 rounded">{'{{friend_name}}'}</code>{' '}
              <code className="bg-white px-1 rounded">{'{{account_name}}'}</code> が使えます
            </li>
            <li>空欄で保存すると LINE 公式の標準あいさつメッセージに戻ります</li>
          </ul>
        </div>

        {!selectedAccountId && (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">
            上部のアカウント選択から LINE アカウントを選んでください。
          </div>
        )}

        {selectedAccountId && (
          <>
            {error && (
              <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}

            {loading ? (
              <div className="rounded border bg-white p-6 text-sm text-gray-500">
                読み込み中…
              </div>
            ) : (
              <div className="rounded-lg border bg-white p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    メッセージ本文
                  </label>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={10}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                    placeholder={
                      'はじめまして、{{friend_name}}さん!\n\nhyhome 公式 LINE にご登録ありがとうございます。\n家づくりのご相談、お気軽にメッセージください。'
                    }
                  />
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className={isOverLimit ? 'text-red-600' : 'text-gray-500'}>
                      {charCount} / 5000 文字
                    </span>
                    {savedAt && (
                      <span className="text-emerald-700">✅ 保存しました ({savedAt})</span>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-2">プレビュー:</p>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm whitespace-pre-wrap">
                    {text
                      ? text
                          .replaceAll('{{friend_name}}', '山田 太郎')
                          .replaceAll('{{account_name}}', 'みな｜家づくり相談')
                      : '(未設定 — LINE 公式の標準あいさつメッセージが使われます)'}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t pt-4">
                  {originalText && (
                    <button
                      type="button"
                      onClick={onClear}
                      disabled={saving}
                      className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      削除して標準に戻す
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={saving || !hasChanges || isOverLimit}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
