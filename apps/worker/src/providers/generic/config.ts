import type { ProviderConfig } from '../types.js';

export const genericProviderConfig: ProviderConfig = {
  id: 'generic',
  name: 'Generic Reservation Provider',
  displayName: '予約サービス',
  shortName: '予約',
  description: '日付と時間を選んで予約できます。',
  address: '',
  phone: '',
  siteUrl: '',
  colors: {
    primary: '#1f4f7a',
    accent: '#69a3d0',
    background: '#f7fafc',
    text: '#172033',
  },
  assets: {
    logoUrl: '',
    heroImageUrl: '',
    faviconUrl: '',
  },
  reservation: {
    title: '予約',
    introTitle: '日付を選んで予約する',
    introBody: '空いている日付と時間枠を選んで、必要事項を入力してください。',
    lineLinkTitle: 'LINEで予約確認',
    lineLinkBody: 'LINE連携をすると、予約確認やキャンセルが簡単になります。',
    enableCafeTab: false,
    enableLineLinkPanel: true,
  },
  email: {
    fromName: '予約受付',
    footerText: 'このメールは予約受付システムから自動送信されています。',
    heroImageUrl: '',
  },
  externalImport: {
    enabled: false,
    label: '外部予約メール取り込み',
    provider: 'none',
    defaultFromEmail: '',
    defaultQuery: '',
    defaultLabels: {
      unprocessed: '外部予約/未処理',
      processed: '外部予約/処理済み',
      review: '外部予約/要確認',
      failed: '外部予約/失敗',
    },
  },
};
