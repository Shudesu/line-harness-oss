/**
 * PPAL 完全自動化移行スクリプト
 *
 * PPALナレッジ (L-Step-Setup/) から全タグ・全シナリオを LINE Harness に移行します。
 * 既存データを確認し、未登録のものだけを追加します。
 *
 * 実行方法:
 *   WORKER_URL=https://miyabi-line-crm.supernovasyun.workers.dev \
 *   API_KEY=my-super-secret-key-123 \
 *   npx tsx migrate-ppal-complete.ts
 */

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';
const API_KEY = process.env.API_KEY ?? '';

if (!API_KEY) {
  console.error('ERROR: API_KEY 環境変数を設定してください');
  process.exit(1);
}

// ============================================================
// 残り22タグ (all-tags-master.csv 行22-43)
// ============================================================
const REMAINING_TAGS = [
  // EN_009
  {
    name: 'Engagement:Week3_Complete',
    color: '#8B5CF6',
    description: 'Week3完了',
  },
  // OB_001-OB_008: オンボーディング進捗タグ
  {
    name: 'Onboarding:Step1_Welcome',
    color: '#3B82F6',
    description: 'ウェルカムメッセージ送信済み',
  },
  {
    name: 'Onboarding:Step2_Setup',
    color: '#3B82F6',
    description: 'セットアップガイド送信済み',
  },
  {
    name: 'Onboarding:Step3_FirstMCP',
    color: '#3B82F6',
    description: '初MCP配布完了',
  },
  {
    name: 'Onboarding:Step4_Community',
    color: '#3B82F6',
    description: 'コミュニティ招待送信',
  },
  {
    name: 'Onboarding:Step5_FirstWin',
    color: '#10B981',
    description: '初期成果確認',
  },
  {
    name: 'Onboarding:Nudge1_Sent',
    color: '#F59E0B',
    description: '1回目リマインド送信',
  },
  {
    name: 'Onboarding:Nudge2_Sent',
    color: '#F59E0B',
    description: '2回目リマインド送信',
  },
  {
    name: 'Onboarding:Completed',
    color: '#10B981',
    description: 'オンボーディング完了',
  },
  // SD_001-SD_006: 5Daysセミナータグ
  {
    name: '5Days:Day1_Attended',
    color: '#6366F1',
    description: 'Day1参加済み',
  },
  {
    name: '5Days:Day2_Attended',
    color: '#6366F1',
    description: 'Day2参加済み',
  },
  {
    name: '5Days:Day3_Attended',
    color: '#6366F1',
    description: 'Day3参加済み',
  },
  {
    name: '5Days:Day4_Attended',
    color: '#6366F1',
    description: 'Day4参加済み',
  },
  {
    name: '5Days:Day5_Attended',
    color: '#6366F1',
    description: 'Day5参加済み',
  },
  { name: '5Days:Completed', color: '#10B981', description: '5Days完走者' },
  // UP_001-UP_002: アップセルタグ
  {
    name: 'Upsell:VIP_Candidate',
    color: '#EF4444',
    description: 'VIP候補者',
  },
  {
    name: 'Upsell:VIP_Rejected',
    color: '#6B7280',
    description: 'VIPオファー辞退者',
  },
  // NT_001-NT_005: Note経由タグ
  { name: 'Note:NewFriend', color: '#8B5CF6', description: 'note経由の新規友だち' },
  {
    name: 'Note:Article_Read',
    color: '#3B82F6',
    description: '記事キーワード送信済み',
  },
  { name: 'Note:NOTE_001', color: '#6366F1', description: 'NOTE_001記事読者' },
  { name: 'Note:NOTE_002', color: '#6366F1', description: 'NOTE_002記事読者' },
  { name: 'Note:NOTE_003', color: '#6366F1', description: 'NOTE_003記事読者' },
];

// ============================================================
// PPALシナリオ全13本 (scenarios.md から)
// ============================================================
type ScenarioStep = {
  stepOrder: number;
  messageContent: string;
  messageType: 'text' | 'image' | 'flex';
  delayMinutes: number;
};

type Scenario = {
  name: string;
  triggerType: 'friend_add' | 'tag_added' | 'manual';
  description: string;
  steps: ScenarioStep[];
};

