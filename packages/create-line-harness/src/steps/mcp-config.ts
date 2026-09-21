import * as p from "@clack/prompts";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AI_AGENTS,
  DEFAULT_SETUP_MCP_AGENTS,
  type AiAgentId,
} from "@line-crm/shared";
import { generateCursorAgentRules } from "./cursor-rules.js";

interface McpConfigOptions {
  workerUrl: string;
  apiKey: string;
  /**
   * LINE account id resolved by the caller (setup knows it from the D1 insert).
   * When provided we skip the HTTP lookup entirely — fresh workers.dev
   * subdomains can take minutes to DNS-resolve, so an install-time fetch to
   * the worker is exactly the call most likely to fail on a fresh install.
   */
  accountId?: string;
  /** MCP 設定を書き込む対象エージェント。既定は Cursor + Claude Code。 */
  agents?: AiAgentId[];
}

interface LineAccount {
  id: string;
  name?: string;
}

/**
 * Resolve the single LINE account id for a fresh install so the MCP server can
 * be configured with a default account.
 */
async function resolveDefaultAccountId(
  options: McpConfigOptions,
): Promise<string | undefined> {
  try {
    const base = options.workerUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/api/line-accounts`, {
      headers: { Authorization: `Bearer ${options.apiKey}` },
      signal: AbortSignal.timeout(10_000),
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

function buildServerEntry(env: Record<string, string>) {
  return {
    command: "npx",
    args: ["-y", "@line-harness/mcp-server@latest"],
    env,
  };
}

function mergeMcpFile(
  filePath: string,
  serverName: string,
  newServerConfig: ReturnType<typeof buildServerEntry>,
  apiKey: string,
): string {
  let mcpConfig: Record<string, any> = {};

  if (existsSync(filePath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      // Invalid JSON, start fresh
    }
  }

  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }

  let resolvedName = serverName;
  if (mcpConfig.mcpServers["line-harness"]) {
    const suffix = apiKey.slice(0, 8);
    resolvedName = `line-harness-${suffix}`;
    p.log.info(
      `既存の line-harness 設定があるため、${resolvedName} として追加します（${filePath}）`,
    );
  }
  mcpConfig.mcpServers[resolvedName] = newServerConfig;

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(mcpConfig, null, 2) + "\n");
  return resolvedName;
}

export async function generateMcpConfig(options: McpConfigOptions): Promise<void> {
  const agents = options.agents?.length
    ? options.agents
    : DEFAULT_SETUP_MCP_AGENTS;

  const env: Record<string, string> = {
    LINE_HARNESS_API_URL: options.workerUrl,
    LINE_HARNESS_API_KEY: options.apiKey,
  };

  const defaultAccountId =
    options.accountId ?? (await resolveDefaultAccountId(options));
  if (defaultAccountId) {
    env.LINE_HARNESS_ACCOUNT_ID = defaultAccountId;
  }

  const newServerConfig = buildServerEntry(env);
  const writtenPaths = new Set<string>();

  for (const agentId of agents) {
    const relativePath = AI_AGENTS[agentId].mcpConfigRelativePath;
    if (writtenPaths.has(relativePath)) continue;
    writtenPaths.add(relativePath);

    const filePath = join(process.cwd(), relativePath);
    const serverName = mergeMcpFile(
      filePath,
      "line-harness",
      newServerConfig,
      options.apiKey,
    );
    p.log.success(`MCP 設定を追加しました: ${relativePath}（${serverName}）`);
  }

  if (agents.includes("cursor")) {
    generateCursorAgentRules({ workerUrl: options.workerUrl });
    p.log.success("Cursor 用ルールを .cursor/rules/l-harness.mdc に追加しました");
  }
}
