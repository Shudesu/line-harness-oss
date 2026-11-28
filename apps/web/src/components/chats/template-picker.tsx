'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { filterInsertableTemplates, type InsertableTemplate } from '@/lib/chat-templates'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'

/**
 * 個別チャットの返信欄の「テンプレートから挿入」。登録済みのテキストテンプレートを
 * 選ぶと本文を返信欄に入れるだけで、送信はしない (送る前にスタッフが書き換えられる)。
 * 一覧は初めて開いたときに1回だけ取得する。
 */
export default function TemplatePicker({
  disabled,
  onInsert,
}: {
  disabled?: boolean
  onInsert: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<InsertableTemplate[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open || templates !== null) return
    let cancelled = false
    setLoading(true)
    setError('')
    api.templates.list()
      .then((res) => {
        if (cancelled) return
        if (res.success) setTemplates(res.data)
        else setError('テンプレートを読み込めませんでした')
      })
      .catch(() => {
        if (!cancelled) setError('テンプレートを読み込めませんでした')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [open, templates])

  // 浮いたポップオーバーなので、外側クリックと Escape で閉じる (⚙ 送信設定と同じ)。
  // トグルボタン自身は除外する — ここで閉じると onClick のトグルが即座に開き直してしまう。
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (popoverRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  // 取得に失敗したときは templates が null のままなので、次に開いたときに取得し直す
  const toggle = () => {
    setOpen((value) => !value)
    setQuery('')
  }

  const handleSelect = (template: InsertableTemplate) => {
    setOpen(false)
    onInsert(template.messageContent)
  }

  const visible = templates ? filterInsertableTemplates(templates, query) : []

  return (
    <>
      <Button
        type="button"
        size="sm"
        shape="square"
        variant={open ? 'primary' : 'ghost'}
        ref={buttonRef}
        disabled={disabled}
        onClick={toggle}
        aria-expanded={open}
        title="テンプレートから挿入"
        aria-label="テンプレートから挿入"
      >
        <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </Button>
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="テンプレートから挿入"
          className="absolute bottom-full left-2 z-20 mb-1 w-80 max-w-[calc(100%-1rem)] rounded-lg border border-gray-200 bg-white p-3 shadow-lg space-y-2 text-xs text-gray-600"
        >
          <Input
            aria-label="テンプレートを検索"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前・本文で検索"
            autoFocus
          />
          {loading ? (
            <p className="py-4 text-center text-gray-400">読み込み中...</p>
          ) : error ? (
            <p className="py-4 text-center text-red-600">{error}</p>
          ) : visible.length === 0 ? (
            <p className="py-4 text-center text-gray-400">
              {query.trim() ? '一致するテンプレートがありません' : (
                <>
                  テキストのテンプレートがありません。
                  <Link href="/templates" className="text-green-600 hover:underline">テンプレート</Link>
                  で登録できます
                </>
              )}
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto -mx-1">
              {visible.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(template)}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium text-gray-900">{template.name}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-gray-400">{template.category}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-gray-500">{template.messageContent}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-gray-400">選ぶと返信欄に入ります (自動では送信しません)</p>
        </div>
      )}
    </>
  )
}
