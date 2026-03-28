import * as p from "@clack/prompts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import { wrangler } from "../lib/wrangler.js";

interface DeployLiffOptions {
  repoDir: string;
  workerUrl: string;
  liffId: string;
  botBasicId: string;
  projectName: string;
}

interface DeployLiffResult {
  liffUrl: string;
}

export async function deployLiff(
  options: DeployLiffOptions,
): Promise<DeployLiffResult> {
  const s = p.spinner();
  const liffDir = join(options.repoDir, "apps/liff");

  // Write .env.production
  s.start("LIFF ビルド中...");
  const envContent = `VITE_API_URL=${options.workerUrl}\nVITE_LIFF_ID=${options.liffId}\nVITE_BOT_BASIC_ID=${options.botBasicId}\n`;
  writeFileSync(join(liffDir, ".env.production"), envContent);

  // Build Vite app
  try {
    await execa("pnpm", ["run", "build"], { cwd: liffDir });
  } catch (error: any) {
    s.stop("LIFF ビルド失敗");
    throw new Error(`LIFF のビルドに失敗しました: ${error.message}`);
  }
  s.stop("LIFF ビルド完了");

  // Deploy to CF Pages
  s.start("LIFF デプロイ中...");
  try {
    // Create Pages project first (ignore error if already exists)
    try {
      await wrangler(["pages", "project", "create", options.projectName, "--production-branch", "main"]);
    } catch {
      // Already exists, that's fine
    }

    const output = await wrangler(
      ["pages", "deploy", "dist", "--project-name", options.projectName, "--commit-dirty=true"],
      { cwd: liffDir },
    );

    // Parse the actual subdomain from project list (CF may add suffix if name is taken)
    let liffUrl = `https://${options.projectName}.pages.dev`;
    try {
      const projectList = await wrangler(["pages", "project", "list"]);
      const subdomainMatch = projectList.match(
        new RegExp(`${options.projectName}\\s+│\\s+(\\S+\\.pages\\.dev)`),
      );
      if (subdomainMatch) {
        liffUrl = `https://${subdomainMatch[1]}`;
      }
    } catch {
      // Fall back to project name
    }

    s.stop("LIFF デプロイ完了");
    return { liffUrl };
  } catch (error: any) {
    s.stop("LIFF デプロイ失敗");
    throw new Error(`LIFF のデプロイに失敗しました: ${error.message}`);
  }
}
