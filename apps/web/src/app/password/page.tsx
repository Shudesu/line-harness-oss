'use client'
import { useState } from 'react'
import Header from '@/components/layout/header'
import { getCsrfToken } from '@/lib/api'

export default function PasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setDone(false)
    if (newPassword !== confirmPassword) {
      setError('新しいパスワードが2回とも同じになっていません')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/staff/me/password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!res.ok || !json?.success) {
        setError(json?.error ?? '変更できませんでした。時間をおいてもう一度お試しください')
        return
      }
      setDone(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      setError('変更できませんでした。時間をおいてもう一度お試しください')
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500'

  return (
    <div>
      <Header title="パスワード変更" description="ログインに使うパスワードを、自分で決めたものに変えられます。" />
      <form onSubmit={handleSubmit} className="max-w-md bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">いまのパスワード</label>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
            required
          />
          <p className="mt-1 text-xs text-gray-500">はじめて変える場合は、受け取った「lh_」で始まる鍵を入れてください。</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">新しいパスワード（10文字以上）</label>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass}
            minLength={10}
            maxLength={128}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">新しいパスワード（確認のためもう一度）</label>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
            minLength={10}
            maxLength={128}
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {done && (
          <p className="text-sm text-green-700">
            変更しました。次からは新しいパスワードでログインしてください。前のパスワードは使えなくなりました。
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="w-full px-4 py-2 rounded-lg text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? '変更しています…' : 'パスワードを変更する'}
        </button>
        <p className="text-xs text-gray-500">パスワードを忘れたときは、オーナーに鍵を作り直してもらってください。</p>
      </form>
    </div>
  )
}
