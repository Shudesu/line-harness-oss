import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageTags(server: McpServer): void {
  server.tool(
    "manage_tags",
    "List, create, or delete tags, and add/remove tags to/from friends. Supports batch operations on multiple friends.",
    {
      action: z.enum(["list", "create", "delete", "add", "remove"]).describe("Action to perform"),
      tagName: z
        .string()
        .optional()
        .describe("Tag name (for 'create' action)"),
      tagColor: z
        .string()
        .optional()
        .describe("Tag color hex code (for 'create' action, e.g. '#FF0000')"),
      tagId: z
        .string()
        .optional()
        .describe("Tag ID (for 'add' or 'remove' actions)"),
      friendIds: z
        .array(z.string())
        .optional()
        .describe(
          "Friend IDs to add/remove the tag from (for 'add' or 'remove' actions)",
        ),
    },
    async ({ action, tagName, tagColor, tagId, friendIds }) => {
      try {
        const client = getClient();

        if (action === "list") {
          const tags = await client.tags.list();
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, tags }, null, 2) }],
          };
        }

        if (action === "delete") {
          if (!tagId) throw new Error("tagId is required for delete action");
          await client.tags.delete(tagId);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: tagId }, null, 2) }],
          };
        }

        if (action === "create") {
          if (!tagName) throw new Error("tagName is required for create action");
          const tag = await client.tags.create({
            name: tagName,
            color: tagColor,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, tag }, null, 2),
              },
            ],
          };
        }

        if (!tagId)
          throw new Error("tagId is required for add/remove actions");
        if (!friendIds?.length)
          throw new Error("friendIds is required for add/remove actions");

        const results: Array<{ friendId: string; status: string }> = [];
        for (const friendId of friendIds) {
          if (action === "add") {
            await client.friends.addTag(friendId, tagId);
          } else {
            await client.friends.removeTag(friendId, tagId);
          }
          results.push({ friendId, status: "ok" });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, results }, null, 2),
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
