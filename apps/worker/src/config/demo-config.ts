// 業種別デモのID・本文集約。
// RM/フォーム/タグ再作成のたびにここだけ更新する。
// 仕様正本は Obsidian: 03-Projects-Areas/自分用LINE/業種別デモ設計書.md

export type DemoIndustryKey = 'restaurant' | 'salon' | 'school' | 'main';


export type DemoActionKind = 'text' | 'flex' | 'form' | 'lookup';

export interface ActionDef {
  actionTagId: string;
  kind: DemoActionKind;
  content?: string;
  contentOptions?: readonly string[];  // ランダム選択用（ガチャ等）
  formId?: string;
  altText?: string;
  switchRmToMain?: true;
  lookupKeyword?: string;
}

export interface IndustryDef {
  richMenuId: string;
  industryTagId: string | null;
  actionTagId: string;
  explain: string | null;
  greeting: string | null;
  greetingType?: 'flex';  // greeting が FlexJSON 文字列のとき指定
}

// ─── タグID ──────────────────────────────────────────────
const T = {
  industry_restaurant: '1b5bddec-1887-45de-bd54-61083baa0407',
  industry_salon:      '6e301ba9-df34-4b7e-9a69-b204cea5683b',
  industry_school:     'c31fe846-f96a-4e8f-bc7d-782569a95e4f',

  main_restaurant: 'a20aa54e-6fe8-4951-a889-818fc6e47f66',
  main_salon:      'e23b9706-f99f-45e3-ae1c-7857689df31e',
  main_school:     '52e07e2b-851b-4379-88c5-cace83524c30',
  main_diag:       '94e6658f-7506-40da-96c2-19ee3acad3da',
  main_profile:    'c563749a-873b-4699-aff4-236cb23c3b77',
  main_consult:    'e361715c-da45-4498-9444-8ae989bcb689',

  back_to_main:    '60a44ab5-3528-4496-9d59-d36db731add3',
  after_demo_consult: 'edd3fb73-a734-4c6d-9977-fdb26aeed131',

  rest_gacha:      'a5a8d2e7-bc82-4330-925a-39abc3275eb9',
  rest_form:       'ab7e7c8c-50b1-4615-b12b-d564b4fa2a33',
  rest_recommend:  'b06b3643-0ba0-47bd-b863-2c90836d2062',
  rest_coupon:     'fb62a9c1-0e9e-46c5-b940-b6c5a2e4bfa7',

  salon_counsel:   '8849b60b-5b9c-4084-91e1-3ba4c8ab3e3b',
  salon_form:      '3e45a8e6-d1f5-4112-be6d-b5eb0b54b09a',
  salon_care:      'be827aa0-bdce-4b88-9274-a679e8c18304',
  salon_aftercare: 'efb778fa-1cd4-40bc-9a29-643348e46372',

  school_diag:     '028a2c1d-7db8-4610-b8de-fcd509d8bff9',
  school_form:     '3beb5ac7-6e53-4d2f-a300-14b87c2e215a',
  school_course:   '37edbf22-e171-4d99-9e8f-6fc62633ccdb',
  school_d3:       'c1f9a8cb-1e8a-4259-881d-4005a2648ec2',
} as const;

// ─── フォームID ─────────────────────────────────────────
const F = {
  rest_form:    '76ddd91c-94f3-4595-9057-7303f275c1b6',
  salon_counsel:'42418183-431f-4c35-ad50-eddb438e6424',
  salon_form:   '31d5696c-08e5-42cc-aa02-7791c17b80c4',
  school_diag:  'a9141529-7bbf-4da4-875d-daa2afc7b6db',
  school_form:  '7fcdae15-5b7e-4e35-9c8e-83c3a0e058a2',
  consult:      '032491b8-563f-4736-bf0d-e91b911c87ac', // 既存の無料相談フォーム
} as const;

// ─── リッチメニューID（新RM作成後に埋める） ───────────
// 旧RM: メイン=richmenu-be45102b45bb39cb6b35201660cf1ce3
//        飲食=richmenu-bd35b6433c1ebd8b8a08d8f12f965082
//        サロン=richmenu-9a9c3f4eb37e5a3ae4e6d456c91a64a6
//        教室=richmenu-5546c2bea50df9bec699a98f06a9a6c7
// 新RM作成後、ここを差し替える。差し替え前でも tagging / reply は動くが
// linkRichMenuToUser は richMenuId が空文字なら呼び出しをスキップする実装。
export const DEMO_RICH_MENU_IDS = {
  main:       'richmenu-0bb6ec3b0574034ceaee93b0d5f08f43',
  restaurant: 'richmenu-f8b9c605ddddec3883cdc0c4c4a3e3d0',
  salon:      'richmenu-b864e092171201115deb97905b83f592',
  school:     'richmenu-f8f94969ec3dc7accaaa28dd73896d08',
} as const;

