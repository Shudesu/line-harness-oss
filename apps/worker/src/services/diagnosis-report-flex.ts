type DiagnosisKey = '1' | '2' | '3' | '4';

type ScoreItem = {
  label: string;
  score: number;
  note: string;
};

type NeedConfig = {
  answerLabel: string;
  title: string;
  lead: string;
  focusLabel: string;
  scores: ScoreItem[];
};

type LineStateConfig = {
  label: string;
};

type IndustryConfig = {
  label: string;
  phrase: string;
};

type VariantConfig = {
  currentText: string;
  growthText: string;
  actions: string[];
  recommendations: string[];
};

const COLORS = {
  black: '#111111',
  charcoal: '#1F1F1F',
  darkGray: '#4A4A4A',
  mediumGray: '#8A8A8A',
  lightGray: '#DCDCDC',
  softGray: '#EFEFEF',
  cream: '#FBF8F2',
  white: '#FFFFFF',
  warmGreen: '#F2FBF6',
  paleGreen: '#EAF8F0',
  brandGreen: '#20A562',
  lineGreen: '#06C755',
  orange: '#FF6841',
};

const NEEDS: Record<DiagnosisKey, NeedConfig> = {
  '1': {
    answerLabel: 'リピート強化',
    title: 'まず整えるのは「来店後フォロー」です',
    lead: '一度来てくれた人に、もう一度思い出してもらう流れを作ると成果につながりやすい状態です。',
    focusLabel: 'リピート導線',
    scores: [
      { label: '集客入口', score: 62, note: '入口は作れています' },
      { label: '興味づけ', score: 66, note: '関係性は育てられます' },
      { label: '予約導線', score: 58, note: 'もう少し短くできます' },
      { label: 'リピート導線', score: 42, note: 'ここが一番の伸びしろ' },
    ],
  },
  '2': {
    answerLabel: '客単価向上',
    title: 'まず整えるのは「メニュー提案の流れ」です',
    lead: 'お客さんがまだ知らないメニューを自然に見せると、売り込み感なく単価アップを狙いやすい状態です。',
    focusLabel: '興味づけ',
    scores: [
      { label: '集客入口', score: 64, note: '入口は作れています' },
      { label: '興味づけ', score: 44, note: 'ここが一番の伸びしろ' },
      { label: '予約導線', score: 61, note: 'あと一歩で強くできます' },
      { label: 'リピート導線', score: 56, note: '提案とつなげられます' },
    ],
  },
  '3': {
    answerLabel: '業務効率化',
    title: 'まず整えるのは「対応の自動化」です',
    lead: '毎回同じ説明や確認をしている作業をLINEに任せると、対応漏れを減らしながら時間を空けやすい状態です。',
    focusLabel: '対応効率化',
    scores: [
      { label: '集客入口', score: 60, note: '登録理由は作れています' },
      { label: '興味づけ', score: 70, note: 'あと一歩で強くできます' },
      { label: '対応効率化', score: 45, note: 'ここが一番の伸びしろ' },
      { label: 'リピート導線', score: 65, note: '自動化で安定します' },
    ],
  },
  '4': {
    answerLabel: '休眠掘り起こし',
    title: 'まず整えるのは「休眠フォロー」です',
    lead: 'しばらく来ていない人に、無理なく思い出してもらう流れを作ると戻ってくる理由を作りやすい状態です。',
    focusLabel: '休眠フォロー',
    scores: [
      { label: '集客入口', score: 55, note: '入口は見直せます' },
      { label: '興味づけ', score: 52, note: '再接点を作れます' },
      { label: '予約導線', score: 59, note: '戻り道を短くできます' },
      { label: '休眠フォロー', score: 40, note: 'ここが一番の伸びしろ' },
    ],
  },
};

const LINE_STATES: Record<DiagnosisKey, LineStateConfig> = {
  '1': { label: '未運用' },
  '2': { label: '公式のみ未活用' },
  '3': { label: '手動配信中' },
  '4': { label: '拡張ツール運用中' },
};

