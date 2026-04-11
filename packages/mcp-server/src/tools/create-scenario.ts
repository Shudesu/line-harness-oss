import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseDelay } from "@line-harness/sdk";
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
      steps: z
        .array(
          z.object({
            delay: z
              .string()
              .describe(
                "Delay before sending. Format: '0m' for immediate, '30m' for 30 minutes, '24h' for 24 hours",
              ),
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
    async ({ name, triggerType, triggerTagId, steps, accountId }) => {
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

        const parsedSteps: Array<{
          delayMinutes: number;
          type: "text" | "flex";
          content: string;
        }> = [];

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          let delayMinutes: number;
          try {
            delayMinutes = parseDelay(step.delay);
          } catch {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: false,
                      error: `Invalid delay format at step ${i + 1}: "${step.delay}". Use formats like '0m', '30m', '24h'.`,
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }
          parsedSteps.push({
            delayMinutes,
            type: step.type,
            content: step.content,
          });
        }

        const client = getClient();
        const scenario = await client.scenarios.create({
          name,
          triggerType,
          triggerTagId,
          lineAccountId: accountId,
        });

        try {
          for (let i = 0; i < parsedSteps.length; i++) {
            const step = parsedSteps[i];
            await client.scenarios.addStep(scenario.id, {
              stepOrder: i + 1,
              delayMinutes: step.delayMinutes,
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
