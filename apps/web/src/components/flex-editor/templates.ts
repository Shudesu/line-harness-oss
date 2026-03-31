// Flex Message テンプレート定義
// 各テンプレートは fields で可変部分を定義し、generate で Flex JSON を生成する

export interface TemplateField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'url' | 'color' | 'number'
  placeholder?: string
  defaultValue?: string
}

export interface FlexTemplate {
  id: string
  name: string
  category: string
  description: string
  fields: TemplateField[]
  generate: (values: Record<string, string>) => object
}

export const FLEX_TEMPLATES: FlexTemplate[] = [
  // ─── お知らせ ────────────────────────────────────────────────
  {
    id: 'notice',
    name: 'お知らせ',
    category: 'お知らせ',
    description: 'シンプルなお知らせカード',
    fields: [
      { key: 'title', label: 'タイトル', type: 'text', placeholder: '重要なお知らせ', defaultValue: 'お知らせ' },
      { key: 'body', label: '本文', type: 'textarea', placeholder: '本文を入力...', defaultValue: 'ここにお知らせの内容が入ります。' },
      { key: 'color', label: 'アクセントカラー', type: 'color', defaultValue: '#06C755' },
    ],
    generate: (v) => ({
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: v.color, paddingAll: '16px', contents: [
        { type: 'text', text: v.title, color: '#ffffff', weight: 'bold', size: 'lg' },
      ]},
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: [
        { type: 'text', text: v.body, wrap: true, size: 'sm', color: '#333333' },
      ]},
    }),
  },

  // ─── 商品カード ──────────────────────────────────────────────
  {
    id: 'product',
    name: '商品カード',
    category: '商品',
    description: '画像付き商品紹介カード',
    fields: [
      { key: 'imageUrl', label: '商品画像URL', type: 'url', placeholder: 'https://example.com/product.jpg' },
      { key: 'name', label: '商品名', type: 'text', placeholder: '商品名', defaultValue: '商品名' },
      { key: 'price', label: '価格', type: 'text', placeholder: '¥1,980', defaultValue: '¥1,980' },
      { key: 'description', label: '説明', type: 'textarea', placeholder: '商品の説明...', defaultValue: '商品の説明文がここに入ります。' },
      { key: 'linkUrl', label: '詳細リンク', type: 'url', placeholder: 'https://example.com/product' },
    ],
    generate: (v) => ({
      type: 'bubble',
      hero: v.imageUrl ? { type: 'image', url: v.imageUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' } : undefined,
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: [
        { type: 'text', text: v.name, weight: 'bold', size: 'lg', color: '#1e293b' },
        { type: 'text', text: v.price, size: 'xl', weight: 'bold', color: '#06C755', margin: 'md' },
        { type: 'text', text: v.description, wrap: true, size: 'sm', color: '#64748b', margin: 'md' },
      ]},
      footer: v.linkUrl ? { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [
        { type: 'button', action: { type: 'uri', label: '詳細を見る', uri: v.linkUrl }, style: 'primary', color: '#06C755' },
      ]} : undefined,
    }),
  },

  // ─── クーポン ────────────────────────────────────────────────
  {
    id: 'coupon',
    name: 'クーポン',
    category: 'キャンペーン',
    description: '割引クーポンカード',
    fields: [
      { key: 'discount', label: '割引内容', type: 'text', placeholder: '20% OFF', defaultValue: '20% OFF' },
      { key: 'title', label: 'キャンペーン名', type: 'text', placeholder: '春のセール', defaultValue: '期間限定セール' },
      { key: 'expiry', label: '有効期限', type: 'text', placeholder: '2026/04/30まで', defaultValue: '2026/04/30まで' },
      { key: 'code', label: 'クーポンコード', type: 'text', placeholder: 'SPRING2026', defaultValue: 'COUPON2026' },
      { key: 'linkUrl', label: '利用リンク', type: 'url', placeholder: 'https://example.com/shop' },
    ],
    generate: (v) => ({
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#ff6b35', paddingAll: '20px', contents: [
        { type: 'text', text: v.discount, color: '#ffffff', weight: 'bold', size: 'xxl', align: 'center' },
        { type: 'text', text: v.title, color: '#ffffff', size: 'sm', align: 'center', margin: 'sm' },
      ]},
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: [
        { type: 'box', layout: 'vertical', backgroundColor: '#f8f9fa', cornerRadius: 'md', paddingAll: '16px', contents: [
          { type: 'text', text: 'クーポンコード', size: 'xs', color: '#64748b', align: 'center' },
          { type: 'text', text: v.code, size: 'xl', weight: 'bold', color: '#1e293b', align: 'center', margin: 'sm' },
        ]},
        { type: 'text', text: `有効期限: ${v.expiry}`, size: 'xs', color: '#94a3b8', align: 'center', margin: 'lg' },
      ]},
      footer: v.linkUrl ? { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [
        { type: 'button', action: { type: 'uri', label: '今すぐ使う', uri: v.linkUrl }, style: 'primary', color: '#ff6b35' },
      ]} : undefined,
    }),
  },

  // ─── 予約確認 ────────────────────────────────────────────────
  {
    id: 'reservation',
    name: '予約確認',
    category: '予約',
    description: '予約内容の確認カード',
    fields: [
      { key: 'date', label: '日時', type: 'text', placeholder: '2026/04/15 14:00', defaultValue: '2026/04/15 14:00' },
      { key: 'service', label: 'サービス名', type: 'text', placeholder: 'カット＋カラー', defaultValue: 'カット＋カラー' },
      { key: 'location', label: '場所', type: 'text', placeholder: '渋谷店', defaultValue: '渋谷店' },
      { key: 'staff', label: '担当者', type: 'text', placeholder: '田中', defaultValue: '担当者名' },
      { key: 'note', label: '備考', type: 'text', placeholder: '駐車場あり' },
    ],
    generate: (v) => ({
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#06C755', paddingAll: '16px', contents: [
        { type: 'text', text: '予約確認', color: '#ffffff', weight: 'bold', size: 'lg' },
      ]},
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md', contents: [
        { type: 'box', layout: 'horizontal', contents: [
          { type: 'text', text: '日時', size: 'sm', color: '#94a3b8', flex: 2 },
          { type: 'text', text: v.date, size: 'sm', color: '#1e293b', weight: 'bold', flex: 5 },
        ]},
        { type: 'box', layout: 'horizontal', contents: [
          { type: 'text', text: 'メニュー', size: 'sm', color: '#94a3b8', flex: 2 },
          { type: 'text', text: v.service, size: 'sm', color: '#1e293b', flex: 5 },
        ]},
        { type: 'box', layout: 'horizontal', contents: [
          { type: 'text', text: '場所', size: 'sm', color: '#94a3b8', flex: 2 },
          { type: 'text', text: v.location, size: 'sm', color: '#1e293b', flex: 5 },
        ]},
        { type: 'box', layout: 'horizontal', contents: [
          { type: 'text', text: '担当', size: 'sm', color: '#94a3b8', flex: 2 },
          { type: 'text', text: v.staff, size: 'sm', color: '#1e293b', flex: 5 },
        ]},
        ...(v.note ? [{ type: 'separator', margin: 'lg' } as const, { type: 'text' as const, text: v.note, size: 'xs' as const, color: '#64748b', wrap: true, margin: 'md' as const }] : []),
      ]},
    }),
  },

  // ─── レシート ────────────────────────────────────────────────
  {
    id: 'receipt',
    name: 'レシート',
    category: '決済',
    description: '購入完了レシートカード',
    fields: [
      { key: 'storeName', label: '店舗名', type: 'text', placeholder: 'ショップ名', defaultValue: 'サンプルショップ' },
      { key: 'item1', label: '商品1', type: 'text', placeholder: '商品A', defaultValue: '商品A' },
      { key: 'price1', label: '金額1', type: 'text', placeholder: '¥1,000', defaultValue: '¥1,000' },
      { key: 'item2', label: '商品2（任意）', type: 'text', placeholder: '商品B' },
      { key: 'price2', label: '金額2（任意）', type: 'text', placeholder: '¥2,000' },
      { key: 'total', label: '合計金額', type: 'text', placeholder: '¥3,000', defaultValue: '¥3,000' },
    ],
    generate: (v) => {
      const items = [
        { type: 'box', layout: 'horizontal', contents: [
          { type: 'text', text: v.item1, size: 'sm', color: '#1e293b', flex: 4 },
          { type: 'text', text: v.price1, size: 'sm', color: '#1e293b', align: 'end', flex: 2 },
        ]},
      ]
      if (v.item2 && v.price2) {
        items.push({ type: 'box', layout: 'horizontal', contents: [
          { type: 'text', text: v.item2, size: 'sm', color: '#1e293b', flex: 4 },
          { type: 'text', text: v.price2, size: 'sm', color: '#1e293b', align: 'end', flex: 2 },
        ]})
      }
      return {
        type: 'bubble',
        body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: [
          { type: 'text', text: v.storeName, weight: 'bold', size: 'lg', color: '#1e293b' },
          { type: 'text', text: '購入完了', size: 'xs', color: '#06C755', margin: 'sm' },
          { type: 'separator', margin: 'lg' },
          { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: items },
          { type: 'separator', margin: 'lg' },
          { type: 'box', layout: 'horizontal', margin: 'lg', contents: [
            { type: 'text', text: '合計', size: 'md', weight: 'bold', color: '#1e293b', flex: 4 },
            { type: 'text', text: v.total, size: 'md', weight: 'bold', color: '#06C755', align: 'end', flex: 2 },
          ]},
        ]},
      }
    },
  },

  // ─── CTA (行動喚起) ─────────────────────────────────────────
  {
    id: 'cta',
    name: '行動喚起（CTA）',
    category: 'キャンペーン',
    description: 'ボタン付きの行動喚起カード',
    fields: [
      { key: 'headline', label: '見出し', type: 'text', placeholder: '今だけ特別価格！', defaultValue: '今だけ特別価格！' },
      { key: 'body', label: '説明文', type: 'textarea', placeholder: '詳細を入力...', defaultValue: '期間限定のお得なキャンペーンです。お見逃しなく！' },
      { key: 'buttonLabel', label: 'ボタンテキスト', type: 'text', placeholder: '詳しく見る', defaultValue: '詳しく見る' },
      { key: 'buttonUrl', label: 'ボタンURL', type: 'url', placeholder: 'https://example.com' },
      { key: 'color', label: 'ボタンカラー', type: 'color', defaultValue: '#06C755' },
    ],
    generate: (v) => ({
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', paddingAll: '24px', contents: [
        { type: 'text', text: v.headline, weight: 'bold', size: 'xl', color: '#1e293b', wrap: true },
        { type: 'text', text: v.body, wrap: true, size: 'sm', color: '#64748b', margin: 'lg' },
      ]},
      footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [
        { type: 'button', action: v.buttonUrl
          ? { type: 'uri', label: v.buttonLabel, uri: v.buttonUrl }
          : { type: 'message', label: v.buttonLabel, text: v.buttonLabel },
          style: 'primary', color: v.color },
      ]},
    }),
  },

  // ─── プロフィール ────────────────────────────────────────────
  {
    id: 'profile',
    name: 'プロフィール',
    category: '紹介',
    description: 'スタッフ・担当者紹介カード',
    fields: [
      { key: 'imageUrl', label: '写真URL', type: 'url', placeholder: 'https://example.com/photo.jpg' },
      { key: 'name', label: '名前', type: 'text', placeholder: '田中太郎', defaultValue: '田中太郎' },
      { key: 'title', label: '肩書き', type: 'text', placeholder: '店長', defaultValue: '担当スタッフ' },
      { key: 'message', label: 'メッセージ', type: 'textarea', placeholder: 'よろしくお願いします！', defaultValue: 'ご来店お待ちしております！' },
    ],
    generate: (v) => ({
      type: 'bubble',
      hero: v.imageUrl ? { type: 'image', url: v.imageUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'cover' } : undefined,
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: [
        { type: 'text', text: v.name, weight: 'bold', size: 'lg', color: '#1e293b', align: 'center' },
        { type: 'text', text: v.title, size: 'sm', color: '#06C755', align: 'center', margin: 'sm' },
        { type: 'separator', margin: 'lg' },
        { type: 'text', text: v.message, wrap: true, size: 'sm', color: '#64748b', margin: 'lg', align: 'center' },
      ]},
    }),
  },

  // ─── イベント ────────────────────────────────────────────────
  {
    id: 'event',
    name: 'イベント告知',
    category: 'イベント',
    description: 'イベント・セミナーの告知カード',
    fields: [
      { key: 'imageUrl', label: 'バナー画像URL', type: 'url', placeholder: 'https://example.com/event.jpg' },
      { key: 'title', label: 'イベント名', type: 'text', placeholder: 'オンラインセミナー', defaultValue: 'オンラインセミナー' },
      { key: 'date', label: '日時', type: 'text', placeholder: '2026/04/20 19:00-', defaultValue: '2026/04/20 19:00-' },
      { key: 'location', label: '場所', type: 'text', placeholder: 'Zoom', defaultValue: 'オンライン (Zoom)' },
      { key: 'description', label: '説明', type: 'textarea', placeholder: 'イベントの説明...', defaultValue: '参加無料のオンラインセミナーです。' },
      { key: 'linkUrl', label: '申込リンク', type: 'url', placeholder: 'https://example.com/event' },
    ],
    generate: (v) => ({
      type: 'bubble',
      hero: v.imageUrl ? { type: 'image', url: v.imageUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' } : undefined,
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: [
        { type: 'text', text: v.title, weight: 'bold', size: 'lg', color: '#1e293b' },
        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: [
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: '日時', size: 'xs', color: '#94a3b8', flex: 2 },
            { type: 'text', text: v.date, size: 'sm', color: '#1e293b', flex: 5 },
          ]},
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: '場所', size: 'xs', color: '#94a3b8', flex: 2 },
            { type: 'text', text: v.location, size: 'sm', color: '#1e293b', flex: 5 },
          ]},
        ]},
        { type: 'text', text: v.description, wrap: true, size: 'sm', color: '#64748b', margin: 'lg' },
      ]},
      footer: v.linkUrl ? { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [
        { type: 'button', action: { type: 'uri', label: '申し込む', uri: v.linkUrl }, style: 'primary', color: '#06C755' },
      ]} : undefined,
    }),
  },

  // ─── FAQ ─────────────────────────────────────────────────────
  {
    id: 'faq',
    name: 'FAQ',
    category: 'サポート',
    description: 'よくある質問カード',
    fields: [
      { key: 'q1', label: '質問1', type: 'text', placeholder: '営業時間は？', defaultValue: '営業時間は？' },
      { key: 'a1', label: '回答1', type: 'textarea', placeholder: '10:00-19:00です', defaultValue: '平日 10:00〜19:00、土日祝 11:00〜18:00 です。' },
      { key: 'q2', label: '質問2（任意）', type: 'text', placeholder: '駐車場はありますか？' },
      { key: 'a2', label: '回答2（任意）', type: 'textarea', placeholder: 'はい、5台分あります' },
    ],
    generate: (v) => {
      const contents: object[] = [
        { type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: `Q. ${v.q1}`, weight: 'bold', size: 'sm', color: '#06C755' },
          { type: 'text', text: `A. ${v.a1}`, wrap: true, size: 'sm', color: '#333333', margin: 'sm' },
        ]},
      ]
      if (v.q2 && v.a2) {
        contents.push(
          { type: 'separator', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'lg', contents: [
            { type: 'text', text: `Q. ${v.q2}`, weight: 'bold', size: 'sm', color: '#06C755' },
            { type: 'text', text: `A. ${v.a2}`, wrap: true, size: 'sm', color: '#333333', margin: 'sm' },
          ]},
        )
      }
      return {
        type: 'bubble',
        header: { type: 'box', layout: 'vertical', backgroundColor: '#f8f9fa', paddingAll: '16px', contents: [
          { type: 'text', text: 'よくある質問', weight: 'bold', size: 'md', color: '#1e293b' },
        ]},
        body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'lg', contents },
      }
    },
  },
]

export const TEMPLATE_CATEGORIES = [...new Set(FLEX_TEMPLATES.map((t) => t.category))]