const PPAL_SCENARIOS: Scenario[] = [
  // SCN_001: Member_Onboarding (月額会員オンボーディング - 14日間)
  // NOTE: "Member_Onboarding" という名前が既に存在する場合はスキップ
  {
    name: 'PPAL_Member_Onboarding',
    triggerType: 'tag_added',
    description: '月額会員の初期オンボーディング（14日間）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          'PPAL Lab へようこそ！🎉\n\n月額メンバーシップにご参加いただきありがとうございます。\n\nこれからAIエージェントの世界を一緒に探求しましょう。\n\n【まず最初にやること】\n▶ Teachable にログイン\nhttps://shuhayas-s-school.teachable.com\n\nWeek1 Lesson1 から始めてみてください。約15分で視聴できます。',
        messageType: 'text',
        delayMinutes: 0,
      },
      {
        stepOrder: 2,
        messageContent:
          'おはようございます！🌟\n\nPPAL Lab へようこそ。\n昨日ご案内した学習ロードマップは確認いただけましたか？\n\n最初の一歩を踏み出すのが一番難しいと言われています。\n\n今日、Week1 Lesson1 を15分だけでも見てみませんか？\n\n▶ Week1を始める\nhttps://shuhayas-s-school.teachable.com\n\n質問があればいつでもどうぞ！',
        messageType: 'text',
        delayMinutes: 1440, // 1日後
      },
      {
        stepOrder: 3,
        messageContent:
          'こんにちは！\n\nPPAL Lab では、メンバー同士が情報交換できるコミュニティもご用意しています。\n\n【Discord コミュニティ】\n✅ 質問し放題\n✅ 実装事例の共有\n✅ 最新MCP情報をキャッチアップ\n\n孤独に学習するより、仲間と一緒に成長しませんか？\n\n▶ コミュニティに参加する\n（招待リンクは別途お送りします）',
        messageType: 'text',
        delayMinutes: 4320, // 3日後
      },
      {
        stepOrder: 4,
        messageContent:
          '1週間が経ちました！\n\n学習は順調ですか？\n\n途中で詰まったところがあれば、遠慮なくご質問ください。\n\n▶ 質問する\n（このLINEに返信でOKです）\n\n引き続きよろしくお願いします！',
        messageType: 'text',
        delayMinutes: 10080, // 7日後
      },
      {
        stepOrder: 5,
        messageContent:
          'PPAL Lab にご参加いただいて2週間が経ちました。\n\n【今月のライブ実装会のご案内】\n毎月開催しているライブ実装会でリアルタイムの質問・相談が可能です。\n\n📅 次回開催: 詳細は近日告知\n📍 オンライン（Zoom）\n\n▶ ライブ実装会に参加登録\n（案内が届いたらご登録ください）\n\nこれからもよろしくお願いします！',
        messageType: 'text',
        delayMinutes: 20160, // 14日後
      },
    ],
  },

  // SCN_002: Archive_Onboarding (アーカイブ会員オンボーディング - 14日間)
  {
    name: 'PPAL_Archive_Onboarding',
    triggerType: 'tag_added',
    description: 'アーカイブ購入者オンボーディング（14日間）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          'Agent Master Archive をご購入いただきありがとうございます！🎉\n\n5日間セミナーのアーカイブへのアクセスはこちら:\nhttps://shuhayas-s-school.teachable.com\n\n【収録内容】\nDay1: AI基礎とChatGPT\nDay2: プロンプトエンジニアリング\nDay3: MCPとエージェント構築\nDay4: 実践ワークショップ\nDay5: まとめと次のステップ\n\nご自身のペースで進めてください！',
        messageType: 'text',
        delayMinutes: 0,
      },
      {
        stepOrder: 2,
        messageContent:
          'アーカイブ学習は進んでいますか？\n\n【効率的な学習順序のご提案】\n\n初めての方:\n1️⃣ Day1: AI基礎とChatGPT\n2️⃣ Day2: プロンプトエンジニアリング\n3️⃣ Day3: MCPとエージェント構築\n4️⃣ Day4: 実践ワークショップ\n5️⃣ Day5: まとめ\n\nすでに経験がある方:\nDay3→Day4から始めるのもOKです!\n\n質問があれば、いつでもどうぞ！',
        messageType: 'text',
        delayMinutes: 4320, // 3日後
      },
      {
        stepOrder: 3,
        messageContent:
          'アーカイブ購入から2週間が経ちました。\n\n学習はいかがですか？\n\nもし、\n✅ もっと深く学びたい\n✅ 最新のMCP情報も欲しい\n✅ コミュニティで仲間と繋がりたい\n\nという気持ちがあれば、月額メンバーシップへのアップグレードもご検討ください。\n\n▶ メンバーシップ詳細を見る\nhttps://shuhayas-s-school.teachable.com\n\nもちろん、アーカイブだけでも十分に学べる内容になっています！',
        messageType: 'text',
        delayMinutes: 20160, // 14日後
      },
    ],
  },

  // SCN_003: VIP_Onboarding (VIPコーチングオンボーディング - 7日間)
  {
    name: 'PPAL_VIP_Onboarding',
    triggerType: 'tag_added',
    description: 'VIPコーチングオンボーディング（7日間）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          'VIPコーチングへようこそ！🌟\n\n個別サポートで、あなたの業務に特化したAI活用を一緒に設計します。\n\n【次のステップ】\n1. 事前ヒアリングシートのご記入（明日お送りします）\n2. 初回面談の日程調整\n3. 面談実施\n\nまずはリラックスして、どうぞよろしくお願いします！',
        messageType: 'text',
        delayMinutes: 0,
      },
      {
        stepOrder: 2,
        messageContent:
          'おはようございます！\n\n初回面談に向けて、事前ヒアリングにご協力ください。\n\n📋 事前ヒアリングシート（約5分）\n（別途URLをお送りします）\n\n【質問内容】\n1. 現在のお仕事・役職\n2. AIに期待すること\n3. 特に解決したい課題\n4. プログラミング経験\n5. 面談で聞きたいこと\n\nご記入後、初回面談の日程調整をさせていただきます。',
        messageType: 'text',
        delayMinutes: 1440, // 1日後
      },
      {
        stepOrder: 3,
        messageContent:
          '初回面談の日程調整をお願いします。\n\n📅 日程調整はこちら\n（Calendlyリンクを別途お送りします）\n\n面談までに以下をご準備ください:\n✅ 現在お使いのAIツール一覧\n✅ 自動化したい業務のリスト\n✅ 質問事項のメモ\n\n楽しみにお待ちしています！',
        messageType: 'text',
        delayMinutes: 4320, // 3日後
      },
      {
        stepOrder: 4,
        messageContent:
          'VIPコーチングのご購入から1週間が経ちました。\n\n初回面談の日程はお決まりですか？\n\n何かお困りのことがあれば、遠慮なくご連絡ください。\n\n▶ 相談する\n（このLINEに返信でOKです）\n\n一緒に最高の結果を作りましょう！',
        messageType: 'text',
        delayMinutes: 10080, // 7日後
      },
    ],
  },

  // SCN_004: Week2_Preparation (Week2準備シナリオ - 7日間)
  {
    name: 'PPAL_Week2_Preparation',
    triggerType: 'tag_added',
    description: 'Week1完了者のWeek2移行サポート（7日間）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          'Week1 お疲れ様でした！🎉\n\nWeek2では、いよいよ実践的なAgent構築に入ります。\n\n【Week2 の予習ポイント】\n✅ Claude Desktop のセットアップ確認\n✅ Git の基本操作の復習\n✅ 自動化したい業務を1つ考えておく\n\n準備ができたら、Week2 を始めましょう！\n\n▶ Week2 を開始する\nhttps://shuhayas-s-school.teachable.com\n\n無理のないペースで進めてください',
        messageType: 'text',
        delayMinutes: 1440, // 1日後
      },
      {
        stepOrder: 2,
        messageContent:
          'Week2 の準備はできましたか？\n\nWeek2 が一番実践的で楽しいパートです！\n\n【Week2 でできるようになること】\n🔧 オリジナル MCP ツールの作成\n🤖 SKILL.md によるエージェント設計\n📂 Git連携で設定管理\n\n今日から始めてみませんか？\n\n▶ Week2 を開始する\nhttps://shuhayas-s-school.teachable.com',
        messageType: 'text',
        delayMinutes: 4320, // 3日後（累計）
      },
      {
        stepOrder: 3,
        messageContent:
          'Week1 完了から1週間が経ちました。\n\nWeek2 の学習は順調ですか？\n\n困ったことがあれば、いつでもご質問ください。\n\n▶ 質問する\n（このLINEに返信でOKです）',
        messageType: 'text',
        delayMinutes: 10080, // 7日後（累計）
      },
    ],
  },

  // SCN_005: Graduate_Celebration (卒業祝福 - 7日間)
  {
    name: 'PPAL_Graduate_Celebration',
    triggerType: 'tag_added',
    description: '全講座完了者の祝福とリテンション（7日間）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          '🎓 全カリキュラム完走おめでとうございます！\n\nPPAL Lab の全講座を修了されたあなたに、特別な Phantom MCP ツールをプレゼントします。\n\n（特典は別途お送りします）\n\n本当におめでとうございます！これからもAIの世界を一緒に探求していきましょう。',
        messageType: 'text',
        delayMinutes: 0,
      },
      {
        stepOrder: 2,
        messageContent:
          '改めて、卒業おめでとうございます！\n\n【レビューのお願い】\nあなたの体験を、これから学ぶ方々の参考にさせていただけませんか？\n\nレビューを投稿いただいた方には、「MCP活用チートシート」をプレゼント🎁\n\n▶ レビューを投稿する\n（別途フォームURLをお送りします）\n\n強制ではありません。お気持ちだけでも嬉しいです。',
        messageType: 'text',
        delayMinutes: 1440, // 1日後
      },
      {
        stepOrder: 3,
        messageContent:
          'カリキュラムは完了しましたが、学びはここからが本番です！\n\n【卒業後の活用方法】\n\n📚 復習として:\n- 各Weekの内容を実務に適用\n- 疑問点の解消（いつでも質問OK）\n\n🔄 最新情報:\n- 毎週更新されるMCP最新情報\n- 新機能の使い方解説\n\n👥 コミュニティ:\n- 他のメンバーとの情報交換\n\n月額会員である限り、これらすべてにアクセスできます！',
        messageType: 'text',
        delayMinutes: 4320, // 3日後
      },
      {
        stepOrder: 4,
        messageContent:
          '卒業から1週間。実務での活用は進んでいますか？\n\nもし、「自分の業務に合わせたカスタマイズ方法がわからない」「もっと踏み込んだ相談がしたい」という気持ちがあれば、1on1 コーチングという選択肢もあります。\n\n▶ VIPコーチングの詳細\nhttps://shuhayas-s-school.teachable.com\n\nもちろん、月額会員のままでもコミュニティでのサポートは継続します。何かあれば、いつでもご連絡ください！',
        messageType: 'text',
        delayMinutes: 10080, // 7日後
      },
    ],
  },

  // SCN_006: VIP_Upsell_Sequence (VIPアップセル - 21日間)
  {
    name: 'PPAL_VIP_Upsell_Sequence',
    triggerType: 'tag_added',
    description: '卒業者向けVIPアップセル（21日間）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          'こんにちは！\n\nPPAL Lab で学んだスキル、実務に活かせていますか？\n\n「基礎はわかったけど、自分の仕事にどう適用すればいいか…」そんな声をよく聞きます。\n\nVIPコーチングでは、あなたの業務に特化した1on1サポートを提供しています。\n\n【VIPコーチングでできること】\n✅ あなた専用のMCPツール設計\n✅ 業務フロー自動化の相談\n✅ 週次での進捗確認と軌道修正\n\n▶ VIPコーチング詳細\nhttps://shuhayas-s-school.teachable.com',
        messageType: 'text',
        delayMinutes: 4320, // 3日後
      },
      {
        stepOrder: 2,
        messageContent:
          'VIPコーチングを受けた方の声をご紹介します。\n\n📝 Aさん（マーケター）\n「毎月20時間かかっていたレポート作成が2時間で終わるようになりました」\n\n📝 Bさん（エンジニア）\n「自分専用のコード生成MCPを作れて開発効率が3倍になりました」\n\n📝 Cさん（営業）\n「議事録の自動生成で会議後の作業が激減しました」\n\nあなたも、自分の業務に特化した自動化を実現しませんか？\n\n▶ VIPコーチング詳細\nhttps://shuhayas-s-school.teachable.com',
        messageType: 'text',
        delayMinutes: 10080, // 7日後（累計）
      },
      {
        stepOrder: 3,
        messageContent:
          '【卒業生限定のご案内】\n\nPPAL Lab 全カリキュラムを完走されたあなたに、特別なお知らせです。\n\n🎁 卒業生限定 VIPコーチング 10%OFF\n\n通常 ¥150,000 → ¥135,000\n\n※ 7日間限定\n\n▶ 特別価格で申し込む\nhttps://shuhayas-s-school.teachable.com\n\nこの機会をお見逃しなく！',
        messageType: 'text',
        delayMinutes: 20160, // 14日後（累計）
      },
      {
        stepOrder: 4,
        messageContent:
          '【リマインド】\n\n卒業生限定の VIPコーチング特別価格は、あと2日で終了です。\n\nまだ検討中でしたら、お早めにご決断ください。\n\n▶ 特別価格で申し込む\nhttps://shuhayas-s-school.teachable.com\n\nご質問があれば、お気軽にどうぞ。',
        messageType: 'text',
        delayMinutes: 27360, // 19日後（累計）
      },
      {
        stepOrder: 5,
        messageContent:
          '卒業生限定オファーは本日終了です。\n\nもし今回は見送られる場合でも、月額会員として引き続きサポートさせていただきます。\n\nVIPコーチングに興味が出たときは、いつでもお声がけください。\n\nこれからも PPAL Lab をよろしくお願いします！',
        messageType: 'text',
        delayMinutes: 30240, // 21日後（累計）
      },
    ],
  },

  // SCN_007: Progress_Reminder (進捗リマインダー - 7日間)
  {
    name: 'PPAL_Progress_Reminder',
    triggerType: 'tag_added',
    description: '学習停滞者へのリマインダー（7日間）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          'こんにちは！\n\n最近、レッスンへのアクセスが少なくなっているようです。\n\nお忙しい中かと思いますが、1日15分だけでも続けることで着実にスキルが身についていきます。\n\n今日、少しだけ学習してみませんか？\n\n▶ 前回の続きから再開\nhttps://shuhayas-s-school.teachable.com\n\n何かお困りのことがあれば、遠慮なくお知らせください。',
        messageType: 'text',
        delayMinutes: 0,
      },
      {
        stepOrder: 2,
        messageContent:
          'まだ学習が再開できていないようですね。\n\nもしかして、何かつまずいているポイントがありますか？\n\n【よくあるお悩み】\n❓ 内容が難しい\n❓ 時間が取れない\n❓ 何を優先すべきかわからない\n❓ 実務との結びつきが見えない\n\nどれか当てはまるものがあれば、一緒に解決策を考えましょう！\n\n▶ 相談する\n（このLINEに返信でOKです）',
        messageType: 'text',
        delayMinutes: 4320, // 3日後
      },
      {
        stepOrder: 3,
        messageContent:
          '2週間ほど学習が止まっているようです。\n\n月額会員は、いつでも再開できます。お時間ができたときに、また戻ってきてください。\n\nその間も、\n✅ 最新MCP情報は毎週配信中\n✅ コミュニティはいつでもアクセス可能\n✅ サポートへの質問もOK\n\n休憩しながらでも大丈夫です。あなたのペースで進めてください。\n\n▶ 学習を再開する\nhttps://shuhayas-s-school.teachable.com',
        messageType: 'text',
        delayMinutes: 10080, // 7日後（累計）
      },
    ],
  },

  // SCN_008: Re_Engagement (再エンゲージメント - 14日間)
  {
    name: 'PPAL_Re_Engagement',
    triggerType: 'manual',
    description: '14日間無反応者の再活性化（14日間）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          'お久しぶりです！\n\n最近、PPAL Lab へのアクセスがないようですが、お元気ですか？\n\n【今週の新着コンテンツ】\nこの2週間で追加された内容をご紹介:\n\n🆕 新MCP解説: Gemini 2.5連携\n🆕 実践事例: 議事録自動生成\n🆕 コミュニティQ&A: 人気の質問まとめ\n\n▶ 新着コンテンツを見る\nhttps://shuhayas-s-school.teachable.com\n\nお時間のあるときに、ぜひチェックしてみてください。',
        messageType: 'text',
        delayMinutes: 0,
      },
      {
        stepOrder: 2,
        messageContent:
          '忙しい中でも活用できるちょっとしたコツをお伝えします。\n\n【5分でできるAI活用】\n\n🕐 朝の5分:\nClaude Code で今日のTODO整理\n\n🕐 移動中の5分:\nコミュニティの最新投稿チェック\n\n🕐 寝る前の5分:\n気になるレッスンを1つだけ視聴\n\nまとまった時間がなくても、少しずつ積み重ねることで確実にスキルアップできます。\n\n▶ 学習を再開する\nhttps://shuhayas-s-school.teachable.com',
        messageType: 'text',
        delayMinutes: 7200, // 5日後
      },
      {
        stepOrder: 3,
        messageContent:
          '【ライブ実装会のお知らせ】\n\n一人で学習を続けるのは大変ですよね。\n\nリアルタイムで質問・相談できるライブ実装会を定期開催しています。\n\n📅 日時: 詳細は近日告知\n📍 場所: オンライン（Zoom）\n\n参加するだけでも刺激になりますよ！\n\n▶ ライブ実装会の案内を受け取る\n（案内が届いたらご登録ください）\n\n一緒に学びましょう！',
        messageType: 'text',
        delayMinutes: 14400, // 10日後（累計）
      },
      {
        stepOrder: 4,
        messageContent:
          '月額会員である限り、いつでも戻ってこれます。\n\nお時間ができたときに、また一緒に学びましょう。\n\n何かお困りのことがあれば、遠慮なくご連絡ください。\n\n▶ 質問・相談する\n（このLINEに返信でOKです）',
        messageType: 'text',
        delayMinutes: 20160, // 14日後（累計）
      },
    ],
  },

  // SCN_009: Week1_Start_Reminder (購入後未開始リマインダー - 4日間)
  {
    name: 'PPAL_Week1_Start_Reminder',
    triggerType: 'manual',
    description: '購入後未開始者へのリマインダー（4日間）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          'ご購入から3日が経ちました。\n\nまだ学習を開始されていないようですが、準備は整っていますか？\n\n【最初の一歩は簡単です】\nWeek1 Lesson1 は約15分で視聴できます。\n今日、まず1つ見てみませんか？\n\n▶ Week1 を始める\nhttps://shuhayas-s-school.teachable.com\n\n何か問題があれば教えてください！\n▶ 質問する\n（このLINEに返信でOKです）',
        messageType: 'text',
        delayMinutes: 4320, // 購入から3日後
      },
      {
        stepOrder: 2,
        messageContent:
          'まだ学習を開始できていないようですね。\n\n何かお困りのことはありますか？\n\n- ログイン方法がわからない\n- 動画が再生できない\n- 何から始めればいいかわからない\n\nどんな小さなことでも、お気軽にご連絡ください。\n\n▶ 相談する\n（このLINEに返信でOKです）\n\n一緒に最初の一歩を踏み出しましょう！',
        messageType: 'text',
        delayMinutes: 10080, // 7日後（累計）
      },
    ],
  },

  // SCN_010: Week2_Transition_Support (Week2開始サポート - 3日間)
  {
    name: 'PPAL_Week2_Transition_Support',
    triggerType: 'tag_added',
    description: 'Week2開始時の追加サポート（3日間）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          'Week2 開始おめでとうございます！🚀\n\nいよいよ実践的なMCPエージェント構築ですね。\n\n【Week2 テンプレートセット】\nWeek2 学習用のテンプレートをご用意しました。\n（別途お送りします）\n\n困ったことがあれば、遠慮なく質問してくださいね！',
        messageType: 'text',
        delayMinutes: 0,
      },
      {
        stepOrder: 2,
        messageContent:
          'Week2 の学習は順調ですか？\n\n【Week2 でつまずきやすいポイント】\n\n❓ MCPサーバーが起動しない\n→ Node.jsのバージョン確認（v18以上推奨）\n\n❓ エラーメッセージの意味がわからない\n→ そのままコピーして質問いただければ解説します\n\n❓ 自分の業務に合わせたカスタマイズ方法\n→ 具体的な業務内容を教えていただければアドバイス\n\n困ったことがあれば、遠慮なく質問してくださいね！\n\n▶ 質問する\n（このLINEに返信でOKです）',
        messageType: 'text',
        delayMinutes: 4320, // 3日後
      },
    ],
  },

  // SCN_011: Month2_Transition_Event (Month2移行イベント - v2.0)
  {
    name: 'PPAL_Month2_Transition_Event',
    triggerType: 'tag_added',
    description: 'Month1→Month2の離脱防止LTイベント（v2.0）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          '【Month2 特別イベントのお知らせ】🎤\n\nPPALでの最初の1ヶ月おめでとうございます！\n\nあなたは今、AI活用のスキルが最も伸びる「成長期」に入っています。\n\nこの大切な時期に、同期メンバーと一緒に「振り返り＆次のステップ」を確認するイベントを開催します。\n\n■ Month2 LT (Lightning Talk) セッション\n📅 日時: 詳細は近日告知\n📍 場所: Discord #lt-session\n📝 内容:\n  1. 3分の成果発表（テンプレあり）\n  2. ピアスタディグループ結成\n  3. Month2 目標宣言\n\n初めてでも大丈夫。テンプレートに沿って話すだけです。',
        messageType: 'text',
        delayMinutes: 36000, // 25日後（Month1完了時）
      },
      {
        stepOrder: 2,
        messageContent:
          'LTセッションの参加登録はお済みですか？\n\n前回の参加者の声:\n「同じ時期に始めた仲間の進捗を見て、やる気が復活しました」\n「3分の発表が、自分の1ヶ月を振り返る良い機会になった」\n\n【発表テンプレート（3分）】\n1. 自己紹介（15秒）\n2. 今月作ったもの（1分）\n3. つまずいたポイント（30秒）\n4. 来月の目標（1分）\n\n▶ 今すぐ参加登録\n（別途URLをお送りします）',
        messageType: 'text',
        delayMinutes: 40320, // 28日後
      },
      {
        stepOrder: 3,
        messageContent:
          'ピアスタディグループが結成されました。\n\n週1回の進捗共有で、お互いの成長を加速させましょう。\n\n次のアクション:\n1. Discord #peer-group に参加\n2. #month2-commitment に目標を投稿\n\n▶ 目標を宣言する\n（Discordで投稿してください）',
        messageType: 'text',
        delayMinutes: 46080, // 32日後
      },
      {
        stepOrder: 4,
        messageContent:
          '#month2-commitment への目標投稿はお済みですか？\n\n「宣言する」だけで継続率が大きく変わることが分かっています。\n\n【Month2 コミットメント テンプレート】\n---\nMonth1の成果: （1行でOK）\nMonth2の目標: （具体的に1つ）\nそのために毎週やること: （小さなアクション1つ）\n---\n\n▶ Discordで投稿する\n（投稿した方には特典コンテンツをお届けします）',
        messageType: 'text',
        delayMinutes: 50400, // 35日後
      },
    ],
  },

  // SCN_012: UGC_Viral_Campaign (UGCバイラル - v2.0)
  {
    name: 'PPAL_UGC_Viral_Campaign',
    triggerType: 'tag_added',
    description: 'メンバー成果のSNS共有バイラルキャンペーン（v2.0）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          'おめでとうございます！🎉\nステージをクリアしましたね。\n\nこの成果、SNSで共有してみませんか？\nコピペするだけで投稿できるテンプレートをご用意しました。\n\n---\n【SNS投稿テンプレート】\nPPAL Lab でAIエージェントを使いこなせるようになってきた！\nMCPツールを自作して〇〇を自動化できた。\n#PPAL成果報告 #AIエージェント実験室\n---\n\n投稿してくれたら、PPALコミュニティで紹介します！\n林も必ずRT/引用RTしますよ。\n\n▶ 投稿した！\n（このLINEに「投稿しました」と返信してください）',
        messageType: 'text',
        delayMinutes: 1440, // Stage完了24h後
      },
      {
        stepOrder: 2,
        messageContent:
          'SNS投稿ありがとうございます！🙌\n\nあなたの投稿がきっかけで、新しい仲間がPPALに興味を持つかもしれません。\n共有の力、すごいですよね。\n\n3回以上投稿すると、VIPスコアが加算されます。\n引き続きよろしくお願いします！',
        messageType: 'text',
        delayMinutes: 4320, // 3日後
      },
      {
        stepOrder: 3,
        messageContent:
          '【今月のSNS投稿ランキング発表！】\n\n今月最も多く成果を発信してくれたメンバーを紹介します。\n\n（コミュニティで発表します）\n\nランキング上位の方には、限定コンテンツをプレゼント🎁\n\n来月もぜひ積極的に発信してください！',
        messageType: 'text',
        delayMinutes: 43200, // 30日後（月末）
      },
    ],
  },

  // SCN_013: Micro_Win_Celebration (マイクロ成功セレブレーション - v2.0)
  {
    name: 'PPAL_Micro_Win_Celebration',
    triggerType: 'tag_added',
    description: '小さな達成の即座認識（v2.0）',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          '🏆 達成おめでとうございます！\n\nPPALメンバーの中で、ここまで到達した人はまだ少数です。\n着実に前に進んでいますよ。\n\nこの成果をSNSでシェアしませんか？\n（テンプレートをご活用ください）\n\n▶ 次のマイルストーンはこちら\nhttps://shuhayas-s-school.teachable.com',
        messageType: 'text',
        delayMinutes: 0,
      },
      {
        stepOrder: 2,
        messageContent:
          '次のマイルストーンはこちらです👇\n\n📝 次の目標\n次のレッスンに進んで、さらなるスキルアップを目指しましょう。\n\n⏱️ 目安: 1〜2時間\n\n小さな一歩が大きな変化を生みます。\n今日も実験を楽しみましょう！\n\n▶ 次のレッスンを開く\nhttps://shuhayas-s-school.teachable.com',
        messageType: 'text',
        delayMinutes: 360, // 6時間後
      },
    ],
  },
];

