/**
 * PPAL シナリオ移行スクリプト
 * L-step の3シナリオを LINE Harness に移行します。
 *
 *   1. Welcome           — 友だち追加直後のウェルカムシーケンス
 *   2. Launch_Countdown  — セミナー/ローンチ直前カウントダウン
 *   3. Member_Onboarding — 購入後の受講開始オンボーディング
 *
 * 実行方法:
 *   WORKER_URL=https://your-worker.workers.dev API_KEY=your-key npx tsx migrate-ppal-scenarios.ts
 */

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';
const API_KEY = process.env.API_KEY ?? '';

if (!API_KEY) {
  console.error('ERROR: API_KEY 環境変数を設定してください');
  process.exit(1);
}

type ScenarioStep = {
  stepOrder: number;
  messageContent: string;
  messageType?: 'text' | 'image' | 'flex';
  delayMinutes: number;
  conditionType?: string;
  conditionValue?: string;
  nextStepOnFalse?: number | null;
};

type Scenario = {
  name: string;
  triggerType: string; // 'friend_added' | 'tag_added' | 'manual'
  steps: ScenarioStep[];
};

const PPAL_SCENARIOS: Scenario[] = [
  // ── 1. Welcome シナリオ ─────────────────────────────────────
  {
    name: 'Welcome',
    triggerType: 'friend_add',
    steps: [
      {
        stepOrder: 1,
        messageContent:
          'こんにちは！PPALコミュニティへようこそ🎉\n\nAIを使って副業・事業を加速させたい方のためのコミュニティです。\n\nまずは自己紹介を見てみましょう👇',
        messageType: 'text',
        delayMinutes: 0,
      },
      {
        stepOrder: 2,
        messageContent:
          '【PPAL とは？】\n\nPPAL（Prompt Professional for AI & Launch）は、AIスキルを活かして収益化するプロフェッショナルを育成するコミュニティです。\n\n✅ AIを使った副業の始め方\n✅ プロンプトエンジニアリング実践\n✅ ビジネス自動化の具体例\n\n毎週コンテンツを更新中です！',
        messageType: 'text',
        delayMinutes: 30,
      },
      {
        stepOrder: 3,
        messageContent:
          '🎁 友だち追加特典\n\n今すぐ「AI副業スターターガイド」をプレゼント中です！\n\n以下のボタンからダウンロードしてください👇\n（有効期限: 72時間）',
        messageType: 'text',
        delayMinutes: 60,
      },
      {
        stepOrder: 4,
        messageContent:
          '📚 今週のおすすめコンテンツ\n\nChatGPTで月10万円を稼いだ3つのパターンを公開中！\n\n実際の事例と具体的なプロンプトを解説しています。ぜひご覧ください。',
        messageType: 'text',
        delayMinutes: 2880, // 2日後
      },
      {
        stepOrder: 5,
        messageContent:
          '最後にひとつ質問です😊\n\nあなたが一番知りたいAI活用法はどれですか？\n\n1. 副業・フリーランス\n2. 会社での業務効率化\n3. 自分のビジネス立ち上げ\n\n返信でお聞かせください！',
        messageType: 'text',
        delayMinutes: 7200, // 5日後
      },
    ],
  },

  // ── 2. Launch_Countdown シナリオ ───────────────────────────────
  {
    name: 'Launch_Countdown',
    triggerType: 'tag_added', // sts:見込み客 タグが付いたとき
    steps: [
      {
        stepOrder: 1,
        messageContent:
          '🔔 重要なお知らせ\n\n特別セミナーまで【7日】になりました！\n\n「AIで月収30万を実現するロードマップ公開セミナー」\n\n━━━━━━━━━━━━━━\n📅 日時: 詳細はこのあとお送りします\n💻 形式: オンライン（Zoom）\n💰 参加費: 無料\n━━━━━━━━━━━━━━\n\n今すぐ参加登録されましたか？まだの方はお早めに！',
        messageType: 'text',
        delayMinutes: 0,
      },
      {
        stepOrder: 2,
        messageContent:
          '⏰ セミナーまで【3日】\n\nセミナーで話す内容を少しだけ先出しします👀\n\n✅ AIを使って最短で副業収入を得る手順\n✅ 失敗しないAIツール選びの基準\n✅ 実際の月収公開（スクリーンショット付き）\n\n楽しみにしていてください！',
        messageType: 'text',
        delayMinutes: 5760, // 4日後
      },
      {
        stepOrder: 3,
        messageContent:
          '🌟 明日がセミナー本番です！\n\nいよいよ明日になりました。\n\n参加URLをこちらで確認してください（当日も再送します）:\n※当日リマインドを送付します\n\n質問があれば今のうちにこちらへ返信してください。',
        messageType: 'text',
        delayMinutes: 7200, // 5日後
      },
      {
        stepOrder: 4,
        messageContent:
          '🚀 本日セミナーです！\n\n今夜のセミナーまであと数時間です。\n\n【参加URL】は登録メールをご確認ください。\n\nお会いできることを楽しみにしています！',
        messageType: 'text',
        delayMinutes: 9360, // 6.5日後（当日朝）
      },
      {
        stepOrder: 5,
        messageContent:
          'セミナーへのご参加ありがとうございました！🙏\n\n参加できなかった方は録画を近日中に送付します。\n\n限定特典の締め切りは【明日24時】です。お見逃しなく！',
        messageType: 'text',
        delayMinutes: 10220, // セミナー翌朝
      },
    ],
  },

  // ── 3. Member_Onboarding シナリオ ─────────────────────────────
  {
    name: 'Member_Onboarding',
    triggerType: 'tag_added', // sts:購入済み タグが付いたとき
    steps: [
      {
        stepOrder: 1,
        messageContent:
          'ご購入ありがとうございます！🎊\n\nPPALプログラムへようこそ！\n\nすぐに始める方はこちら👇\n【Teachable ログインURL】\nhttps://ppal.teachable.com\n\nログインIDは購入時のメールアドレスです。パスワードは登録メールをご確認ください。',
        messageType: 'text',
        delayMinutes: 0,
      },
      {
        stepOrder: 2,
        messageContent:
          '📋 スタートガイド\n\n【最初の3日間でやること】\n\nDay 1: プロフィール設定 + 第1章視聴\nDay 2: 第2章 + 最初のプロンプトを試す\nDay 3: コミュニティに自己紹介投稿\n\n迷ったらいつでも返信してください👋',
        messageType: 'text',
        delayMinutes: 1440, // 1日後
      },
      {
        stepOrder: 3,
        messageContent:
          'はじめて3日が経ちました！\n\n進捗はいかがですか？\n\n✅ 第1章は終わりましたか？\n✅ 自己紹介投稿はしましたか？\n\n「はい」か「まだ」を返信してください😊\n（つまづいている場合はその内容も教えてください）',
        messageType: 'text',
        delayMinutes: 4320, // 3日後
      },
      {
        stepOrder: 4,
        messageContent:
          '📈 1週間が経ちました！\n\nここまでの進捗を教えてください。\n\n1. 順調に進んでいる\n2. 少し遅れている\n3. 止まっている\n\n番号で返信してください。状況に合わせてサポートします！',
        messageType: 'text',
        delayMinutes: 10080, // 7日後
      },
      {
        stepOrder: 5,
        messageContent:
          '🏆 1ヶ月が経ちました！\n\nPPALプログラムを続けていただきありがとうございます。\n\n受講者アンケートにご協力ください（3分）。\nご回答いただいた方に特別コンテンツをプレゼントします！\n\n【アンケートURL】',
        messageType: 'text',
        delayMinutes: 43200, // 30日後
      },
    ],
  },
];

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as T;
  return data;
}

