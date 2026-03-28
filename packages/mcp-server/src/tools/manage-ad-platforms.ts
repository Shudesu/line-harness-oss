import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageAdPlatforms(server: McpServer): void {
  server.tool(
    "manage_ad_platforms",
    "Manage ad platform integrations for conversion tracking. Supports Meta (Facebook/Instagram), X (Twitter), Google Ads, and TikTok. Use 'list' to see configured platforms, 'create' to add a new one, 'update' to modify settings, 'delete' to remove, or 'test' to verify the connection.",
    {
      action: z
        .enum(["list", "create", "update", "delete", "test"])
        .describe("Action to perform"),
      platformId: z
        .string()
        .optional()
        .describe("Platform ID (required for 'update' and 'delete')"),
      name: z
        .enum(["meta", "x", "google", "tiktok"])
        .optional()
        .describe("Platform name (required for 'create' and 'test')"),
      displayName: z
        .string()
        .optional()
        .describe("Display name for the platform (e.g. 'Meta広告')"),
      config: z
        .record(z.unknown())
        .optional()
        .describe(
          "Platform config JSON. Meta: {pixel_id, access_token, test_event_code?}. X: {pixel_id, api_key, api_secret}. Google: {customer_id, conversion_action_id, oauth_token}. TikTok: {pixel_code, access_token}",
        ),
      isActive: z
        .boolean()
        .optional()
        .describe("Enable/disable the platform (for 'update')"),
      eventName: z
        .string()
        .optional()
        .describe("Event name for test conversion (for 'test', e.g. 'Lead')"),
      friendId: z
        .string()
        .optional()
        .describe("Friend ID for test conversion (for 'test')"),
    },
    async ({ action, platformId, name, displayName, config, isActive, eventName, friendId }) => {
      try {
        const client = getClient();

        switch (action) {
          case "list": {
            const platforms = await client.adPlatforms.list();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      count: platforms.length,
                      platforms,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          case "create": {
            if (!name) throw new Error("name is required for create action");
            if (!config)
              throw new Error("config is required for create action");

            const platform = await client.adPlatforms.create({
              name,
              displayName,
              config,
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ success: true, platform }, null, 2),
                },
              ],
            };
          }

          case "update": {
            if (!platformId)
              throw new Error("platformId is required for update action");

            const platform = await client.adPlatforms.update(platformId, {
              name,
              displayName,
              config,
              isActive,
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ success: true, platform }, null, 2),
                },
              ],
            };
          }

          case "delete": {
            if (!platformId)
              throw new Error("platformId is required for delete action");

            await client.adPlatforms.delete(platformId);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    message: `Platform ${platformId} deleted`,
                  }),
                },
              ],
            };
          }

          case "test": {
            if (!name) throw new Error("name is required for test action");
            if (!eventName)
              throw new Error("eventName is required for test action");

            const result = await client.adPlatforms.test(
              name,
              eventName,
              friendId,
            );

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ success: true, ...result }, null, 2),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown action: ${action}`);
        }
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
