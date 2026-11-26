'use client'

import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Select } from '@cloudflare/kumo/components/select'

interface AccountOption {
  id: string
  name: string
}

interface Props {
  q: string
  account: string
  overdueOnly: boolean
  accountOptions: AccountOption[]
  onChange: (next: { q?: string; account?: string; overdueOnly?: boolean }) => void
}

export default function InboxFilters({
  q,
  account,
  overdueOnly,
  accountOptions,
  onChange,
}: Props) {
  return (
    <LayerCard className="flex flex-wrap items-end gap-3 p-4">
      <Input
        type="search"
        value={q}
        onChange={(e) => onChange({ q: e.target.value })}
        placeholder="名前で検索"
        aria-label="友だち名"
        className="min-w-[240px] flex-1"
      />
      <Checkbox
        label="1時間以上のみ"
        checked={overdueOnly}
        onCheckedChange={(checked) => onChange({ overdueOnly: checked })}
      />
      <Select
        aria-label="LINEアカウント"
        value={account}
        onValueChange={(value) => onChange({ account: value ?? '' })}
        items={[{ value: '', label: '全アカウント' }, ...accountOptions.map((item) => ({ value: item.id, label: item.name }))]}
      />
    </LayerCard>
  )
}
