import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { renderInstalledWranglerToml, resolveInstalledWranglerConfig, type SavedInstallConfig } from "./installed-wrangler.js";

const WRANGLER_PATH = "apps/worker/wrangler.toml";

interface GeneratedWranglerSnapshot {
  content: string;
  mode: number;
  index: string;
  head: string;
}

interface GitConfigState {
  head: string;
  index: string;
  headEntry: string;
  headContent: string;
  fetchedHead: string | null;
}

async function readGitConfigState(repoDir: string): Promise<GitConfigState> {
  const { stdout: head } = await execa("git", ["rev-parse", "HEAD"], { cwd: repoDir });
  const [entry, content, fetched] = await Promise.all([
    execa("git", ["ls-tree", head, "--", WRANGLER_PATH], { cwd: repoDir }),
    execa("git", ["show", `${head}:${WRANGLER_PATH}`], { cwd: repoDir, stripFinalNewline: false }),
    // Annotated release tags make FETCH_HEAD a tag object, while checkout HEAD
    // is its commit. Peel the fetched ref without trusting an arbitrary HEAD.
    execa("git", ["rev-parse", "--verify", "FETCH_HEAD^{commit}"], { cwd: repoDir }).catch(() => null),
  ]);
  // Read the mutable index last, immediately before callers inspect current
  // file bytes/mode and decide whether a write is still authorized.
  const index = await execa("git", ["ls-files", "--stage", "--", WRANGLER_PATH], { cwd: repoDir });
  return { head, index: index.stdout, headEntry: entry.stdout, headContent: content.stdout, fetchedHead: fetched?.stdout ?? null };
}

function indexMatchesHead(state: GitConfigState): boolean {
  const index = /^(100644|100755) ([a-f0-9]+) 0\t/.exec(state.index);
  const head = /^(100644|100755) blob ([a-f0-9]+)\t/.exec(state.headEntry);
  return !!index && !!head && index[1] === head[1] && index[2] === head[2] && !state.index.includes("\n");
}

function readCurrentToml(repoDir: string): { content: string; mode: number } | null {
  const path = join(repoDir, WRANGLER_PATH);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile()) return null;
  return { content: readFileSync(path, "utf8"), mode: stat.mode & 0o777 };
}

function saveSnapshotForRecovery(snapshot: GeneratedWranglerSnapshot): Error & { backupPath: string } {
  // Unknown current contents must never be overwritten to restore our older
  // generated output. Keep it in an owner-only directory outside the checkout.
  const directory = mkdtempSync(join(tmpdir(), "line-harness-config-backup-"));
  const backupPath = join(directory, "wrangler.toml");
  writeFileSync(backupPath, snapshot.content, { flag: "wx", mode: 0o600 });
  writeFileSync(join(directory, "snapshot.json"), JSON.stringify({ mode: snapshot.mode, head: snapshot.head, index: snapshot.index }), { flag: "wx", mode: 0o600 });
  return Object.assign(new Error(
    `${WRANGLER_PATH} がGit操作中に変更されたため、現在のファイルとindexを保持して停止しました。` +
    `元の生成設定の退避先: ${backupPath}`,
  ), { backupPath });
}

interface ResumeSnapshot {
  originalWranglerToml?: string;
  accountId?: string;
  d1DatabaseId?: string;
}

/** Validate before setup's existing snapshot restoration, in either mode. */
export async function assertSetupWranglerConfigSafe(
  repoDir: string,
  state: ResumeSnapshot,
  fromSource = false,
): Promise<void> {
  if (state.originalWranglerToml === undefined) {
    // Source reuse does not switch Git state. Preserve its existing behavior;
    // the official-release path, however, will pin the checkout.
    if (!fromSource) await inspectWranglerForGit(repoDir);
    return;
  }

  const original = state.originalWranglerToml;
  const afterAccount = state.accountId
    ? original.replace(/account_id\s*=\s*"[^"]*"/g, `account_id = "${state.accountId}"`)
    : original;
  const afterDatabase = state.d1DatabaseId
    ? afterAccount.replace(/database_id\s*=\s*"[^"]*"/g, `database_id = "${state.d1DatabaseId}"`)
    : afterAccount;
  const tomlPath = join(repoDir, WRANGLER_PATH);
  const current = existsSync(tomlPath) ? readFileSync(tomlPath, "utf8") : null;
  if (current !== null && [original, afterAccount, afterDatabase].includes(current)) return;

  throw new Error(
    `${WRANGLER_PATH} が保存済みのセットアップ内容から変更されています。` +
    "古いsnapshotで上書きせず停止しました。現在の設定とセットアップ状態をバックアップし、内容を確認してから再開してください。",
  );
}

