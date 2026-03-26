import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerSendMessage(server: McpServer): void {
  server.tool(
    "send_message",
    "Send a text or flex message to a specific friend. Use messageType 'flex' for rich card layouts.",
    {
      friendId: z.string().describe("The friend's ID to send the message to"),
      content: z
        .string()
        .describe(
          "Message content. For text: plain string. For flex: JSON string of LINE Flex Message.",
        ),
      messageType: z
        .enum(["text", "flex"])
        .default("text")
        .describe(
          "Message type: 'text' for plain text, 'flex' for Flex Message JSON",
        ),
    },
    async ({ friendId, content, messageType }) => {
      try {
        const client = getClient();
        const result = await client.friends.sendMessage(
          friendId,
          content,
          messageType,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, messageId: result.messageId },
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