// ─── 解説 / あいさつ本文 ────────────────────────────────
const EXPLAIN_RESTAURANT = `飲食店デモへようこそ。

登録 → 特典配布 → 来店後フォロー
の流れをこのLINEで体験できます。

まずはガチャで特典を受け取ってください。`;

// FlexJSON: 挨拶カード＋登録ガチャボタン
const GREETING_RESTAURANT_FLEX = JSON.stringify({
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    paddingAll: '20px',
    contents: [
      { type: 'text', text: 'ご登録ありがとうございます', weight: 'bold', size: 'xl', color: '#1e293b', wrap: true },
      { type: 'text', text: 'LINE登録の方限定で、今すぐ使える特典をご用意しています。まずは登録ガチャを回して、あなたの特典を確認してください。', size: 'sm', color: '#64748b', wrap: true, margin: 'lg' },
      { type: 'text', text: 'お席の予約や本日のおすすめも、このLINEから確認できます。', size: 'sm', color: '#64748b', wrap: true, margin: 'md' },
    ],
  },
  footer: {
    type: 'box',
    layout: 'vertical',
    paddingAll: '16px',
    contents: [
      {
        type: 'button',
        style: 'primary',
        color: '#06C755',
        action: { type: 'postback', label: '🎰 登録ガチャを回す', data: 'demo_action=飲食_登録ガチャ表示', displayText: '登録ガチャを回す' },
      },
    ],
  },
});

const EXPLAIN_SALON = `美容サロン・整体向けデモに切り替えました。

事前カウンセリングをLINEで受け取り、
2回目以降の予約をLINEへ寄せる想定です。

予約前日はキャンセル防止、
施術後はホームケアや追加メニュー案内までつなげます。`;

const GREETING_SALON = `ご登録ありがとうございます。

施術前に、今のお悩みやご希望を
LINEで簡単に伺っています。

当日スムーズにご案内するために、
まずはカウンセリングシートをご記入ください。

下のメニューから
「カウンセリング」を押してみてください。`;

const EXPLAIN_SCHOOL = `教室・スクール向けデモに切り替えました。

レベル診断で目的や不安を聞き、
その人に合う体験内容へ案内する想定です。

診断だけで止まった人にも、
3日後の不安解消メッセージで無理なく後追いします。`;

const GREETING_SCHOOL = `ご登録ありがとうございます。

このLINEでは、
あなたに合う始め方を簡単に診断できます。

経験や不安に合わせて、
おすすめの体験内容をご案内します。

まずは下のメニューから
「レベル診断」を押してみてください。`;

const BACK_TO_MAIN_TEXT = `メインメニューに戻りました。

別の業種デモを試したい場合は、
上段の3つのデモボタンから選んでください。`;

// ─── 業種定義 ──────────────────────────────────────────
export const DEMO_INDUSTRIES: Record<DemoIndustryKey, IndustryDef> = {
  restaurant: {
    richMenuId:    DEMO_RICH_MENU_IDS.restaurant,
    industryTagId: T.industry_restaurant,
    actionTagId:   T.main_restaurant,
    explain:       EXPLAIN_RESTAURANT,
    greeting:      GREETING_RESTAURANT_FLEX,
    greetingType:  'flex',
  },
  salon: {
    richMenuId:    DEMO_RICH_MENU_IDS.salon,
    industryTagId: T.industry_salon,
    actionTagId:   T.main_salon,
    explain:       EXPLAIN_SALON,
    greeting:      GREETING_SALON,
  },
  school: {
    richMenuId:    DEMO_RICH_MENU_IDS.school,
    industryTagId: T.industry_school,
    actionTagId:   T.main_school,
    explain:       EXPLAIN_SCHOOL,
    greeting:      GREETING_SCHOOL,
  },
  main: {
    richMenuId:    DEMO_RICH_MENU_IDS.main,
    industryTagId: null,
    actionTagId:   T.back_to_main,
    explain:       BACK_TO_MAIN_TEXT,
    greeting:      null,
  },
};

