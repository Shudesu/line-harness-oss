import { Hono } from 'hono';
import {
  upsertFriend,
  addTagToFriend,
  getTags,
  createTag,
  getLineAccountById,
  jstNow,
} from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

const sync = new Hono<Env>();

interface FollowerIdsResponse {
  userIds: string[];
  next?: string;
}

interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

/**
 * POST /api/friends/sync
 * LINE Messaging API からフォロワーを一括取得してDBに登録する。
 * body: { lineAccountId?: string, tagNames?: string[] }
 *   - lineAccountId: 指定アカウントのトークンを使用（省略時はデフォルト）
 *   - tagNames: インポート時に全員に付与するタグ名（存在しなければ自動作成）
 */
sync.post('/api/friends/sync', requireRole('owner'), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    lineAccountId?: string;
    tagNames?: string[];
    dryRun?: boolean;
  }>().catch(() => ({}));

  // Resolve access token
  let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  const lineAccountId = (body as { lineAccountId?: string }).lineAccountId ?? null;
  if (lineAccountId) {
    const account = await getLineAccountById(db, lineAccountId);
    if (!account) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    accessToken = account.channel_access_token;
  }

  // Resolve tags (auto-create if missing)
  const tagNames = (body as { tagNames?: string[] }).tagNames ?? [];
  const tagIds: string[] = [];
  if (tagNames.length > 0) {
    const existingTags = await getTags(db);
    for (const name of tagNames) {
      const existing = existingTags.find((t) => t.name === name);
      if (existing) {
        tagIds.push(existing.id);
      } else {
        const newTag = await createTag(db, name);
        tagIds.push(newTag.id);
      }
    }
  }

  // Fetch all follower IDs from LINE API (paginated)
  const allUserIds: string[] = [];
  let nextToken: string | undefined;

  do {
    const url = nextToken
      ? `https://api.line.me/v2/bot/followers/ids?start=${nextToken}`
      : 'https://api.line.me/v2/bot/followers/ids';

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      return c.json({
        success: false,
        error: `LINE API error: ${res.status} ${errText}`,
      }, 500);
    }

    const data = (await res.json()) as FollowerIdsResponse;
    allUserIds.push(...data.userIds);
    nextToken = data.next;
  } while (nextToken);

  if ((body as { dryRun?: boolean }).dryRun) {
    return c.json({
      success: true,
      data: {
        totalFollowers: allUserIds.length,
        tagsToApply: tagNames,
        dryRun: true,
      },
    });
  }

  // Import followers with profile
  let imported = 0;
  let updated = 0;
  let failed = 0;
  const errors: Array<{ userId: string; error: string }> = [];

  // Process in batches of 20 (LINE profile API rate limit)
  const BATCH_SIZE = 20;
  for (let i = 0; i < allUserIds.length; i += BATCH_SIZE) {
    const batch = allUserIds.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (userId) => {
        // Get profile
        let profile: LineProfile | null = null;
        try {
          const profileRes = await fetch(
            `https://api.line.me/v2/bot/profile/${userId}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (profileRes.ok) {
            profile = (await profileRes.json()) as LineProfile;
          }
        } catch {
          // Profile fetch failed, continue with userId only
        }

        // Upsert friend
        const friend = await upsertFriend(db, {
          lineUserId: userId,
          displayName: profile?.displayName ?? null,
          pictureUrl: profile?.pictureUrl ?? null,
          statusMessage: profile?.statusMessage ?? null,
        });

        // Set line_account_id
        if (lineAccountId) {
          await db
            .prepare('UPDATE friends SET line_account_id = ? WHERE id = ? AND line_account_id IS NULL')
            .bind(lineAccountId, friend.id)
            .run();
        }

        // Apply tags
        for (const tagId of tagIds) {
          try {
            await addTagToFriend(db, friend.id, tagId);
          } catch {
            // Tag already applied, ignore
          }
        }

        return { friendId: friend.id, isNew: !friend.updated_at || friend.created_at === friend.updated_at };
      }),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === 'fulfilled') {
        if (result.value.isNew) {
          imported++;
        } else {
          updated++;
        }
      } else {
        failed++;
        errors.push({ userId: batch[j], error: String(result.reason) });
      }
    }
  }

  return c.json({
    success: true,
    data: {
      totalFollowers: allUserIds.length,
      imported,
      updated,
      failed,
      tagsApplied: tagNames,
      errors: errors.slice(0, 20),
    },
  });
});

/**
 * POST /api/friends/import
 * 友だちデータを直接受け取ってDBに登録する（LINE API不要）。
 * body: { friends: Array<{ userId: string, name?: string }> }
 */
sync.post('/api/friends/import', requireRole('owner'), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    friends: Array<{ userId: string; name?: string }>;
  }>();

  if (!body.friends?.length) {
    return c.json({ success: false, error: 'friends array required' }, 400);
  }

  let imported = 0;
  let skipped = 0;

  for (const f of body.friends) {
    try {
      await upsertFriend(db, {
        lineUserId: f.userId,
        displayName: f.name ?? null,
        pictureUrl: null,
        statusMessage: null,
      });
      imported++;
    } catch {
      skipped++;
    }
  }

  return c.json({
    success: true,
    data: { total: body.friends.length, imported, skipped },
  });
});

export { sync };
