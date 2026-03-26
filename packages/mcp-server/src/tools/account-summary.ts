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
  friendsInDb: number;
  riskLevel?: string;
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

        // Fetch all LINE accounts
        const accountsRes = await fetch(`${apiUrl}/api/line-accounts`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const accountsData = (await accountsRes.json()) as {
          success: boolean;
          data: AccountInfo[];
        };
        const accounts: AccountInfo[] = accountsData.success
          ? accountsData.data
          : [];

        // Get per-account friend counts
        const accountStats: AccountStat[] = [];
        for (const acc of accounts) {
          // Use direct API call for per-account count (SDK count() has no params)
          const countRes = await fetch(
            `${apiUrl}/api/friends/count?lineAccountId=${encodeURIComponent(acc.id)}`,
            { headers: { Authorization: `Bearer ${apiKey}` } },
          );
          const countData = (await countRes.json()) as {
            success: boolean;
            data: { count: number };
          };
          const count = countData.success ? countData.data.count : 0;
          accountStats.push({
            id: acc.id,
            name: acc.name,
            channelId: acc.channelId,
            friendsInDb: count,
          });
        }

        // Get health/risk level for each account
        for (const acc of accountStats) {
          try {
            const healthRes = await fetch(
              `${apiUrl}/api/accounts/${acc.id}/health`,
              { headers: { Authorization: `Bearer ${apiKey}` } },
            );
            const healthData = (await healthRes.json()) as {
              success: boolean;
              data: { riskLevel: string };
            };
            if (healthData.success) {
              acc.riskLevel = healthData.data.riskLevel;
            }
          } catch {
            // Health endpoint may not exist yet
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
            note: "totalDbRecords includes both Account \u2460 and \u2461 records. Same user on different accounts = separate records. Use per-account counts below for accurate numbers.",
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
