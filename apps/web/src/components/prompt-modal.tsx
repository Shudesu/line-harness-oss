'use client'

import { useState, useRef } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || ''

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
  const [aiAnswer, setAiAnswer] = useState<Record<number, string>>({})
  const [aiLoading, setAiLoading] = useState<Record<number, boolean>>({})
  const abortRefs = useRef<Record<number, AbortController>>({})

  if (!isOpen) return null

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    } catch {
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

  const handleAskAi = async (prompt: string, index: number) => {
    // 既に実行中なら中断
    if (abortRefs.current[index]) {
      abortRefs.current[index].abort()
    }
    const controller = new AbortController()
    abortRefs.current[index] = controller

    setAiAnswer((prev) => ({ ...prev, [index]: '' }))
    setAiLoading((prev) => ({ ...prev, [index]: true }))

    try {
      const res = await fetch(`${API_URL}/api/ai/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        setAiAnswer((prev) => ({ ...prev, [index]: 'エラーが発生しました。' }))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE の data: フィールドを解析
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') break
          try {
            const json = JSON.parse(data)
            // Anthropic SSE: content_block_delta
            if (json.type === 'content_block_delta' && json.delta?.text) {
              setAiAnswer((prev) => ({
                ...prev,
                [index]: (prev[index] ?? '') + json.delta.text,
              }))
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setAiAnswer((prev) => ({ ...prev, [index]: 'エラーが発生しました。' }))
      }
    } finally {
      setAiLoading((prev) => ({ ...prev, [index]: false }))
      delete abortRefs.current[index]
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-bold text-gray-900">AI アシスタント</h2>
          <button
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="閉じる"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Prompt List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {prompts.map((p, i) => (
            <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleExpand(i)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors min-h-[44px]"
              >
                <span className="text-sm font-medium text-gray-800">{p.title}</span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${expandedIndex === i ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expandedIndex === i && (
                <div className="px-4 pb-3 border-t border-gray-100">
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 rounded-md p-3 mt-2 max-h-32 overflow-y-auto">
                    {p.prompt}
                  </pre>

                  {/* Action buttons */}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(p.prompt, i)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors min-h-[36px]"
                      style={
                        copiedIndex === i
                          ? { backgroundColor: '#06C755', color: '#fff' }
                          : { backgroundColor: '#f3f4f6', color: '#374151' }
                      }
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
                    </button>

                    <button
                      onClick={() => handleAskAi(p.prompt, i)}
                      disabled={aiLoading[i]}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors min-h-[36px] disabled:opacity-60"
                      style={{ backgroundColor: '#1a1a2e', color: '#fff' }}
                    >
                      {aiLoading[i] ? (
                        <>
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                          分析中...
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                          AIに聞く
                        </>
                      )}
                    </button>
                  </div>

                  {/* AI streaming answer */}
                  {(aiAnswer[i] || aiLoading[i]) && (
                    <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 p-3">
                      <p className="text-xs font-semibold text-blue-700 mb-1">AI 回答</p>
                      <p className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">
                        {aiAnswer[i] || ''}
                        {aiLoading[i] && <span className="inline-block w-1.5 h-3.5 bg-blue-400 ml-0.5 animate-pulse rounded-sm" />}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200">
          <p className="text-xs text-gray-400">
            「AIに聞く」でCRMデータをもとにClaude AIが即時回答します
          </p>
        </div>
      </div>
    </div>
  )
}
