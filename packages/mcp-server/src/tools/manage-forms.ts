import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageForms(server: McpServer): void {
  server.tool(
    "manage_forms",
    "フォームの管理操作。list: 一覧、get: 詳細、update: 更新、delete: 削除。作成は create_form ツールを使用。",
    {
      action: z.enum(["list", "get", "update", "delete"]).describe("Action to perform"),
      formId: z.string().optional().describe("Form ID (required for get, update, delete)"),
      name: z.string().optional().describe("Form name (for update)"),
      description: z.string().nullable().optional().describe("Form description (for update)"),
      fields: z.string().optional().describe("JSON string of form fields array (for update)"),
      onSubmitTagId: z.string().nullable().optional().describe("Tag to add on submit (for update)"),
      onSubmitScenarioId: z.string().nullable().optional().describe("Scenario to enroll on submit (for update)"),
      onSubmitMessageType: z.enum(["text", "flex"]).nullable().optional().describe("Custom message type to send after form submission (for update). Supports template variables: {{name}}, {{auth_url:CHANNEL_ID}}"),
      onSubmitMessageContent: z.string().nullable().optional().describe("Custom message content to send after form submission (for update). If set, replaces the default confirmation Flex."),
      saveToMetadata: z.boolean().optional().describe("Save responses to friend metadata (for update)"),
      isActive: z.boolean().optional().describe("Active status (for update)"),
    },
    async ({ action, formId, name, description, fields, onSubmitTagId, onSubmitScenarioId, onSubmitMessageType, onSubmitMessageContent, saveToMetadata, isActive }) => {
      try {
        const client = getClient();
        if (action === "list") {
          const forms = await client.forms.list();
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, forms }, null, 2) }] };
        }
        if (!formId) throw new Error("formId is required for this action");
        if (action === "get") {
          const form = await client.forms.get(formId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, form }, null, 2) }] };
        }
        if (action === "update") {
          const input: Record<string, unknown> = {};
          if (name !== undefined) input.name = name;
          if (description !== undefined) input.description = description;
          if (fields !== undefined) input.fields = JSON.parse(fields);
          if (onSubmitTagId !== undefined) input.onSubmitTagId = onSubmitTagId;
          if (onSubmitScenarioId !== undefined) input.onSubmitScenarioId = onSubmitScenarioId;
          if (onSubmitMessageType !== undefined) input.onSubmitMessageType = onSubmitMessageType;
          if (onSubmitMessageContent !== undefined) input.onSubmitMessageContent = onSubmitMessageContent;
          if (saveToMetadata !== undefined) input.saveToMetadata = saveToMetadata;
          if (isActive !== undefined) input.isActive = isActive;
          const form = await client.forms.update(formId, input);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, form }, null, 2) }] };
        }
        if (action === "delete") {
          await client.forms.delete(formId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: formId }, null, 2) }] };
        }
        throw new Error(`Unknown action: ${action}`);
      } catch (err) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }], isError: true };
      }
    },
  );
}
