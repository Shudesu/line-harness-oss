import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

interface CursorRulesOptions {
  workerUrl: string;
}

/**
 * Cursor Agent が L Harness を操作する際の最低限のルールを書き出す。
 * MCP ツール一覧は @line-harness/mcp-server が提供する。
 */
export function generateCursorAgentRules(options: CursorRulesOptions): void {
  const rulesPath = join(process.cwd(), ".cursor", "rules", "l-harness.mdc");
  const dir = dirname(rulesPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const base = options.workerUrl.replace(/\/$/, "");
  const content = `---
description: L Harness（LINE CRM）を MCP で操作する
alwaysApply: true
---

# L Harness × Cursor

- LINE 公式アカウントの変更は **REST API または MCP ツール** 経由で行う（管理画面は確認用）。
- MCP サーバー: \`@line-harness/mcp-server\`（設定は \`.cursor/mcp.json\`）。
- API ベース URL: \`${base}\`
- ドキュメント: リポジトリ内 \`docs/wiki/24-MCP-Server.md\`、\`docs/wiki/29-Cursor-Integration.md\`
- シークレット（API キー）をルールファイルやコミットに含めない。
`;

  writeFileSync(rulesPath, content, "utf-8");
}
