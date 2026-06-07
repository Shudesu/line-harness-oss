import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  computeUnansweredInbox,
  countUnanswered,
  type UnansweredInboxOptions,
} from '../services/unanswered-inbox.js';

export const inbox = new Hono<Env>();

inbox.get('/api/inbox/unanswered', async (c) => {
  try {
    const q = c.req.query('q');
    // Codex P0 修正: account (= lineAccountId) を必須化。
    // 省略すると全アカ横断で未回答 inbox を返すため、テナント境界がない。
    // 単一アカ運用のクライアントも明示的に accountId を渡す方針に変える。
    const account = c.req.query('account');
    if (!account) {
      return c.json({ success: false, error: 'account (lineAccountId) is required' }, 400);
    }
    const idPattern = /^[a-f0-9-]{32,36}$/i;
    if (!idPattern.test(account)) {
      return c.json({ success: false, error: 'account の形式が不正です' }, 400);
    }
    const minWaitMinutesStr = c.req.query('minWaitMinutes');
    const pageStr = c.req.query('page');
    const pageSizeStr = c.req.query('pageSize');

    const opts: UnansweredInboxOptions = {
      q: q || undefined,
      account,
      minWaitMinutes: minWaitMinutesStr ? Number.parseInt(minWaitMinutesStr, 10) : undefined,
      page: pageStr ? Number.parseInt(pageStr, 10) : undefined,
      pageSize: pageSizeStr ? Number.parseInt(pageSizeStr, 10) : undefined,
    };

    const result = await computeUnansweredInbox(c.env.DB, opts);
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('GET /api/inbox/unanswered error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

inbox.get('/api/inbox/unanswered/count', async (c) => {
  try {
    const result = await countUnanswered(c.env.DB);
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('GET /api/inbox/unanswered/count error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
