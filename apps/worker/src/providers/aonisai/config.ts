import type { ProviderConfig } from '../types.js';

export const aonisaiProviderConfig: ProviderConfig = {
  id: 'aonisai',
  name: 'AONISAI FARM',
  displayName: 'アオニサイファーム ブルーベリー観光農園',
  shortName: 'アオニサイファーム',
  description: 'つくばの農園で、旬のブルーベリーとカフェを楽しめます。',
  address: '〒300-2645 茨城県つくば市上郷 2223-1',
  phone: '',
  siteUrl: 'https://aonisai-blueberry.com/',
  colors: {
    primary: '#272f72',
    accent: '#69a3d0',
    background: '#fbfaf6',
    text: '#1c2440',
  },
  assets: {
    logoUrl: '/aonisai/aonisai_blue.jpg',
    heroImageUrl: '/aonisai/cafe/cafe-hero.webp',
    faviconUrl: '',
  },
  reservation: {
    title: 'ブルーベリー体験予約',
    introTitle: 'つくばの農園で、旬のブルーベリーを楽しむ体験',
    introBody: '日付を選んで、空いている時間枠から予約できます。',
    lineLinkTitle: 'LINEで予約確認',
    lineLinkBody: 'LINEで連携すると、予約確認やキャンセルが簡単になります。',
    enableCafeTab: true,
    enableLineLinkPanel: true,
  },
  email: {
    fromName: 'アオニサイファーム予約',
    footerText: 'アオニサイファーム ブルーベリー観光農園',
    heroImageUrl: '/aonisai/cafe/cafe-hero.webp',
  },
  externalImport: {
    enabled: true,
    label: 'じゃらん / Gmail設定',
    provider: 'jalan',
    defaultFromEmail: 'reservation@activityboard.jp,reservation_cancel@activityboard.jp',
    defaultQuery: '{from:reservation@activityboard.jp from:reservation_cancel@activityboard.jp} newer_than:30d',
    defaultLabels: {
      unprocessed: 'じゃらん予約/未処理',
      processed: 'じゃらん予約/処理済み',
      review: 'じゃらん予約/要確認',
      failed: 'じゃらん予約/失敗',
    },
  },
};
