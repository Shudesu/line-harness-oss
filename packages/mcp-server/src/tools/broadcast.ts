import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerBroadcast(server: McpServer): void {
  server.tool(
    "broadcast",
    "Send a broadcast message to all friends, a specific tag group, or a filtered segment. Creates and immediately sends the broadcast.",
    {
      title: z
        .string()
        .describe("Internal title for this broadcast (not shown to users)"),
      messageType: z.enum(["text", "flex"]).describe("Message type"),
      messageContent: z
        .string()
        .describe(
          "Message content. For text: plain string. For flex: JSON string.",
        ),
      targetType: z
        .enum(["all", "tag", "segment"])
        .default("all")
        .describe(
          "Target audience: 'all' for everyone, 'tag' for a tag group, 'segment' for filtered conditions",
        ),
      targetTagId: z
        .string()
        .optional()
        .describe("Tag ID when targetType is 'tag'"),
      segmentConditions: z
        .string()
        .optional()
        .describe(
          "JSON string of segment conditions when targetType is 'segment'. Format: { operator: 'AND'|'OR', rules: [{ type: 'tag_exists'|'tag_not_exists'|'metadata_equals'|'metadata_not_equals'|'ref_code'|'is_following', value: string|boolean|{key,value} }] }",
        ),
      scheduledAt: z
        .string()
        .optional()
        .describe("ISO 8601 datetime to schedule. Omit to send immediately."),
      altText: z
        .string()
        .optional()
        .describe(
          "Custom notification preview text for Flex Messages (shown on lock screen). If omitted, auto-extracted from Flex content.",
        ),
      accountId: z
        .string()
        .optional()
        .describe("LINE account ID (uses default if omitted)"),
      trackLinks: z
        .boolean()
        .default(true)
        .describe(
          "Set false to disable automatic URL shortening (/t/ tracking links). URLs are sent as-is. Default true.",
        ),
    },
    async ({
      title,
      messageType,
      messageContent,
      targetType,
      targetTagId,
      segmentConditions,
      scheduledAt,
      altText,
      accountId,
      trackLinks,
    }) => {
      try {
        const client = getClient();

        if (targetType === "segment" && !segmentConditions) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    error:
                      "segmentConditions is required when targetType is 'segment'",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        if (targetType === "segment" && scheduledAt) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    error:
                      "Scheduled segment broadcasts are not supported. Use scheduledAt only with targetType 'all' or 'tag'.",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        if (targetType === "segment" && segmentConditions) {
          let parsedConditions;
          try {
            parsedConditions = JSON.parse(segmentConditions);
          } catch {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: false,
                      error: "segmentConditions must be valid JSON",
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          // URL の短縮 (auto-track) は worker が送信時に行う (broadcast の
          // line_account_id 付きでリンクを所有させるため、ここでは変換しない。
          // 事前に変換すると draft/scheduled で trackLinks を OFF に切り替えても
          // 短縮済み URL のまま送られてしまう)。
          const broadcast = await client.broadcasts.create({
            title: `[SEGMENT] ${title}`,
            messageType,
            messageContent,
            targetType: "all",
            lineAccountId: accountId,
            altText,
            trackLinks,
          });

          try {
            const result = await client.broadcasts.sendToSegment(
              broadcast.id,
              parsedConditions,
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { success: true, broadcast: result },
                    null,
                    2,
                  ),
                },
              ],
            };
          } catch (sendError) {
            await client.broadcasts.delete(broadcast.id).catch(() => {});
            throw sendError;
          }
        }

        // URL の短縮 (auto-track) は worker が送信時に行う (上の segment 経路と同じ理由)。
        // At this point targetType is guaranteed to be 'all' or 'tag' (segment handled above)
        const broadcast = await client.broadcasts.create({
          title,
          messageType,
          messageContent,
          targetType: targetType as "all" | "tag",
          targetTagId,
          scheduledAt,
          lineAccountId: accountId,
          altText,
          trackLinks,
        });

        const result = scheduledAt
          ? broadcast
          : await client.broadcasts.send(broadcast.id);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, broadcast: result },
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
