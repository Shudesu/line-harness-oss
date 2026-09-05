import * as p from "@clack/prompts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  materializeAdminFiles,
  findResidualPlaceholders,
} from "@line-harness/update-engine";
import { wrangler, WranglerError } from "../lib/wrangler.js";
import { repoPnpm } from "../lib/pnpm.js";

const TTY_REQUIRED =
  /non[- ]?interactive|cloudflare_api_token|consent denied|authentication error|expired/i;

interface DeployAdminOptions {
  repoDir: string;
  workerUrl: string;
  apiKey?: string; // Deprecated: no longer embedded in client bundle
  projectName: string;
  /**
   * Admin static files from the official release bundle (path → content).
   * When set, these are deployed (after `__LH_WORKER_URL__` placeholder
   * materialization) instead of building apps/web from source — much
   * faster, and pixel-identical to the released admin. Absent only in
   * `--from-source` mode.
   */
  adminFiles?: Map<string, Buffer>;
}

interface DeployAdminResult {
  adminUrl: string;
}

/**
 * Write the materialized admin files into a fresh temp dir that
 * `wrangler pages deploy` can consume. Returns the dir path; caller cleans
 * it up.
 */
function stageAdminFiles(
  adminFiles: Map<string, Buffer>,
  workerUrl: string,
): string {
  const stageDir = mkdtempSync(join(tmpdir(), "clh-admin-"));
  const files = materializeAdminFiles(adminFiles, workerUrl);
  const residual = findResidualPlaceholders(files);
  if (residual.length > 0) {
    p.log.warn(
      `未知のプレースホルダーが残っています（動作に影響する可能性）: ${residual.slice(0, 5).join(", ")}${residual.length > 5 ? " …" : ""}`,
    );
  }
  for (const [relPath, buf] of files) {
    const dest = join(stageDir, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
  }
  return stageDir;
}

export async function deployAdmin(
  options: DeployAdminOptions,
): Promise<DeployAdminResult> {
  const webDir = join(options.repoDir, "apps/web");

  // Resolve the directory to deploy: staged release-bundle files
  // (placeholder-materialized), or a local Next.js build in --from-source
  // mode.
  let deployDir: string;
  let deployCwd: string | undefined;
  let stageDir: string | null = null;

  if (options.adminFiles) {
    const s = p.spinner();
    s.start("Admin UI 準備中（リリース bundle から展開）...");
    stageDir = stageAdminFiles(options.adminFiles, options.workerUrl);
    s.stop("Admin UI 準備完了");
    deployDir = stageDir;
    deployCwd = undefined;
  } else {
    // Write .env.production with the Worker URL and build from source.
    const buildSpinner = p.spinner();
    buildSpinner.start("Admin UI ビルド中...");
    // Only set the API URL — API key is entered via login page (never embedded in client bundle)
    const envContent = `NEXT_PUBLIC_API_URL=${options.workerUrl}\n`;
    writeFileSync(join(webDir, ".env.production"), envContent);

    try {
      await repoPnpm(options.repoDir, ["run", "build"], { cwd: webDir });
    } catch (error: any) {
      buildSpinner.stop("Admin UI ビルド失敗");
      throw new Error(`Admin UI のビルドに失敗しました: ${error.message}`);
    }
    buildSpinner.stop("Admin UI ビルド完了");
    deployDir = "out";
    deployCwd = webDir;
  }

  try {
    // Create Pages project first (ignore error if already exists) — silent step
    const projectSpinner = p.spinner();
    projectSpinner.start("Pages プロジェクト準備中...");
    try {
      await wrangler(["pages", "project", "create", options.projectName, "--production-branch", "main"]);
    } catch (error) {
      if (
        error instanceof WranglerError &&
        TTY_REQUIRED.test(`${error.message}\n${error.stderr}`)
      ) {
        projectSpinner.stop("Pages プロジェクト認証を更新します");
        await wrangler(
          ["pages", "project", "create", options.projectName, "--production-branch", "main"],
          { tty: true },
        );
        projectSpinner.start("Pages プロジェクト準備中...");
      } else {
        // Already exists, that's fine
      }
    }
    projectSpinner.stop("Pages プロジェクト準備完了");

    // Deploy to CF Pages — hand TTY over to wrangler
    p.log.info("Admin UI をデプロイしています（wrangler の出力が表示されます）...");
    try {
      await wrangler(
        ["pages", "deploy", deployDir, "--project-name", options.projectName, "--commit-dirty=true"],
        { cwd: deployCwd, tty: true },
      );

      // Parse the actual subdomain from project list (deploy output is captured-or-not depending on TTY)
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

      p.log.success(`Admin UI デプロイ完了: ${adminUrl}`);
      return { adminUrl };
    } catch (error: any) {
      p.log.error("Admin UI デプロイ失敗");
      throw new Error(`Admin UI のデプロイに失敗しました: ${error.message}`);
    }
  } finally {
    if (stageDir) {
      try {
        rmSync(stageDir, { recursive: true, force: true });
      } catch {
        // Temp dir — the OS cleans it up eventually.
      }
    }
  }
}
