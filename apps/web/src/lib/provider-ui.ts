import type { ApiProviderConfig } from './api'

export type ReservationCardForm = {
  title: string
  body: string
  buttonLabel: string
  reservationUrl: string
  imageUrl: string
  footer: string
  primaryColor: string
}

export type GmailRuleDraftLike = {
  name: string
  fromEmail: string
  query: string
}

export type BroadcastCardDraftLike = {
  cardTitle: string
  cardBody: string
  cardUrl: string
  cardImageUrl: string
}

export type ReservationEntryUrlInput = {
  workerBaseUrl?: string
  page?: 'book' | 'book-v2'
  channel?: string
  resourceId?: string
  menuId?: string
  ref?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
}

export const DEFAULT_RESERVATION_CARD: ReservationCardForm = {
  title: 'ブルーベリー予約はこちら',
  body: '日付と時間を選んで、かんたんに予約できます。',
  buttonLabel: '予約する',
  reservationUrl: '',
  imageUrl: '',
  footer: 'アオニサイファーム',
  primaryColor: '#69A3D0',
}

export const DEFAULT_EXTERNAL_IMPORT_NAME = 'じゃらん予約メール'
export const DEFAULT_EXTERNAL_IMPORT_QUERY = '{from:reservation@activityboard.jp from:reservation_cancel@activityboard.jp} newer_than:30d'

export function bookingUrlFromApiBase(apiUrl?: string): string {
  const base = apiUrl?.trim().replace(/\/+$/, '') || ''
  return base ? `${base}/?page=book` : ''
}

export function normalizeWorkerBaseUrl(apiUrl?: string): string {
  return (apiUrl || 'http://localhost:8787').trim().replace(/\/+$/, '')
}

export function providerDisplayName(provider?: ApiProviderConfig | null): string {
  return provider?.shortName || provider?.displayName || '予約'
}

export function buildProviderReservationCard(
  current: ReservationCardForm,
  provider: ApiProviderConfig | null,
  bookingUrl: string,
): ReservationCardForm {
  if (!provider) return current
  return {
    ...current,
    title: current.title !== DEFAULT_RESERVATION_CARD.title
      ? current.title
      : `${providerDisplayName(provider)}予約はこちら`,
    body: current.body !== DEFAULT_RESERVATION_CARD.body
      ? current.body
      : provider.reservation.introBody || current.body,
    reservationUrl: current.reservationUrl || bookingUrl,
    imageUrl: current.imageUrl || provider.assets.heroImageUrl || '',
    footer: current.footer !== DEFAULT_RESERVATION_CARD.footer
      ? current.footer
      : providerDisplayName(provider),
    primaryColor: current.primaryColor !== DEFAULT_RESERVATION_CARD.primaryColor
      ? current.primaryColor
      : provider.colors.primary || current.primaryColor,
  }
}

export function externalImportUi(provider?: ApiProviderConfig | null): {
  enabled: boolean
  label: string
  sourceLabel: string
  fallbackRuleName: string
} {
  const external = provider?.externalImport
  const label = external?.label || 'じゃらん / Gmail設定'
  const sourceLabel = external?.provider === 'jalan'
    ? 'じゃらん'
    : (label.replace(/\s*設定$/, '').replace(/\s*\/\s*Gmail$/, '') || '外部予約')
  return {
    enabled: external?.enabled ?? true,
    label,
    sourceLabel,
    fallbackRuleName: `${label.replace(/\s*設定$/, '') || '外部予約メール'} 取り込み`,
  }
}

export function applyProviderGmailRuleDefaults<T extends GmailRuleDraftLike>(
  current: T,
  provider: ApiProviderConfig | null,
): T {
  if (!provider) return current
  const external = provider.externalImport
  return {
    ...current,
    name: current.name && current.name !== DEFAULT_EXTERNAL_IMPORT_NAME
      ? current.name
      : `${external.label || '外部予約メール'} 取り込み`,
    fromEmail: current.fromEmail || external.defaultFromEmail || '',
    query: current.query && current.query !== DEFAULT_EXTERNAL_IMPORT_QUERY
      ? current.query
      : external.defaultQuery || current.query,
  }
}

export function applyProviderBroadcastCardDefaults<T extends BroadcastCardDraftLike>(
  current: T,
  provider: ApiProviderConfig | null,
  bookingUrl: string,
): T {
  if (!provider) return current
  return {
    ...current,
    cardTitle: current.cardTitle !== DEFAULT_RESERVATION_CARD.title
      ? current.cardTitle
      : `${providerDisplayName(provider)}予約はこちら`,
    cardBody: current.cardBody !== DEFAULT_RESERVATION_CARD.body
      ? current.cardBody
      : provider.reservation.introBody || current.cardBody,
    cardUrl: current.cardUrl || bookingUrl,
    cardImageUrl: current.cardImageUrl || provider.assets.heroImageUrl || '',
  }
}

export function reservationEntryUi(provider?: ApiProviderConfig | null): {
  providerName: string
  bookingTitle: string
  accentColor: string
} {
  return {
    providerName: providerDisplayName(provider),
    bookingTitle: provider?.reservation.title || '予約',
    accentColor: provider?.colors.primary || '#2563eb',
  }
}

export function buildReservationEntryUrl(input: ReservationEntryUrlInput): string {
  const params = new URLSearchParams({
    page: input.page === 'book-v2' ? 'book-v2' : 'book',
    mode: 'web',
    channel: input.channel?.trim() || 'web',
  })
  if (input.resourceId?.trim()) params.set('resourceId', input.resourceId.trim())
  if (input.menuId?.trim()) params.set('menuId', input.menuId.trim())
  if (input.ref?.trim()) params.set('ref', input.ref.trim())
  if (input.utmSource?.trim()) params.set('utm_source', input.utmSource.trim())
  if (input.utmMedium?.trim()) params.set('utm_medium', input.utmMedium.trim())
  if (input.utmCampaign?.trim()) params.set('utm_campaign', input.utmCampaign.trim())
  return `${normalizeWorkerBaseUrl(input.workerBaseUrl)}/?${params.toString()}`
}
