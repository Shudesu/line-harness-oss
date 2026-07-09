'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

/**
 * Global short-link domain settings (deployment-wide, not per-account).
 *
 * 1. link_base_url — affiliate click-through links. The operator configures a
 *    Redirect Rule that forwards the domain's root paths to the Worker's /r/.
 * 2. tracked_link_base_url — message tracked links (/t/<code>) created by
 *    auto-shortening. The domain must route /t/* to the Worker as-is
 *    (path-preserving Redirect Rule or Custom Domain). Kept separate from
 *    link_base_url because existing affiliate domains map everything to /r/.
 */

interface UrlSettingCardProps {
  title: string
  description: React.ReactNode
  placeholder: string
  load: () => Promise<{ success: boolean; data: string | null }>
  save: (value: string) => Promise<{ success: boolean; error?: string }>
}

function UrlSettingCard({ title, description, placeholder, load, save }: UrlSettingCardProps) {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await load()
        if (!cancelled && res.success) {
          setValue(res.data ?? '')
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await save(value.trim())
      if (res.success) {
        // Normalise stored value: strip trailing slash to match server behaviour.
        setValue(value.trim().replace(/\/$/, ''))
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setError(res.error ?? '保存に失敗しました')
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-xs text-gray-400">読み込み中...</p>
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <h3 className="text-sm font-semibold text-gray-800 mb-1">{title}</h3>
      <p className="text-xs text-gray-500 mb-3">{description}</p>
      <div className="flex gap-2 items-start">
        <div className="flex-1">
          <input
            type="url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          {saved && <p className="text-xs text-green-600 mt-1">保存しました</p>}
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-medium disabled:opacity-50 whitespace-nowrap"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )
}

export default function LinkBaseUrlSetting() {
  return (
    <>
      <UrlSettingCard
        title="アフィリリンクドメイン（全アカウント共通）"
        description={
          <>
            アフィリエイト配布リンクに短縮ドメインを使う場合に設定。例:{' '}
            <code className="bg-gray-100 px-1 rounded">https://go.example.com</code>
            （そのドメインから Worker の /r/ へ転送する Redirect Rule が必要）
          </>
        }
        placeholder="https://go.example.com（空欄でデフォルト /r/ を使用）"
        load={api.accountSettings.getLinkBaseUrl}
        save={api.accountSettings.updateLinkBaseUrl}
      />
      <UrlSettingCard
        title="メッセージ内リンクの短縮ドメイン（全アカウント共通）"
        description={
          <>
            配信メッセージの自動短縮リンク（/t/…）に使うドメイン。例:{' '}
            <code className="bg-gray-100 px-1 rounded">https://go.example.com</code>
            {' '}→ リンクは <code className="bg-gray-100 px-1 rounded">https://go.example.com/t/Ab3xY9k</code> 形式に。
            そのドメインの <code className="bg-gray-100 px-1 rounded">/t/*</code> をパスそのまま Worker へ転送する設定（Redirect Rule 等）が必要。詳細は wiki「Tracked Links」参照
          </>
        }
        placeholder="https://go.example.com（空欄で Worker URL を使用）"
        load={api.accountSettings.getTrackedLinkBaseUrl}
        save={api.accountSettings.updateTrackedLinkBaseUrl}
      />
    </>
  )
}
