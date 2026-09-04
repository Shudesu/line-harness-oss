'use client'

import { useState, type ReactNode } from 'react'
import { Collapsible } from '@cloudflare/kumo/components/collapsible'
import { Input } from '@cloudflare/kumo/components/input'
import { SensitiveInput } from '@cloudflare/kumo/components/sensitive-input'
import OgEditor from '@/components/shared/og-editor'

// Shared form field building blocks for the LINE account create / edit flows.
// Kept as primitives (not a full form) so the create page (single submit) and
// the edit modal (partial PATCH) can share field rendering without forcing the
// same submit semantics.

export interface AccountFormState {
  name: string
  channelId: string
  channelAccessToken: string
  channelSecret: string
  loginChannelId: string
  loginChannelSecret: string
  liffId: string
  // OGP brand settings (optional — only present/sent when the user edits them)
  ogSiteName: string | null
  ogDefaultDescription: string | null
  ogDefaultImageUrl: string | null
}

export const emptyAccountFormState: AccountFormState = {
  name: '',
  channelId: '',
  channelAccessToken: '',
  channelSecret: '',
  loginChannelId: '',
  loginChannelSecret: '',
  liffId: '',
  ogSiteName: null,
  ogDefaultDescription: null,
  ogDefaultImageUrl: null,
}

// Section: collapsible group of fields. Future "Provider" / "Rich Menu Default"
// sections can be added without touching the page layout, just by rendering
// another <FormSection>.
export function FormSection({
  title,
  description,
  defaultOpen = true,
  children,
}: {
  title: string
  description?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="overflow-hidden rounded-lg border border-kumo-line">
      <Collapsible.DefaultTrigger className="w-full px-4 py-3 text-left">
        <div>
          <p className="text-sm font-semibold text-kumo-strong">{title}</p>
          {description ? <p className="mt-0.5 text-xs text-kumo-subtle">{description}</p> : null}
        </div>
      </Collapsible.DefaultTrigger>
      <Collapsible.DefaultPanel className="space-y-3 p-4">{children}</Collapsible.DefaultPanel>
    </Collapsible.Root>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = 'text',
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  type?: 'text' | 'password'
  hint?: string
}) {
  return type === 'password' ? (
    <SensitiveInput
      label={label}
      value={value}
      onValueChange={onChange}
      placeholder={placeholder}
      required={required}
      description={hint}
    />
  ) : (
      <Input
        label={label}
        value={value}
        onValueChange={onChange}
        placeholder={placeholder}
        required={required}
        description={hint}
      />
  )
}

// Renders the three sections used by both create and edit. Caller provides
// state + setter; this component is presentation-only.
export function AccountFormSections({
  state,
  update,
  showMessagingRequired,
  channelIdEditable = true,
  defaultOpen,
}: {
  state: AccountFormState
  update: (partial: Partial<AccountFormState>) => void
  // create form: messaging fields are required (new account needs them).
  // edit modal: not required (user may only be editing Login/LIFF; passing
  // empty messaging fields means "leave unchanged").
  showMessagingRequired: boolean
  // Channel ID is the immutable identifier of a Messaging API channel on
  // LINE's side — it's never re-issued for the same official account, and
  // the worker has no UPDATE path for `channel_id`. Render it read-only on
  // edit so users don't think they can fix a typo here (they'd need to
  // delete + recreate the row to change Channel ID).
  channelIdEditable?: boolean
  defaultOpen?: { messaging?: boolean; login?: boolean; liff?: boolean; ogp?: boolean }
}) {
  return (
    <div className="space-y-3">
      <FormSection
        title="Messaging API"
        description="LINE 公式アカウント本体の送信用設定（必須）"
        defaultOpen={defaultOpen?.messaging ?? true}
      >
        {channelIdEditable ? (
          <TextField
            label="Channel ID"
            value={state.channelId}
            onChange={(v) => update({ channelId: v })}
            placeholder="123456789"
            required={showMessagingRequired}
          />
        ) : (
          <Input
            label="Channel ID"
            value={state.channelId}
            disabled
            readOnly
            className="font-mono"
            description="Channel IDは変更できません（LINE側で固定の識別子）"
          />
        )}
        <TextField
          label="Channel Access Token"
          value={state.channelAccessToken}
          onChange={(v) => update({ channelAccessToken: v })}
          required={showMessagingRequired}
          type="password"
          hint={
            showMessagingRequired
              ? undefined
              : '空欄なら現在の値を維持。再発行した場合のみ入力'
          }
        />
        <TextField
          label="Channel Secret"
          value={state.channelSecret}
          onChange={(v) => update({ channelSecret: v })}
          required={showMessagingRequired}
          type="password"
          hint={showMessagingRequired ? undefined : '空欄なら現在の値を維持'}
        />
      </FormSection>

      <FormSection
        title="LINE Login（任意）"
        description="友だち追加 OAuth 導線で使う。後から追加可"
        defaultOpen={defaultOpen?.login ?? false}
      >
        <TextField
          label="Login Channel ID"
          value={state.loginChannelId}
          onChange={(v) => update({ loginChannelId: v })}
          placeholder="2009624792"
          hint="LINE Developers > Login channel > Channel ID"
        />
        <TextField
          label="Login Channel Secret"
          value={state.loginChannelSecret}
          onChange={(v) => update({ loginChannelSecret: v })}
          type="password"
        />
      </FormSection>

      <FormSection
        title="LIFF（任意）"
        description="LIFF page を開くときの ?liffId= で識別。後から追加可"
        defaultOpen={defaultOpen?.liff ?? false}
      >
        <TextField
          label="LIFF ID"
          value={state.liffId}
          onChange={(v) => update({ liffId: v })}
          placeholder="2009624792-XXXXXXXX"
          hint="LINE Developers > Login channel > LIFF タブで作成したものの ID"
        />
      </FormSection>

      <FormSection
        title="ブランド設定（OGP）"
        description="LINE / X / Facebook のリンクプレビューに使うブランド情報"
        defaultOpen={defaultOpen?.ogp ?? false}
      >
        <Input
          label="サイト名（og:site_name）"
          value={state.ogSiteName ?? ''}
          placeholder={`空欄なら「${state.name || 'アカウント名'}」を使用`}
          onValueChange={(value) => update({ ogSiteName: value || null })}
          description="リンクプレビューでブランド名として表示されます。"
        />
        <OgEditor
          hideTitle
          value={{
            ogTitle: null,
            ogDescription: state.ogDefaultDescription,
            ogImageUrl: state.ogDefaultImageUrl,
          }}
          onChange={(v) =>
            update({
              ogDefaultDescription: v.ogDescription,
              ogDefaultImageUrl: v.ogImageUrl,
            })
          }
        />
      </FormSection>
    </div>
  )
}