const VARIANTS: Record<`${DiagnosisKey}-${DiagnosisKey}`, VariantConfig> = {
  '1-1': {
    currentText: 'まだお客さんと継続的につながる場所が弱く、来店後に思い出してもらうきっかけを作れていない状態です。',
    growthText: 'まずLINE登録の入口と来店後のお礼をセットにすると、次回来店のきっかけを無理なく作れます。',
    actions: [
      'お会計や来店後にLINE登録の案内を出す',
      '登録直後にお礼と次回案内を送る',
      '1ヶ月後に思い出してもらうメッセージを用意する',
    ],
    recommendations: [
      '最初はクーポンより「次回来店の理由」を1つ作る',
      '来店3日後に、お礼とおすすめを短く送る',
      '再来店した人をタグで分け、次の案内に使う',
    ],
  },
  '1-2': {
    currentText: 'LINEアカウントはありますが、来店後に自動でフォローする流れがまだ弱い状態です。',
    growthText: '今あるアカウントに来店後フォローを1つ足すだけで、忘れられる前に次の接点を作れます。',
    actions: [
      '来店後のお礼メッセージを1つ作る',
      '次回来店につながる案内を短く入れる',
      '反応した人だけに予約導線を出す',
    ],
    recommendations: [
      '来店3日後に、お礼と次回提案を送る',
      '一斉配信より先に、来店後フォローを固定化する',
      '次回予約ボタンをメッセージ内に1つだけ置く',
    ],
  },
  '1-3': {
    currentText: '手動配信はできていますが、来店後のフォローが毎回の作業になりやすい状態です。',
    growthText: '手動配信を続けながら、来店後フォローだけ自動化すると、負担を増やさず再来店の機会を増やせます。',
    actions: [
      '来店後フォローだけ自動化する',
      '手動配信はキャンペーンや近況案内に残す',
      '再来店した人をタグで分ける',
    ],
    recommendations: [
      '来店3日後の定型メッセージを作る',
      '14日後か30日後に、軽いリマインドを入れる',
      '手動配信と自動フォローの役割を分ける',
    ],
  },
  '1-4': {
    currentText: 'すでに仕組みはありますが、来店後フォローのタイミングや内容を見直す余地があります。',
    growthText: '既存の導線を少し調整するだけで、再来店につながる反応を取りやすくなります。',
    actions: [
      '来店後フォローのタイミングを確認する',
      'お礼だけでなく次回提案まで入れる',
      '再来店率を見て文面を調整する',
    ],
    recommendations: [
      '来店3日後の文面を「お礼+次回提案」に変える',
      '反応率と予約クリックを見て改善する',
      '休眠前のタイミングで軽い案内を入れる',
    ],
  },
  '2-1': {
    currentText: 'まだLINEで後から案内する接点が弱く、良いメニューがあっても知ってもらう機会が少ない状態です。',
    growthText: 'まず登録の入口を作り、登録直後におすすめを1つだけ見せると、自然に単価アップのきっかけを作れます。',
    actions: [
      '登録直後におすすめメニューを1つ見せる',
      'メニューの選び方を短く案内する',
      '興味がある人だけ詳しい案内へ進める',
    ],
    recommendations: [
      '「初めての方におすすめ」を1つだけ用意する',
      '高単価メニューを売り込まず、合う人を説明する',
      '反応した人にだけ予約導線を出す',
    ],
  },
  '2-2': {
    currentText: 'LINEアカウントはありますが、メニューやサービスの魅力を見せる流れがまだ弱い状態です。',
    growthText: '今あるアカウントにおすすめ案内を1つ足すだけで、知られていないメニューに気づいてもらえます。',
    actions: [
      'おすすめメニューを1つに絞る',
      '誰に合うメニューかを短く書く',
      '予約ボタンまでの流れを近くに置く',
    ],
    recommendations: [
      '月1回、知られていないメニューを1つだけ紹介する',
      '「こういう方に合います」の形で案内する',
      '詳しく知りたい人だけ次の案内へ進める',
    ],
  },
  '2-3': {
    currentText: '手動配信はできていますが、配信内容が告知中心になると、単価につながる提案が埋もれやすい状態です。',
    growthText: '今の配信におすすめ提案を1つ混ぜるだけで、知らなかったメニューを選ぶきっかけを作れます。',
    actions: [
      '手動配信におすすめ枠を1つ作る',
      '前回利用した内容に近い提案を入れる',
      '反応した人を次回提案用に分ける',
    ],
    recommendations: [
      '月1回の配信に、追加メニューの紹介を入れる',
      'メニュー一覧ではなく1つだけ推す',
      'クリックした人だけに詳しい案内を送る',
    ],
  },
  '2-4': {
    currentText: 'すでに仕組みはありますが、メニュー提案の出し分けやタイミングに改善余地があります。',
    growthText: '既存のタグや行動データを使えば、売り込み感を抑えた個別提案に近づけられます。',
    actions: [
      '利用メニュー別に提案を出し分ける',
      'クリックや回答で興味を分ける',
      '高単価メニューへの導線を自然に置く',
    ],
    recommendations: [
      '前回利用メニューに合わせたおすすめを出す',
      'クリックした人だけに詳しい説明を送る',
      '単価より「次に試す理由」を先に見せる',
    ],
  },
  '3-1': {
    currentText: '問い合わせや事前確認が人の手に寄っていて、同じ説明を何度も返しやすい状態です。',
    growthText: 'まずよくある質問と確認事項をLINEにまとめるだけで、対応漏れを減らしながら時間を空けられます。',
    actions: [
      'よくある問い合わせの回答を3つだけ用意する',
      '事前確認をフォームで受け取る流れを作る',
      '登録直後に自動返信で案内を返す',
    ],
    recommendations: [
      '最初は説明の繰り返しが多い内容から自動化する',
      'フォーム項目は確認に必要なものだけに絞る',
      '回答内容で問い合わせ種別のタグを付ける',
    ],
  },
  '3-2': {
    currentText: 'LINEアカウントの土台はありますが、問い合わせ対応や事前確認にはまだ使い切れていない状態です。',
    growthText: '今あるアカウントに自動返信とフォームを足すだけで、毎回の説明や確認をかなり軽くできます。',
    actions: [
      'よく聞かれる質問を自動返信に入れる',
      '事前確認フォームを1つ用意する',
      '回答内容で対応優先度を分ける',
    ],
    recommendations: [
      '手入力で返している定型文から先に置き換える',
      'フォーム送信後に受付完了メッセージを返す',
      '回答済みの人だけ次の案内へ進める',
    ],
  },
  '3-3': {
    currentText: '手動配信はできていますが、問い合わせ返信や説明文まで毎回手で整えていて負担が残りやすい状態です。',
    growthText: '手動配信は残しつつ、定型の説明・確認・リマインドだけ自動化すると運用がかなり軽くなります。',
    actions: [
      '毎回送っている説明文をテンプレ化する',
      'フォーム回答後の自動返信を用意する',
      '未回答者だけにリマインドを送る',
    ],
    recommendations: [
      '手動配信と自動返信の役割を分ける',
      '回答済み、未回答、要対応をタグで分ける',
      'リマインドは全員ではなく未完了者だけに送る',
    ],
  },
  '3-4': {
    currentText: 'すでに仕組みはありますが、手動対応が残っている箇所やタグ分けの粗さを見直す余地があります。',
    growthText: '既存のフォーム、自動返信、リマインド、タグを整理すると、対応の抜け漏れを減らしながら運用を軽くできます。',
    actions: [
      '手動で残っている対応を洗い出す',
      'フォーム回答ごとの自動返信を見直す',
      'タグ分けとリマインド条件を整理する',
    ],
    recommendations: [
      '問い合わせ種別ごとに自動返信を分ける',
      '要対応、対応済み、未回答をタグで見える化する',
      'リマインド条件が広すぎないか確認する',
    ],
  },
  '4-1': {
    currentText: '今はまだLINEで継続接点を作る前の段階なので、既存の休眠客をLINEだけで戻すより、次回来店以降に離れにくくする入口作りが先です。',
    growthText: '来店時の登録案内と来店後フォローをセットにすると、次回来店以降に休眠させない接点を作れます。',
    actions: [
      '来店時にLINE登録の案内を出す',
      '登録直後にお礼と次回案内を返す',
      '30日後に軽いリマインドを送る',
    ],
    recommendations: [
      '既存休眠客の掘り起こしより、まず今来ている人を離さない',
      '登録理由は強い割引より次回に役立つ案内にする',
      '再来店した人をタグで分け、次のフォローに使う',
    ],
  },
  '4-2': {
    currentText: 'LINEアカウントはありますが、しばらく来ていない人へ自然に声をかける流れがまだ弱い状態です。',
    growthText: '来店からの期間で分けて案内できると、休眠する前に戻るきっかけを作れます。',
    actions: [
      '最終来店からの期間で相手を分ける',
      '久しぶりの人向けの短い案内を作る',
      '戻りやすい予約ボタンを一緒に置く',
    ],
    recommendations: [
      '30日以上来ていない人に軽い近況案内を送る',
      '限定クーポンより先に「思い出す理由」を作る',
      '反応した人だけに予約導線を出して、押しすぎない',
    ],
  },
  '4-3': {
    currentText: '手動配信はできていますが、休眠しそうな人だけを分けて後追いする流れが作りにくい状態です。',
    growthText: '一斉配信とは別に、未反応・未来店の人だけへ軽く声をかける流れを作ると戻りやすくなります。',
    actions: [
      '未反応の人を分ける条件を決める',
      '休眠前の軽いリマインドを作る',
      '反応した人だけに予約案内を出す',
    ],
    recommendations: [
      '一斉配信と休眠フォローを分ける',
      '最初は「最近どうですか」くらい軽くする',
      '戻ってきた人を次回フォローへつなげる',
    ],
  },
  '4-4': {
    currentText: 'すでに仕組みはありますが、休眠前後のセグメントや文面を調整すると戻るきっかけを増やせます。',
    growthText: '既存のタグや配信履歴を使えば、離れそうな人にだけ自然なフォローを出せます。',
    actions: [
      '未反応期間でセグメントを見直す',
      '休眠前と休眠後の文面を分ける',
      '戻ってきた人の次回フォローを用意する',
    ],
    recommendations: [
      '30日、60日など期間別に文面を分ける',
      '強い割引より先に、戻る理由を提示する',
      '反応率と予約クリックで文面を調整する',
    ],
  },
};

