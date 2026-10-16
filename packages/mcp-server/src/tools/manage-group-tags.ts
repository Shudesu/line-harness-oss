import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageGroupTags(server: McpServer): void {
  server.tool(
    "manage_group_tags",
    "List LINE groups (optionally filtered by tag), register a group, and attach or detach tags on a group. Tags are the same tags used for friends, so a tag can span both.",
    {
      action: z
        .enum(["list_groups", "get_group", "register", "add", "remove"])
        .describe(
          "list_groups: list groups, narrowed by tagId when given. get_group: one group with its tags. register: add a group by hand. add/remove: attach or detach a tag.",
        ),
      groupId: z
        .string()
        .optional()
        .describe("LINE group ID (for 'get_group', 'register', 'add', 'remove')"),
      tagId: z
        .string()
        .optional()
        .describe(
          "Tag ID. Required for 'add' and 'remove'; optional filter for 'list_groups'.",
        ),
      groupName: z
        .string()
        .optional()
        .describe("Group display name (for 'register')"),
      accountId: z
        .string()
        .optional()
        .describe("LINE account ID to scope by (optional)"),
      status: z
        .enum(["joined", "left"])
        .optional()
        .describe("Filter by membership status (for 'list_groups')"),
    },
    async ({ action, groupId, tagId, groupName, accountId, status }) => {
      try {
        const client = getClient();

        if (action === "list_groups") {
          const groups = await client.groups.list({ tagId, accountId, status });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { success: true, count: groups.length, groups },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        if (action === "get_group") {
          if (!groupId) throw new Error("groupId is required for get_group action");
          const group = await client.groups.get(groupId);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, group }, null, 2),
              },
            ],
          };
        }

        if (action === "register") {
          if (!groupId) throw new Error("groupId is required for register action");
          const group = await client.groups.register({
            id: groupId,
            name: groupName ?? null,
            accountId: accountId ?? null,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, group }, null, 2),
              },
            ],
          };
        }

        if (!groupId) throw new Error("groupId is required for add/remove actions");
        if (!tagId) throw new Error("tagId is required for add/remove actions");

        if (action === "add") {
          const result = await client.groups.addTag(groupId, tagId);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, ...result }, null, 2),
              },
            ],
          };
        }

        await client.groups.removeTag(groupId, tagId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, removed: { groupId, tagId } },
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