/** Inspect without changing files. A marker is not evidence that edits are ours. */
export async function inspectWranglerForGit(repoDir: string): Promise<GeneratedWranglerSnapshot | null> {
  const tomlPath = join(repoDir, WRANGLER_PATH);
  if (!existsSync(tomlPath)) return null;
  const { stdout } = await execa("git", [
    "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching", "--", WRANGLER_PATH,
  ], { cwd: repoDir });
  if (!stdout.trim()) return null;

  // The CLI never stages files. Preserve staged, untracked, ignored, deleted,
  // or otherwise unfamiliar changes rather than resetting the user's index.
  const onlyUnstagedModification = stdout.split(/\r?\n/).filter(Boolean).length === 1 && stdout.startsWith(" M ");
  const git = await readGitConfigState(repoDir);
  const current = readCurrentToml(repoDir);
  let expected: string | null = null;
  try {
    const config = JSON.parse(readFileSync(join(repoDir, ".line-harness-config.json"), "utf8")) as SavedInstallConfig;
    const resolved = resolveInstalledWranglerConfig(config);
    if (resolved) expected = renderInstalledWranglerToml(resolved);
  } catch {
    // Missing/unreadable configuration cannot establish ownership.
  }
  if (!onlyUnstagedModification || !indexMatchesHead(git) || current === null || expected === null || current.content !== expected) {
    throw new Error(
      `${WRANGLER_PATH} にユーザーの変更、または生成元を確認できない設定があります。` +
      "上書きせず停止しました。設定をバックアップし、別のクリーンなインストール先を使うか、手動更新ガイドに従ってください。" +
      "変更を自動で破棄・stash・commitすることはありません。",
    );
  }
  return { ...current, index: git.index, head: git.head };
}

/** Temporarily remove only an exact known CLI output, then restore it on every exit. */
export async function withWranglerRestored<T>(
  repoDir: string,
  snapshot: GeneratedWranglerSnapshot | null,
  operation: () => Promise<T>,
): Promise<T> {
  if (!snapshot) return operation();
  const tomlPath = join(repoDir, WRANGLER_PATH);

  // Fetch may have awaited the network since inspection. Recheck the approved
  // bytes, mode, index and HEAD immediately before the destructive reset.
  const beforeGit = await readGitConfigState(repoDir);
  const before = readCurrentToml(repoDir);
  if (!before || before.content !== snapshot.content || before.mode !== snapshot.mode ||
      beforeGit.index !== snapshot.index || beforeGit.head !== snapshot.head) {
    throw new Error(`${WRANGLER_PATH} が確認後に変更されたため、ファイルとindexに触れず停止しました。`);
  }

  try {
    await execa("git", ["checkout", "--", WRANGLER_PATH], { cwd: repoDir });
  } catch (error) {
    const current = readCurrentToml(repoDir);
    if (!current || current.content !== snapshot.content || current.mode !== snapshot.mode) {
      throw saveSnapshotForRecovery(snapshot);
    }
    throw error;
  }

  let temporaryMode: number;
  try {
    const git = await readGitConfigState(repoDir);
    const current = readCurrentToml(repoDir);
    if (!current || git.head !== snapshot.head || git.index !== snapshot.index ||
        !indexMatchesHead(git) || current.content !== git.headContent) {
      throw new Error("Working configuration changed during the temporary reset.");
    }
    temporaryMode = current.mode;
  } catch {
    throw saveSnapshotForRecovery(snapshot);
  }

  try {
    return await operation();
  } finally {
    // Only an untouched Git result can be replaced by the saved generated
    // config. A user edit, chmod, staged change or unreadable state is retained.
    let safe = false;
    try {
      const git = await readGitConfigState(repoDir);
      const current = readCurrentToml(repoDir);
      const expectedHead = git.head === snapshot.head || git.head === git.fetchedHead;
      safe = expectedHead && !!current && indexMatchesHead(git) && current.content === git.headContent && current.mode === temporaryMode;
    } catch {
      // Inability to prove the write safe is not permission to overwrite.
    }
    if (!safe) throw saveSnapshotForRecovery(snapshot);
    writeFileSync(tomlPath, snapshot.content);
    chmodSync(tomlPath, snapshot.mode);
  }
}
