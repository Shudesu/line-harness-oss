// インターン（すごい大学生ズ）のメニュー「Q&A」。
//
// 押すと、よくある質問を種類ごとのカードに分けて横にめくれる形（カルーセル）で送る。
// カードの質問を押すと、その回答をカードで返す（カードの下に［ほかの質問を見る］を付ける）。
// トーク下に並ぶボタン（クイックリプライ）は見た目がよくないので使わない。
// 質問と回答の中身は 11/02 版（そーごの直しを反映・4枚×3問）。
// カードの大きさをそろえるため、どのカードも3問ずつにし、質問の行は高さを固定する（2行まで）。
// ここの QA_SECTIONS は初期の中身。管理画面の「自動で送る文面」で直した中身があればそちらを使う（intern-copy.ts）。
// 回答は LINE 配信の決まりに合わせる（です・ます・200字以内・絵文字なし・断定を避ける）。

type Msg = Record<string, unknown>;

export interface QaItem {
  /** ボタンの合図に使う短い名前。公開後に変えると、古いカードのボタンが効かなくなる */
  id: string;
  q: string;
  a: string;
}

export interface QaSection {
  title: string;
  items: QaItem[];
}

export const QA_SECTIONS: QaSection[] = [
  {
    title: '求人について',
    items: [
      {
        id: 'jobs-what',
        q: 'どんな求人が掲載されていますか？',
        a: 'KIDOUインターンの運営が企業を選び、直接お声がけした企業の求人だけを掲載します。\n\n企業から申し込みがあったからといって、無条件に掲載することはありません。',
      },
      {
        id: 'jobs-diff',
        q: 'ほかの求人サイトと何が違いますか？',
        a: 'KIDOUインターンでは、大学生が実際に働く姿や職場の雰囲気を、学生目線の取材動画で紹介します。\n\nさらに、入社直後に任される仕事から、その先に挑戦できる仕事までを段階的に掲載。\n\n企業の説明だけではわからない「働くリアル」を知ったうえで、応募先を選べることが特徴です。',
      },
      {
        id: 'jobs-check',
        q: '求人の内容は、誰が確認していますか？',
        a: 'すべての求人について、掲載前に運営が内容を確認しています。\n\nまた、掲載中に企業が求人内容を変更した場合も、運営による再確認が完了するまで変更は反映されません。',
      },
    ],
  },
  {
    title: '会員サイトについて',
    items: [
      {
        id: 'academy-what',
        q: '会員サイトでは何を学べますか？',
        a: '長期インターンの基礎知識から、企業が学生を採用する理由、就職活動との関係まで、大学生のうちに知っておきたいことを学べます。\n\n図解や音声を使った講座なので、通学中などのすき間時間にも学習できます。',
      },
      {
        id: 'academy-how',
        q: '会員サイトは、どうすれば利用できますか？',
        a: 'このLINEに登録していれば、メニューの「会員サイト」から無料で利用できます。\n\nスマホからそのまま開けるので、新しいアプリのインストールも不要です。\n\n現在は公開準備中です。公開時には、このLINEでお知らせします。',
      },
      {
        id: 'academy-no-apply',
        q: '求人に応募しなくても利用できますか？',
        a: 'もちろん利用できます。\n\n今すぐ長期インターンを始める予定がなくても、講座を見たり、企業について調べたりするだけで問題ありません。\n\nまずは長期インターンについて知るところから始めてみてください。',
      },
    ],
  },
  {
    title: 'このLINEについて',
    items: [
      {
        id: 'fee',
        q: '利用にお金はかかりますか？',
        a: '大学生の方は、すべて無料で利用できます。\n\n求人の閲覧、講座の受講、企業への応募に費用はかかりません。',
      },
      {
        id: 'privacy',
        q: '登録した個人情報は、企業に伝わりますか？',
        a: '求人を閲覧したり、講座を受講したりするだけで、企業にお名前や連絡先が伝わることはありません。\n\n企業への応募時には、応募に必要な情報を共有する場合があります。\n\n詳しくはプライバシーポリシーをご確認ください。',
      },
      {
        id: 'no-experience',
        q: '未経験でも長期インターンに応募できますか？',
        a: '応募できるかどうかは、企業や求人によって異なります。\n\n未経験の学生を対象とした求人も掲載できる仕組みですので、各求人の応募条件や求める人物像を確認してみてください。\n\n初めての長期インターンでも、自分に合う企業を探せるよう情報を整理して掲載します。',
      },
    ],
  },
  {
    title: '困ったとき',
    items: [
      {
        id: 'profile',
        q: '大学名や学年などの登録情報を変更したい',
        a: 'メニューの「マイページ」から変更できます。\n\n最初のアンケートで回答した情報も、マイページから修正できます。',
      },
      {
        id: 'contact',
        q: '質問や相談をしたい',
        a: 'このLINEのトークに、そのままメッセージを送ってください。\n\nサービスの使い方や求人に関するご質問を運営が確認し、順番にお返事します。\n\n※返信まで数日かかる場合があります。',
      },
      {
        id: 'mute',
        q: 'LINEの通知を止めたい',
        a: 'LINEのトーク画面から通知をオフにできます。\n\n通知をオフにしても、メニューや会員サイトはこれまでどおり利用できます。',
      },
    ],
  },
];

