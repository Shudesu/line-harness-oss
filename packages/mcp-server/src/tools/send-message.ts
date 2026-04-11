import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";
import { autoTrackUrls } from "./auto-track-urls.js";

export function registerSendMessage(server: McpServer): void {
  server.tool(
    "send_message",
    "Send a text, image, or flex message to a specific friend. Use messageType 'image' for standalone image messages, 'flex' for rich card layouts.",
    {
      friendId: z.string().describe("The friend's ID to send the message to"),
      content: z
        .string()
        .describe(
          "Message content. For text: plain string. For image: JSON string with originalContentUrl and previewImageUrl (both HTTPS URLs). For flex: JSON string of LINE Flex Message.",
        ),
      messageType: z
        .enum(["text", "image", "flex"])
        .default("text")
        .describe(
          "Message type: 'text' for plain text, 'image' for standalone image, 'flex' for Flex Message JSON",
        ),
      altText: z
        .string()
        .optional()
        .describe(
          "Custom notification preview text for Flex Messages (shown on lock screen). If omitted, auto-extracted from Flex content.",
        ),
    },
    async ({ friendId, content, messageType, altText }) => {
      try {
        const client = getClient();

        // Auto-track URLs in flex messages
        const { content: trackedContent } = await autoTrackUrls(
          client,
          content,
          messageType,
          `DM to ${friendId.slice(0, 8)}`,
        );

        const result = await client.friends.sendMessage(
          friendId,
          trackedContent,
          messageType,
          altText,
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
