/**
 * PPAL Teachable Webhook 自動化ルール設定スクリプト
 *
 * Teachable の sale.created / subscription.cancelled Webhook を
 * LINE Harness の IF-THEN 自動化に接続します。
 *
 * 設定されるルール:
 *   1. 購入時: sts:購入済み タグ付与 + Member_Onboarding シナリオ開始
 *   2. 解約時: sts:解約済み タグ付与 + Member_Onboarding シナリオ停止
 *   3. リッチメニュー切替: sts:購入済み タグ付与後に Member メニューに変更
 *
 * Teachable 側での設定:
 *   sale.created webhook URL:
 *     POST https://your-worker.workers.dev/api/webhooks/incoming/{webhookId}/receive
 *
 * 実行方法:
 *   WORKER_URL=https://your-worker.workers.dev API_KEY=your-key npx tsx ppal-automation-rules.ts
 */

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';
const API_KEY = process.env.API_KEY ?? '';

if (!API_KEY) {
  console.error('ERROR: API_KEY 環境変数を設定してください');
  process.exit(1);
}

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

type Tag = { id: string; name: string };
type Scenario = { id: string; name: string };
type ApiList<T> = { success: boolean; data?: T[] };

async function findTagByName(name: string, tags: Tag[]): Promise<Tag | undefined> {
  return tags.find((t) => t.name === name);
}

async function findScenarioByName(
  name: string,
  scenarios: Scenario[],
): Promise<Scenario | undefined> {
  return scenarios.find((s) => s.name === name);
}

async function createWebhookEndpoint(name: string, secret: string) {
  const res = await postJson<{ success: boolean; data?: { id: string; url?: string }; error?: string }>(
    '/api/webhooks/incoming',
    {
      name,
      sourceType: 'teachable',
      secret,
    },
  );
  return res;
}

async function createAutomationRule(rule: {
  name: string;
  eventType: string;
  conditions?: Record<string, unknown>;
  actions: Array<{
    actionType: string;
    actionValue?: string;
  }>;
}) {
  const res = await postJson<{ success: boolean; data?: { id: string }; error?: string }>(
    '/api/automations',
    rule,
  );
  return res;
}

