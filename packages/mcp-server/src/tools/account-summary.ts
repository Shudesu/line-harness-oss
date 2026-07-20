import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";
import {
  buildAccountSyncWarnings,
  evaluateSyncHealth,
  type SyncBaseline,
} from "./sync-health.js";

interface AccountInfo {
  id: string;
  name: string;
  channelId: string;
}

interface AccountStat {
  id: string;
  name: string;
  channelId: string;
  friendsInDb: number | null;
  friendsFromLine: number | null;
  lineFollowersDate: string;
  lineFollowersStatus: string | null;
  dbCountStatus: "ready" | "error";
  lineCountStatus: "ready" | "unready" | "error";
  syncBaseline: SyncBaseline | null;
  syncBaselineValue: number | null;
  syncDifference: number | null;
  syncTolerance: number | null;
  syncRiskLevel: "ok" | "warning" | "unknown";
  riskLevel?: string;
  targetedReaches?: number | null;
  blocks?: number | null;
  warnings: string[];
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function yyyymmddInJst(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

function previousJstDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return yyyymmddInJst(d);
}

async function fetchHarnessJson<T>(
  apiUrl: string,
  apiKey: string,
  path: string,
): Promise<ApiEnvelope<T>> {
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!res.ok) {
      return {
        success: false,
        error: json?.error ?? `HTTP ${res.status}`,
      };
    }
    if (!json?.success) {
      return {
        success: false,
        error: json?.error ?? "API returned success=false",
      };
    }
    return json;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerAccountSummary(server: McpServer): void {
  server.tool(
    "account_summary",
    "Get a high-level summary of the LINE account: friend count per account (DB + LINE API stats), active scenarios, recent broadcasts, tags, and forms. Use this to understand the current state before making changes.",
    {
      accountId: z
        .string()
        .optional()
        .describe("LINE account ID (uses default if omitted)"),
    },
    async ({ accountId }) => {
      try {
        const client = getClient();
        const apiUrl = process.env.LINE_HARNESS_API_URL;
        const apiKey = process.env.LINE_HARNESS_API_KEY;
        if (!apiUrl || !apiKey) {
          throw new Error("LINE_HARNESS_API_URL and LINE_HARNESS_API_KEY are required");
        }
        const lineFollowersDate = previousJstDate();

        // Fetch all LINE accounts
        const accountsData = await fetchHarnessJson<AccountInfo[]>(
          apiUrl,
          apiKey,
          "/api/line-accounts",
        );
        const accounts: AccountInfo[] = accountsData.success
          ? accountsData.data ?? []
          : [];

        // Get per-account friend counts
        const accountStats: AccountStat[] = [];
        for (const acc of accounts) {
          // Use direct API call for per-account count (SDK count() has no params)
          const countData = await fetchHarnessJson<{ count: number }>(
            apiUrl,
            apiKey,
            `/api/friends/count?lineAccountId=${encodeURIComponent(acc.id)}`,
          );
          const lineData = await fetchHarnessJson<{
            date: string;
            status: string;
            followers: number | null;
            targetedReaches: number | null;
            blocks: number | null;
          }>(
            apiUrl,
            apiKey,
            `/api/line-accounts/${encodeURIComponent(acc.id)}/follower-insight?date=${lineFollowersDate}`,
          );
          const friendsInDb = countData.success ? countData.data?.count ?? null : null;
          const friendsFromLine = lineData.success && lineData.data?.status === "ready"
            ? lineData.data.followers
            : null;
          const targetedReaches = lineData.success ? lineData.data?.targetedReaches ?? null : null;
          const blocks = lineData.success ? lineData.data?.blocks ?? null : null;
          // followers はブロック済みを含む累計なので比較基準に使わない（sync-health.ts 参照）。
          const sync = evaluateSyncHealth({
            friendsInDb,
            followers: friendsFromLine,
            targetedReaches,
            blocks,
          });
          const warnings = buildAccountSyncWarnings({
            dbCountAvailable: countData.success,
            dbCountError: countData.error,
            insightAvailable: lineData.success,
            insightError: lineData.error,
            insightStatus: lineData.success ? lineData.data?.status ?? null : null,
            insightDate: lineFollowersDate,
            sync,
          });
          accountStats.push({
            id: acc.id,
            name: acc.name,
            channelId: acc.channelId,
            friendsInDb,
            friendsFromLine,
            lineFollowersDate,
            lineFollowersStatus: lineData.success ? lineData.data?.status ?? null : null,
            dbCountStatus: countData.success ? "ready" : "error",
            lineCountStatus: !lineData.success
              ? "error"
              : lineData.data?.status === "ready"
                ? "ready"
                : "unready",
            syncBaseline: sync.syncBaseline,
            syncBaselineValue: sync.syncBaselineValue,
            syncDifference: sync.syncDifference,
            syncTolerance: sync.syncTolerance,
            syncRiskLevel: sync.syncRiskLevel,
            targetedReaches,
            blocks,
            warnings,
          });
        }

        // Get health/risk level for each account
        for (const acc of accountStats) {
          try {
            const healthData = await fetchHarnessJson<{ riskLevel: string }>(
              apiUrl,
              apiKey,
              `/api/accounts/${encodeURIComponent(acc.id)}/health`,
            );
            if (healthData.success) {
              acc.riskLevel = healthData.data?.riskLevel;
            } else {
              acc.warnings.push(`Health risk level unavailable: ${healthData.error ?? "unknown error"}`);
            }
          } catch (err) {
            acc.warnings.push(
              `Health risk level unavailable: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        const [totalFriends, scenarios, broadcasts, tags, forms] =
          await Promise.all([
            client.friends.count(),
            client.scenarios.list({ accountId }),
            client.broadcasts.list({ accountId }),
            client.tags.list(),
            client.forms.list(),
          ]);

        const activeScenarios = scenarios.filter(
          (s: { isActive: boolean }) => s.isActive,
        );
        const recentBroadcasts = broadcasts.slice(0, 5);

        const summary = {
          friends: {
            totalDbRecords: totalFriends,
            note: "totalDbRecords is the DB count. perAccount[].friendsFromLine is LINE's cumulative follower count for the previous JST date and INCLUDES blocked users, so it is expected to exceed friendsInDb — do not compare them directly. Sync health is judged against the reachable baseline (perAccount[].syncBaseline / syncBaselineValue); check syncRiskLevel, not the raw follower gap.",
            warningCount: accountStats.reduce((sum, acc) => sum + acc.warnings.length, 0),
            perAccount: accountStats,
          },
          scenarios: {
            total: scenarios.length,
            active: activeScenarios.length,
            activeList: activeScenarios.map(
              (s: { id: string; name: string; triggerType: string }) => ({
                id: s.id,
                name: s.name,
                triggerType: s.triggerType,
              }),
            ),
          },
          broadcasts: {
            total: broadcasts.length,
            recent: recentBroadcasts.map(
              (b: {
                id: string;
                title: string;
                status: string;
                sentAt: string | null;
              }) => ({
                id: b.id,
                title: b.title,
                status: b.status,
                sentAt: b.sentAt,
              }),
            ),
          },
          tags: {
            total: tags.length,
            list: tags.map((t: { id: string; name: string }) => ({
              id: t.id,
              name: t.name,
            })),
          },
          forms: {
            total: forms.length,
            list: forms.map(
              (f: { id: string; name: string; submitCount: number }) => ({
                id: f.id,
                name: f.name,
                submitCount: f.submitCount,
              }),
            ),
          },
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: false, error: String(error) },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
