import { describe, expect, it } from "vitest";
import { buildAccountSyncWarnings, evaluateSyncHealth } from "./sync-health.js";

/**
 * 代表的な本番規模の値。followers はブロック済みを含む累計なので、
 * DB 実数（friendsInDb）とは定義上一致せず、targetedReaches ≒ DB になる。
 */
const PROD_SCALE_SAMPLE = {
  friendsInDb: 10325,
  followers: 14342,
  targetedReaches: 10317,
  blocks: 3835,
};

describe("evaluateSyncHealth", () => {
  describe("誤検知しないこと（同期は正常）", () => {
    it("代表的な本番規模の値で warning を出さない", () => {
      const result = evaluateSyncHealth(PROD_SCALE_SAMPLE);

      expect(result.syncRiskLevel).toBe("ok");
      expect(result.warning).toBeNull();
    });

    it("followers ではなく targetedReaches を基準にする", () => {
      const result = evaluateSyncHealth(PROD_SCALE_SAMPLE);

      expect(result.syncBaseline).toBe("targetedReaches");
      expect(result.syncBaselineValue).toBe(10317);
      // 10325 - 10317 = 8。followers 基準の -4017 ではない。
      expect(result.syncDifference).toBe(8);
    });

    it("小規模アカウントの完全一致でも ok", () => {
      const result = evaluateSyncHealth({
        friendsInDb: 2,
        followers: 2,
        targetedReaches: 2,
        blocks: 0,
      });

      expect(result.syncRiskLevel).toBe("ok");
    });

    it("小規模アカウントの1〜2件のズレでは警告しない（絶対値の下駄）", () => {
      const result = evaluateSyncHealth({
        friendsInDb: 14,
        followers: 20,
        targetedReaches: 12,
        blocks: 6,
      });

      expect(result.syncRiskLevel).toBe("ok");
    });

    it("友だちが急増した日でも DB が先行しているだけなら ok", () => {
      // インサイトは前日分で固定、DB は当日ぶんを即時反映するので DB が先行する。
      const result = evaluateSyncHealth({
        friendsInDb: 10617, // 前日比 +300 の流入
        followers: 14342,
        targetedReaches: 10317,
        blocks: 3835,
      });

      expect(result.syncRiskLevel).toBe("ok");
    });
  });

  describe("本物の同期断は検知すること", () => {
    it("webhook 停止（DB が LINE に追随できず取り残される）で warning", () => {
      // follow イベントを取りこぼし続けると DB だけ増えなくなる。
      const result = evaluateSyncHealth({
        friendsInDb: 9800,
        followers: 14342,
        targetedReaches: 10317,
        blocks: 3835,
      });

      expect(result.syncRiskLevel).toBe("warning");
      expect(result.warning).toContain("9800");
      expect(result.warning).toContain("10317");
    });

    it("DB が LINE を大幅に上回る場合も warning", () => {
      const result = evaluateSyncHealth({
        friendsInDb: 13000,
        followers: 14342,
        targetedReaches: 10317,
        blocks: 3835,
      });

      expect(result.syncRiskLevel).toBe("warning");
    });

    it("警告文は followers ではなく実際に比較した基準を示す", () => {
      const result = evaluateSyncHealth({
        friendsInDb: 9800,
        followers: 14342,
        targetedReaches: 10317,
        blocks: 3835,
      });

      expect(result.warning).toContain("targetedReaches");
      // ブロック込み累計の 14342 を突きつけて混乱させない。
      expect(result.warning).not.toContain("14342");
    });
  });

  describe("インサイトが取れないときは unknown（警告を偽装しない）", () => {
    it("チャネルトークン失効などで全指標が null なら unknown", () => {
      const result = evaluateSyncHealth({
        friendsInDb: 10325,
        followers: null,
        targetedReaches: null,
        blocks: null,
      });

      expect(result.syncRiskLevel).toBe("unknown");
      expect(result.syncBaseline).toBeNull();
      expect(result.warning).toBeNull();
    });

    it("DB 件数が取れないなら unknown", () => {
      const result = evaluateSyncHealth({
        friendsInDb: null,
        followers: 14342,
        targetedReaches: 10317,
        blocks: 3835,
      });

      expect(result.syncRiskLevel).toBe("unknown");
    });
  });

  describe("targetedReaches が無いときは followers - blocks で代替", () => {
    it("代替基準を使ったことを明示する", () => {
      const result = evaluateSyncHealth({
        friendsInDb: 10325,
        followers: 14342,
        targetedReaches: null,
        blocks: 3835,
      });

      expect(result.syncBaseline).toBe("followersMinusBlocks");
      expect(result.syncBaselineValue).toBe(10507);
      expect(result.syncRiskLevel).toBe("ok");
    });

    it("代替基準でも本物の同期断は検知する", () => {
      const result = evaluateSyncHealth({
        friendsInDb: 6000,
        followers: 14342,
        targetedReaches: null,
        blocks: 3835,
      });

      expect(result.syncRiskLevel).toBe("warning");
    });

    it("blocks が無ければ差し引けないので unknown", () => {
      const result = evaluateSyncHealth({
        friendsInDb: 10325,
        followers: 14342,
        targetedReaches: null,
        blocks: null,
      });

      expect(result.syncRiskLevel).toBe("unknown");
      expect(result.syncBaseline).toBeNull();
    });
  });
});