const INDUSTRIES: Record<DiagnosisKey, IndustryConfig> = {
  '1': { label: '美容サロン', phrase: '予約前後の不安を減らす見せ方が効きやすい業種です。' },
  '2': { label: 'フィットネス', phrase: '継続のきっかけを作る導線が効きやすい業種です。' },
  '3': { label: '教育・教室', phrase: '体験前の不安を減らす案内が効きやすい業種です。' },
  '4': { label: '飲食店', phrase: '来店後の再来店導線が効きやすい業種です。' },
};

function text(text: string, options: Record<string, unknown> = {}) {
  return { type: 'text', text, ...options };
}

function box(layout: 'vertical' | 'horizontal', contents: unknown[], options: Record<string, unknown> = {}) {
  return { type: 'box', layout, contents, ...options };
}

function separator(margin = 'lg') {
  return { type: 'separator', margin, color: COLORS.softGray };
}

function sectionTitle(label: string) {
  return box('horizontal', [
    box('vertical', [], {
      width: '4px',
      height: '16px',
      backgroundColor: COLORS.brandGreen,
      cornerRadius: 'xxl',
      flex: 0,
    }),
    text(label, {
      size: 'md',
      weight: 'bold',
      color: COLORS.black,
      flex: 1,
    }),
  ], {
    spacing: 'sm',
    margin: 'xl',
  });
}

