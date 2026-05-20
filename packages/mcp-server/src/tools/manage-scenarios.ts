import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageScenarios(server: McpServer): void {
  server.tool(
    "manage_scenarios",
    "シナリオの管理操作。list: 一覧、get: 詳細（ステップ含む）、update: 更新、delete: 削除、add_step: ステップ追加、update_step: ステップ更新、delete_step: ステップ削除。",
    {
      action: z
        .enum(["list", "get", "update", "delete", "add_step", "update_step", "delete_step"])
        .describe("Action to perform"),
      scenarioId: z.string().optional().describe("Scenario ID (required for get, update, delete, add_step, update_step, delete_step)"),
      stepId: z.string().optional().describe("Step ID (required for update_step, delete_step)"),
      name: z.string().optional().describe("Scenario name (for update)"),
      description: z.string().nullable().optional().describe("Scenario description (for update)"),
      triggerType: z.enum(["friend_add", "tag_added", "manual"]).optional().describe("Trigger type (for update)"),
      triggerTagId: z.string().nullable().optional().describe("Trigger tag ID (for update)"),
      isActive: z.boolean().optional().describe("Active status (for update)"),
      stepOrder: z.number().optional().describe("Step order number (for add_step, update_step)"),
      delayMinutes: z.number().optional().describe("Delay in minutes (for add_step, update_step)"),
      messageType: z.enum(["text", "image", "flex"]).optional().describe("Message type (for add_step, update_step)"),
      messageContent: z.string().optional().describe("Message content (for add_step, update_step)"),
      conditionType: z
        .enum(["tag_exists", "tag_not_exists", "metadata_equals", "metadata_not_equals"])
        .nullable()
        .optional()
        .describe(
          "Condition type evaluated at delivery time. " +
            "tag_exists / tag_not_exists: conditionValue = tag UUID. " +
            "metadata_equals / metadata_not_equals: conditionValue = JSON {\"key\":\"...\",\"value\":...}. " +
            "Unknown values are rejected (set to null to clear).",
        ),
      conditionValue: z.string().nullable().optional().describe("Condition value (for add_step, update_step). See conditionType for format."),
      nextStepOnFalse: z.number().nullable().optional().describe("Next step on false (for add_step, update_step)"),
      templateId: z.string().nullable().optional().describe("Template ID reference (for add_step, update_step; null clears)"),
      onReachTagId: z.string().nullable().optional().describe("Tag ID to attach on step reach (for add_step, update_step; null clears)"),
      accountId: z.string().optional().describe("LINE account ID for list (uses default if omitted)"),
    },
    async ({ action, scenarioId, stepId, name, description, triggerType, triggerTagId, isActive, stepOrder, delayMinutes, messageType, messageContent, conditionType, conditionValue, nextStepOnFalse, templateId, onReachTagId, accountId }) => {
      try {
        const client = getClient();

        if (action === "list") {
          const scenarios = await client.scenarios.list(accountId ? { accountId } : undefined);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, scenarios }, null, 2) }] };
        }

        if (!scenarioId) throw new Error("scenarioId is required for this action");

        if (action === "get") {
          const scenario = await client.scenarios.get(scenarioId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, scenario }, null, 2) }] };
        }

        if (action === "update") {
          const input: Record<string, unknown> = {};
          if (name !== undefined) input.name = name;
          if (description !== undefined) input.description = description;
          if (triggerType !== undefined) input.triggerType = triggerType;
          if (triggerTagId !== undefined) input.triggerTagId = triggerTagId;
          if (isActive !== undefined) input.isActive = isActive;
          const scenario = await client.scenarios.update(scenarioId, input);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, scenario }, null, 2) }] };
        }

        if (action === "delete") {
          await client.scenarios.delete(scenarioId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: scenarioId }, null, 2) }] };
        }

        if (action === "add_step") {
          if (stepOrder === undefined || delayMinutes === undefined || !messageType || !messageContent) {
            throw new Error("stepOrder, delayMinutes, messageType, messageContent are required for add_step");
          }
          const step = await client.scenarios.addStep(scenarioId, {
            stepOrder, delayMinutes, messageType, messageContent,
            conditionType: conditionType ?? null, conditionValue: conditionValue ?? null, nextStepOnFalse: nextStepOnFalse ?? null,
            templateId: templateId ?? null, onReachTagId: onReachTagId ?? null,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, step }, null, 2) }] };
        }

        if (action === "update_step") {
          if (!stepId) throw new Error("stepId is required for update_step");
          const input: Record<string, unknown> = {};
          if (stepOrder !== undefined) input.stepOrder = stepOrder;
          if (delayMinutes !== undefined) input.delayMinutes = delayMinutes;
          if (messageType !== undefined) input.messageType = messageType;
          if (messageContent !== undefined) input.messageContent = messageContent;
          if (conditionType !== undefined) input.conditionType = conditionType;
          if (conditionValue !== undefined) input.conditionValue = conditionValue;
          if (nextStepOnFalse !== undefined) input.nextStepOnFalse = nextStepOnFalse;
          if (templateId !== undefined) input.templateId = templateId;
          if (onReachTagId !== undefined) input.onReachTagId = onReachTagId;
          const step = await client.scenarios.updateStep(scenarioId, stepId, input);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, step }, null, 2) }] };
        }

        if (action === "delete_step") {
          if (!stepId) throw new Error("stepId is required for delete_step");
          await client.scenarios.deleteStep(scenarioId, stepId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: stepId }, null, 2) }] };
        }

        throw new Error(`Unknown action: ${action}`);
      } catch (err) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }], isError: true };
      }
    },
  );
}
