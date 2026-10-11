'use client'

import { useCallback, useEffect, useState } from 'react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { LANDING_TEXT_KEYS, type LandingTextKey, type LandingTexts } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'

const FIELDS: { key: LandingTextKey; label: string; help: string; multiline?: boolean }[] = [
  { key: 'qrHeading', label: '見出し（パソコン）', help: 'QR コードの上に表示します。' },
  { key: 'qrHint', label: '読み取り方法の案内（パソコン）', help: 'QR コードの下に表示します。改行できます。', multiline: true },
  { key: 'qrFooter', label: '補足（パソコン）', help: 'ページの最下部に小さく表示します。' },
  { key: 'mobileHeading', label: '見出し（スマートフォン）', help: '「LINEで開く」ボタンの上に表示します。' },
]
const emptyTexts = (): Record<LandingTextKey, string> => ({
  qrHeading: '', qrHint: '', qrFooter: '', mobileHeading: '',
})

// A failed read must never become an editable empty form: saving that would
// replace every stored override with the defaults we did not actually load.
type LoadState = 'pending' | 'loaded' | 'failed'

export default function LandingTextsSetting() {
  const [values, setValues] = useState(emptyTexts)
  const [defaults, setDefaults] = useState(emptyTexts)
  const [maxLength, setMaxLength] = useState(200)
  const [loadState, setLoadState] = useState<LoadState>('pending')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoadState('pending')
    try {
      const res = await api.accountSettings.getLandingTexts()
      if (!res.success) {
        setLoadState('failed')
        return
      }
      const next = emptyTexts()
      for (const key of LANDING_TEXT_KEYS) next[key] = res.data.stored[key] ?? res.data.defaults[key]
      setValues(next)
      setDefaults(res.data.defaults)
      setMaxLength(res.data.maxLength)
      setLoadState('loaded')
    } catch {
      setLoadState('failed')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const change = (key: LandingTextKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
    setError('')
  }

  const handleSave = async () => {
    if (loadState !== 'loaded' || saving) return
    setSaving(true)
    setError('')
    setSaved(false)
    const normalized = emptyTexts()
    const value: LandingTexts = {}
    for (const key of LANDING_TEXT_KEYS) {
      normalized[key] = values[key].trim() === '' ? '' : values[key]
      // Omission follows future defaults; an explicit empty value hides a line.
      if (normalized[key] !== defaults[key]) value[key] = normalized[key]
    }
    try {
      const res = await api.accountSettings.updateLandingTexts(value)
      if (res.success) {
        setValues(normalized)
        setSaved(true)
      } else {
        setError(res.error ?? '保存に失敗しました')
      }
    } catch (err) {
      setError(err instanceof ApiError && err.detail ? err.detail : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <LayerCard className="mb-6 p-6">
      <h3 className="mb-1 text-sm font-semibold text-kumo-strong">案内ページの文言（全アカウント共通）</h3>
      <p className="mb-4 text-xs leading-5 text-kumo-subtle">
        流入リンク・友だち追加リンク・OpenChat や Instagram のDM向けリンクを開いたときの案内です。
        空欄にするとその行を表示しません。変更後に「保存」を押してください。
      </p>
      {loadState === 'pending' ? (
        <span className="inline-flex items-center gap-2 text-xs text-kumo-subtle"><Loader size="sm" /> 設定を読み込み中</span>
      ) : loadState === 'failed' ? (
        <>
          <Banner variant="error" title="設定を読み込めませんでした" description="再読み込みしてから変更してください。" />
          <Button type="button" variant="secondary" className="mt-3" onClick={() => void load()}>再読み込み</Button>
        </>
      ) : (
        <>
          <fieldset disabled={saving} className="space-y-4">
            {FIELDS.map(({ key, label, help, multiline }) => {
              const fieldProps = {
                id: `landing-${key}`,
                value: values[key],
                maxLength,
                placeholder: '空欄で非表示',
                onValueChange: (value: string) => change(key, value),
                'aria-describedby': `landing-${key}-help`,
                className: 'w-full',
              }
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between gap-4">
                    <label htmlFor={fieldProps.id} className="text-xs font-semibold text-kumo-strong">{label}</label>
                    <Button type="button" variant="ghost" size="xs" disabled={saving || values[key] === defaults[key]} onClick={() => change(key, defaults[key])}>
                      既定に戻す
                    </Button>
                  </div>
                  <p id={fieldProps['aria-describedby']} className="mb-1.5 text-xs text-kumo-subtle">{help}</p>
                  {multiline ? <InputArea {...fieldProps} rows={2} /> : <Input {...fieldProps} type="text" />}
                </div>
              )
            })}
          </fieldset>
          {error ? <Banner className="mt-3" variant="error" title="保存できません" description={error} /> : null}
          {saved ? <p role="status" className="mt-3 text-xs text-kumo-success">保存しました</p> : null}
          <Button type="button" variant="secondary" className="mt-4" loading={saving} disabled={saving} onClick={() => void handleSave()}>保存</Button>
        </>
      )}
    </LayerCard>
  )
}