function scoreCard(item: ScoreItem, isFocus: boolean) {
  const color = isFocus ? COLORS.orange : COLORS.brandGreen;
  return box('vertical', [
    box('horizontal', [
      text(item.label, { size: 'sm', weight: 'bold', color: COLORS.black, flex: 1, wrap: true }),
      text(String(item.score), { size: 'xl', weight: 'bold', color: COLORS.black, align: 'end', flex: 0 }),
      text('/100', { size: 'xs', weight: 'bold', color: COLORS.mediumGray, align: 'end', flex: 0 }),
    ]),
    box('vertical', [
      box('vertical', [], {
        width: `${item.score}%`,
        height: '6px',
        backgroundColor: color,
        cornerRadius: 'xxl',
      }),
    ], {
      height: '6px',
      backgroundColor: COLORS.softGray,
      cornerRadius: 'xxl',
      margin: 'sm',
    }),
    text(item.note, { size: 'xs', weight: 'bold', color: COLORS.darkGray, wrap: true, margin: 'sm' }),
  ], {
    borderColor: COLORS.softGray,
    borderWidth: '1px',
    cornerRadius: 'lg',
    paddingAll: '12px',
    flex: 1,
  });
}

function scoreRows(need: NeedConfig) {
  const firstRow = need.scores.slice(0, 2).map((item) => scoreCard(item, item.label === need.focusLabel));
  const secondRow = need.scores.slice(2, 4).map((item) => scoreCard(item, item.label === need.focusLabel));
  return [
    box('horizontal', firstRow, { spacing: 'md', margin: 'md' }),
    box('horizontal', secondRow, { spacing: 'md', margin: 'md' }),
  ];
}

