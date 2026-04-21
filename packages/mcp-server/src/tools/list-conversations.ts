import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerListConversations(server: McpServer): void {
  server.tool(
    "list_conversations",
    "List unreplied conversations (friends who sent an incoming message with no subsequent human reply). Excludes automated outgoing (broadcast/scenario/auto_reply/reminder). Results sorted by longest wait first.",
    {
      lineAccountId: z
        .string()
        .optional()
        .describe("Filter by LINE account ID (uses default if omitted)"),
      minHoursSince: z
        .number()
        .default(0)
        .describe("Minimum hours since last incoming message (default 0 = all)"),
      maxHoursSince: z
        .number()
        .optional()
        .describe("Maximum hours since last incoming message (omit for no upper bound)"),
      limit: z
        .number()
        .default(50)
        .describe("Number of conversations to return (max 200)"),
      offset: z.number().default(0).describe("Offset for pagination"),
    },
    async ({ lineAccountId, minHoursSince, maxHoursSince, limit, offset }) => {
      try {
        const client = getClient();
        const result = await client.conversations.list({
          lineAccountId,
          minHoursSince,
          maxHoursSince,
          limit,
          offset,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, total: result.total, items: result.items },
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
              text: JSON.stringify({ success: false, error: String(error) }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