describe("buildAccountSyncWarnings", () => {
  const healthySignals = {
    dbCountAvailable: true,
    insightAvailable: true,
    insightStatus: "ready",
    insightDate: "20260719",
    sync: evaluateSyncHealth(PROD_SCALE_SAMPLE),
  };

  it("正常状態では警告が1件も出ない", () => {
    expect(buildAccountSyncWarnings(healthySignals)).toEqual([]);
  });

  it("チャネルトークン失効（インサイトが取れない）で警告", () => {
    const warnings = buildAccountSyncWarnings({
      ...healthySignals,
      insightAvailable: false,
      insightError: "HTTP 401",
      insightStatus: null,
      sync: evaluateSyncHealth({
        friendsInDb: 10325,
        followers: null,
        targetedReaches: null,
        blocks: null,
      }),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("LINE follower insight unavailable");
    expect(warnings[0]).toContain("HTTP 401");
  });

  it("webhook 停止で警告", () => {
    const warnings = buildAccountSyncWarnings({
      ...healthySignals,
      sync: evaluateSyncHealth({
        friendsInDb: 9800,
        followers: 14342,
        targetedReaches: 10317,
        blocks: 3835,
      }),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Check webhook sync and channel tokens");
  });

  it("DB 件数が取れないときに警告", () => {
    const warnings = buildAccountSyncWarnings({
      ...healthySignals,
      dbCountAvailable: false,
      dbCountError: "HTTP 500",
      sync: evaluateSyncHealth({
        friendsInDb: null,
        followers: 14342,
        targetedReaches: 10317,
        blocks: 3835,
      }),
    });

    expect(warnings[0]).toContain("DB friend count unavailable");
  });

  it("インサイトが当日ぶん未確定なら警告", () => {
    const warnings = buildAccountSyncWarnings({
      ...healthySignals,
      insightStatus: "unready",
      sync: evaluateSyncHealth({
        friendsInDb: 10325,
        followers: null,
        targetedReaches: null,
        blocks: null,
      }),
    });

    expect(warnings[0]).toContain("not ready for 20260719");
  });

  it("指標が欠けて判定不能なときは無言にせず警告する", () => {
    // API は成功しているのに到達可能数が返らないケース。
    // 沈黙させると warningCount 0 =「正常」と誤読されるので明示的に警告する。
    const warnings = buildAccountSyncWarnings({
      ...healthySignals,
      sync: evaluateSyncHealth({
        friendsInDb: 10325,
        followers: 14342,
        targetedReaches: null,
        blocks: null,
      }),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("could not be verified");
  });

  it("原因が既に説明されているときは判定不能の警告を重ねない", () => {
    const warnings = buildAccountSyncWarnings({
      ...healthySignals,
      insightAvailable: false,
      insightError: "HTTP 401",
      insightStatus: null,
      sync: evaluateSyncHealth({
        friendsInDb: 10325,
        followers: null,
        targetedReaches: null,
        blocks: null,
      }),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("could not be verified");
  });
});