function statusCard(label: string, body: string, highlighted = false) {
  return box('horizontal', [
    box('vertical', [
      text(label === '伸びしろ' ? '伸' : '今', {
        size: 'xs',
        weight: 'bold',
        color: COLORS.brandGreen,
        align: 'center',
      }),
    ], {
      width: '30px',
      height: '30px',
      backgroundColor: COLORS.cream,
      cornerRadius: 'md',
      justifyContent: 'center',
      flex: 0,
    }),
    box('vertical', [
      text(label, { size: 'sm', weight: 'bold', color: COLORS.black }),
      text(body, { size: 'sm', color: COLORS.darkGray, wrap: true, margin: 'xs', lineSpacing: '4px' }),
    ], { flex: 1 }),
  ], {
    spacing: 'md',
    paddingAll: '14px',
    borderColor: highlighted ? '#BFE8D1' : COLORS.softGray,
    borderWidth: '1px',
    backgroundColor: highlighted ? COLORS.warmGreen : COLORS.white,
    cornerRadius: 'lg',
    margin: 'md',
  });
}

function numberedRows(items: string[]) {
  return items.map((item, index) => box('horizontal', [
    box('vertical', [
      text(String(index + 1), {
        size: 'xxs',
        weight: 'bold',
        color: COLORS.brandGreen,
        align: 'center',
      }),
    ], {
      width: '22px',
      height: '22px',
      backgroundColor: COLORS.paleGreen,
      cornerRadius: 'xxl',
      justifyContent: 'center',
      flex: 0,
    }),
    text(item, { size: 'sm', weight: 'bold', color: COLORS.charcoal, wrap: true, flex: 1 }),
  ], {
    spacing: 'sm',
    margin: index === 0 ? 'md' : 'sm',
  }));
}

