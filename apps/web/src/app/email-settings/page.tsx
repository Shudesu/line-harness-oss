'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api, type ApiAccountSetting } from '@/lib/api'

export default function EmailSettingsPage() {
  const { selectedAccountId } = useAccount()
  const [settings, setSettings] = useState<ApiAccountSetting[]>([])
  const [form, setForm] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.accountSettings.getConfig({ accountId: selectedAccountId, category: 'email' })
      if (!res.success) {
        setError(res.error)
        return
      }
      setSettings(res.data)
      setForm(Object.fromEntries(res.data.map((item) => [item.key, item.secret ? '' : item.value])))
    } catch {
      setError('メール配信設定の読み込みに失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const values: Record<string, string> = {}
      for (const setting of settings) {
        const value = form[setting.key] ?? ''
        if (setting.secret && !value.trim()) continue
        values[setting.key] = value
      }
      const res = await api.accountSettings.updateConfig({ accountId: selectedAccountId, values })
      if (!res.success) {
        setError(res.error)
        return
      }
      setNotice('メール配信設定を保存しました。')
      await load()
    } catch {
      setError('メール配信設定の保存に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header title="メール配信設定" />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {notice}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-gray-900">Resend設定</h2>
          <p className="mt-1 text-xs text-gray-500">
            Web予約確認メールなどの送信に使います。APIキーは保存時に暗号化され、画面には表示されません。
          </p>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="animate-pulse space-y-2">
                <div className="h-3 w-40 rounded bg-gray-200" />
                <div className="h-10 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {settings.map((setting) => (
                <div key={setting.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {setting.label}
                    {setting.configured && (
                      <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-[11px] text-green-700">
                        設定済み{setting.encrypted ? '・暗号化' : ''}
                      </span>
                    )}
                  </label>
                  <input
                    value={form[setting.key] ?? ''}
                    onChange={(event) => setForm((current) => ({ ...current, [setting.key]: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder={setting.secret && setting.configured ? `${setting.value}（変更時だけ入力）` : ''}
                    type={setting.secret ? 'password' : 'text'}
                  />
                  <p className="mt-1 text-xs text-gray-400">{setting.description}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '保存中...' : 'メール設定を保存'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
