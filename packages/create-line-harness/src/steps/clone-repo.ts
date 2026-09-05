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
 * Pin the cloned repo to the release tag for `version` (e.g. `0.16.0` →
 * `v0.16.0`).
 *
 * Setup deploys the Worker from the official release bundle; pinning the
 * clone to the SAME release keeps everything else sourced from the repo —
 * schema.sql, migrations, the vite-built client assets — consistent with
 * the deployed Worker. Installing from main HEAD instead would apply
 * migrations newer than the release, leaving the database "ahead" of what
 * the manifest expects on the next update.
 *
 * The clone is CLI-managed (`~/.line-harness`): apps/worker/wrangler.toml
 * is force-restored before checkout because setup itself patches/generates
 * it and a dirty copy would block `git checkout`.
 */
export async function pinRepoToTag(
  repoDir: string,
  version: string,
): Promise<void> {
  const tag = `v${version}`;
  const s = p.spinner();
  s.start(`リリース ${tag} のソースに固定中...`);

  // Drop CLI-authored wrangler.toml changes so the checkout can't conflict.
  // The file is regenerated later in setup (applyPatchedConfig /
  // syncInstalledWorkerConfig), so nothing user-authored is lost.
  try {
    await execa("git", ["checkout", "--", "apps/worker/wrangler.toml"], {
      cwd: repoDir,
    });
  } catch {
    // File may be untracked / repo pristine — fine.
  }

  try {
    await execa(
      "git",
      ["fetch", "--depth", "1", "origin", "tag", tag, "--no-tags"],
      { cwd: repoDir },
    );
    await execa("git", ["checkout", "--quiet", tag], { cwd: repoDir });
  } catch (error: any) {
    s.stop(`リリースタグ ${tag} への切り替えに失敗`);
    throw new Error(
      [
        `リリースタグ ${tag} を取得できませんでした: ${error.message}`,
        "ネットワークを確認して再実行してください。",
        "（タグの無い開発用リポジトリの場合は --from-source を使ってください）",
      ].join("\n"),
    );
  }
  s.stop(`リリース ${tag} のソースに固定しました`);

  // The tag may pin different dependency versions than the previously
  // installed main HEAD — reinstall to match its lockfile.
  s.start("依存関係インストール中...");
  try {
    await repoPnpm(repoDir, ["install", "--frozen-lockfile"], {
      cwd: repoDir,
    });
  } catch {
    await repoPnpm(repoDir, ["install"], { cwd: repoDir });
  }
  s.stop("依存関係インストール完了");
}

/**
 * Clone the L Harness repo and install dependencies.
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
  s.start("L Harness をダウンロード中...");

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
