import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerGetConversionLogs(server: McpServer): void {
  server.tool(
    "get_conversion_logs",
    "View ad conversion send logs for a specific platform. Shows the history of conversion events sent to Meta CAPI, X, Google Ads, or TikTok, including status (sent/failed) and error details.",
    {
      platformId: z
        .string()
        .describe(
          "Ad platform ID to get logs for. Use manage_ad_platforms with action 'list' first to get the ID.",
        ),
      limit: z
        .number()
        .optional()
        .default(50)
        .describe("Maximum number of logs to return (default: 50)"),
    },
    async ({ platformId, limit }) => {
      try {
        const client = getClient();
        const logs = await client.adPlatforms.getLogs(platformId, limit);

        const summary = {
          total: logs.length,
          sent: logs.filter((l) => l.status === "sent").length,
          failed: logs.filter((l) => l.status === "failed").length,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, summary, logs },
                null,
                2,
              ),
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
