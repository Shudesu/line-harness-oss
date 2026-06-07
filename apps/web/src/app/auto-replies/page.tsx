'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import EditDialog, { type AutoReplyDraft } from '@/components/auto-replies/edit-dialog'
import { Badge, Banner, Button, Card } from '@/components/ui/primitives'

interface EffectiveAccount {
  accountId: string
  accountName: string
  status: 'reply' | 'silent' | 'not_applicable'
  via: 'inline' | 'automation' | null
}

interface AutoReply {
  id: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
  createdAt: string
  effectiveAccounts?: EffectiveAccount[]
}

interface TemplateLite {
  id: string
  name: string
  messageType: string
  messageContent: string
}

const matchTypeLabel: Record<'exact' | 'contains', string> = { exact: '完全一致', contains: '包含' }

export default function AutoRepliesPage() {
  const { selectedAccountId, accounts } = useAccount()
  const [items, setItems] = useState<AutoReply[]>([])
  const [templates, setTemplates] = useState<TemplateLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AutoReplyDraft | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [arRes, tplRes] = await Promise.all([
        api.autoReplies.list({ accountId: selectedAccountId || undefined }),
        api.templates.list(),
      ])
      if (arRes.success) setItems(arRes.data)
      if (tplRes.success) setTemplates(tplRes.data.map((t) => ({
        id: t.id,
        name: t.name,
        messageType: t.messageType,
        messageContent: t.messageContent,
      })))
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { load() }, [load])

  const templateById = new Map(templates.map((t) => [t.id, t]))
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  const renderEffectiveCell = (r: AutoReply) => {
    if (!r.effectiveAccounts || r.effectiveAccounts.length === 0) {
      // 古い shape の fallback (effectiveAccounts 計算前)
      if (!r.lineAccountId) return <span className="text-gray-400 italic">全アカウント</span>
      const acc = accountById.get(r.lineAccountId)
      return <span className="text-gray-700">{acc?.displayName ?? acc?.name ?? r.lineAccountId.slice(0, 8)}</span>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {r.effectiveAccounts.map((ea) => {
          const acc = accountById.get(ea.accountId)
          const label = acc?.displayName ?? acc?.name ?? ea.accountName
          if (ea.status === 'not_applicable') {
            return (
              <Badge
                key={ea.accountId}
                tone="neutral"
                className="line-through opacity-60"
                title={`${label}: 適用外 (line_account_id 別アカ固定)`}
              >
                {label}
              </Badge>
            )
          }
          if (ea.status === 'reply') {
            return (
              <Badge
                key={ea.accountId}
                tone="success"
                title={`${label}: 返信あり (${ea.via === 'automation' ? 'automation 経由' : 'inline'})`}
              >
                ✓ {label}{ea.via === 'automation' && <span className="text-emerald-500">⚙</span>}
              </Badge>
            )
          }
          // silent
          return (
            <Badge
              key={ea.accountId}
              tone="warning"
              title={`${label}: silent (match するが返信なし — automation rule 未登録)`}
            >
              ⚠ {label}
            </Badge>
          )
        })}
      </div>
    )
  }

  const renderResponseCell = (r: AutoReply) => {
    if (r.responseType === 'silent') return <span className="text-gray-400 text-xs">silent</span>
    if (r.responseType === 'flex') return <Badge tone="info">📋 flex</Badge>
    if (r.responseType === 'image') return <Badge tone="default">🖼️ image</Badge>
    return <Badge tone="neutral">📝 text</Badge>
  }

  const renderTemplateCell = (r: AutoReply) => {
    if (!r.templateId) return <span className="text-[11px] text-gray-400 italic">(inline)</span>
    const tpl = templateById.get(r.templateId)
    return (
      <a href="/templates" className="text-blue-600 hover:underline text-xs">
        🔗 {tpl?.name ?? `(未知 ${r.templateId.slice(0, 6)})`}
      </a>
    )
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このルールを削除しますか？')) return
    try {
      await api.autoReplies.delete(id)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="自動返信ルール"
        action={
          <Button
            onClick={() => setEditing({
              keyword: '',
              matchType: 'exact',
              responseType: 'text',
              responseContent: '',
              templateId: null,
              lineAccountId: selectedAccountId,
              isActive: true,
            })}
            className="bg-[#06C755] hover:bg-[#05b34c] focus-visible:ring-[#06C755]"
          >
            + 新規ルール
          </Button>
        }
      />

      {error && (
        <Banner tone="danger" className="mb-4">
          {error}
        </Banner>
      )}

      <Banner tone="info" className="mb-4 space-y-1 text-xs">
        <p><Badge tone="success">✓ アカ名</Badge> 返信あり (inline) / <Badge tone="success">✓ アカ名 ⚙</Badge> automation 経由</p>
        <p><Badge tone="warning">⚠ アカ名</Badge> silent rule のみ — match するが返信しない (同 keyword の automation rule 未登録)</p>
        <p><Badge tone="neutral" className="line-through opacity-60">アカ名</Badge> 適用外 (line_account_id が別アカに固定)</p>
      </Banner>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">keyword</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">match</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">response</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">template</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">適用アカウント</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">状態</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">読み込み中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">自動返信ルールがありません</td></tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.keyword}</td>
                    <td className="px-4 py-3">
                      <Badge tone="info">{matchTypeLabel[r.matchType]}</Badge>
                    </td>
                    <td className="px-4 py-3">{renderResponseCell(r)}</td>
                    <td className="px-4 py-3">{renderTemplateCell(r)}</td>
                    <td className="px-4 py-3">{renderEffectiveCell(r)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={r.isActive ? 'success' : 'neutral'}>
                        {r.isActive ? '有効' : '無効'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing({
                          id: r.id,
                          keyword: r.keyword,
                          matchType: r.matchType,
                          responseType: r.responseType,
                          responseContent: r.responseContent,
                          templateId: r.templateId,
                          lineAccountId: r.lineAccountId,
                          isActive: r.isActive,
                        })}
                        className="text-blue-600 hover:bg-blue-50"
                      >
                        編集
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(r.id)}
                        className="ml-1 text-red-500 hover:bg-red-50"
                      >
                        削除
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <EditDialog
          draft={editing}
          templates={templates}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
