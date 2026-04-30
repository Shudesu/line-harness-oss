// 業種別デモのID・本文集約。
// RM/フォーム/タグ再作成のたびにここだけ更新する。
// 仕様正本は Obsidian: 03-Projects-Areas/自分用LINE/業種別デモ設計書.md

export type DemoIndustryKey = 'restaurant' | 'salon' | 'school' | 'main';


export type DemoActionKind = 'text' | 'flex' | 'form' | 'lookup';

export interface ActionDef {
  actionTagId?: string;              // 省略時はタグ付与しない
  kind: DemoActionKind;
  content?: string;
  contentOptions?: readonly string[];   // ランダム選択用（ガチャ等）
  contentMultiple?: readonly string[];  // 複数バルーン一括送信用
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
}

// 業種別デモ：店主向け説明書（メインRMボタン押下時に送る2バルーン+CTA）
export interface IndustryIntroDef {
  bubble1Text: string;     // 説明書 吹き出し①（テキスト）
  bubble2Flex: string;     // 説明書 吹き出し②（Flex本文 + 「デモを開始する」ボタン）
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
  main:       'richmenu-c0116681cb64406d22fe343ad78bd4c1',
  restaurant: 'richmenu-ff34fffe93e5ebe0ae38d10692d6ea72',
  salon:      'richmenu-b864e092171201115deb97905b83f592',
  school:     'richmenu-f8f94969ec3dc7accaaa28dd73896d08',
} as const;

// ─── 解説 / あいさつ本文 ────────────────────────────────
// 文面正本: 配信文面.md §業種別デモ入口文面（実装前正本 / 2026-04-28 リライト）
// 構造: メインRMの業種ボタン押下 → demo_intro= で「店主向け説明書 2バルーン + デモを開始するCTA」
//       CTA押下 → demo= で「業種別RM切替 + 業種タグ + お客さん向けあいさつ 1バルーン」

// 業種別デモ：説明書②（吹き出し②本文 + 「デモを開始する」ボタン）共通ビルダ
const buildIntroBubble2Flex = (bodyText: string, demoKey: 'restaurant' | 'salon' | 'school'): string => JSON.stringify({
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    paddingAll: '20px',
    contents: [
      { type: 'text', text: bodyText, size: 'sm', color: '#1e293b', wrap: true },
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
        action: { type: 'postback', label: '▶ デモを開始する', data: `demo=${demoKey}`, displayText: 'デモを開始する' },
      },
    ],
  },
});

// ── 飲食店 ─────────────────────────────────
const INTRO_RESTAURANT_BUBBLE1 = `🍽 登録のあとで止まりがちなLINE
━━━━━━━━━━━━

飲食店のLINE、
登録までは作るんですが
そこから止まりがちです。

会計時に「LINEどうぞ」と渡して
クーポン1枚で終わり、
リピートに効いたかも見えない。
あるあるです。`;

const INTRO_RESTAURANT_BUBBLE2_BODY = `このデモで触れるのは3つ。

✅ 登録時に渡す特典ガチャ
✅ LINE内で完結する席予約
✅ 来店後1ヶ月以内の再来店メッセージ

下の「デモを開始する」を押すと
お客さんとしてお店のLINEに登録した
ところからスタートします。`;

const GREETING_RESTAURANT = `🍽 ご登録ありがとうございます
━━━━━━━━━━━━

このLINEでは
次回使える特典、席予約、
本日のおすすめが受け取れます。

まずは下のメニューから
「登録ガチャ」を回してみてください。
次回1ヶ月以内に使える特典が出ます👇`;

// ── サロン・整体 ──────────────────────────
const INTRO_SALON_BUBBLE1 = `💆 サロンの「LINE登録してもらう理由」
━━━━━━━━━━━━

サロンや整体って
「LINEに登録してください」
だけだと弱いんですよね。

クーポンを配って終わり、
にもなりやすい。

でも
「施術前のカウンセリングを
LINEで先にやっています」
と言えると、
登録してもらう理由が自然になります。`;

