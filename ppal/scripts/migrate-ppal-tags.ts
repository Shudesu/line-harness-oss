/**
 * PPAL タグ移行スクリプト
 * L-step の20タグを LINE Harness に一括作成します。
 *
 * 実行方法:
 *   WORKER_URL=https://your-worker.workers.dev API_KEY=your-key npx tsx migrate-ppal-tags.ts
 */

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';
const API_KEY = process.env.API_KEY ?? '';

if (!API_KEY) {
  console.error('ERROR: API_KEY 環境変数を設定してください');
  process.exit(1);
}

// PPALのタグ定義（L-stepからの移行）
// カテゴリ: Segment / Status / Engagement / Source / Article / Test
const PPAL_TAGS: Array<{ name: string; color: string; category: string }> = [
  // ── Segment（受講者層） ────────────────────────────────
  { name: 'seg:初心者',       color: '#3B82F6', category: 'Segment' },
  { name: 'seg:中級者',       color: '#8B5CF6', category: 'Segment' },
  { name: 'seg:経営者',       color: '#F59E0B', category: 'Segment' },
  { name: 'seg:副業希望',     color: '#10B981', category: 'Segment' },

  // ── Status（購買・受講ステータス） ─────────────────────
  { name: 'sts:見込み客',     color: '#6B7280', category: 'Status' },
  { name: 'sts:購入済み',     color: '#EF4444', category: 'Status' },
  { name: 'sts:受講中',       color: '#F97316', category: 'Status' },
  { name: 'sts:受講完了',     color: '#22C55E', category: 'Status' },
  { name: 'sts:解約済み',     color: '#94A3B8', category: 'Status' },

  // ── Engagement（エンゲージメント度） ───────────────────
  { name: 'eng:高',           color: '#DC2626', category: 'Engagement' },
  { name: 'eng:中',           color: '#CA8A04', category: 'Engagement' },
  { name: 'eng:低',           color: '#64748B', category: 'Engagement' },

  // ── Source（流入元） ──────────────────────────────────
  { name: 'src:X',            color: '#000000', category: 'Source' },
  { name: 'src:YouTube',      color: '#FF0000', category: 'Source' },
  { name: 'src:紹介',         color: '#7C3AED', category: 'Source' },
  { name: 'src:広告',         color: '#0EA5E9', category: 'Source' },

  // ── Article（特定コンテンツ反応） ──────────────────────
  { name: 'art:AI活用',       color: '#2563EB', category: 'Article' },
  { name: 'art:副業',         color: '#16A34A', category: 'Article' },

  // ── Test（A/Bテスト・検証） ───────────────────────────
  { name: 'test:A',           color: '#E11D48', category: 'Test' },
  { name: 'test:B',           color: '#7C3AED', category: 'Test' },
];

async function createTag(name: string, color: string): Promise<string | null> {
  const res = await fetch(`${WORKER_URL}/api/tags`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ name, color }),
  });

  const data = (await res.json()) as { success: boolean; data?: { id: string }; error?: string };

  if (!data.success) {
    // タグが既に存在する場合はスキップ
    if (data.error?.includes('UNIQUE') || data.error?.includes('already')) {
      console.log(`  SKIP (already exists): ${name}`);
      return null;
    }
    throw new Error(`Failed to create tag "${name}": ${data.error}`);
  }

  return data.data?.id ?? null;
}

async function main() {
  console.log('');
  console.log('===================================');
  console.log('  PPAL タグ移行');
  console.log('===================================');
  console.log(`  Worker: ${WORKER_URL}`);
  console.log(`  タグ数: ${PPAL_TAGS.length}`);
  console.log('');

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const tag of PPAL_TAGS) {
    try {
      const id = await createTag(tag.name, tag.color);
      if (id) {
        console.log(`  ✓ [${tag.category}] ${tag.name} (id: ${id})`);
        created++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`  ✗ ${tag.name}: ${err}`);
      failed++;
    }
  }

  console.log('');
  console.log('===================================');
  console.log(`  完了: 作成 ${created} / スキップ ${skipped} / 失敗 ${failed}`);
  console.log('===================================');

  if (failed > 0) process.exit(1);

  // 作成後に全タグを確認表示
  console.log('');
  console.log('現在の全タグ一覧:');
  const listRes = await fetch(`${WORKER_URL}/api/tags`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const listData = (await listRes.json()) as {
    success: boolean;
    data?: Array<{ id: string; name: string; color: string }>;
  };
  if (listData.success && listData.data) {
    listData.data.forEach((t) => {
      console.log(`  ${t.color} ${t.name} (${t.id})`);
    });
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
