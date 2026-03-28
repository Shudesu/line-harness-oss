import * as p from "@clack/prompts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import { wrangler } from "../lib/wrangler.js";

interface DeployAdminOptions {
  repoDir: string;
  workerUrl: string;
  apiKey?: string; // Deprecated: no longer embedded in client bundle
  projectName: string;
}

interface DeployAdminResult {
  adminUrl: string;
}

export async function deployAdmin(
  options: DeployAdminOptions,
): Promise<DeployAdminResult> {
  const s = p.spinner();
  const webDir = join(options.repoDir, "apps/web");

  // Write .env.production with the Worker URL and API key
  s.start("Admin UI ビルド中...");
  // Only set the API URL — API key is entered via login page (never embedded in client bundle)
  const envContent = `NEXT_PUBLIC_API_URL=${options.workerUrl}\n`;
  writeFileSync(join(webDir, ".env.production"), envContent);

  // Build Next.js
  try {
    await execa("pnpm", ["run", "build"], { cwd: webDir });
  } catch (error: any) {
    s.stop("Admin UI ビルド失敗");
    throw new Error(`Admin UI のビルドに失敗しました: ${error.message}`);
  }
  s.stop("Admin UI ビルド完了");

  // Deploy to CF Pages
  s.start("Admin UI デプロイ中...");
  try {
    // Create Pages project first (ignore error if already exists)
    try {
      await wrangler(["pages", "project", "create", options.projectName, "--production-branch", "main"]);
    } catch {
      // Already exists, that's fine
    }

    const output = await wrangler(
      ["pages", "deploy", "out", "--project-name", options.projectName, "--commit-dirty=true"],
      { cwd: webDir },
    );

    // Parse the actual subdomain from wrangler output or project list
    let adminUrl = `https://${options.projectName}.pages.dev`;
    try {
      const projectList = await wrangler(["pages", "project", "list"]);
      const subdomainMatch = projectList.match(
        new RegExp(`${options.projectName}\\s+│\\s+(\\S+\\.pages\\.dev)`),
      );
      if (subdomainMatch) {
        adminUrl = `https://${subdomainMatch[1]}`;
      }
    } catch {
      // Fall back to project name
    }

    s.stop("Admin UI デプロイ完了");
    return { adminUrl };
  } catch (error: any) {
    s.stop("Admin UI デプロイ失敗");
    throw new Error(`Admin UI のデプロイに失敗しました: ${error.message}`);
  }
}
