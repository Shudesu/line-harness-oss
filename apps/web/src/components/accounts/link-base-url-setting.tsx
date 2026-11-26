'use client'

import { useState, useEffect } from 'react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
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
    return <span className="inline-flex items-center gap-2 text-xs text-kumo-subtle"><Loader size="sm" /> 設定を読み込み中</span>
  }

  return (
    <LayerCard className="mb-6 p-6">
      <h3 className="mb-1 text-sm font-semibold text-kumo-strong">{title}</h3>
      <div className="mb-3 text-xs leading-5 text-kumo-subtle">{description}</div>
      <div className="flex items-start gap-2">
        <Input
          className="min-w-0 flex-1"
          aria-label={title}
          type="url"
          value={value}
          onValueChange={setValue}
          placeholder={placeholder}
        />
        <Button type="button" variant="secondary" loading={saving} onClick={() => void handleSave()}>保存</Button>
      </div>
      {error ? <Banner className="mt-2" variant="error" title="保存できません" description={error} /> : null}
      {saved ? <p className="mt-2 text-xs text-kumo-success">保存しました</p> : null}
    </LayerCard>
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
            <code className="rounded bg-kumo-tint px-1">https://go.example.com</code>
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
            <code className="rounded bg-kumo-tint px-1">https://go.example.com</code>
            {' '}→ リンクは <code className="rounded bg-kumo-tint px-1">https://go.example.com/t/Ab3xY9k</code> 形式に。
            そのドメインの <code className="rounded bg-kumo-tint px-1">/t/*</code> をパスそのまま Worker へ転送する設定（Redirect Rule 等）が必要。詳細は wiki「Tracked Links」参照
          </>
        }
        placeholder="https://go.example.com（空欄で Worker URL を使用）"
        load={api.accountSettings.getTrackedLinkBaseUrl}
        save={api.accountSettings.updateTrackedLinkBaseUrl}
      />
    </>
  )
}
