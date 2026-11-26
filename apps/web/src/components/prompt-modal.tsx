'use client'

import { useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'

export interface PromptTemplate {
  title: string
  prompt: string
}

interface PromptModalProps {
  isOpen: boolean
  onClose: () => void
  prompts: PromptTemplate[]
}

export default function PromptModal({ isOpen, onClose, prompts }: PromptModalProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  if (!isOpen) return null

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    }
  }

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index)
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog className="w-full max-w-lg max-h-[80vh] flex flex-col p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <Dialog.Title className="text-base font-bold text-kumo-strong">CC プロンプトテンプレート</Dialog.Title>
          <Button
            type="button"
            onClick={onClose}
            size="xs"
            shape="square"
            variant="ghost"
            aria-label="閉じる"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {/* Prompt List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {prompts.map((p, i) => (
            <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
              <Button
                type="button"
                onClick={() => toggleExpand(i)}
                className="w-full justify-between"
                variant="ghost"
              >
                <span className="text-sm font-medium text-gray-800">{p.title}</span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${expandedIndex === i ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </Button>

              {expandedIndex === i && (
                <div className="px-4 pb-3 border-t border-gray-100">
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 rounded-md p-3 mt-2 max-h-48 overflow-y-auto">
                    {p.prompt}
                  </pre>
                  <Button
                    type="button"
                    onClick={() => handleCopy(p.prompt, i)}
                    className="mt-2"
                    size="sm"
                    variant={copiedIndex === i ? 'primary' : 'secondary'}
                  >
                    {copiedIndex === i ? (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        コピーしました
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        コピー
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200">
          <p className="text-xs text-gray-400">Claude Code にプロンプトを貼り付けて使用してください</p>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
