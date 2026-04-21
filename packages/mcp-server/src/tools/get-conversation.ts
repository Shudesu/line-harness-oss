import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerGetConversation(server: McpServer): void {
  server.tool(
    "get_conversation",
    "Get message history for a specific friend (both incoming and outgoing). Each message has a `source` field (user/broadcast/scenario/auto_reply/reminder/manual) indicating origin.",
    {
      friendId: z.string().describe("Friend ID (from list_friends or list_conversations)"),
      limit: z
        .number()
        .default(50)
        .describe("Number of messages to return (max 200)"),
      before: z
        .string()
        .optional()
        .describe("Return messages before this timestamp (ISO8601, for pagination)"),
    },
    async ({ friendId, limit, before }) => {
      try {
        const client = getClient();
        const result = await client.conversations.get({ friendId, limit, before });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, ...result }, null, 2),
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
