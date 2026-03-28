import * as p from "@clack/prompts";
import { execa } from "execa";

export async function checkDeps(): Promise<void> {
  const s = p.spinner();
  s.start("環境チェック中...");

  // Check Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0], 10);
  if (major < 20) {
    s.stop("環境チェック失敗");
    p.cancel(`Node.js 20 以上が必要です（現在: ${nodeVersion}）`);
    process.exit(1);
  }

  // Check that npx is available (wrangler will be invoked via npx)
  try {
    await execa("npx", ["--version"]);
  } catch {
    s.stop("環境チェック失敗");
    p.cancel("npx が見つかりません。Node.js をインストールしてください。");
    process.exit(1);
  }

  s.stop("環境チェック完了");
}
