import type { ChatStatus, ConsoleMessage, ConsoleTemplate, TabId } from './types'

export const tabs: { id: TabId; label: string; description: string }[] = [
  { id: 'main', label: 'メイン', description: '今日見るべき状況' },
  { id: 'messages', label: 'メッセージ', description: '顧客対応とチャット' },
  { id: 'calendar', label: '予約', description: '予約カレンダー' },
  { id: 'broadcast', label: '配信', description: 'テンプレート配信' },
  { id: 'forms', label: 'フォーム', description: '受付と集計' },
  { id: 'analytics', label: '分析', description: '流入と成果' },
]

export const statusLabel: Record<ChatStatus, string> = {
  unread: '未読',
  in_progress: '対応中',
  resolved: '解決済',
}

export const statusClass: Record<ChatStatus, string> = {
  unread: 'bg-red-50 text-red-700 border-red-100',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-100',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-100',
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function shortText(value: string, max = 80) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max)}...`
}

export function renderMessageSender(message: ConsoleMessage) {
  if (message.direction) return message.direction === 'outgoing' ? 'こちら' : 'お客様'
  if (message.senderType) return message.senderType === 'operator' ? 'こちら' : 'お客様'
  return '不明'
}

export function normalizeTemplatePreview(template: ConsoleTemplate) {
  if (template.messageType === 'text') return shortText(template.messageContent, 120)
  if (template.messageType === 'flex') return 'Flexメッセージ'
  if (template.messageType === 'image') return '画像メッセージ'
  return template.messageType
}

export function buildFormPresetFields(preset: 'inquiry' | 'trial' | 'questionnaire') {
  const base = [
    { name: 'name', label: 'お名前', type: 'text', required: true },
    { name: 'phone', label: '電話番号', type: 'phone', required: true },
    { name: 'email', label: 'メールアドレス', type: 'email', required: false },
  ]
  if (preset === 'trial') {
    return [
      ...base,
      { name: 'preferred_date', label: '希望日', type: 'text', required: false },
      { name: 'interest', label: '体験したい内容', type: 'textarea', required: false },
      { name: 'memo', label: 'ご相談内容', type: 'textarea', required: false },
    ]
  }
  if (preset === 'questionnaire') {
    return [
      ...base,
      { name: 'purpose', label: '来店目的', type: 'textarea', required: false },
      { name: 'concern', label: 'お悩み', type: 'textarea', required: false },
      { name: 'memo', label: 'その他', type: 'textarea', required: false },
    ]
  }
  return [
    ...base,
    { name: 'message', label: 'お問い合わせ内容', type: 'textarea', required: true },
  ]
}
