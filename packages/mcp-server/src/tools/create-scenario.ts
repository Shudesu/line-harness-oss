import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildStepSchedule, type StepSchedule } from "./scenario-schedule.js";
import { getClient } from "../client.js";

export function registerCreateScenario(server: McpServer): void {
  server.tool(
    "create_scenario",
    "Create a step delivery scenario with multiple message steps. Each step has a delay and message content. Scenarios auto-trigger on friend_add, tag_added, or manual enrollment.",
    {
      name: z.string().describe("Scenario name"),
      triggerType: z
        .enum(["friend_add", "tag_added", "manual"])
        .describe(
          "When to start: 'friend_add' on new friends, 'tag_added' when a tag is applied, 'manual' for explicit enrollment",
        ),
      triggerTagId: z
        .string()
        .optional()
        .describe(
          "Required when triggerType is 'tag_added': the tag ID that triggers this scenario",
        ),
      deliveryMode: z
        .enum(["relative", "elapsed", "absolute_time"])
        .optional()
        .describe(
          "relative (default): 各ステップは前ステップから delay 後。elapsed: 購読開始から offsetDays 日 + offsetMinutes 分後。absolute_time: 購読開始から offsetDays 日後の deliveryTime (HH:MM JST) ちょうどに配信（例: 19:30）。",
        ),
      steps: z
        .array(
          z.object({
            delay: z
              .string()
              .optional()
              .describe(
                "relative モード用。Delay before sending. Format: '0m' for immediate, '30m' for 30 minutes, '24h' for 24 hours",
              ),
            offsetDays: z.number().int().min(0).optional().describe("elapsed / absolute_time モード用: 購読開始から何日後か（0=当日）"),
            offsetMinutes: z.number().int().min(0).max(1439).optional().describe("elapsed モード用: 0..1439"),
            deliveryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("absolute_time モード用: \"HH:MM\" JST 例 \"19:30\""),
            type: z.enum(["text", "flex"]).describe("Message type"),
            content: z.string().describe("Message content"),
          }),
        )
        .describe("Ordered list of message steps"),
      accountId: z
        .string()
        .optional()
        .describe("LINE account ID (uses default if omitted)"),
    },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ name, triggerType, triggerTagId, deliveryMode, steps, accountId }) => {
      try {
        if (triggerType === "tag_added" && !triggerTagId) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    error:
                      "triggerTagId is required when triggerType is 'tag_added'",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        const mode = deliveryMode ?? "relative";
        const parsedSteps: Array<{
          schedule: StepSchedule;
          type: "text" | "flex";
          content: string;
        }> = [];

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          try {
            parsedSteps.push({ schedule: buildStepSchedule(mode, step, i), type: step.type, content: step.content });
          } catch (e) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }, null, 2) }],
              isError: true,
            };
          }
        }

        const client = getClient();
        const scenario = await client.scenarios.create({
          name,
          triggerType,
          triggerTagId,
          deliveryMode: mode,
          lineAccountId: accountId,
        });

        try {
          for (let i = 0; i < parsedSteps.length; i++) {
            const step = parsedSteps[i];
            await client.scenarios.addStep(scenario.id, {
              stepOrder: i + 1,
              ...step.schedule,
              messageType: step.type,
              messageContent: step.content,
            });
          }
        } catch (stepError) {
          await client.scenarios.delete(scenario.id).catch(() => {});
          throw stepError;
        }

        const scenarioWithSteps = await client.scenarios.get(scenario.id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, scenario: scenarioWithSteps },
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