// 業種切替時に「現在の業種以外を外す」用の業種タグID列挙
export const INDUSTRY_TAG_IDS: readonly string[] = [
  T.industry_restaurant,
  T.industry_salon,
  T.industry_school,
];

// ─── アクション定義 ────────────────────────────────────
const REST_IMAGE_URLS = {
  menu: 'https://line-harness.line-harness-shota-test.workers.dev/images/9e34ca17-da8b-4b6c-afce-936294f572c7.jpg',
  gachaDrink: 'https://line-harness.line-harness-shota-test.workers.dev/images/restaurant-gacha-drink.png',
  gachaDessert: 'https://line-harness.line-harness-shota-test.workers.dev/images/restaurant-gacha-dessert.png',
  gachaDiscount: 'https://line-harness.line-harness-shota-test.workers.dev/images/restaurant-gacha-discount.png',
} as const;

const buildRestGachaFlex = (imageUrl: string, title: string, description: string): string => JSON.stringify({
  type: 'bubble',
  hero: {
    type: 'image',
    url: imageUrl,
    size: 'full',
    aspectRatio: '20:13',
    aspectMode: 'cover',
  },
  body: {
    type: 'box',
    layout: 'vertical',
    spacing: 'sm',
    contents: [
      { type: 'text', text: '🎰 おめでとうございます！', weight: 'bold', size: 'lg', color: '#1e293b', wrap: true },
      { type: 'text', text: title, weight: 'bold', size: 'xl', color: '#ff6b35', wrap: true },
      { type: 'text', text: description, size: 'sm', color: '#64748b', wrap: true },
      { type: 'text', text: 'スタッフにこの画面をご提示ください。', size: 'xs', color: '#94a3b8', wrap: true, margin: 'md' },
    ],
  },
  footer: {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'button',
        style: 'primary',
        color: '#06C755',
        action: { type: 'postback', label: '席を予約する', data: 'demo_action=飲食_予約フォーム表示', displayText: '予約したい' },
      },
    ],
  },
});

// ガチャ結果 3パターン（ランダム選択）
export const REST_GACHA_RESULTS = [
  buildRestGachaFlex(
    REST_IMAGE_URLS.gachaDrink,
    '【A特典】ドリンク1杯サービス',
    '本日のご来店時にお使いいただけます。',
  ),
  buildRestGachaFlex(
    REST_IMAGE_URLS.gachaDessert,
    '【B特典】デザートサービス',
    'お食事のご注文時にお申し付けください。',
  ),
  buildRestGachaFlex(
    REST_IMAGE_URLS.gachaDiscount,
    '【C特典】次回来店時10%OFF',
    '有効期限: 本日から1ヶ月以内',
  ),
] as const;

// FlexJSON: メニュー表画像＋予約ボタンだけのおすすめカード
const REST_RECOMMEND_FLEX = JSON.stringify({
  type: 'bubble',
  hero: {
    type: 'image',
    url: REST_IMAGE_URLS.menu,
    size: 'full',
    aspectRatio: '20:13',
    aspectMode: 'cover',
    action: { type: 'uri', label: 'メニューを見る', uri: REST_IMAGE_URLS.menu },
  },
  footer: {
    type: 'box',
    layout: 'vertical',
    paddingAll: '16px',
    contents: [
      {
        type: 'button',
        style: 'primary',
        color: '#ff6b35',
        action: { type: 'postback', label: '席を予約する', data: 'demo_action=飲食_予約フォーム表示', displayText: '予約したい' },
      },
    ],
  },
});

// 来店後フォロー例（RMの「1ヶ月以内クーポン」ボタンから発火）
const REST_COUPON_TEXT = `【来店後フォロー例】

本日はご来店ありがとうございました。

今日の感想があれば、
ぜひこのLINEに送ってください。

次回のご予約もここからできます。
「また来たい」と思ったとき、
そのまま予約窓口として使えます。

※ このメッセージは来店当日の夜に
　 自動送信される想定です。`;

const SALON_CARE_TEXT = `今日の状態だと、
ご自宅でのケアを少し足すと
次回まで整いやすくなります。

必要であれば、
ホームケア用のアイテムや
追加メニューもご案内できます。`;

