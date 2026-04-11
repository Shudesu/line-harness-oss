import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureAuth } from "../steps/auth.js";
import { wrangler } from "../lib/wrangler.js";
import { execa } from "execa";

interface SetupState {
  projectName?: string;
  workerName?: string;
  adminUrl?: string;
  [key: string]: unknown;
}

function loadState(repoDir: string): SetupState | null {
  // Check for saved config from previous setup
  const configPath = join(repoDir, ".line-harness-config.json");
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // corrupt file
    }
  }
  return null;
}

export async function runUpdate(repoDir: string): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" LINE Harness アップデート ")));

  // Load saved config or ask for project name
  const savedState = loadState(repoDir);
  let projectName: string;

  if (savedState?.projectName) {
    projectName = savedState.projectName;
    p.log.success(`プロジェクト名: ${projectName}`);
  } else {
    const name = await p.text({
      message: "プロジェクト名（setup 時に指定した名前）",
      placeholder: "line-harness",
      defaultValue: "line-harness",
    });
    if (p.isCancel(name)) {
      p.cancel("アップデートをキャンセルしました");
      process.exit(0);
    }
    projectName = (name as string).trim() || "line-harness";
  }

  await ensureAuth();

  const s = p.spinner();

  // Run pending migrations
  s.start("マイグレーション確認中...");
  try {
    await wrangler(
      ["d1", "migrations", "apply", projectName, "--remote"],
      { cwd: join(repoDir, "packages/db") },
    );
    s.stop("マイグレーション完了");
  } catch {
    s.stop("マイグレーション完了（変更なし）");
  }

  // Redeploy Worker
  s.start("Worker 再デプロイ中...");
  await wrangler(["deploy", "--name", projectName], { cwd: join(repoDir, "apps/worker") });
  s.stop("Worker 再デプロイ完了");

  // Rebuild and redeploy Admin UI
  const adminProjectName = savedState?.adminUrl
    ? new URL(savedState.adminUrl as string).hostname.replace(".pages.dev", "")
    : `${projectName}-admin`;
  s.start("Admin UI 再デプロイ中...");
  const webDir = join(repoDir, "apps/web");
  await execa("pnpm", ["run", "build"], { cwd: webDir });
  await wrangler(
    ["pages", "deploy", "out", "--project-name", adminProjectName],
    { cwd: webDir },
  );
  s.stop("Admin UI 再デプロイ完了");

  p.outro(pc.green("アップデート完了！"));
}
