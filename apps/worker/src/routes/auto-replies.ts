import { Hono } from 'hono';
import {
  getAutoReplies,
  getAutoReplyById,
  createAutoReply,
  updateAutoReply,
  deleteAutoReply,
} from '@line-crm/db';
import type { AutoReply as DbAutoReply } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

const autoReplies = new Hono<Env>();

interface EffectiveAccount {
  accountId: string;
  accountName: string;
  status: 'reply' | 'silent' | 'not_applicable';
  via: 'inline' | 'automation' | null;
}

interface SerializedAutoReply {
  id: string;
  keyword: string;
  matchType: 'exact' | 'contains';
  responseType: string;
  responseContent: string;
  templateId: string | null;
  lineAccountId: string | null;
  isActive: boolean;
  createdAt: string;
  effectiveAccounts?: EffectiveAccount[];
}

function serializeAutoReply(row: DbAutoReply): SerializedAutoReply {
  return {
    id: row.id,
    keyword: row.keyword,
    matchType: row.match_type,
    responseType: row.response_type,
    responseContent: row.response_content,
    templateId: row.template_id,
    lineAccountId: row.line_account_id,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

/**
 * 全 active LINE accounts と全 active automations を一発で取って、各 auto_reply の
 * 「実際にどのアカで返信するか」を計算する。auto_reply の line_account_id が null
 * なら全アカ対象、specific なら対象 1 アカのみ。返信は inline (silent 以外) または
 * 同 keyword の automation rule (event_type='message_received') で起きる。
 */
async function computeEffectiveAccounts(
  db: D1Database,
  rule: DbAutoReply,
  accounts: Array<{ id: string; name: string }>,
  automationsByKeyword: Map<string, Set<string>>,  // keyword -> set of account_ids that have rule
): Promise<EffectiveAccount[]> {
  return accounts.map((acc) => {
    // line_account_id が specific なら対象アカ以外は適用外
    if (rule.line_account_id && rule.line_account_id !== acc.id) {
      return { accountId: acc.id, accountName: acc.name, status: 'not_applicable', via: null };
    }
    // inline 返信 (text / flex / image)
    if (rule.response_type !== 'silent') {
      return { accountId: acc.id, accountName: acc.name, status: 'reply', via: 'inline' };
    }
    // silent: 同 keyword の automation rule が同アカに存在すれば返信、無ければ silent only
    const automationAccs = automationsByKeyword.get(rule.keyword);
    if (automationAccs?.has(acc.id)) {
      return { accountId: acc.id, accountName: acc.name, status: 'reply', via: 'automation' };
    }
    return { accountId: acc.id, accountName: acc.name, status: 'silent', via: null };
  });
}

async function buildAutomationKeywordIndex(db: D1Database): Promise<Map<string, Set<string>>> {
  // event_type='message_received' で keyword を持ち、send_message を含む automation を全件取って
  // keyword -> set<account_id> のインデックス化。
  const res = await db
    .prepare(`SELECT line_account_id, conditions, actions FROM automations WHERE is_active = 1 AND event_type = 'message_received'`)
    .all<{ line_account_id: string | null; conditions: string; actions: string }>();
  const idx = new Map<string, Set<string>>();
  for (const r of res.results ?? []) {
    if (!r.line_account_id) continue;  // global rules — skip; UI assumes per-account
    let keyword: string | null = null;
    try {
      const c = JSON.parse(r.conditions) as { keyword?: string; keyword_exact?: string };
      keyword = c.keyword ?? c.keyword_exact ?? null;
    } catch { continue; }
    if (!keyword) continue;
    // send_message action があるか
    let hasSendMessage = false;
    try {
      const acts = JSON.parse(r.actions) as Array<{ type: string }>;
      hasSendMessage = acts.some((a) => a.type === 'send_message');
    } catch { continue; }
    if (!hasSendMessage) continue;
    const set = idx.get(keyword) ?? new Set<string>();
    set.add(r.line_account_id);
    idx.set(keyword, set);
  }
  return idx;
}

// GET /api/auto-replies — list all auto-replies (optional ?accountId filter)
autoReplies.get('/api/auto-replies', async (c) => {
  try {
    const accountId = c.req.query('accountId');
    const items = await getAutoReplies(c.env.DB, accountId || undefined);

    // active LINE accounts を取得 + automations の keyword -> accounts インデックスを構築
    const accRes = await c.env.DB
      .prepare(`SELECT id, name FROM line_accounts WHERE is_active = 1 ORDER BY name`)
      .all<{ id: string; name: string }>();
    const activeAccounts = accRes.results ?? [];
    const automationIdx = await buildAutomationKeywordIndex(c.env.DB);

    const data: SerializedAutoReply[] = await Promise.all(
      items.map(async (row) => {
        const base = serializeAutoReply(row);
        base.effectiveAccounts = await computeEffectiveAccounts(c.env.DB, row, activeAccounts, automationIdx);
        return base;
      }),
    );

    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/auto-replies error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/auto-replies/:id — get by ID
autoReplies.get('/api/auto-replies/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const item = await getAutoReplyById(c.env.DB, id);
    if (!item) {
      return c.json({ success: false, error: 'Auto-reply not found' }, 404);
    }
    return c.json({ success: true, data: serializeAutoReply(item) });
  } catch (err) {
    console.error('GET /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/auto-replies — create
autoReplies.post('/api/auto-replies', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      keyword: string;
      matchType?: 'exact' | 'contains';
      responseType?: string;
      responseContent?: string;
      templateId?: string | null;
      lineAccountId?: string | null;
    }>();

    if (!body.keyword) {
      return c.json({ success: false, error: 'keyword is required' }, 400);
    }
    // template_id があれば content は空でも OK (template から resolve される)。
    // silent も content 不要。それ以外は inline content 必須。
    if (!body.templateId && !body.responseContent && body.responseType !== 'silent') {
      return c.json({ success: false, error: 'templateId or responseContent required (unless responseType=silent)' }, 400);
    }

    // template_id が来てて content/type が空の場合、template の現在値を inline
    // snapshot として保存する。これがないと ON DELETE SET NULL で template_id が
    // クリアされた時に webhook resolve が空メッセージにフォールバックしてしまう。
    let resolvedResponseType = body.responseType ?? 'text';
    let resolvedResponseContent = body.responseContent ?? '';
    if (body.templateId && (!body.responseContent || !body.responseType)) {
      const { getTemplateById } = await import('@line-crm/db');
      const tpl = await getTemplateById(c.env.DB, body.templateId);
      if (tpl) {
        if (!body.responseType) resolvedResponseType = tpl.message_type;
        if (!body.responseContent) resolvedResponseContent = tpl.message_content;
      }
    }

    const item = await createAutoReply(c.env.DB, {
      keyword: body.keyword,
      matchType: body.matchType,
      responseType: resolvedResponseType,
      responseContent: resolvedResponseContent,
      templateId: body.templateId ?? null,
      lineAccountId: body.lineAccountId ?? null,
    });

    return c.json({ success: true, data: serializeAutoReply(item) }, 201);
  } catch (err) {
    console.error('POST /api/auto-replies error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/auto-replies/:id — update
autoReplies.put('/api/auto-replies/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      keyword?: string;
      matchType?: 'exact' | 'contains';
      responseType?: string;
      responseContent?: string;
      templateId?: string | null;
      lineAccountId?: string | null;
      isActive?: boolean;
    }>();

    const input: Record<string, unknown> = {};
    if (body.keyword !== undefined) input.keyword = body.keyword;
    if (body.matchType !== undefined) input.matchType = body.matchType;
    if (body.responseType !== undefined) input.responseType = body.responseType;
    if (body.responseContent !== undefined) input.responseContent = body.responseContent;
    if ('templateId' in body) input.templateId = body.templateId;
    if ('lineAccountId' in body) input.lineAccountId = body.lineAccountId;
    if (body.isActive !== undefined) input.isActive = body.isActive;

    // templateId が新たに set されて responseContent が来てない場合は template の
    // 現在値を inline snapshot として書き込む (ON DELETE SET NULL の fallback 用)。
    if (body.templateId && body.responseContent === undefined) {
      const { getTemplateById } = await import('@line-crm/db');
      const tpl = await getTemplateById(c.env.DB, body.templateId);
      if (tpl) {
        input.responseContent = tpl.message_content;
        if (body.responseType === undefined) input.responseType = tpl.message_type;
      }
    }

    const updated = await updateAutoReply(c.env.DB, id, input as Parameters<typeof updateAutoReply>[2]);

    if (!updated) {
      return c.json({ success: false, error: 'Auto-reply not found' }, 404);
    }

    return c.json({ success: true, data: serializeAutoReply(updated) });
  } catch (err) {
    console.error('PUT /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/auto-replies/:id
autoReplies.delete('/api/auto-replies/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const item = await getAutoReplyById(c.env.DB, id);
    if (!item) {
      return c.json({ success: false, error: 'Auto-reply not found' }, 404);
    }
    await deleteAutoReply(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { autoReplies };
