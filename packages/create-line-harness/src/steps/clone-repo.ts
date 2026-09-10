import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { inspectWranglerForGit, withWranglerRestored } from "../lib/wrangler-config-preservation.js";
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
 * A caller may supply any checkout via --repo-dir. Only exact CLI-generated
 * configuration can be temporarily restored for Git; unknown edits stop setup.
 */
export async function pinRepoToTag(
  repoDir: string,
  version: string,
): Promise<void> {
  const tag = `v${version}`;
  const snapshot = await inspectWranglerForGit(repoDir);
  const s = p.spinner();
  s.start(`リリース ${tag} のソースに固定中...`);

  try {
    await execa(
      "git",
      ["fetch", "--depth", "1", "origin", "tag", tag, "--no-tags"],
      { cwd: repoDir },
    );
    await withWranglerRestored(repoDir, snapshot, () =>
      execa("git", ["checkout", "--quiet", tag], { cwd: repoDir }),
    );
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
  await installRepoDeps(repoDir);
}

/**
 * Install workspace dependencies into an existing checkout.
 *
 * `ensureRepo()` installs only on the fresh-clone path, so a checkout that
 * already exists locally — cwd, `--repo-dir`, or a previous
 * `~/.line-harness` clone — arrives at the build steps with no
 * `node_modules`. `pinRepoToTag()` covers that for release installs;
 * `--from-source` skips pinning entirely and must install here instead,
 * or the first build fails with `tsc: command not found`.
 */
export async function installRepoDeps(repoDir: string): Promise<void> {
  const s = p.spinner();
  s.start("依存関係インストール中...");
  try {
    await repoPnpm(repoDir, ["install", "--frozen-lockfile"], {
      cwd: repoDir,
    });
  } catch {
    // A drifted lockfile must not block setup — retry unfrozen.
    await repoPnpm(repoDir, ["install"], { cwd: repoDir });
  }
  s.stop("依存関係インストール完了");
}

/** Refresh the canonical install checkout without replacing unknown configuration. */
export async function refreshInstalledRepo(repoDir: string): Promise<string> {
  let snapshot: Awaited<ReturnType<typeof inspectWranglerForGit>>;
  try {
    snapshot = await inspectWranglerForGit(repoDir);
  } catch {
    // Reusing a source checkout is read-only. Unknown configuration does not
    // authorize a pull/reset; leave it intact and let setup choose its mode.
    p.log.warn("Worker設定に変更があるため、リポジトリを更新せず現在のチェックアウトを使います。");
    return repoDir;
  }
  const s = p.spinner();
  s.start("最新バージョンを取得中...");
  try {
    await withWranglerRestored(repoDir, snapshot, async () => {
      try {
        await execa("git", ["pull", "--ff-only"], { cwd: repoDir });
      } catch {
        // A failed pull can use the existing checkout. Restoration errors must
        // still propagate, so this catch only surrounds the Git operation.
      }
    });
  } catch (error) {
    s.stop("設定ファイルの復元に失敗しました");
    throw error;
  }
  s.stop("リポジトリ更新完了");
  return repoDir;
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
    return refreshInstalledRepo(homeDir);
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

  await installRepoDeps(homeDir);

  return homeDir;
}