const INTRO_SALON_BUBBLE2_BODY = `このデモで触れるのは
カウンセリングを入口にした流れ。

✅ 施術前カウンセリングシート
✅ 悩み別のおすすめメニュー返答
✅ 施術後ケア + 次回提案

下の「デモを開始する」を押すと
お客さんとしてサロンに登録した
ところからスタートします。`;

// 想定シーン: 店頭で「カウンセリングはLINEでやってます」と促されて施術直前に登録した直後
const GREETING_SALON = `💆 ご登録ありがとうございます
━━━━━━━━━━━━

カウンセリングは
このLINEで承っています。

ご記入いただいた内容をもとに
本日の施術をご提案します。

下のメニューから
「カウンセリング」を押してください👇`;

// ── 教室・スクール ────────────────────────
const INTRO_SCHOOL_BUBBLE1 = `🎓 問い合わせは来るのに、体験まで来ない
━━━━━━━━━━━━

教室・スクールあるあるです。

問い合わせや資料請求は来るのに
体験予約までは進まない。
体験までは来てくれても、
入会で止まる。

止まってる理由はだいたい
「自分のレベルでいいのか」
「合わなかったらどうしよう」
の不安です。`;

const INTRO_SCHOOL_BUBBLE2_BODY = `このデモで触れるのは
その不安をLINEで先に潰す流れ。

✅ レベル診断 → コース提案
✅ 体験予約フォーム
✅ 申込まなかった人への3日後フォロー

下の「デモを開始する」を押すと
お客さんとして教室に登録した
ところからスタートします。`;

const GREETING_SCHOOL = `🎓 ご登録ありがとうございます
━━━━━━━━━━━━

このLINEでは
あなたに合う始め方を
30秒で診断できます。

まずは下のメニューから
「レベル診断」を押してください。
体験コースの案内まで
このLINEで完結します👇`;

// ── メインに戻る ─────────────────────────
const BACK_TO_MAIN_TEXT = `メインメニューに戻りました。

別の業種デモを試したい場合は、
上段の3つのデモボタンから選んでください。`;

