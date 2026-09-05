'use client'

import { useState } from 'react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { Select } from '@cloudflare/kumo/components/select'
import { api } from '@/lib/api'
import { COUNTRY_OPTIONS, countryFlag } from '@/lib/country-flag'

interface Props {
  accountId: string
  initialCountry: string | null
  initialRole: string | null
  onUpdated: () => void
}

export default function AccountSettingsSection({
  accountId, initialCountry, initialRole, onUpdated,
}: Props) {
  const isPredefined = initialCountry === null
    || (COUNTRY_OPTIONS as readonly string[]).slice(0, -1).includes(initialCountry)
  const [select, setSelect] = useState<string>(
    initialCountry === null
      ? ''
      : isPredefined ? initialCountry : 'その他',
  )
  const [other, setOther] = useState<string>(
    isPredefined ? '' : (initialCountry ?? ''),
  )
  const [role, setRole] = useState<string>(initialRole ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const computedCountry = (): string | null => {
    if (select === '') return null
    if (select === 'その他') {
      const t = other.trim()
      return t === '' ? null : t
    }
    return select
  }

  const handleSave = async () => {
    setSaving(true); setError('')
    try {
      const res = await api.lineAccounts.update(accountId, {
        country: computedCountry(),
        role: role.trim() === '' ? null : role.trim(),
      })
      if (res.success) onUpdated()
      else setError(res.error || '保存に失敗しました')
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-kumo-line pt-3">
      <p className="text-xs font-medium text-kumo-default">アカウント設定</p>

      <div className="flex items-end gap-2">
          <Select
            className="min-w-0 flex-1"
            label="国/地域"
            value={select || '__unset__'}
            onValueChange={(value) => setSelect(value === '__unset__' || value === null ? '' : value)}
            items={[
              { value: '__unset__', label: '未設定' },
              ...COUNTRY_OPTIONS.map((country) => ({ value: country, label: `${country} ${countryFlag(country)}` })),
            ]}
          />
          {select === 'その他' ? (
            <Input
              className="min-w-0 flex-1"
              label="国・地域名"
              value={other}
              onValueChange={setOther}
              placeholder="例: インドネシア"
            />
          ) : null}
          {countryFlag(computedCountry()) ? <span className="pb-2 text-base">{countryFlag(computedCountry())}</span> : null}
      </div>

      <Input label="役割" value={role} onValueChange={setRole} placeholder="本店 / プロモ / 実験 など" />

      {error ? <Banner variant="error" title="保存できません" description={error} /> : null}

      <Button type="button" size="sm" variant="secondary" loading={saving} onClick={() => void handleSave()}>設定を保存</Button>
    </div>
  )
}
