// KIDOUインターンの「自動で送る文面」の受け口（管理画面）。仕組みは services/intern-copy.ts
//
// アンケート・Q&A・再案内の文面は account_settings に、あいさつ・回答後の文は定型文（message_templates）の
// 「ズ_あいさつ_◯」「ズ_回答後_◯」に置く。どちらもここから読み書きする（スタッフも担当なら触れる）。
import { Hono } from 'hono';
import { jstNow } from '@line-crm/db';
import type { Env } from '../index.js';
import { DEFAULT_COPY, loadCopyRecord, saveCopy, validateCopy } from '../services/intern-copy.js';
import { DONE_IMAGE_URL, GRADES, surveyConfigFromEnv } from '../services/intern-survey.js';

const internCopy = new Hono<Env>();

const NO_ACCOUNT = 'KIDOUインターンのアカウントが設定されていません';

const GROUPS = {
  greeting: 'ズ_あいさつ_',
  doneIntro: 'ズ_回答後_',
} as const;
type Group = keyof typeof GROUPS;
const NAME = /^ズ_(あいさつ|回答後)_(\d+)$/;
// 1回の返事で送れるのは5つまで。アンケートの入口・画像の分を残して4つ
const GROUP_MAX = 4;

interface TemplateRow {
  id: string;
  name: string;
  message_type: string;
  message_content: string;
  updated_at: string;
}

function groupOf(name: string): Group | null {
  const m = NAME.exec(name);
  if (!m) return null;
  return m[1] === 'あいさつ' ? 'greeting' : 'doneIntro';
}

async function listGroupTemplates(db: D1Database) {
  const rows = await db
    .prepare("SELECT id, name, message_type, message_content, updated_at FROM message_templates WHERE name LIKE 'ズ_あいさつ_%' OR name LIKE 'ズ_回答後_%'")
    .all<TemplateRow>();
  const out: Record<Group, { id: string; name: string; messageType: string; messageContent: string; updatedAt: string }[]> = {
    greeting: [],
    doneIntro: [],
  };
  for (const r of rows.results ?? []) {
    const g = groupOf(r.name);
    if (!g) continue;
    out[g].push({ id: r.id, name: r.name, messageType: r.message_type, messageContent: r.message_content, updatedAt: r.updated_at });
  }
  for (const g of Object.keys(out) as Group[]) out[g].sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
  return out;
}

/** 定型文の中身を確かめる。問題があれば日本語で返す */
function checkTemplate(messageType: unknown, messageContent: unknown): string | null {
  if (messageType !== 'text' && messageType !== 'flex') return '種類が正しくありません';
  if (typeof messageContent !== 'string') return '中身がありません';
  if (messageContent.length > 20000) return '長すぎます';
  if (messageType === 'text') return messageContent.length > 5000 ? '文は5000字までです' : null;
  try {
    const parsed = JSON.parse(messageContent);
    if (!parsed || (parsed.type !== 'bubble' && parsed.type !== 'carousel')) return 'カードの形が正しくありません';
  } catch {
    return 'カードの形が正しくありません';
  }
  return null;
}

internCopy.get('/api/intern/line-copy', async (c) => {
  const config = surveyConfigFromEnv(c.env);
  if (!config.accountId) return c.json({ success: false, error: NO_ACCOUNT }, 404);
  try {
    const [record, templates] = await Promise.all([loadCopyRecord(c.env.DB, config.accountId), listGroupTemplates(c.env.DB)]);
    return c.json({
      success: true,
      data: {
        copy: record.copy,
        defaults: DEFAULT_COPY,
        updatedAt: record.updatedAt,
        templates,
        context: {
          hasPicker: !!config.pickerUrl,
          termsUrl: config.termsUrl ?? null,
          privacyPolicyUrl: config.privacyPolicyUrl ?? null,
          doneImageUrl: DONE_IMAGE_URL,
          grades: GRADES,
          reminderOn: c.env.INTERN_SURVEY_REMINDER === 'on',
        },
      },
    });
  } catch (err) {
    console.error('GET /api/intern/line-copy error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

internCopy.put('/api/intern/line-copy', async (c) => {
  const config = surveyConfigFromEnv(c.env);
  if (!config.accountId) return c.json({ success: false, error: NO_ACCOUNT }, 404);
  const body = await c.req.json<{ copy?: unknown }>().catch(() => null);
  const result = validateCopy(body?.copy);
  if (!result.ok) return c.json({ success: false, error: result.errors.join('\n'), errors: result.errors }, 400);
  try {
    const now = jstNow();
    await saveCopy(c.env.DB, config.accountId, result.copy, now);
    return c.json({ success: true, data: { copy: result.copy, updatedAt: now } });
  } catch (err) {
    console.error('PUT /api/intern/line-copy error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// あいさつ・回答後の文を1つ足す。名前は空いている次の番号
internCopy.post('/api/intern/line-copy/templates', async (c) => {
  const body = await c.req.json<{ group?: unknown; messageType?: unknown; messageContent?: unknown }>().catch(() => null);
  const group = body?.group === 'greeting' || body?.group === 'doneIntro' ? body.group : null;
  if (!group) return c.json({ success: false, error: 'どこに足すかが正しくありません' }, 400);
  const problem = checkTemplate(body?.messageType, body?.messageContent);
  if (problem) return c.json({ success: false, error: problem }, 400);
  try {
    const all = await listGroupTemplates(c.env.DB);
    if (all[group].filter((t) => t.messageContent.trim()).length >= GROUP_MAX) {
      return c.json({ success: false, error: `1回に送れるのは${GROUP_MAX}つまでです` }, 400);
    }
    const used = all[group].map((t) => Number(NAME.exec(t.name)?.[2] ?? 0));
    const name = `${GROUPS[group]}${(used.length ? Math.max(...used) : 0) + 1}`;
    const now = jstNow();
    const id = crypto.randomUUID();
    await c.env.DB
      .prepare('INSERT INTO message_templates (id, name, message_type, message_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, name, body!.messageType as string, body!.messageContent as string, now, now)
      .run();
    return c.json({ success: true, data: { id, name } }, 201);
  } catch (err) {
    console.error('POST /api/intern/line-copy/templates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

async function findGroupTemplate(db: D1Database, id: string): Promise<TemplateRow | null> {
  const row = await db
    .prepare('SELECT id, name, message_type, message_content, updated_at FROM message_templates WHERE id = ?')
    .bind(id)
    .first<TemplateRow>();
  return row && groupOf(row.name) ? row : null;
}

internCopy.put('/api/intern/line-copy/templates/:id', async (c) => {
  const body = await c.req.json<{ messageType?: unknown; messageContent?: unknown }>().catch(() => null);
  const problem = checkTemplate(body?.messageType, body?.messageContent);
  if (problem) return c.json({ success: false, error: problem }, 400);
  try {
    const row = await findGroupTemplate(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    await c.env.DB
      .prepare('UPDATE message_templates SET message_type = ?, message_content = ?, updated_at = ? WHERE id = ?')
      .bind(body!.messageType as string, body!.messageContent as string, jstNow(), row.id)
      .run();
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /api/intern/line-copy/templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

internCopy.delete('/api/intern/line-copy/templates/:id', async (c) => {
  try {
    const row = await findGroupTemplate(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    await c.env.DB.prepare('DELETE FROM message_templates WHERE id = ?').bind(row.id).run();
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/intern/line-copy/templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { internCopy };
