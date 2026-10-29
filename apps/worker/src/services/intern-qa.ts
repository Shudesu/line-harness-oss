// インターン（すごい大学生ズ）のメニュー「Q&A」。
//
// 押すと、よくある質問を種類ごとのカードに分けて横にめくれる形（カルーセル）で送る。
// カードの質問を押すと、その回答をカードで返す（カードの下に［ほかの質問を見る］を付ける）。
// トーク下に並ぶボタン（クイックリプライ）は見た目がよくないので使わない。
// 質問と回答の中身はたたき台（10/29）。中身を変えるときは QA_SECTIONS だけ直せばよい。
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
    title: 'このLINEについて',
    items: [
      {
        id: 'about',
        q: 'このLINEでは何ができますか？',
        a: '長期インターンの求人を探したり、就活やインターンに役立つ講座を見たりできます。\n\n画面下のメニューからご覧ください。',
      },
      {
        id: 'fee',
        q: '利用にお金はかかりますか？',
        a: '学生の方の利用料はかかりません。求人を見る・講座を見る・応募するのは、すべて無料です。',
      },
      {
        id: 'longintern',
        q: '長期インターンとは何ですか？',
        a: '数か月以上、企業の一員として実際の仕事に関わる働き方を指す場合が多いです。\n\n多くは給与が出て、週に何日か、授業の合間に働きます。勤務の日数や時間は求人ごとに違います。',
      },
    ],
  },
  {
    title: '求人・応募について',
    items: [
      {
        id: 'search',
        q: '求人はどこで見られますか？',
        a: 'メニューの「求人を探す」から見られます。職種で分かれているほか、勤務地や条件で絞り込んだり、気になる求人をお気に入りに残したりできます。',
      },
      {
        id: 'apply',
        q: '応募するにはどうすればいいですか？',
        a: '応募の受け付けは、現在準備中です。始まりましたら、このLINEでお知らせします。\n\nそれまでの間も、求人の中身はご覧いただけます。',
      },
      {
        id: 'selection',
        q: '応募したあとの流れは？',
        a: '選考の流れは求人ごとに違います。求人の詳しい画面で、面接の回数などの流れを確認できます。\n\n応募した求人の進み具合は、メニューの「応募状況」から見られます。',
      },
      {
        id: 'beginner',
        q: '経験がなくても応募できますか？',
        a: '経験を問わない求人もあります。応募の条件は求人ごとに違うため、求人の詳しい画面の「応募資格」をご確認ください。',
      },
    ],
  },
  {
    title: '登録内容について',
    items: [
      {
        id: 'profile',
        q: '大学名や学年を変更したい',
        a: 'メニューの「マイページ」から変更できます。アンケートで答えた内容も、そこで直せます。',
      },
      {
        id: 'privacy',
        q: '登録した情報は企業に伝わりますか？',
        a: '求人を見ているだけでは、企業にお名前や連絡先は伝わりません。\n\n情報の取り扱いについては、プライバシーポリシーをご覧ください。',
      },
    ],
  },
  {
    title: '講座・そのほか',
    items: [
      {
        id: 'course',
        q: '講座はどこで見られますか？',
        a: 'メニューの「会員サイト」から見られます。就活やインターンに役立つ講座を、無料でご覧いただけます。',
      },
      {
        id: 'contact',
        q: '質問や相談をしたい',
        a: 'このトークにメッセージを送ってください。運営が確認して、順番にお返事します。\n\nお返事まで数日かかる場合があります。',
      },
      {
        id: 'mute',
        q: '通知を止めたい',
        a: 'トーク画面右上のメニューから、通知をオフにできます。オフにしても、メニューや求人はこれまでどおりご覧いただけます。',
      },
    ],
  },
];

export const QA_PREFIX = 'qa';

// カードの見た目はアンケートのカード（クリーム）にそろえる
const CREAM = '#f6f1e7';
const INK = '#3a3a3a';
const SUB = '#8a7f6a';
const LINE = '#e3dccd';

function questionRow(prefix: string, item: QaItem): Msg {
  return {
    type: 'box',
    layout: 'horizontal',
    paddingAll: '12px',
    cornerRadius: '8px',
    borderWidth: '1px',
    borderColor: LINE,
    backgroundColor: '#ffffff',
    action: { type: 'postback', label: item.q.slice(0, 40), data: `${prefix}${QA_PREFIX}:${item.id}`, displayText: item.q },
    contents: [
      { type: 'text', text: item.q, size: 'sm', color: INK, wrap: true, flex: 1 },
      { type: 'text', text: '›', size: 'md', color: SUB, flex: 0, gravity: 'center' },
    ],
  };
}

/** よくある質問のカルーセル。prefix はボタンの合図の頭（アンケートと同じ isv: を使う） */
export function buildQaCarousel(prefix: string): Msg {
  return {
    type: 'flex',
    altText: 'よくある質問です。気になる質問を押してください。',
    contents: {
      type: 'carousel',
      contents: QA_SECTIONS.map((s, i) => ({
        type: 'bubble',
        size: 'kilo',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: CREAM,
          paddingAll: '16px',
          contents: [
            { type: 'text', text: `よくある質問 ${i + 1}/${QA_SECTIONS.length}`, size: 'xxs', color: SUB },
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

export function findQa(id: string): QaItem | undefined {
  for (const s of QA_SECTIONS) {
    const hit = s.items.find((i) => i.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** 質問のボタンを押したときの回答。知らない質問（古いカード等）ならカルーセルを出し直す */
export function buildQaAnswer(prefix: string, id: string): Msg {
  const item = findQa(id);
  if (!item) return buildQaCarousel(prefix);
  return {
    type: 'flex',
    altText: item.a,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        backgroundColor: CREAM,
        paddingAll: '16px',
        contents: [
          { type: 'text', text: 'よくある質問', size: 'xxs', color: SUB },
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
            action: { type: 'postback', label: 'ほかの質問を見る', data: `${prefix}${QA_PREFIX}`, displayText: 'ほかの質問を見る' },
            contents: [{ type: 'text', text: 'ほかの質問を見る', size: 'sm', color: SUB, align: 'center' }],
          },
        ],
      },
    },
  };
}
