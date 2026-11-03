// KIDOUインターンの「答える前（鍵付き）」「答えた後（解放後）」のリッチメニューを、
// 管理画面のリッチメニューから選ぶ受け口。仕組みは services/intern-richmenus.ts
import { Hono } from 'hono';
import { getLineAccountById } from '@line-crm/db';
import type { Env } from '../index.js';
import { surveyConfigFromEnv } from '../services/intern-survey.js';
import {
  type InternRichMenuChoice,
  loadInternRichMenuChoice,
  publishedRichMenuIdOf,
  relinkInternFriends,
  saveInternRichMenuChoice,
} from '../services/intern-richmenus.js';
import { createLineClient } from './rich-menu-groups.js';

const internRichMenus = new Hono<Env>();

const NO_ACCOUNT = 'KIDOUインターンのアカウントが設定されていません';

internRichMenus.get('/api/intern/richmenus', async (c) => {
  const config = surveyConfigFromEnv(c.env);
  if (!config.accountId) return c.json({ success: false, error: NO_ACCOUNT }, 404);
  const accountId = config.accountId;
  const choice = await loadInternRichMenuChoice(c.env.DB, accountId);
  const [lockedId, unlockedId] = await Promise.all([
    choice.lockedGroupId ? publishedRichMenuIdOf(c.env.DB, accountId, choice.lockedGroupId) : null,
    choice.unlockedGroupId ? publishedRichMenuIdOf(c.env.DB, accountId, choice.unlockedGroupId) : null,
  ]);
  return c.json({
    success: true,
    data: {
      accountId,
      lockedGroupId: choice.lockedGroupId,
      unlockedGroupId: choice.unlockedGroupId,
      // 選んだのに公開されていない（LINE 上に無い）ときは null。そのあいだは秘密の値のメニューを使う
      lockedRichMenuId: lockedId,
      unlockedRichMenuId: unlockedId,
      fallbackLockedRichMenuId: config.lockedRichMenuId ?? null,
      fallbackUnlockedRichMenuId: config.unlockedRichMenuId ?? null,
    },
  });
});

// body: { lockedGroupId: string | null, unlockedGroupId: string | null }
// 保存したら、友だちのままの人にすぐ付け直す（答えた人＝解放後、まだの人＝鍵付き）。
// 鍵付きは、新しく友だちになった人に最初から出るよう「全員のデフォルト」にもする。
internRichMenus.put('/api/intern/richmenus', async (c) => {
  const config = surveyConfigFromEnv(c.env);
  if (!config.accountId) return c.json({ success: false, error: NO_ACCOUNT }, 404);
  const accountId = config.accountId;
  let body: { lockedGroupId?: unknown; unlockedGroupId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: '中身を読み取れませんでした' }, 400);
  }
  const pick = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const lockedGroupId = pick(body.lockedGroupId);
  const unlockedGroupId = pick(body.unlockedGroupId);
  if (lockedGroupId && lockedGroupId === unlockedGroupId) {
    return c.json({ success: false, error: '答える前と答えた後に同じメニューは選べません' }, 400);
  }
  const [lockedId, unlockedId] = await Promise.all([
    lockedGroupId ? publishedRichMenuIdOf(c.env.DB, accountId, lockedGroupId) : null,
    unlockedGroupId ? publishedRichMenuIdOf(c.env.DB, accountId, unlockedGroupId) : null,
  ]);
  if (lockedGroupId && !lockedId) {
    return c.json({ success: false, error: '「答える前」に選んだメニューが LINE に公開されていません。先に公開してください' }, 400);
  }
  if (unlockedGroupId && !unlockedId) {
    return c.json({ success: false, error: '「答えた後」に選んだメニューが LINE に公開されていません。先に公開してください' }, 400);
  }

  const before = await loadInternRichMenuChoice(c.env.DB, accountId);
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account) return c.json({ success: false, error: 'LINE アカウントが見つかりません' }, 500);
  const line = createLineClient(account.channel_access_token);

  // LINE 側（全員のデフォルト・友だちへの付け直し）が済んだ役から保存する。
  // 途中で失敗したら、その役は前の選択のまま残すので、もう一度保存すればやり直せる
  const saved: InternRichMenuChoice = { ...before };
  const result = { relinkedLocked: 0, relinkedUnlocked: 0 };
  try {
    if (lockedGroupId !== before.lockedGroupId) {
      if (lockedId && lockedGroupId) {
        await line.setDefaultRichMenu(lockedId);
        result.relinkedLocked = await relinkInternFriends(c.env.DB, line, accountId, 'locked', lockedId);
        const now = new Date().toISOString();
        await c.env.DB.batch([
          c.env.DB.prepare('UPDATE rich_menu_groups SET is_default_for_all = 0, updated_at = ? WHERE account_id = ? AND id != ?').bind(now, accountId, lockedGroupId),
          c.env.DB.prepare('UPDATE rich_menu_groups SET is_default_for_all = 1, updated_at = ? WHERE id = ?').bind(now, lockedGroupId),
        ]);
      }
      saved.lockedGroupId = lockedGroupId;
      await saveInternRichMenuChoice(c.env.DB, accountId, saved);
    }
    if (unlockedGroupId !== before.unlockedGroupId) {
      if (unlockedId) {
        result.relinkedUnlocked = await relinkInternFriends(c.env.DB, line, accountId, 'unlocked', unlockedId);
      }
      saved.unlockedGroupId = unlockedGroupId;
      await saveInternRichMenuChoice(c.env.DB, accountId, saved);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json(
      {
        success: false,
        error: `LINE への反映に失敗したため、切り替えられなかった分は前のメニューのままです。もう一度保存してください（${message}）`,
        data: { ...result, saved },
      },
      502,
    );
  }
  return c.json({ success: true, data: { ...result, saved } });
});

export { internRichMenus };