export const QA_PREFIX = 'qa';
// 回答カードの［ほかの質問を見る］。メニューの Q&A（qa）と分けて、メニューの押された回数に混ざらないようにする
export const QA_MORE = 'qamore';

// カードの見た目はアンケートのカード（クリーム）にそろえる
const CREAM = '#f6f1e7';
const INK = '#3a3a3a';
const SUB = '#8a7f6a';
const LINE = '#e3dccd';
// 質問の行の高さ。2行の質問が収まる高さで全部そろえる
const ROW_HEIGHT = '56px';

function questionRow(prefix: string, item: QaItem): Msg {
  return {
    type: 'box',
    layout: 'horizontal',
    height: ROW_HEIGHT,
    paddingStart: '12px',
    paddingEnd: '12px',
    cornerRadius: '8px',
    borderWidth: '1px',
    borderColor: LINE,
    backgroundColor: '#ffffff',
    action: { type: 'postback', label: item.q.slice(0, 40), data: `${prefix}${QA_PREFIX}:${item.id}`, displayText: item.q },
    contents: [
      { type: 'text', text: item.q, size: 'sm', color: INK, wrap: true, maxLines: 2, flex: 1, gravity: 'center' },
      { type: 'text', text: '›', size: 'md', color: SUB, flex: 0, gravity: 'center' },
    ],
  };
}

/** よくある質問のカルーセル。prefix はボタンの合図の頭（アンケートと同じ isv: を使う） */
export function buildQaCarousel(prefix: string, sections: QaSection[] = QA_SECTIONS): Msg {
  return {
    type: 'flex',
    altText: 'よくある質問です。気になる質問を押してください。',
    contents: {
      type: 'carousel',
      contents: sections.map((s, i) => ({
        type: 'bubble',
        size: 'kilo',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: CREAM,
          paddingAll: '16px',
          contents: [
            { type: 'text', text: `よくある質問 ${i + 1}/${sections.length}`, size: 'xxs', color: SUB },
            { type: 'text', text: s.title, weight: 'bold', size: 'md', color: INK, wrap: true },
          ],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          backgroundColor: CREAM,
          paddingTop: '0px',
          contents: s.items.map((item) => questionRow(prefix, item)),
        },
      })),
    },
  };
}

export function findQa(id: string, sections: QaSection[] = QA_SECTIONS): QaItem | undefined {
  for (const s of sections) {
    const hit = s.items.find((i) => i.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** 質問のボタンを押したときの回答。知らない質問（古いカード等）ならカルーセルを出し直す */
export function buildQaAnswer(
  prefix: string,
  id: string,
  sections: QaSection[] = QA_SECTIONS,
  labels: { answerKicker: string; more: string } = { answerKicker: 'よくある質問', more: 'ほかの質問を見る' },
): Msg {
  const item = findQa(id, sections);
  if (!item) return buildQaCarousel(prefix, sections);
  return {
    type: 'flex',
    altText: item.a.slice(0, 400), // LINE の決まりで400字まで
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        backgroundColor: CREAM,
        paddingAll: '16px',
        contents: [
          { type: 'text', text: labels.answerKicker, size: 'xxs', color: SUB },
          { type: 'text', text: item.q, weight: 'bold', size: 'md', color: INK, wrap: true },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        backgroundColor: CREAM,
        paddingTop: '0px',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            cornerRadius: '8px',
            backgroundColor: '#ffffff',
            contents: [{ type: 'text', text: item.a, size: 'sm', color: INK, wrap: true }],
          },
          {
            type: 'box',
            layout: 'vertical',
            paddingAll: '10px',
            cornerRadius: '8px',
            borderWidth: '1px',
            borderColor: LINE,
            action: { type: 'postback', label: labels.more.slice(0, 20), data: `${prefix}${QA_MORE}`, displayText: labels.more.slice(0, 300) },
            contents: [{ type: 'text', text: labels.more, size: 'sm', color: SUB, align: 'center' }],
          },
        ],
      },
    },
  };
}