const SALON_AFTERCARE_TEXT = `本日はありがとうございました。

今日の状態に合わせて、
ご自宅で気をつけるポイントを
短くまとめました。

次回は【目安時期】くらいに
もう一度見られると整えやすいです。`;

const SCHOOL_COURSE_TEXT = `コース紹介デモです。

実際の教室なら、
診断結果に合わせて
おすすめコースを出し分けます。

例:
- 初心者向け基礎コース
- 親子向け体験コース
- 短期集中コース
- 趣味で続けるコース

「自分はどれを選べばいいか」を
LINEの中で答えに近づけます。`;

const SCHOOL_D3_TEXT = `【3日後に届く想定のメッセージ】

先日は診断ありがとうございました。

体験に進むか迷っている方向けに、
当日の流れを短くまとめました。

初めてでも大丈夫な内容なので、
まずは雰囲気を見るだけでもOKです。`;

const MAIN_DIAG_TEXT = `30秒の診断を始めます。

このあと、
お悩み → 今のLINE運用状態 → 業種
の3問をお聞きします。

ボタンを押すだけで進めます。
途中で止めても問題ありません。`;

const MAIN_PROFILE_TEXT = `小規模店舗向けの
LINE導線設計を伴走しています。

主戦場は、
飲食店・美容サロン・整体・教室など、
お客さんと近い距離で商売をしている店舗です。

「LINEを入れたけど活かせていない」
という状態を、
無理なく続けられる導線に整え直すのが仕事です。`;

const AFTER_DEMO_CONSULT_TEXT = `30分Zoomで、
あなたのお店のLINE導線を一緒に見ます。

見るのは3つだけです。

1. どこで登録してもらうか
2. 登録直後に何を見せるか
3. 予約・再来店・体験申込へどうつなげるか

提案資料は作りません。
その場で「まず直すならここ」を見える化します。`;

export const DEMO_ACTIONS: Record<string, ActionDef> = {
  // 飲食
  '飲食_登録ガチャ表示':   { actionTagId: T.rest_gacha,     kind: 'flex', contentOptions: REST_GACHA_RESULTS, altText: '登録ガチャ結果' },
  '飲食_予約フォーム表示': { actionTagId: T.rest_form,      kind: 'form', formId: F.rest_form,       altText: '飲食店予約フォーム' },
  '飲食_おすすめ表示':     { actionTagId: T.rest_recommend, kind: 'flex', content: REST_RECOMMEND_FLEX, altText: '本日のおすすめ' },
  '飲食_再来店クーポン表示':{actionTagId: T.rest_coupon,    kind: 'text', content: REST_COUPON_TEXT },
  // サロン
  '美容_カウンセリング表示':{actionTagId: T.salon_counsel,  kind: 'form', formId: F.salon_counsel,  altText: 'カウンセリングシート' },
  '美容_予約フォーム表示': { actionTagId: T.salon_form,     kind: 'form', formId: F.salon_form,     altText: '初回予約フォーム' },
  '美容_おすすめケア表示': { actionTagId: T.salon_care,     kind: 'text', content: SALON_CARE_TEXT },
  '美容_来店後ケア表示':   { actionTagId: T.salon_aftercare,kind: 'text', content: SALON_AFTERCARE_TEXT },
  // 教室
  '教室_レベル診断表示':   { actionTagId: T.school_diag,    kind: 'form', formId: F.school_diag,    altText: 'レベル診断フォーム' },
  '教室_体験予約表示':     { actionTagId: T.school_form,    kind: 'form', formId: F.school_form,    altText: '体験予約フォーム' },
  '教室_コース表示':       { actionTagId: T.school_course,  kind: 'text', content: SCHOOL_COURSE_TEXT },
  '教室_3日後配信表示':    { actionTagId: T.school_d3,      kind: 'text', content: SCHOOL_D3_TEXT },
  // メイン直下
  'メイン_診断開始':       { actionTagId: T.main_diag,      kind: 'lookup', lookupKeyword: 'お店に合う提案を見る' },
  'メイン_プロフィール表示':{actionTagId: T.main_profile,   kind: 'text', content: MAIN_PROFILE_TEXT },
  'メイン_相談フォーム表示':{actionTagId: T.main_consult,   kind: 'form', formId: F.consult,        altText: '無料相談フォーム' },
  // デモ後共通
  'デモ後_相談表示':       { actionTagId: T.after_demo_consult, kind: 'form', formId: F.consult, altText: '無料相談フォーム', switchRmToMain: true },
};
