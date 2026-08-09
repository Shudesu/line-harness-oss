import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

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
  syncDifference: number | null;
  followersNotInDb: number | null;
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
          const warnings: string[] = [];
          if (!countData.success) {
            warnings.push(`DB friend count unavailable: ${countData.error ?? "unknown error"}`);
          }
          if (!lineData.success) {
            warnings.push(`LINE follower insight unavailable: ${lineData.error ?? "unknown error"}`);
          } else if (lineData.data?.status !== "ready") {
            warnings.push(`LINE follower insight is not ready for ${lineFollowersDate}`);
          }
          const syncDifference =
            friendsInDb !== null && friendsFromLine !== null
              ? friendsInDb - friendsFromLine
              : null;
          // friends rows are only created by webhook events: `follow` for new adds,
          // or `ensureFriendFromWebhookUser()` on message/postback from a user we
          // have not seen yet. Followers who added the account before the webhook
          // went live and have never interacted since are therefore invisible to
          // the DB by design, and there is no LINE API to backfill them. So a DB
          // count *below* the LINE follower count is the expected steady state,
          // not a fault — only the opposite direction indicates something wrong.
          if (syncDifference !== null && syncDifference > 0) {
            warnings.push(
              `DB friends (${friendsInDb}) exceed LINE followers (${friendsFromLine}) by ${syncDifference}. Expected at most parity — suspect stale rows, duplicate registrations, or friends mapped to the wrong lineAccountId.`,
            );
          }
          const followersNotInDb =
            syncDifference !== null ? Math.max(0, -syncDifference) : null;
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
            syncDifference,
            followersNotInDb,
            syncRiskLevel: syncDifference === null
              ? "unknown"
              : syncDifference > 0
                ? "warning"
                : "ok",
            targetedReaches: lineData.success ? lineData.data?.targetedReaches ?? null : null,
            blocks: lineData.success ? lineData.data?.blocks ?? null : null,
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
            note: "totalDbRecords is the DB count. perAccount[].friendsFromLine is the LINE official follower insight for the previous JST date. The DB only holds friends the webhook has seen (a `follow` event, or a message/postback from a previously unknown user), so followersNotInDb > 0 is normal — those are followers from before the webhook went live who have not interacted since, and they cannot be backfilled. Only friendsInDb EXCEEDING friendsFromLine (syncRiskLevel=warning) points at a real fault. Broadcasts still reach every follower via the LINE broadcast API; only tag-filtered sends and 1:1 conversations are limited to friendsInDb.",
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