// ============================================================
// API ヘルパー
// ============================================================
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

// ============================================================
// タグ登録
// ============================================================
async function migrateRemainingTags(existingTagNames: Set<string>) {
  console.log('\n[タグ登録] 残り22タグを確認・登録中...');
  let added = 0;
  let skipped = 0;

  for (const tag of REMAINING_TAGS) {
    if (existingTagNames.has(tag.name)) {
      console.log(`  スキップ: ${tag.name} (既存)`);
      skipped++;
      continue;
    }

    const res = await postJson<{ success: boolean; data?: { id: string }; error?: string }>(
      '/api/tags',
      { name: tag.name, color: tag.color, description: tag.description },
    );

    if (res.success && res.data?.id) {
      console.log(`  ✓ ${tag.name}`);
      added++;
    } else {
      console.warn(`  ✗ ${tag.name}: ${res.error}`);
    }
  }

  console.log(`  → 登録: ${added}件 / スキップ: ${skipped}件`);
}

// ============================================================
// シナリオ登録
// ============================================================
async function createScenario(scenario: Scenario): Promise<string> {
  const res = await postJson<{ success: boolean; data?: { id: string }; error?: string }>(
    '/api/scenarios',
    { name: scenario.name, triggerType: scenario.triggerType, status: 'active' },
  );

  if (!res.success || !res.data?.id) {
    throw new Error(`シナリオ作成失敗 "${scenario.name}": ${res.error}`);
  }

  const scenarioId = res.data.id;

  for (const step of scenario.steps) {
    const stepRes = await postJson<{ success: boolean; error?: string }>(
      `/api/scenarios/${scenarioId}/steps`,
      {
        stepOrder: step.stepOrder,
        messageContent: step.messageContent,
        messageType: step.messageType,
        delayMinutes: step.delayMinutes,
      },
    );

    if (!stepRes.success) {
      console.warn(`    WARNING: Step${step.stepOrder} の追加失敗: ${stepRes.error}`);
    } else {
      const h = Math.floor(step.delayMinutes / 60);
      const m = step.delayMinutes % 60;
      const delay = h > 0 ? `${h}h${m > 0 ? `${m}m` : ''}` : `${step.delayMinutes}m`;
      console.log(
        `    ✓ Step${step.stepOrder} (${delay}後): ${step.messageContent.substring(0, 40).replace(/\n/g, ' ')}...`,
      );
    }
  }

  return scenarioId;
}

