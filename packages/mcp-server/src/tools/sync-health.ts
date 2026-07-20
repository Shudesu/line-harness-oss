/**
 * DB の友だち数と LINE インサイトを突き合わせて、webhook 同期が壊れていないかを判定する。
 *
 * 重要な前提: LINE の `followers` は「友だち追加された延べ人数」の累計で、
 * ブロックされても退会されても減らない。一方 DB の friendsInDb はブロックを除いた実数なので、
 * この2つは定義上ずっと一致しない（followers はブロック・退会ぶんだけ DB を上回る）。
 * followers と直接比べると恒常的に警告が出続け、本物の異常が埋もれる。
 *
 * そこで到達可能な友だち数を基準にする:
 *   1. `targetedReaches`（LINE が「配信到達可能」と数えた実数。最も DB に近い）
 *   2. `followers - blocks`（targetedReaches が取れないときの代替。粗いので許容幅を広げる）
 */

export type SyncBaseline = "targetedReaches" | "followersMinusBlocks";

export interface SyncHealthInput {
  friendsInDb: number | null;
  followers: number | null;
  targetedReaches: number | null;
  blocks: number | null;
}

export interface SyncHealthResult {
  syncBaseline: SyncBaseline | null;
  syncBaselineValue: number | null;
  /** friendsInDb - syncBaselineValue（正 = DB が先行、負 = DB が取り残されている） */
  syncDifference: number | null;
  /** 許容する差の絶対値。これを超えると warning。 */
  syncTolerance: number | null;
  syncRiskLevel: "ok" | "warning" | "unknown";
  warning: string | null;
}

interface DirectionalTolerance {
  /** 基準値に対する割合 */
  ratio: number;
  /** 小規模アカウントで割合がゼロ同然になるのを防ぐ下駄 */
  floor: number;
}

/**
 * 許容幅は「DB が先行」と「DB が遅れ」で非対称にする。
 *
 * - ahead(DB > 基準): 想定内。インサイトは前日分で固定なのに DB は当日の追加を即時反映するため、
 *   常に DB が先行する。ブロック解除やアンフォロー取りこぼしも同じ向きに効く。流入が跳ねた日に
 *   誤検知しないよう広めに取る。
 * - behind(DB < 基準): webhook 停止の兆候そのもの。follow イベントを取りこぼすと DB だけが
 *   増えなくなり、この向きに開いていく。早く気づきたいので狭くする。
 */
const TOLERANCE: Record<SyncBaseline, { ahead: DirectionalTolerance; behind: DirectionalTolerance }> = {
  // 通常 DB との差は基準値の 1% 未満に収まる。下の閾値は十分な余裕を持たせてある。
  targetedReaches: {
    ahead: { ratio: 0.05, floor: 100 },
    behind: { ratio: 0.01, floor: 50 },
  },
  // followers - blocks は targetedReaches とは数%ずれる粗い近似なので広めに取る。
  followersMinusBlocks: {
    ahead: { ratio: 0.08, floor: 150 },
    behind: { ratio: 0.04, floor: 100 },
  },
};

function isUsableCount(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** 到達可能な友だち数の基準を、優先順に選ぶ。 */
function pickBaseline(
  input: SyncHealthInput,
): { baseline: SyncBaseline; value: number } | null {
  if (isUsableCount(input.targetedReaches)) {
    return { baseline: "targetedReaches", value: input.targetedReaches };
  }
  if (isUsableCount(input.followers) && isUsableCount(input.blocks)) {
    const reachable = input.followers - input.blocks;
    // 累計と時点値の混在でごく稀に負になりうる。その場合は基準として使えない。
    if (reachable >= 0) {
      return { baseline: "followersMinusBlocks", value: reachable };
    }
  }
  return null;
}

const UNKNOWN: SyncHealthResult = {
  syncBaseline: null,
  syncBaselineValue: null,
  syncDifference: null,
  syncTolerance: null,
  syncRiskLevel: "unknown",
  warning: null,
};

export interface AccountSyncSignals {
  dbCountAvailable: boolean;
  dbCountError?: string;
  /** インサイト API 自体が取れたか（チャネルトークン失効ならここが false） */
  insightAvailable: boolean;
  insightError?: string;
  insightStatus: string | null;
  insightDate: string;
  sync: SyncHealthResult;
}

/**
 * アカウント1件ぶんの警告文を組み立てる。
 *
 * 「判定できなかった」を無言で ok 扱いにしないのが要点。指標が欠けて unknown になった場合、
 * 他に理由を説明する警告が無ければ「検証できていない」ことを明示的に警告する。
 * 毎日見る画面に出す以上、沈黙は「正常」と読まれてしまうため。
 */
export function buildAccountSyncWarnings(signals: AccountSyncSignals): string[] {
  const warnings: string[] = [];

  if (!signals.dbCountAvailable) {
    warnings.push(`DB friend count unavailable: ${signals.dbCountError ?? "unknown error"}`);
  }
  if (!signals.insightAvailable) {
    warnings.push(`LINE follower insight unavailable: ${signals.insightError ?? "unknown error"}`);
  } else if (signals.insightStatus !== "ready") {
    warnings.push(`LINE follower insight is not ready for ${signals.insightDate}`);
  }

  if (signals.sync.warning) {
    warnings.push(signals.sync.warning);
  } else if (signals.sync.syncRiskLevel === "unknown" && warnings.length === 0) {
    warnings.push(
      "Sync health could not be verified: LINE returned no reachable-friend metrics " +
        "(targetedReaches / blocks). Treat sync status as unconfirmed, not healthy.",
    );
  }

  return warnings;
}

export function evaluateSyncHealth(input: SyncHealthInput): SyncHealthResult {
  if (!isUsableCount(input.friendsInDb)) return { ...UNKNOWN };

  const picked = pickBaseline(input);
  if (!picked) return { ...UNKNOWN };

  const difference = input.friendsInDb - picked.value;
  const direction = difference >= 0 ? "ahead" : "behind";
  const { ratio, floor } = TOLERANCE[picked.baseline][direction];
  const tolerance = Math.max(floor, Math.floor(picked.value * ratio));

  const withinTolerance = Math.abs(difference) <= tolerance;
  const warning = withinTolerance
    ? null
    : `DB friends (${input.friendsInDb}) differ from LINE reachable friends ` +
      `(${picked.value}, baseline=${picked.baseline}) by ${difference}, ` +
      `beyond tolerance ±${tolerance}. Check webhook sync and channel tokens.`;

  return {
    syncBaseline: picked.baseline,
    syncBaselineValue: picked.value,
    syncDifference: difference,
    syncTolerance: tolerance,
    syncRiskLevel: withinTolerance ? "ok" : "warning",
    warning,
  };
}