// ─── 業種定義 ──────────────────────────────────────────
// demo= 押下時（=「デモを開始する」CTA）の挙動: RM切替 + 業種タグ + あいさつ1バルーン
export const DEMO_INDUSTRIES: Record<DemoIndustryKey, IndustryDef> = {
  restaurant: {
    richMenuId:    DEMO_RICH_MENU_IDS.restaurant,
    industryTagId: T.industry_restaurant,
    actionTagId:   T.main_restaurant,
    explain:       null,
    greeting:      GREETING_RESTAURANT,
  },
  salon: {
    richMenuId:    DEMO_RICH_MENU_IDS.salon,
    industryTagId: T.industry_salon,
    actionTagId:   T.main_salon,
    explain:       null,
    greeting:      GREETING_SALON,
  },
  school: {
    richMenuId:    DEMO_RICH_MENU_IDS.school,
    industryTagId: T.industry_school,
    actionTagId:   T.main_school,
    explain:       null,
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

// demo_intro= 押下時（=メインRMの業種ボタン）の挙動: 説明書2バルーン+CTA Flex のみ。
// RM切替・業種タグ付与はしない。CTA「デモを開始する」のpostback dataは `demo=<industry>`。
export const DEMO_INDUSTRY_INTROS: Record<Exclude<DemoIndustryKey, 'main'>, IndustryIntroDef> = {
  restaurant: {
    bubble1Text: INTRO_RESTAURANT_BUBBLE1,
    bubble2Flex: buildIntroBubble2Flex(INTRO_RESTAURANT_BUBBLE2_BODY, 'restaurant'),
  },
  salon: {
    bubble1Text: INTRO_SALON_BUBBLE1,
    bubble2Flex: buildIntroBubble2Flex(INTRO_SALON_BUBBLE2_BODY, 'salon'),
  },
  school: {
    bubble1Text: INTRO_SCHOOL_BUBBLE1,
    bubble2Flex: buildIntroBubble2Flex(INTRO_SCHOOL_BUBBLE2_BODY, 'school'),
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

// FlexJSON: ガチャ演出カード（登録ガチャ1タップ目）
const GACHA_PRODUCTION_FLEX = JSON.stringify({
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    paddingAll: '20px',
    spacing: 'md',
    contents: [
      { type: 'text', text: '🎰 ガラガラ ガラガラ…', weight: 'bold', size: 'xl', color: '#1e293b', wrap: true },
      { type: 'text', text: 'ただいま抽選中です。', size: 'sm', color: '#64748b', wrap: true },
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
        action: { type: 'postback', label: '結果を見る', data: 'demo_action=飲食_ガチャ結果表示', displayText: '結果を見る' },
      },
    ],
  },
});

const buildRestGachaFlex = (imageUrl: string, title: string): string => JSON.stringify({
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
      { type: 'text', text: '🎉 当たり！', weight: 'bold', size: 'lg', color: '#1e293b', wrap: true },
      { type: 'text', text: title, weight: 'bold', size: 'xl', color: '#ff6b35', wrap: true },
      { type: 'text', text: '次回1ヶ月以内のご来店でご利用いただけます。', size: 'sm', color: '#64748b', wrap: true },
      { type: 'text', text: 'お会計時にこの画面を店員にお見せください。', size: 'xs', color: '#94a3b8', wrap: true, margin: 'md' },
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

// ガチャ結果 3パターン（ランダム選択）— 文面正本: 配信文面.md §飲食店デモ：登録ガチャ結果
export const REST_GACHA_RESULTS = [
  buildRestGachaFlex(REST_IMAGE_URLS.gachaDrink,   'ドリンク1杯サービス'),
  buildRestGachaFlex(REST_IMAGE_URLS.gachaDessert, 'お好きな一品サービス'),
  buildRestGachaFlex(REST_IMAGE_URLS.gachaDiscount, 'お会計から10%OFF'),
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

// 来店後フォロー例 3バルーン — 文面正本: 配信文面.md §飲食店：来店後フォロー例
const REST_FOLLOW_MSG1 = `🍽 先日はありがとうございました

先日はお越しいただき
ありがとうございました！

お料理、お楽しみいただけましたか？

次回のご予約は
下のメニュー「席を予約する」から
そのまま取れます。

またのお越しをお待ちしています。`;

const REST_FOLLOW_MSG2 = `🍽 そろそろもう一度、いかがですか？

前回のご来店から
そろそろ1ヶ月になりますね。

ご登録時の特典の期限も
近づいてきました。

「そういえばあそこ
また行きたかった」という方、
このタイミングでぜひ。

▼ 席を予約する`;

const REST_FOLLOW_MSG3 = `💡 来店後フォローはLINEが一番効く
━━━━━━━━━━━━

新規集客より
一度来た人をもう一度呼ぶほうが
ずっと少ない手間で済むんですよね。

このデモみたいに
✅ 来店後3日目にお礼
✅ 1ヶ月後にリマインド
を自動で届く流れにしておくと、
「忘れてただけ」を防げます。

文面・タイミング・特典の中身は
お店に合わせて変えられます。

この後、その2通の例をお送りします。`;

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
  '飲食_登録ガチャ表示':    { kind: 'flex', content: GACHA_PRODUCTION_FLEX, altText: '登録ガチャ' },
  '飲食_ガチャ結果表示':    { actionTagId: T.rest_gacha,     kind: 'flex', contentOptions: REST_GACHA_RESULTS, altText: '登録ガチャ結果' },
  '飲食_予約フォーム表示':  { actionTagId: T.rest_form,      kind: 'form', formId: F.rest_form,       altText: '飲食店予約フォーム' },
  '飲食_おすすめ表示':      { actionTagId: T.rest_recommend, kind: 'flex', content: REST_RECOMMEND_FLEX, altText: '本日のおすすめ' },
  '飲食_来店後フォロー表示':{ actionTagId: T.rest_coupon,    kind: 'text', contentMultiple: [REST_FOLLOW_MSG3, REST_FOLLOW_MSG1, REST_FOLLOW_MSG2] },
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
