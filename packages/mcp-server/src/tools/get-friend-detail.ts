import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerGetFriendDetail(server: McpServer): void {
  server.tool(
    "get_friend_detail",
    "Get detailed information about a specific friend including tags, metadata, and profile.",
    {
      friendId: z.string().describe("The friend's ID"),
    },
    async ({ friendId }) => {
      try {
        const client = getClient();
        const friend = await client.friends.get(friendId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, friend }, null, 2),
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
