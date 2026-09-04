'use client'

import { useState } from 'react'
import { Table } from '@cloudflare/kumo/components/table'

const fmt = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const ACCOUNT_BADGE_COLORS = [
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-slate-100 text-slate-700',
]

export interface UserRowData {
  identityKey: string
  identityKeyKind: 'url_token' | 'uid' | 'solo'
  displayName: string | null
  pictureUrl: string | null
  accounts: Array<{
    accountId: string
    accountName: string
    lineUserId: string
    isFollowing: boolean
    joinedAt: string
    friendId: string
  }>
  xUsername: string | null
  emails: string[]
  phones: string[]
  lastActivityAt: string
  isDuplicate: boolean
}

interface Props {
  row: UserRowData
  accountColorMap: Map<string, string>
}

export default function UserRow({ row, accountColorMap }: Props) {
  const [expanded, setExpanded] = useState(false)
  const idShort =
    row.identityKey.length > 12 ? `${row.identityKey.slice(0, 8)}...` : row.identityKey

  return (
    <>
      <Table.Row
        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
        onClick={() => setExpanded((v) => !v)}
      >
        <Table.Cell className="font-mono text-xs text-kumo-subtle">{idShort}</Table.Cell>
        <Table.Cell className="font-medium text-kumo-strong">
          {row.displayName || <span className="text-gray-400">—</span>}
        </Table.Cell>
        <Table.Cell>
          <div className="flex flex-wrap gap-1">
            {row.accounts.map((a) => {
              const color = accountColorMap.get(a.accountId) ?? ACCOUNT_BADGE_COLORS[0]
              return (
                <span
                  key={a.accountId}
                  title={a.accountName}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
                >
                  {a.accountName}
                </span>
              )
            })}
          </div>
        </Table.Cell>
        <Table.Cell className="text-kumo-subtle">
          {row.xUsername ? `@${row.xUsername}` : <span className="text-gray-300">—</span>}
        </Table.Cell>
        <Table.Cell className="text-kumo-subtle">
          {row.emails[0] ?? <span className="text-gray-300">—</span>}
          {row.emails.length > 1 ? (
            <span className="text-gray-400"> +{row.emails.length - 1}</span>
          ) : null}
        </Table.Cell>
        <Table.Cell className="text-kumo-subtle">
          {row.phones[0] ?? <span className="text-gray-300">—</span>}
          {row.phones.length > 1 ? (
            <span className="text-gray-400"> +{row.phones.length - 1}</span>
          ) : null}
        </Table.Cell>
      </Table.Row>
      {expanded && (
        <Table.Row className="bg-kumo-control">
          <Table.Cell colSpan={6} className="px-6 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-gray-500">登録アカウント詳細</p>
                <ul className="space-y-1 text-sm">
                  {row.accounts.map((a) => (
                    <li key={a.friendId} className="flex flex-wrap items-center gap-2 text-gray-700">
                      <span
                        className={`h-2 w-2 rounded-full ${a.isFollowing ? 'bg-emerald-500' : 'bg-gray-300'}`}
                      />
                      <span className="font-medium">{a.accountName}</span>
                      <span className="font-mono text-xs text-gray-400">{a.lineUserId}</span>
                      <span className="text-xs text-gray-400">
                        登録: {fmt.format(new Date(a.joinedAt))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2 text-sm">
                {row.emails.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500">メール（フォーム回答）</p>
                    <p className="text-gray-700">{row.emails.join(', ')}</p>
                  </div>
                )}
                {row.phones.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500">電話（フォーム回答）</p>
                    <p className="text-gray-700">{row.phones.join(', ')}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-gray-500">識別子</p>
                  <p className="break-all font-mono text-xs text-gray-500">
                    {row.identityKey}
                    <span className="ml-2 rounded bg-gray-200 px-1 text-[10px] text-gray-600">
                      {row.identityKeyKind}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </Table.Cell>
        </Table.Row>
      )}
    </>
  )
}
