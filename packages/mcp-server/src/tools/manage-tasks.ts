import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageTasks(server: McpServer): void {
  server.tool(
    "manage_tasks",
    "List, create, update, complete, or delete tasks. Tasks can hang off a LINE group. Lists come back ordered by due date, soonest first, with undated tasks last.",
    {
      action: z
        .enum(["list", "get", "create", "update", "complete", "delete"])
        .describe("Action to perform"),
      taskId: z
        .string()
        .optional()
        .describe("Task ID (for 'get', 'update', 'complete', 'delete')"),
      groupId: z
        .string()
        .optional()
        .describe(
          "LINE group ID. Filter for 'list'; the group the task belongs to for 'create' and 'update'.",
        ),
      title: z.string().optional().describe("Task title (for 'create'; optional for 'update')"),
      status: z
        .enum(["todo", "doing", "done"])
        .optional()
        .describe("Task status. Filter for 'list'; the new value for 'create' and 'update'."),
      dueDate: z
        .string()
        .optional()
        .describe("Deadline as 'YYYY-MM-DD'. Pass an empty string to clear it on 'update'."),
      assignee: z.string().optional().describe("Who owns the task"),
      openOnly: z
        .boolean()
        .optional()
        .describe("For 'list': exclude completed tasks. Ignored when status is given."),
    },
    async ({ action, taskId, groupId, title, status, dueDate, assignee, openOnly }) => {
      try {
        const client = getClient();

        if (action === "list") {
          const { tasks, counts } = await client.tasks.list({
            status,
            groupId,
            openOnly,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { success: true, count: tasks.length, counts, tasks },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        if (action === "get") {
          if (!taskId) throw new Error("taskId is required for get action");
          const task = await client.tasks.get(taskId);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ success: true, task }, null, 2) },
            ],
          };
        }

        if (action === "create") {
          if (!title) throw new Error("title is required for create action");
          const task = await client.tasks.create({
            title,
            groupId: groupId ?? null,
            status,
            dueDate: dueDate ? dueDate : null,
            assignee: assignee ?? null,
          });
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ success: true, task }, null, 2) },
            ],
          };
        }

        if (!taskId) throw new Error(`taskId is required for ${action} action`);

        if (action === "complete") {
          const task = await client.tasks.complete(taskId);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ success: true, task }, null, 2) },
            ],
          };
        }

        if (action === "update") {
          // Only forward the keys the caller actually supplied, so an update of
          // one field never blanks the others. An empty dueDate clears it.
          const task = await client.tasks.update(taskId, {
            ...(title !== undefined ? { title } : {}),
            ...(status !== undefined ? { status } : {}),
            ...(dueDate !== undefined ? { dueDate: dueDate === "" ? null : dueDate } : {}),
            ...(assignee !== undefined ? { assignee } : {}),
            ...(groupId !== undefined ? { groupId } : {}),
          });
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ success: true, task }, null, 2) },
            ],
          };
        }

        await client.tasks.delete(taskId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, deleted: taskId }, null, 2),
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
