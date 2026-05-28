import { describe, expect, it } from 'vitest'
import type { ApiProviderConfig } from './api'
import {
  DEFAULT_EXTERNAL_IMPORT_NAME,
  DEFAULT_EXTERNAL_IMPORT_QUERY,
  DEFAULT_RESERVATION_CARD,
  applyProviderGmailRuleDefaults,
  applyProviderBroadcastCardDefaults,
  buildReservationEntryUrl,
  bookingUrlFromApiBase,
  buildProviderReservationCard,
  externalImportUi,
  normalizeWorkerBaseUrl,
  reservationEntryUi,
} from './provider-ui'

const provider: ApiProviderConfig = {
  id: 'sample',
  displayName: 'Sample Farm',
  shortName: 'Sample',
  description: 'sample',
  timezone: 'Asia/Tokyo',
  colors: {
    primary: '#123456',
    secondary: '#abcdef',
    accent: '#ffcc00',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#111827',
  },
  assets: {
    logoUrl: '/logo.webp',
    heroImageUrl: '/hero.webp',
    cafeHeroImageUrl: '',
  },
  reservation: {
    title: '体験予約',
    introTitle: '予約する',
    introBody: '好きな日程を選んでください。',
    completedTitle: '予約完了',
    lineFriendPrompt: 'LINEでも確認できます。',
    lineFriendUrl: 'https://line.me/R/ti/p/@sample',
    cafeEnabled: false,
  },
  externalImport: {
    enabled: true,
    provider: 'gmail',
    label: '外部予約 / Gmail設定',
    defaultFromEmail: 'booking@example.com',
    defaultQuery: 'from:booking@example.com newer_than:30d',
  },
  contact: {
    email: 'info@example.com',
    phone: '09000000000',
    address: 'Tokyo',
  },
}

describe('provider-ui', () => {
  it('builds booking URL from API base without duplicate slashes', () => {
    expect(bookingUrlFromApiBase('https://worker.example.com///')).toBe('https://worker.example.com/?page=book')
    expect(bookingUrlFromApiBase('')).toBe('')
    expect(normalizeWorkerBaseUrl('https://worker.example.com///')).toBe('https://worker.example.com')
  })

  it('applies provider defaults to reservation card', () => {
    const card = buildProviderReservationCard(DEFAULT_RESERVATION_CARD, provider, 'https://worker.example.com/?page=book')

    expect(card.title).toBe('Sample予約はこちら')
    expect(card.body).toBe('好きな日程を選んでください。')
    expect(card.reservationUrl).toBe('https://worker.example.com/?page=book')
    expect(card.imageUrl).toBe('/hero.webp')
    expect(card.footer).toBe('Sample')
    expect(card.primaryColor).toBe('#123456')
  })

  it('does not overwrite admin-edited reservation card fields', () => {
    const edited = {
      ...DEFAULT_RESERVATION_CARD,
      title: '独自タイトル',
      body: '独自本文',
      footer: '独自フッター',
      primaryColor: '#000000',
      imageUrl: 'https://example.com/image.jpg',
      reservationUrl: 'https://example.com/book',
    }

    expect(buildProviderReservationCard(edited, provider, 'https://worker.example.com/?page=book')).toEqual(edited)
  })

  it('derives external import labels from provider config', () => {
    const ui = externalImportUi(provider)

    expect(ui.enabled).toBe(true)
    expect(ui.label).toBe('外部予約 / Gmail設定')
    expect(ui.sourceLabel).toBe('外部予約')
    expect(ui.fallbackRuleName).toBe('外部予約 / Gmail 取り込み')
  })

  it('uses jalan as explicit source label when provider is jalan', () => {
    expect(externalImportUi({
      ...provider,
      externalImport: { ...provider.externalImport, provider: 'jalan', label: 'じゃらん / Gmail設定' },
    }).sourceLabel).toBe('じゃらん')
  })

  it('applies provider Gmail defaults without overwriting edited values', () => {
    const base = {
      name: DEFAULT_EXTERNAL_IMPORT_NAME,
      fromEmail: '',
      query: DEFAULT_EXTERNAL_IMPORT_QUERY,
      connectionId: 'conn_1',
    }
    const applied = applyProviderGmailRuleDefaults(base, provider)

    expect(applied).toMatchObject({
      name: '外部予約 / Gmail設定 取り込み',
      fromEmail: 'booking@example.com',
      query: 'from:booking@example.com newer_than:30d',
      connectionId: 'conn_1',
    })

    const edited = {
      ...base,
      name: '編集済みルール',
      fromEmail: 'manual@example.com',
      query: 'from:manual@example.com',
    }
    expect(applyProviderGmailRuleDefaults(edited, provider)).toEqual(edited)
  })

  it('builds reservation entry labels for provider and fallback', () => {
    expect(reservationEntryUi(provider)).toEqual({
      providerName: 'Sample',
      bookingTitle: '体験予約',
      accentColor: '#123456',
    })
    expect(reservationEntryUi(null)).toEqual({
      providerName: '予約',
      bookingTitle: '予約',
      accentColor: '#2563eb',
    })
  })

  it('applies provider defaults to broadcast card draft without overwriting edited fields', () => {
    const draft = {
      cardTitle: DEFAULT_RESERVATION_CARD.title,
      cardBody: DEFAULT_RESERVATION_CARD.body,
      cardUrl: '',
      cardImageUrl: '',
      untouched: 'keep',
    }

    expect(applyProviderBroadcastCardDefaults(draft, provider, 'https://worker.example.com/?page=book')).toEqual({
      cardTitle: 'Sample予約はこちら',
      cardBody: '好きな日程を選んでください。',
      cardUrl: 'https://worker.example.com/?page=book',
      cardImageUrl: '/hero.webp',
      untouched: 'keep',
    })

    const edited = {
      ...draft,
      cardTitle: '独自カード',
      cardBody: '独自本文',
      cardUrl: 'https://example.com/custom',
      cardImageUrl: 'https://example.com/image.webp',
    }
    expect(applyProviderBroadcastCardDefaults(edited, provider, 'https://worker.example.com/?page=book')).toEqual(edited)
  })

  it('builds web reservation entry URL with optional tracking parameters', () => {
    expect(buildReservationEntryUrl({
      workerBaseUrl: 'https://worker.example.com///',
      channel: 'google_map',
      resourceId: 'res_1',
      menuId: 'menu_1',
      ref: ' gmaps ',
      utmSource: 'google',
      utmMedium: 'profile',
      utmCampaign: 'summer',
    })).toBe('https://worker.example.com/?page=book&mode=web&channel=google_map&resourceId=res_1&menuId=menu_1&ref=gmaps&utm_source=google&utm_medium=profile&utm_campaign=summer')

    expect(buildReservationEntryUrl({
      workerBaseUrl: 'https://worker.example.com',
      channel: '',
    })).toBe('https://worker.example.com/?page=book&mode=web&channel=web')

    expect(buildReservationEntryUrl({
      workerBaseUrl: 'https://worker.example.com',
      page: 'book-v2',
      channel: 'website',
      resourceId: 'res_2',
    })).toBe('https://worker.example.com/?page=book-v2&mode=web&channel=website&resourceId=res_2')
  })
})
