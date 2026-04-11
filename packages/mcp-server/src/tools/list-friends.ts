import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerListFriends(server: McpServer): void {
  server.tool(
    "list_friends",
    "List friends with optional filtering by tag, name search, or metadata values. Returns paginated results with friend details.",
    {
      search: z.string().optional().describe("Search friends by display name (partial match)"),
      tagId: z.string().optional().describe("Filter by tag ID"),
      metadataFilter: z
        .string()
        .optional()
        .describe("JSON string of metadata filters. e.g. '{\"monthly_cost\": \"〜100万円\", \"business_type\": \"EC・物販\"}'"),
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
    async ({ search, tagId, metadataFilter, limit, offset, accountId }) => {
      try {
        const client = getClient();
        const metadata = metadataFilter ? JSON.parse(metadataFilter) as Record<string, string> : undefined;
        const result = await client.friends.list({
          search,
          tagId,
          metadata,
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
