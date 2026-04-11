import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

function getApiConfig() {
  const apiUrl = process.env.LINE_HARNESS_API_URL;
  const apiKey = process.env.LINE_HARNESS_API_KEY;
  if (!apiUrl || !apiKey) throw new Error("LINE_HARNESS_API_URL and LINE_HARNESS_API_KEY required");
  return { apiUrl, apiKey };
}

export function registerGetFriendDetail(server: McpServer): void {
  server.tool(
    "get_friend_detail",
    "Get detailed information about a specific friend including tags, metadata, profile, and message history.",
    {
      friendId: z.string().describe("The friend's ID"),
      includeMessages: z.boolean().optional().describe("Include message history (default: false)"),
    },
    async ({ friendId, includeMessages }) => {
      try {
        const client = getClient();
        const friend = await client.friends.get(friendId);

        let messages = null;
        if (includeMessages) {
          const { apiUrl, apiKey } = getApiConfig();
          const res = await fetch(`${apiUrl}/api/friends/${friendId}/messages`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (res.ok) {
            const data = await res.json() as { success: boolean; data: unknown[] };
            messages = data.data;
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, friend, ...(messages ? { messages } : {}) }, null, 2),
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
