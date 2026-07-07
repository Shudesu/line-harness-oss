import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

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
      isTest: z
        .boolean()
        .default(false)
        .describe(
          "Mark as test send. Prepends 【テスト配信】 to text messages, adds test banner to flex messages.",
        ),
      trackLinks: z
        .boolean()
        .default(true)
        .describe(
          "Set false to disable automatic URL shortening (/t/ tracking links). URLs are sent as-is. Default true.",
        ),
    },
    async ({ friendId, content, messageType, altText, isTest, trackLinks }) => {
      try {
        const client = getClient();

        // Add test label
        let finalContent = content;
        if (isTest) {
          if (messageType === "text") {
            finalContent = `【テスト配信】\n${content}`;
          } else if (messageType === "flex") {
            try {
              const flex = JSON.parse(content);
              // Wrap in a carousel with a test banner
              finalContent = JSON.stringify({
                type: "bubble",
                header: {
                  type: "box",
                  layout: "vertical",
                  backgroundColor: "#FFE066",
                  paddingAll: "8px",
                  contents: [{ type: "text", text: "⚠️ テスト配信", size: "sm", weight: "bold", color: "#333", align: "center" }],
                },
                ...(flex.type === "bubble" ? { body: flex.body, footer: flex.footer } : { body: { type: "box", layout: "vertical", contents: [{ type: "text", text: "テスト配信", wrap: true }] } }),
              });
            } catch {
              finalContent = content;
            }
          }
        }

        // URL の短縮 (auto-track) は worker が送信時に行う (friend の所属アカウント
        // 付きでリンクを所有させるため、ここでは変換しない)。trackLinks=false は
        // API に渡して worker 側の短縮もスキップさせる。
        const result = await client.friends.sendMessage(
          friendId,
          finalContent,
          messageType,
          altText,
          { trackLinks },
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
