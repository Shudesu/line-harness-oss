import * as p from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import {
  isGeneratedInstalledWranglerToml,
  renderInstalledWranglerToml,
  resolveInstalledWranglerConfig,
  type SavedInstallConfig,
} from "../lib/installed-wrangler.js";
import { repoPnpm } from "../lib/pnpm.js";

const REPO_URL =
  process.env.LINE_HARNESS_REPO_URL ??
  "https://github.com/Shudesu/line-harness-oss.git";

/**
 * Clone the ラクらくLINE repo and install dependencies.
 * Returns the path to the cloned repo.
 */
export async function ensureRepo(repoDir: string | null): Promise<string> {
  // If --repo-dir was given and has the repo, use it
  if (repoDir && existsSync(join(repoDir, "pnpm-workspace.yaml"))) {
    return repoDir;
  }

  // Check if cwd is the repo
  if (existsSync(join(process.cwd(), "pnpm-workspace.yaml"))) {
    return process.cwd();
  }

  // Check standard install location
  const homeDir = join(
    process.env.HOME || process.env.USERPROFILE || tmpdir(),
    ".line-harness",
  );
  if (existsSync(join(homeDir, "pnpm-workspace.yaml"))) {
    const wranglerTomlPath = join(homeDir, "apps/worker/wrangler.toml");
    const configPath = join(homeDir, ".line-harness-config.json");
    let installedToml: string | null = null;

    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(
          readFileSync(configPath, "utf-8"),
        ) as SavedInstallConfig;
        const resolved = resolveInstalledWranglerConfig(config);
        if (resolved) {
          installedToml = renderInstalledWranglerToml(resolved);
        }
      } catch {
        // Ignore unreadable config and continue with a normal pull.
      }
    }

    if (existsSync(wranglerTomlPath)) {
      try {
        const currentToml = readFileSync(wranglerTomlPath, "utf-8");
        if (isGeneratedInstalledWranglerToml(currentToml)) {
          await execa("git", ["checkout", "--", "apps/worker/wrangler.toml"], {
            cwd: homeDir,
          });
        }
      } catch {
        // Best effort — if the file stays dirty, the pull below may fail.
      }
    }

    // Pull latest
    const s = p.spinner();
    s.start("最新バージョンを取得中...");
    try {
      await execa("git", ["pull", "--ff-only"], { cwd: homeDir });
    } catch {
      // Non-critical, continue with existing
    }
    s.stop("リポジトリ更新完了");

    if (installedToml) {
      try {
        writeFileSync(wranglerTomlPath, installedToml);
      } catch {
        // Non-critical — the next setup run will regenerate it again.
      }
    }
    return homeDir;
  }

  // Clone fresh
  const s = p.spinner();
  s.start("ラクらくLINE をダウンロード中...");

  try {
    await execa("git", ["clone", "--depth", "1", REPO_URL, homeDir]);
  } catch (error: any) {
    s.stop("ダウンロード失敗");
    throw new Error(
      `git clone に失敗しました: ${error.message}\ngit がインストールされているか確認してください。`,
    );
  }
  s.stop("ダウンロード完了");

  // Install dependencies
  s.start("依存関係インストール中...");
  try {
    await repoPnpm(homeDir, ["install", "--frozen-lockfile"], {
      cwd: homeDir,
    });
  } catch {
    // Try without frozen lockfile
    await repoPnpm(homeDir, ["install"], { cwd: homeDir });
  }
  s.stop("依存関係インストール完了");

  return homeDir;
}