async function main() {
  console.log('');
  console.log('===================================');
  console.log('  PPAL 自動化ルール設定');
  console.log('===================================');
  console.log(`  Worker: ${WORKER_URL}`);
  console.log('');

  // ── タグ一覧取得 ────────────────────────────────────────
  console.log('タグ一覧を取得...');
  const tagsRes = await getJson<ApiList<Tag>>('/api/tags');
  const tags = tagsRes.data ?? [];
  if (tags.length === 0) {
    console.error('ERROR: タグが存在しません。先に migrate-ppal-tags.ts を実行してください。');
    process.exit(1);
  }

  const tagPurchased = await findTagByName('sts:購入済み', tags);
  const tagCancelled = await findTagByName('sts:解約済み', tags);
  const tagActive = await findTagByName('sts:受講中', tags);

  console.log(`  sts:購入済み: ${tagPurchased?.id ?? 'NOT FOUND'}`);
  console.log(`  sts:解約済み: ${tagCancelled?.id ?? 'NOT FOUND'}`);
  console.log(`  sts:受講中:   ${tagActive?.id ?? 'NOT FOUND'}`);

  // ── シナリオ一覧取得 ─────────────────────────────────────
  console.log('\nシナリオ一覧を取得...');
  const scenariosRes = await getJson<ApiList<Scenario>>('/api/scenarios');
  const scenarios = scenariosRes.data ?? [];

  const onboardingScenario = await findScenarioByName('Member_Onboarding', scenarios);
  console.log(`  Member_Onboarding: ${onboardingScenario?.id ?? 'NOT FOUND'}`);

  // ── Teachable Webhook エンドポイント作成 ────────────────────
  console.log('\n[1/4] Teachable Webhook エンドポイントを作成...');
  const webhookSecret = crypto.randomUUID().replace(/-/g, '');
  const webhookRes = await createWebhookEndpoint('Teachable PPAL', webhookSecret);

  if (!webhookRes.success) {
    console.warn(`  WARNING: Webhook作成失敗: ${webhookRes.error}`);
  } else {
    const webhookId = webhookRes.data?.id;
    const receiveUrl = `${WORKER_URL}/api/webhooks/incoming/${webhookId}/receive`;
    console.log(`  ✓ Webhook ID: ${webhookId}`);
    console.log(`  ✓ Webhook Secret: ${webhookSecret}`);
    console.log('');
    console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Teachable 管理画面で以下を設定してください:');
    console.log('    Settings > Integrations > Webhooks');
    console.log(`    Webhook URL: ${receiveUrl}`);
    console.log(`    Secret:      ${webhookSecret}`);
    console.log('    Events: sale.created, subscription.cancelled');
    console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  // ── 自動化ルール: 購入時 ─────────────────────────────────
  console.log('\n[2/4] 購入時の自動化ルールを設定...');
  const purchaseActions = [];

  if (tagPurchased) {
    purchaseActions.push({ actionType: 'add_tag', actionValue: tagPurchased.id });
  }
  if (tagActive) {
    purchaseActions.push({ actionType: 'add_tag', actionValue: tagActive.id });
  }
  if (onboardingScenario) {
    purchaseActions.push({ actionType: 'start_scenario', actionValue: onboardingScenario.id });
  }

  if (purchaseActions.length > 0) {
    const purchaseRule = await createAutomationRule({
      name: 'Teachable購入→タグ+シナリオ開始',
      eventType: 'webhook_event',
      conditions: { event: 'sale.created' },
      actions: purchaseActions,
    });

    if (purchaseRule.success) {
      console.log(`  ✓ 購入時ルール作成: ${purchaseRule.data?.id}`);
      purchaseActions.forEach((a) => {
        console.log(`    → ${a.actionType}: ${a.actionValue}`);
      });
    } else {
      console.error(`  ✗ 購入時ルール作成失敗: ${purchaseRule.error}`);
    }
  }

  // ── 自動化ルール: 解約時 ─────────────────────────────────
  console.log('\n[3/4] 解約時の自動化ルールを設定...');
  const cancelActions = [];

  if (tagCancelled) {
    cancelActions.push({ actionType: 'add_tag', actionValue: tagCancelled.id });
  }
  if (tagActive) {
    cancelActions.push({ actionType: 'remove_tag', actionValue: tagActive.id });
  }
  if (tagPurchased) {
    cancelActions.push({ actionType: 'remove_tag', actionValue: tagPurchased.id });
  }

  if (cancelActions.length > 0) {
    const cancelRule = await createAutomationRule({
      name: 'Teachable解約→タグ変更',
      eventType: 'webhook_event',
      conditions: { event: 'subscription.cancelled' },
      actions: cancelActions,
    });

    if (cancelRule.success) {
      console.log(`  ✓ 解約時ルール作成: ${cancelRule.data?.id}`);
      cancelActions.forEach((a) => {
        console.log(`    → ${a.actionType}: ${a.actionValue}`);
      });
    } else {
      console.error(`  ✗ 解約時ルール作成失敗: ${cancelRule.error}`);
    }
  }

  // ── リッチメニュー切替ルール ──────────────────────────────
  console.log('\n[4/4] リッチメニュー切替ルールを設定...');
  console.log('  NOTE: リッチメニューは LINE Developers Console で');
  console.log('  Guest/Member の2種を作成後、ID を控えてください。');
  console.log('');
  console.log('  rich_menu_switch ルールの設定例:');
  console.log('    triggerType:  tag_added');
  console.log('    triggerValue: <sts:購入済みのtag_id>');
  console.log('    actionType:   switch_rich_menu');
  console.log('    actionValue:  <Member用のrich_menu_id>');
  console.log('');
  console.log('  ⚠ リッチメニューIDは後から /api/automations POST で追加できます。');

  console.log('');
  console.log('===================================');
  console.log('  自動化ルール設定完了');
  console.log('===================================');
  console.log('');
  console.log('最終確認:');
  console.log('  curl -H "Authorization: Bearer $API_KEY" \\');
  console.log(`    ${WORKER_URL}/api/automations`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
