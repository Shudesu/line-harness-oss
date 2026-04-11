import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerCreateForm(server: McpServer): void {
  server.tool(
    "create_form",
    "Create a form for collecting user responses. Can auto-tag responders and enroll them in scenarios.",
    {
      name: z.string().describe("Form name"),
      description: z
        .string()
        .optional()
        .describe("Form description shown to users"),
      fields: z
        .string()
        .describe(
          "JSON string of form fields. Format: [{ name: string, label: string, type: 'text'|'email'|'tel'|'number'|'textarea'|'select'|'radio'|'checkbox'|'date', required?: boolean, options?: string[], placeholder?: string }]",
        ),
      onSubmitTagId: z
        .string()
        .optional()
        .describe("Tag ID to auto-apply when form is submitted"),
      onSubmitScenarioId: z
        .string()
        .optional()
        .describe("Scenario ID to auto-enroll when form is submitted"),
      onSubmitMessageType: z
        .enum(["text", "flex"])
        .optional()
        .describe("Custom message type to send after submission. Supports template variables: {{name}}, {{auth_url:CHANNEL_ID}}"),
      onSubmitMessageContent: z
        .string()
        .optional()
        .describe("Custom message content to send after submission. If set, replaces the default confirmation Flex."),
      saveToMetadata: z
        .boolean()
        .default(true)
        .describe("Save form responses to friend metadata"),
      accountId: z
        .string()
        .optional()
        .describe("LINE account ID (uses default if omitted)"),
    },
    async ({
      name,
      description,
      fields,
      onSubmitTagId,
      onSubmitScenarioId,
      onSubmitMessageType,
      onSubmitMessageContent,
      saveToMetadata,
    }) => {
      try {
        const client = getClient();
        const form = await client.forms.create({
          name,
          description,
          fields: JSON.parse(fields),
          onSubmitTagId,
          onSubmitScenarioId,
          onSubmitMessageType,
          onSubmitMessageContent,
          saveToMetadata,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, form }, null, 2),
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
