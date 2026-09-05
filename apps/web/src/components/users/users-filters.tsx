'use client'

import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Input } from '@cloudflare/kumo/components/input'
import { Select } from '@cloudflare/kumo/components/select'

interface AccountOption {
  id: string
  name: string
}

interface Props {
  q: string
  onlyDups: boolean
  account: string
  accountOptions: AccountOption[]
  onChange: (next: { q?: string; onlyDups?: boolean; account?: string }) => void
}

export default function UsersFilters({
  q,
  onlyDups,
  account,
  accountOptions,
  onChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <Input
        type="search"
        value={q}
        onChange={(e) => onChange({ q: e.target.value })}
        placeholder="名前・X・メール・電話・LINE ID で検索"
        aria-label="ユーザー検索"
        className="min-w-[240px] flex-1"
      />
      <Checkbox label="重複のみ" checked={onlyDups} onCheckedChange={(checked) => onChange({ onlyDups: checked })} />
      <Select
        value={account}
        onValueChange={(value) => onChange({ account: value ?? '' })}
        aria-label="LINEアカウント"
        items={[{ value: '', label: '全アカウント' }, ...accountOptions.map((option) => ({ value: option.id, label: option.name }))]}
      />
    </div>
  )
}