async function migrateScenarios(existingScenarioNames: Set<string>) {
  console.log('\n[シナリオ登録] 13シナリオを確認・登録中...');
  const results: Array<{ name: string; id: string }> = [];
  let skipped = 0;

  for (const scenario of PPAL_SCENARIOS) {
    if (existingScenarioNames.has(scenario.name)) {
      console.log(`\n  スキップ: ${scenario.name} (既存)`);
      skipped++;
      continue;
    }

    console.log(`\n  [${scenario.name}] 登録中... (${scenario.steps.length}ステップ)`);
    try {
      const id = await createScenario(scenario);
      results.push({ name: scenario.name, id });
      console.log(`  ✓ ${scenario.name} (id: ${id})`);
    } catch (err) {
      console.error(`  ✗ ${scenario.name}: ${err}`);
    }
  }

  console.log(`\n  → 登録: ${results.length}件 / スキップ: ${skipped}件`);
  return results;
}

// ============================================================
// メイン
// ============================================================
async function main() {
  console.log('');
  console.log('==============================================');
  console.log('  PPAL 完全自動化 移行スクリプト');
  console.log('==============================================');
  console.log(`  Worker: ${WORKER_URL}`);
  console.log('');

  // 既存データを取得
  console.log('[1/4] 既存データを確認中...');
  const tagsRes = await getJson<{ success: boolean; data?: Array<{ name: string }> }>('/api/tags');
  const existingTagNames = new Set<string>(
    (tagsRes.data ?? []).map((t) => t.name),
  );
  console.log(`  既存タグ: ${existingTagNames.size}件`);

  const scenariosRes = await getJson<{
    success: boolean;
    data?: Array<{ name: string }>;
  }>('/api/scenarios');
  const existingScenarioNames = new Set<string>(
    (scenariosRes.data ?? []).map((s) => s.name),
  );
  console.log(`  既存シナリオ: ${existingScenarioNames.size}件`);
  console.log(`  既存シナリオ名: ${[...existingScenarioNames].join(', ')}`);

  // タグ登録
  console.log('\n[2/4] 残り22タグを登録中...');
  await migrateRemainingTags(existingTagNames);

  // シナリオ登録
  console.log('\n[3/4] 全シナリオを登録中...');
  const scenarioResults = await migrateScenarios(existingScenarioNames);

  // 完了確認
  console.log('\n[4/4] 最終確認...');
  const finalTags = await getJson<{ success: boolean; data?: Array<{ name: string }> }>('/api/tags');
  const finalScenarios = await getJson<{
    success: boolean;
    data?: Array<{ name: string; id: string }>;
  }>('/api/scenarios');

  console.log('');
  console.log('==============================================');
  console.log('  移行完了');
  console.log('==============================================');
  console.log(`  タグ合計: ${finalTags.data?.length ?? 0}件`);
  console.log(`  シナリオ合計: ${finalScenarios.data?.length ?? 0}件`);
  console.log('');
  console.log('登録されたシナリオ:');
  (finalScenarios.data ?? []).forEach((s) => {
    console.log(`  - ${s.name} (${s.id})`);
  });

  console.log('');
  console.log('次のステップ:');
  console.log('  1. wrangler login でCloudflare認証 → wrangler deploy');
  console.log('  2. wrangler secret put API_KEY (新しい安全なキーに変更)');
  console.log('  3. git add . && git commit && git push origin main');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
