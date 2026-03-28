import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerListFriends(server: McpServer): void {
  server.tool(
    "list_friends",
    "List friends with optional filtering by tag. Returns paginated results with friend details.",
    {
      tagId: z.string().optional().describe("Filter by tag ID"),
      limit: z
        .number()
        .default(20)
        .describe("Number of friends to return (max 100)"),
      offset: z.number().default(0).describe("Offset for pagination"),
      accountId: z
        .string()
        .optional()
        .describe("LINE account ID (uses default if omitted)"),
    },
    async ({ tagId, limit, offset, accountId }) => {
      try {
        const client = getClient();
        const result = await client.friends.list({
          tagId,
          limit,
          offset,
          accountId,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  total: result.total,
                  hasNextPage: result.hasNextPage,
                  friends: result.items,
                },
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
