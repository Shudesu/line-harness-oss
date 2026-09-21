/**
 * AI エージェント（MCP クライアント）の識別子と表示用メタデータ。
 * 管理画面の「使用中エージェント」切替と、セットアップ時の MCP 設定出力で共有する。
 */
export type AiAgentId = "claude-code" | "cursor" | "codex" | "generic-mcp";

export interface AiAgentDefinition {
  id: AiAgentId;
  /** 管理画面・セットアップ用の表示名 */
  label: string;
  /** FAB や狭い UI 用の短い名前 */
  shortLabel: string;
  /**
   * プロジェクトルートからの MCP 設定ファイル相対パス。
   * 複数エージェントが同じファイルを使う場合はセットアップ側で重複書き込みを避ける。
   */
  mcpConfigRelativePath: string;
  /** プロンプトテンプレートのフッター文言 */
  promptFooter: string;
  /** 依頼ボタンの aria-label */
  requestAriaLabel: string;
  /** 依頼ボタンの表示テキスト（sm 以上） */
  requestButtonLabel: string;
  /** プロンプトモーダルのタイトル */
  promptModalTitle: string;
}

export const AI_AGENTS: Record<AiAgentId, AiAgentDefinition> = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    shortLabel: "Claude Code",
    mcpConfigRelativePath: ".mcp.json",
    promptFooter: "Claude Code のチャットにプロンプトを貼り付けて使用してください",
    requestAriaLabel: "Claude Code に依頼",
    requestButtonLabel: "CCに依頼",
    promptModalTitle: "Claude Code プロンプトテンプレート",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    shortLabel: "Cursor",
    mcpConfigRelativePath: ".cursor/mcp.json",
    promptFooter:
      "Cursor の Agent チャットにプロンプトを貼り付けて使用してください（MCP は .cursor/mcp.json で接続）",
    requestAriaLabel: "Cursor に依頼",
    requestButtonLabel: "Cursorに依頼",
    promptModalTitle: "Cursor プロンプトテンプレート",
  },
  codex: {
    id: "codex",
    label: "Codex CLI",
    shortLabel: "Codex",
    mcpConfigRelativePath: ".mcp.json",
    promptFooter: "Codex CLI のセッションにプロンプトを貼り付けて使用してください",
    requestAriaLabel: "Codex に依頼",
    requestButtonLabel: "Codexに依頼",
    promptModalTitle: "Codex プロンプトテンプレート",
  },
  "generic-mcp": {
    id: "generic-mcp",
    label: "その他（MCP 対応ツール）",
    shortLabel: "MCP",
    mcpConfigRelativePath: ".mcp.json",
    promptFooter:
      "お使いの MCP 対応 AI ツールのチャットにプロンプトを貼り付けて使用してください",
    requestAriaLabel: "AI に依頼",
    requestButtonLabel: "AIに依頼",
    promptModalTitle: "AI プロンプトテンプレート",
  },
};

export const AI_AGENT_IDS = Object.keys(AI_AGENTS) as AiAgentId[];

export const DEFAULT_AI_AGENT_ID: AiAgentId = "cursor";

export const LH_PREFERRED_AI_AGENT_STORAGE_KEY = "lh_preferred_ai_agent";

export function isAiAgentId(value: string): value is AiAgentId {
  return value in AI_AGENTS;
}

export function resolveAiAgentId(value: string | null | undefined): AiAgentId {
  if (value && isAiAgentId(value)) return value;
  return DEFAULT_AI_AGENT_ID;
}

/** セットアップで MCP 設定を書き込む既定のエージェント（複数選択可） */
export const DEFAULT_SETUP_MCP_AGENTS: AiAgentId[] = ["cursor", "claude-code"];
