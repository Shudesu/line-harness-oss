'use client'

import UserRow, { type UserRowData } from './user-row'
import { Button } from '@cloudflare/kumo/components/button'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Table } from '@cloudflare/kumo/components/table'

const fmt = new Intl.NumberFormat('ja-JP')

const ACCOUNT_BADGE_COLORS = [
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-slate-100 text-slate-700',
]

interface Props {
  rows: UserRowData[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  onPageChange: (page: number) => void
}

export default function UsersTable({
  rows,
  total,
  page,
  pageSize,
  loading,
  onPageChange,
}: Props) {
  const accountColorMap = new Map<string, string>()
  for (const row of rows) {
    for (const a of row.accounts) {
      if (!accountColorMap.has(a.accountId)) {
        accountColorMap.set(
          a.accountId,
          ACCOUNT_BADGE_COLORS[accountColorMap.size % ACCOUNT_BADGE_COLORS.length],
        )
      }
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)

  return (
    <LayerCard className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <Table className="min-w-full">
          <Table.Header>
            <Table.Row>
              <Table.Head>識別子</Table.Head>
              <Table.Head>表示名</Table.Head>
              <Table.Head>登録アカウント</Table.Head>
              <Table.Head>X</Table.Head>
              <Table.Head>メール</Table.Head>
              <Table.Head>電話</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 && !loading ? (
              <Table.Row>
                <Table.Cell colSpan={6} className="py-8 text-center text-kumo-subtle">
                  該当ユーザーがいません
                </Table.Cell>
              </Table.Row>
            ) : (
              rows.map((row) => (
                <UserRow key={row.identityKey} row={row} accountColorMap={accountColorMap} />
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
        <span>
          {fmt.format(total)} 件中 {fmt.format(start)}–{fmt.format(end)} 件
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            size="xs"
            variant="secondary"
          >
            前へ
          </Button>
          <span className="tabular-nums text-xs text-gray-500">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || loading}
            size="xs"
            variant="secondary"
          >
            次へ
          </Button>
        </div>
      </div>
    </LayerCard>
  )
}