async function createScenario(scenario: Scenario): Promise<string> {
  // 1. シナリオを作成
  const scenarioRes = await postJson<{
    success: boolean;
    data?: { id: string };
    error?: string;
  }>('/api/scenarios', {
    name: scenario.name,
    triggerType: scenario.triggerType,
    status: 'active',
  });

  if (!scenarioRes.success || !scenarioRes.data?.id) {
    throw new Error(`シナリオ作成失敗 "${scenario.name}": ${scenarioRes.error}`);
  }

  const scenarioId = scenarioRes.data.id;
  console.log(`  ✓ シナリオ作成: ${scenario.name} (id: ${scenarioId})`);

  // 2. ステップを順次追加
  for (const step of scenario.steps) {
    const stepRes = await postJson<{
      success: boolean;
      data?: { id: string };
      error?: string;
    }>(`/api/scenarios/${scenarioId}/steps`, {
      stepOrder: step.stepOrder,
      messageContent: step.messageContent,
      messageType: step.messageType ?? 'text',
      delayMinutes: step.delayMinutes,
      conditionType: step.conditionType,
      conditionValue: step.conditionValue,
      nextStepOnFalse: step.nextStepOnFalse,
    });

    if (!stepRes.success) {
      console.warn(
        `    WARNING: ステップ${step.stepOrder}の追加失敗: ${stepRes.error}`,
      );
    } else {
      const hours = Math.floor(step.delayMinutes / 60);
      const mins = step.delayMinutes % 60;
      const delayStr =
        hours > 0
          ? `${hours}h${mins > 0 ? ` ${mins}m` : ''}`
          : `${step.delayMinutes}m`;
      console.log(
        `    ✓ Step${step.stepOrder} (${delayStr}後): ${step.messageContent.substring(0, 30)}...`,
      );
    }
  }

  return scenarioId;
}

async function main() {
  console.log('');
  console.log('===================================');
  console.log('  PPAL シナリオ移行');
  console.log('===================================');
  console.log(`  Worker: ${WORKER_URL}`);
  console.log(`  シナリオ数: ${PPAL_SCENARIOS.length}`);
  console.log('');

  const results: Array<{ name: string; id: string }> = [];

  for (const scenario of PPAL_SCENARIOS) {
    console.log(`\n[${scenario.name}] 移行中...`);
    try {
      const id = await createScenario(scenario);
      results.push({ name: scenario.name, id });
    } catch (err) {
      console.error(`  ✗ ${scenario.name}: ${err}`);
    }
  }

  console.log('');
  console.log('===================================');
  console.log('  移行完了');
  console.log('===================================');
  results.forEach((r) => {
    console.log(`  ✓ ${r.name}: ${r.id}`);
  });

  console.log('');
  console.log('次のステップ:');
  console.log('  Teachable Webhook の自動化を設定:');
  console.log('  npx tsx ppal-automation-rules.ts');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
