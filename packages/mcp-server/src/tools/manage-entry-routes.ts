import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiCall, toToolResult } from "../api-call.js";

/**
 * 流入リンク（entry_routes）の管理。
 *
 * これが MCP に無かったせいで、AI エージェントが manage_traffic_pools だけで
 * `/r/{slug}` を作り、コンソールの「流入リンク」画面に **(未登録)** と表示され、
 * タグ自動付与・起動シナリオが発火しない状態を作ってしまう事故が起きた
 * （2026-08-25 の実戦報告）。
 *
 * entry_routes が ref 名前空間を所有していて、tagId / scenarioId / poolId の
 * 紐付けを全部持っている。Traffic Pool だけ作っても「アカウントの振り分け」しか
 * 効かず、タグもシナリオも付かない。**両方作って初めてファネルが成立する。**
 */
export function registerManageEntryRoutes(server: McpServer): void {
  server.tool(
    "manage_entry_routes",
    "流入リンク（entry_routes）の管理。/r/{refCode} で友だち追加したときの「タグ自動付与」「起動シナリオ」「振り分け先プール」を紐付ける。" +
      "重要: manage_traffic_pools だけで /r/{slug} を作ると、コンソールの流入リンク画面に (未登録) と出てタグもシナリオも発火しない。" +
      "Traffic Pool = どのLINEアカウントへ振り分けるか。entry_route = 流入時に何をするか。ファネルを組むなら両方必要。" +
      "list: 一覧、create: 作成、update: 更新、delete: 削除、funnel: 流入ファネル分析。",
    {
      action: z.enum(["list", "create", "update", "delete", "funnel"]).describe("実行する操作"),
      id: z.string().optional().describe("entry_route の ID（update / delete / funnel で必須）"),
      refCode: z
        .string()
        .optional()
        .describe("URL に入る識別子。/r/{refCode} になる（create で必須）。Traffic Pool の slug と同じ値にすると両者が紐づく"),
      name: z.string().optional().describe("表示名（create で必須）。コンソールの流入リンク一覧に出る"),
      tagId: z.string().optional().describe("この経路で友だち追加した人に自動付与するタグの ID"),
      scenarioId: z.string().optional().describe("この経路で友だち追加した人に自動で開始するシナリオの ID"),
      poolId: z
        .string()
        .optional()
        .describe("振り分け先の Traffic Pool ID。manage_traffic_pools で作った pool の id を渡すと /r/{refCode} がそのプールへ流れる"),
      introTemplateId: z.string().optional().describe("友だち追加直後に push するメッセージテンプレートの ID"),
      redirectUrl: z.string().optional().describe("LINE 以外へ流したい場合のリダイレクト先"),
      runAccountFriendAddScenarios: z
        .boolean()
        .optional()
        .describe("アカウント既定の friend_add シナリオも併せて実行するか"),
      isActive: z.boolean().optional().describe("有効/無効の切り替え"),
    },
    async ({
      action,
      id,
      refCode,
      name,
      tagId,
      scenarioId,
      poolId,
      introTemplateId,
      redirectUrl,
      runAccountFriendAddScenarios,
      isActive,
    }) => {
      try {
        if (action === "list") {
          return toToolResult(await apiCall("/api/entry-routes"));
        }

        if (action === "create") {
          if (!refCode || !name) throw new Error("refCode and name are required for create");
          return toToolResult(await apiCall("/api/entry-routes", "POST", {
            refCode,
            name,
            tagId,
            scenarioId,
            poolId,
            introTemplateId,
            redirectUrl,
            runAccountFriendAddScenarios,
            isActive,
          }));
        }

        if (action === "update") {
          if (!id) throw new Error("id is required for update");
          return toToolResult(await apiCall(`/api/entry-routes/${id}`, "PATCH", {
            name,
            tagId,
            scenarioId,
            poolId,
            introTemplateId,
            redirectUrl,
            runAccountFriendAddScenarios,
            isActive,
          }));
        }

        if (action === "delete") {
          if (!id) throw new Error("id is required for delete");
          return toToolResult(await apiCall(`/api/entry-routes/${id}`, "DELETE"));
        }

        if (action === "funnel") {
          if (!id) throw new Error("id is required for funnel");
          return toToolResult(await apiCall(`/api/entry-routes/${id}/funnel`));
        }

        throw new Error(`Unknown action: ${action}`);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(error) }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
