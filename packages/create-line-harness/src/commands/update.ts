import * as p from "@clack/prompts";
import pc from "picocolors";
import { ensureAuth } from "../steps/auth.js";
import { wrangler } from "../lib/wrangler.js";
import { join } from "node:path";
import { execa } from "execa";

export async function runUpdate(repoDir: string): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" LINE Harness アップデート ")));

  await ensureAuth();

  const s = p.spinner();

  // Run pending migrations
  s.start("マイグレーション確認中...");
  try {
    await wrangler(
      ["d1", "migrations", "apply", "line-harness", "--remote"],
      { cwd: join(repoDir, "packages/db") },
    );
    s.stop("マイグレーション完了");
  } catch {
    s.stop("マイグレーション完了（変更なし）");
  }

  // Redeploy Worker
  s.start("Worker 再デプロイ中...");
  await wrangler(["deploy"], { cwd: join(repoDir, "apps/worker") });
  s.stop("Worker 再デプロイ完了");

  // Rebuild and redeploy Admin UI
  s.start("Admin UI 再デプロイ中...");
  const webDir = join(repoDir, "apps/web");
  await execa("pnpm", ["run", "build"], { cwd: webDir });
  await wrangler(
    ["pages", "deploy", "out", "--project-name", "line-harness-admin"],
    { cwd: webDir },
  );
  s.stop("Admin UI 再デプロイ完了");

  p.outro(pc.green("アップデート完了！"));
}