function checkRows(items: string[]) {
  return items.map((item, index) => box('horizontal', [
    box('vertical', [
      text('✓', {
        size: 'xs',
        weight: 'bold',
        color: COLORS.white,
        align: 'center',
      }),
    ], {
      width: '22px',
      height: '22px',
      backgroundColor: COLORS.lineGreen,
      cornerRadius: 'xxl',
      justifyContent: 'center',
      flex: 0,
    }),
    text(item, { size: 'sm', color: COLORS.darkGray, wrap: true, flex: 1, lineSpacing: '4px' }),
  ], {
    spacing: 'sm',
    margin: index === 0 ? 'md' : 'sm',
  }));
}

export function buildMiniDiagnosisReportFlex(options: {
  need: DiagnosisKey;
  lineState: DiagnosisKey;
  industry: DiagnosisKey;
  displayName?: string | null;
}) {
  const need = NEEDS[options.need];
  const lineState = LINE_STATES[options.lineState];
  const industry = INDUSTRIES[options.industry];
  const variant = VARIANTS[`${options.need}-${options.lineState}`];

  return {
    type: 'bubble',
    size: 'giga',
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '22px',
      backgroundColor: COLORS.white,
      contents: [
        box('horizontal', [
          text('八巻翔太 / LINEマーケター', {
            size: 'xxs',
            weight: 'bold',
            color: COLORS.darkGray,
            flex: 1,
          }),
          text('ミニ診断レポート', {
            size: 'xxs',
            weight: 'bold',
            color: COLORS.brandGreen,
            align: 'end',
            flex: 0,
          }),
        ]),
        text(need.title, {
          size: 'xxl',
          weight: 'bold',
          color: COLORS.black,
          wrap: true,
          margin: 'xl',
        }),
        text(need.lead, {
          size: 'sm',
          color: COLORS.darkGray,
          wrap: true,
          margin: 'md',
          lineSpacing: '5px',
        }),
        box('vertical', [
          text('あなたのお店の場合', { size: 'sm', weight: 'bold', color: COLORS.black }),
          text(`${industry.label}は、${industry.phrase}`, {
            size: 'sm',
            color: COLORS.darkGray,
            wrap: true,
            margin: 'xs',
            lineSpacing: '4px',
          }),
        ], {
          backgroundColor: COLORS.warmGreen,
          borderColor: '#BFE8D1',
          borderWidth: '1px',
          cornerRadius: 'lg',
          paddingAll: '14px',
          margin: 'xl',
        }),

        separator('xl'),
        sectionTitle('4つの状態'),
        ...scoreRows(need),

        separator('xl'),
        sectionTitle('見えていること'),
        statusCard('今の状態', variant.currentText),
        statusCard('伸びしろ', variant.growthText, true),

        separator('xl'),
        sectionTitle('まず整えること'),
        ...numberedRows(variant.actions),

        separator('xl'),
        sectionTitle('おすすめの一手'),
        ...checkRows(variant.recommendations),

        text(`${options.displayName || 'あなた'}さんの回答: ${need.answerLabel} / ${lineState.label} / ${industry.label}`, {
          size: 'xs',
          color: COLORS.mediumGray,
          wrap: true,
          margin: 'xl',
        }),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '18px',
      backgroundColor: COLORS.warmGreen,
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: COLORS.brandGreen,
          height: 'md',
          action: {
            type: 'message',
            label: 'ちょっと相談する',
            text: 'ちょっと相談する',
          },
        },
        {
          type: 'button',
          style: 'secondary',
          height: 'md',
          margin: 'sm',
          action: {
            type: 'message',
            label: 'まず事例を見てみる',
            text: 'まず事例を見てみる',
          },
        },
        text('相談か事例、今の温度感に合わせて選べます。', {
          size: 'xs',
          color: COLORS.mediumGray,
          align: 'center',
          wrap: true,
          margin: 'md',
        }),
      ],
    },
  };
}
