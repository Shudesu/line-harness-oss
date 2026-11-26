'use client'

import { useState, useEffect, useCallback } from 'react'
import { XIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { Loader } from '@cloudflare/kumo/components/loader'
import { api } from '@/lib/api'

interface Friend {
  id: string
  displayName: string
  pictureUrl: string | null
}

interface TestRecipientsSettingProps {
  accountId: string
}

export default function TestRecipientsSetting({ accountId }: TestRecipientsSettingProps) {
  const [recipients, setRecipients] = useState<Friend[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Friend[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.accountSettings.getTestRecipients(accountId)
      if (res.success) setRecipients(res.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  // Debounced friend search
  useEffect(() => {
    if (search.length < 2) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        // The worker now ranks friends by match quality (exact > prefix >
        // word-start > generic substring) before created_at DESC. So
        // `limit: 10` here gives 10 best matches across the entire account,
        // not "10 newest containing the substring". Fixes the long-standing
        // issue where the operator's own friend record (day-one) was buried
        // by recently-added friends sharing the same substring.
        // includeTags=false: tags not rendered here; skipping the per-row
        // tag fetch turns ~11 D1 reads/keystroke into 2 (count + list).
        const res = await api.friends.list({ search, accountId, limit: 10, includeTags: false })
        if (res.success) {
          const existing = new Set(recipients.map(r => r.id))
          const items = (res.data as unknown as { items: Friend[] }).items ?? res.data
          setSearchResults(
            (Array.isArray(items) ? items : [])
              .filter((f: Friend) => !existing.has(f.id))
              .map((f: Friend) => ({ id: f.id, displayName: f.displayName, pictureUrl: f.pictureUrl }))
          )
        }
      } catch { /* ignore */ }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(timer)
  }, [search, accountId, recipients])

  const addRecipient = async (friend: Friend) => {
    const updated = [...recipients, friend]
    setRecipients(updated)
    setSearch('')
    setSearchResults([])
    setSaving(true)
    try {
      await api.accountSettings.updateTestRecipients(accountId, updated.map(r => r.id))
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const removeRecipient = async (friendId: string) => {
    const updated = recipients.filter(r => r.id !== friendId)
    setRecipients(updated)
    setSaving(true)
    try {
      await api.accountSettings.updateTestRecipients(accountId, updated.map(r => r.id))
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  if (loading) return <span className="mt-3 inline-flex items-center gap-2 text-xs text-kumo-subtle"><Loader size="sm" /> テスト送信先を読み込み中</span>

  return (
    <div className="mt-3 border-t border-kumo-line pt-3">
      <h4 className="mb-2 text-xs font-semibold text-kumo-default">テスト送信先</h4>

      {/* Current recipients */}
      {recipients.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {recipients.map((recipient) => (
            <span key={recipient.id} className="inline-flex items-center gap-1 rounded-full bg-kumo-info-tint px-2 py-1 text-xs text-kumo-info">
              {recipient.pictureUrl ? <img src={recipient.pictureUrl} alt="" className="h-4 w-4 rounded-full" /> : null}
              {recipient.displayName}
              <Button
                type="button"
                size="xs"
                variant="ghost"
                icon={XIcon}
                aria-label={`${recipient.displayName}をテスト送信先から外す`}
                disabled={saving}
                onClick={() => void removeRecipient(recipient.id)}
              />
            </span>
          ))}
        </div>
      ) : null}

      {/* Search to add */}
      <div className="relative">
        <Input
          aria-label="テスト送信する友だちを検索"
          placeholder="友だちを検索して追加…"
          value={search}
          onValueChange={setSearch}
        />
        {searching ? <span className="absolute right-2 top-2 inline-flex items-center gap-1 text-xs text-kumo-subtle"><Loader size="sm" />検索中</span> : null}
        {saving ? <span className="absolute right-2 top-2 text-xs text-kumo-success">保存中…</span> : null}

        {searchResults.length > 0 ? (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-kumo-line bg-kumo-base p-1 shadow-lg">
            {searchResults.map((friend) => (
              <li key={friend.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  disabled={saving}
                  onClick={() => void addRecipient(friend)}
                >
                  {friend.pictureUrl ? (
                    <img src={friend.pictureUrl} alt="" className="h-5 w-5 rounded-full" />
                  ) : (
                    <span className="h-5 w-5 rounded-full bg-kumo-fill" />
                  )}
                  {friend.displayName}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
