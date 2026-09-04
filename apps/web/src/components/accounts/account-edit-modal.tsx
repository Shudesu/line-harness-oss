'use client'

import { useState } from 'react'
import { XIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { api } from '@/lib/api'
import {
  AccountFormSections,
  emptyAccountFormState,
  type AccountFormState,
} from './account-form-fields'
import AccountSetupUrls from './account-setup-urls'

interface Props {
  accountId: string
  initialName: string
  initialChannelId: string
  initialLoginChannelId: string | null
  initialLiffId: string | null
  initialOgSiteName?: string | null
  initialOgDefaultDescription?: string | null
  initialOgDefaultImageUrl?: string | null
  onClose: () => void
  onSaved: () => void
}

// Edit modal — reads current secrets from the secrets-allowed GET endpoint
// (so the user can see "is the secret set?" without exposing it in the list).
// On save, only fields the user actually modified are sent. Empty messaging
// credentials are NOT sent (leave server value as-is) — this lets users edit
// just the Login/LIFF fields without re-entering Messaging credentials.
export default function AccountEditModal({
  accountId,
  initialName,
  initialChannelId,
  initialLoginChannelId,
  initialLiffId,
  initialOgSiteName = null,
  initialOgDefaultDescription = null,
  initialOgDefaultImageUrl = null,
  onClose,
  onSaved,
}: Props) {
  const [state, setState] = useState<AccountFormState>({
    ...emptyAccountFormState,
    name: initialName,
    channelId: initialChannelId,
    loginChannelId: initialLoginChannelId ?? '',
    liffId: initialLiffId ?? '',
    ogSiteName: initialOgSiteName,
    ogDefaultDescription: initialOgDefaultDescription,
    ogDefaultImageUrl: initialOgDefaultImageUrl,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const update = (partial: Partial<AccountFormState>) =>
    setState((s) => ({ ...s, ...partial }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')

    // Only send fields the user actually changed. Empty string for password-
    // like fields means "no change", not "clear it" — there's no UI affordance
    // to clear credentials, and accidentally clearing them would break prod.
    const payload: Parameters<typeof api.lineAccounts.update>[1] = {}
    if (state.name !== initialName) payload.name = state.name
    if (state.channelAccessToken.trim() !== '') {
      payload.channelAccessToken = state.channelAccessToken.trim()
    }
    if (state.channelSecret.trim() !== '') {
      payload.channelSecret = state.channelSecret.trim()
    }
    // Login/LIFF: empty string means "clear" (set null) — these are
    // configured per-account and clearing is a legitimate operation
    // (e.g. removing a deprecated LIFF). Send the current value as-is.
    const loginIdNext = state.loginChannelId.trim() || null
    const loginIdChanged = loginIdNext !== (initialLoginChannelId ?? null)
    if (loginIdChanged) payload.loginChannelId = loginIdNext

    if (state.loginChannelSecret.trim() !== '') {
      payload.loginChannelSecret = state.loginChannelSecret.trim()
    } else if (loginIdNext === null && initialLoginChannelId !== null) {
      // User cleared the Login Channel ID. Pair with secret-clear so the
      // server's pair-validator doesn't reject the request (it would see
      // id=null + kept-old-secret as inconsistent). Pair-clear is the
      // intended "disable LINE Login on this account" action.
      payload.loginChannelSecret = null
    }

    if ((state.liffId.trim() || null) !== (initialLiffId ?? null)) {
      payload.liffId = state.liffId.trim() || null
    }

    // OGP brand settings: always send when they differ from initial values
    if (state.ogSiteName !== initialOgSiteName) {
      payload.ogSiteName = state.ogSiteName
    }
    if (state.ogDefaultDescription !== initialOgDefaultDescription) {
      payload.ogDefaultDescription = state.ogDefaultDescription
    }
    if (state.ogDefaultImageUrl !== initialOgDefaultImageUrl) {
      payload.ogDefaultImageUrl = state.ogDefaultImageUrl
    }

    if (Object.keys(payload).length === 0) {
      onClose()
      return
    }

    try {
      const res = await api.lineAccounts.update(accountId, payload)
      if (res.success) {
        onSaved()
        onClose()
      } else {
        setError(res.error || '保存に失敗しました')
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <Dialog size="lg" className="max-h-[90vh] overflow-y-auto p-0">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-kumo-line bg-kumo-base px-6 py-4">
          <Dialog.Title className="text-base font-bold text-kumo-strong">アカウント編集</Dialog.Title>
          <Button type="button" size="xs" variant="ghost" icon={XIcon} aria-label="編集を閉じる" disabled={saving} onClick={onClose} />
        </div>

        <form onSubmit={handleSave} className="space-y-4 p-6">
          <Input label="アカウント名" value={state.name} onValueChange={(value) => update({ name: value })} required />

          <AccountFormSections
            state={state}
            update={update}
            showMessagingRequired={false}
            channelIdEditable={false}
            defaultOpen={{
              messaging: false,
              // Open Login/LIFF by default in edit mode if they're empty,
              // since "I want to fill these in" is the most common edit
              // intent now that they were previously SQL-only.
              login: !initialLoginChannelId,
              liff: !initialLiffId,
            }}
          />

          <AccountSetupUrls
            liffId={state.liffId.trim() || initialLiffId || null}
            heading="このアカで使う URL（LINE Developers Console に貼る）"
          />

          {error ? <Banner variant="error" title="保存できません" description={error} /> : null}

          <div className="flex justify-end gap-2 border-t border-kumo-line pt-4">
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>キャンセル</Button>
            <Button type="submit" variant="primary" loading={saving}>保存</Button>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  )
}
