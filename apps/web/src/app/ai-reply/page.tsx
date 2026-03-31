'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { AiReplyConfig, AiReplyQueueEntry } from '@/lib/api'
import Header from '@/components/layout/header'

const MODEL_OPTIONS = [
  { value: 'claude-haiku', label: 'Claude Haiku (高速・低コスト)' },
  { value: 'claude-sonnet', label: 'Claude Sonnet (バランス型)' },
  { value: 'claude-opus', label: 'Claude Opus (高精度)' },
]

export default function AiReplyPage() {
  const [config, setConfig] = useState<AiReplyConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form state
  const [isEnabled, setIsEnabled] = useState(false)
  const [aiModel, setAiModel] = useState('claude-haiku')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [delayMin, setDelayMin] = useState(10)
  const [delayMax, setDelayMax] = useState(30)
  const [maxContext, setMaxContext] = useState(20)
  const [maxTokens, setMaxTokens] = useState(500)

  // Queue
  const [queue, setQueue] = useState<AiReplyQueueEntry[]>([])
  const [queueLoading, setQueueLoading] = useState(false)

  // Test
  const [testMessage, setTestMessage] = useState('')
  const [testResponse, setTestResponse] = useState('')
  const [testing, setTesting] = useState(false)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.aiReply.getConfig()
      if (res.success && res.data) {
        setConfig(res.data)
        setIsEnabled(res.data.isEnabled)
        setAiModel(res.data.aiModel)
        setSystemPrompt(res.data.systemPrompt)
        setDelayMin(res.data.delayMinMinutes)
        setDelayMax(res.data.delayMaxMinutes)
        setMaxContext(res.data.maxContextMessages)
        setMaxTokens(res.data.maxTokens)
      }
    } catch {
      setError('設定の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadQueue = useCallback(async () => {
    setQueueLoading(true)
    try {
      const res = await api.aiReply.getQueue({ limit: 20 })
      if (res.success) {
        setQueue(res.data)
      }
    } catch {
      // silent
    } finally {
      setQueueLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
    loadQueue()
  }, [loadConfig, loadQueue])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.aiReply.updateConfig({
        isEnabled,
        aiModel,
        systemPrompt,
        delayMinMinutes: delayMin,
        delayMaxMinutes: delayMax,
        maxContextMessages: maxContext,
        maxTokens,
      })
      if (res.success) {
        setConfig(res.data)
        setSuccess('設定を保存しました')
        setTimeout(() => setSuccess(''), 3000)
      } else {
        setError('保存に失敗しました')
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async () => {
    const newState = !isEnabled
    setIsEnabled(newState)
    setSaving(true)
    try {
      await api.aiReply.updateConfig({ isEnabled: newState })
      setSuccess(newState ? 'AI自動返信を有効にしました' : 'AI自動返信を無効にしました')
      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setIsEnabled(!newState)
      setError('切り替えに失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!testMessage.trim()) return
    setTesting(true)
    setTestResponse('')
    try {
      const res = await api.aiReply.test({ message: testMessage })
      if (res.success) {
        setTestResponse(res.data.response)
      } else {
        setTestResponse('エラー: ' + (res as { error?: string }).error)
      }
    } catch {
      setTestResponse('テストに失敗しました')
    } finally {
      setTesting(false)
    }
  }

  const handleCancelQueue = async (id: string) => {
    try {
      await api.aiReply.cancelQueue(id)
      setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: 'cancelled' } : q)))
    } catch {
      // silent
    }
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case 'pending': return { text: '送信待ち', color: 'bg-yellow-100 text-yellow-700' }
      case 'sent': return { text: '送信済み', color: 'bg-green-100 text-green-700' }
      case 'failed': return { text: '失敗', color: 'bg-red-100 text-red-700' }
      case 'cancelled': return { text: 'キャンセル', color: 'bg-gray-100 text-gray-500' }
      default: return { text: status, color: 'bg-gray-100 text-gray-500' }
    }
  }

  if (loading) {
    return (
      <div>
        <Header title="AI自動返信" description="AIが友だちのメッセージに自動で返信します" />
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="h-3 bg-gray-100 rounded w-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header title="AI自動返信" description="AIが友だちのメッセージに自動で返信します" />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {success}
        </div>
      )}

      {/* 有効/無効トグル */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">AI自動返信</h3>
            <p className="text-xs text-gray-500 mt-1">
              有効にすると、キーワード自動応答にマッチしなかったメッセージにAIが自動で返信します
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              isEnabled ? 'bg-green-500' : 'bg-gray-300'
            }`}
            title={isEnabled ? '有効 - クリックで無効化' : '無効 - クリックで有効化'}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                isEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 設定フォーム */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">設定</h3>
        <div className="space-y-5">
          {/* AIモデル */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">AIモデル</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* システムプロンプト */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">システムプロンプト</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y font-mono"
              rows={6}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="AIの性格や返信スタイルを指示するプロンプトを入力..."
            />
            <p className="text-xs text-gray-400 mt-1">AIがどのような返信をするかを制御します。例: 「あなたはフレンドリーなショップスタッフです。」</p>
          </div>

          {/* 遅延設定 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">最小遅延（分）</label>
              <input
                type="number"
                min={1}
                max={120}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={delayMin}
                onChange={(e) => setDelayMin(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">最大遅延（分）</label>
              <input
                type="number"
                min={1}
                max={120}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={delayMax}
                onChange={(e) => setDelayMax(Number(e.target.value))}
              />
            </div>
          </div>
          <p className="text-xs text-gray-400 -mt-3">即返信だとBot感が出るため、ランダムな遅延を入れて人間らしく見せます</p>

          {/* 詳細設定 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">会話コンテキスト件数</label>
              <input
                type="number"
                min={1}
                max={50}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={maxContext}
                onChange={(e) => setMaxContext(Number(e.target.value))}
              />
              <p className="text-xs text-gray-400 mt-1">直近何件の会話をAIに渡すか</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">最大トークン数</label>
              <input
                type="number"
                min={50}
                max={4096}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
              />
              <p className="text-xs text-gray-400 mt-1">AI返信の最大長</p>
            </div>
          </div>

          {/* 保存ボタン */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>
        </div>
      </div>

      {/* テスト送信 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">テスト</h3>
        <p className="text-xs text-gray-500 mb-3">AIの返信をプレビューします（実際には送信されません）</p>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="テストメッセージを入力..."
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTest() }}
          />
          <button
            onClick={handleTest}
            disabled={testing || !testMessage.trim()}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {testing ? '生成中...' : 'テスト'}
          </button>
        </div>
        {testResponse && (
          <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-xs font-medium text-gray-500 mb-1">AI返信プレビュー:</p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{testResponse}</p>
          </div>
        )}
      </div>

      {/* 送信キュー */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">送信キュー</h3>
          <button
            onClick={loadQueue}
            disabled={queueLoading}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            {queueLoading ? '読み込み中...' : '更新'}
          </button>
        </div>

        {queue.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">キューにエントリーがありません</p>
        ) : (
          <div className="space-y-3">
            {queue.map((entry) => {
              const st = statusLabel(entry.status)
              return (
                <div key={entry.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>
                          {st.text}
                        </span>
                        <span className="text-xs text-gray-400">
                          {entry.scheduledSendAt ? new Date(entry.scheduledSendAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : ''}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">受信: {entry.incomingMessage}</p>
                      <p className="text-sm text-gray-800 mt-1 line-clamp-2">{entry.aiResponse}</p>
                      {entry.errorMessage && (
                        <p className="text-xs text-red-500 mt-1">{entry.errorMessage}</p>
                      )}
                    </div>
                    {entry.status === 'pending' && (
                      <button
                        onClick={() => handleCancelQueue(entry.id)}
                        className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap"
                      >
                        キャンセル
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
