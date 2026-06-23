import * as p from "@clack/prompts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface McpConfigOptions {
  workerUrl: string;
  apiKey: string;
}

interface LineAccount {
  id: string;
  name?: string;
}

/**
 * Resolve the single LINE account id for a fresh install so the MCP server can
 * be configured with a default account.
 *
 * Why this matters: the MCP server passes its `LINE_HARNESS_ACCOUNT_ID` to the
 * SDK as `defaultAccountId`. The SDK only auto-fills `lineAccountId` on
 * broadcast create/list/send when that default is present. Without it, every
 * broadcast created via the MCP server is written with `line_account_id = NULL`
 * and is therefore invisible in the account-scoped admin UI list (which filters
 * on `line_account_id`). Single-account installs are the common case, so we set
 * the default automatically. Multi-account setups are left unset on purpose —
 * the operator should pick a default per server entry themselves.
 *
 * Best-effort: any failure (network, multi-account, unexpected shape) just
 * skips the field and never breaks the install.
 */
async function resolveDefaultAccountId(
  options: McpConfigOptions,
): Promise<string | undefined> {
  try {
    const res = await fetch(`${options.workerUrl}/api/line-accounts`, {
      headers: { Authorization: `Bearer ${options.apiKey}` },
    });
    if (!res.ok) return undefined;
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: LineAccount[] }
      | null;
    if (!json?.success || !Array.isArray(json.data)) return undefined;
    if (json.data.length === 1) return json.data[0]?.id;
    return undefined;
  } catch {
    return undefined;
  }
}

export async function generateMcpConfig(options: McpConfigOptions): Promise<void> {
  const mcpJsonPath = join(process.cwd(), ".mcp.json");

  const env: Record<string, string> = {
    LINE_HARNESS_API_URL: options.workerUrl,
    LINE_HARNESS_API_KEY: options.apiKey,
  };

  // Set a default account for single-account installs so MCP-created
  // broadcasts are tagged with line_account_id and show up in the admin UI.
  const defaultAccountId = await resolveDefaultAccountId(options);
  if (defaultAccountId) {
    env.LINE_HARNESS_ACCOUNT_ID = defaultAccountId;
  }

  const newServerConfig = {
    command: "npx",
    args: ["-y", "@line-harness/mcp-server@latest"],
    env,
  };

  let mcpConfig: Record<string, any> = {};

  if (existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    } catch {
      // Invalid JSON, start fresh
    }
  }

  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }

  // Don't overwrite existing line-harness config — use a unique name
  let serverName = "line-harness";
  if (mcpConfig.mcpServers["line-harness"]) {
    // Extract a short suffix from the API key
    const suffix = options.apiKey.slice(0, 8);
    serverName = `line-harness-${suffix}`;
    p.log.info(
      `既存の line-harness 設定があるため、${serverName} として追加します`,
    );
  }
  mcpConfig.mcpServers[serverName] = newServerConfig;

  writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + "\n");
  p.log.success(`.mcp.json に MCP 設定を追加しました（${serverName}）`);
}
