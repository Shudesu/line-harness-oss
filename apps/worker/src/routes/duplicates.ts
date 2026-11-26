import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  computeDuplicatesStats,
  type DuplicatesStats,
  type PerAccountStat,
  type PairwiseOverlap,
} from '../services/duplicates-stats.js';

interface PerAccountStatDTO {
  accountId: string;
  accountName: string;
  friends: number;
  dups: number;
  dupRate: number;
}

interface PairwiseOverlapDTO {
  fromAccountId: string;
  toAccountId: string;
  overlap: number;
}

interface DuplicatesStatsDTO {
  totalFollowing: number;
  uniquePeople: number;
  friendDups: number;
  duplicateGroups: number;
  wastedPerBroadcastYen: number;
  msgUnitYen: number;
  perAccount: PerAccountStatDTO[];
  pairwiseOverlap: PairwiseOverlapDTO[];
  computedAt: string;
}

function serializePerAccount(row: PerAccountStat): PerAccountStatDTO {
  return {
    accountId: row.account_id,
    accountName: row.account_name,
    friends: row.friends,
    dups: row.dups,
    dupRate: row.dup_rate,
  };
}

function serializePairwise(row: PairwiseOverlap): PairwiseOverlapDTO {
  return {
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    overlap: row.overlap,
  };
}

function serializeDuplicatesStats(stats: DuplicatesStats): DuplicatesStatsDTO {
  return {
    totalFollowing: stats.total_following,
    uniquePeople: stats.unique_people,
    friendDups: stats.friend_dups,
    duplicateGroups: stats.duplicate_groups,
    wastedPerBroadcastYen: stats.wasted_per_broadcast_yen,
    msgUnitYen: stats.msg_unit_yen,
    perAccount: stats.per_account.map(serializePerAccount),
    pairwiseOverlap: stats.pairwise_overlap.map(serializePairwise),
    computedAt: stats.computed_at,
  };
}

export const duplicates = createAuthorizedRouter<Env>();

duplicates.get('/api/duplicates/stats', async (c) => {
  try {
    const forceRefresh = c.req.query('refresh') === '1';
    const stats = await computeDuplicatesStats(c.env.DB, { forceRefresh });
    return c.json({ success: true, data: serializeDuplicatesStats(stats) });
  } catch (err) {
    console.error('GET /api/duplicates/stats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
