import type { ApiBroadcast, ApiExternalCustomer, ApiExternalCustomerLink, ApiUserEvent } from '@/lib/api'

export type TabId = 'main' | 'messages' | 'calendar' | 'broadcast' | 'forms' | 'analytics'

export type ChatStatus = 'unread' | 'in_progress' | 'resolved'

export type ConsoleChat = {
  id: string
  friendId: string
  friendName: string
  friendPictureUrl: string | null
  status: ChatStatus
  notes: string | null
  lastMessageAt: string | null
  tags?: ConsoleTag[]
}

export type ConsoleMessage = {
  id: string
  content: string
  messageType?: string
  senderType?: string
  direction?: 'incoming' | 'outgoing'
  createdAt: string
}

export type ConsoleChatDetail = ConsoleChat & {
  messages?: ConsoleMessage[]
}

export type ConsoleTemplate = {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
}

export type ConsoleTag = {
  id: string
  name: string
  color?: string | null
  kind?: 'system' | 'custom'
  category?: string | null
  isLocked?: boolean
}

export type ConsoleFriend = {
  id: string
  displayName: string
  pictureUrl: string | null
  isFollowing?: boolean
  tags?: ConsoleTag[]
}

export type ConsoleForm = {
  id: string
  name: string
  submitCount?: number
}

export type ConsoleTrackedLink = {
  id: string
  name: string
  originalUrl: string
  trackingUrl: string
  clickCount: number
  isActive: boolean
}

export type ConsoleConversionReportItem = {
  conversionPointId: string
  conversionPointName: string
  eventType: string
  totalCount: number
  totalValue: number
}

export type LoadState = {
  loading: boolean
  error: string
}

export type BroadcastDraft = {
  title: string
  templateId: string
  targetType: 'all' | 'tag'
  targetTagId: string
}

export type FormDraft = {
  name: string
  description: string
  preset: 'inquiry' | 'trial' | 'questionnaire'
  onSubmitTagId: string
}

export type ExternalCustomerForm = {
  name: string
  phone: string
  email: string
  source: string
}

export type CsvImportState = {
  importing: boolean
  total: number
  imported: number
  failed: number
  message: string
}

export type {
  ApiBroadcast,
  ApiExternalCustomer,
  ApiExternalCustomerLink,
  ApiUserEvent,
}
