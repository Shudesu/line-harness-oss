import { resolve, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { validateSetupReleaseVersion } from "./lib/setup-release.js";

const HELP = `Usage: create-line-harness [setup|update] [options]

Commands:
  setup                  L Harness をセットアップ（省略時のコマンド）
  update                 インストール済みの L Harness を更新

Options:
  -h, --help             このヘルプを表示して終了
  --repo-dir <path>      リポジトリ・設定ファイルのディレクトリ
  --from-source          ソースからビルドしてデプロイ（setup のみ）
  --release <X.Y.Z>       公開済みの対象リリースを指定・再開先を変更（setup のみ）
  --repair-admin         管理画面のみを復旧（update のみ）`;

interface CliArgs {
  command: "setup" | "update";
  repoDir: string | null;
  fromSource: boolean;
  releaseVersion?: string;
  repairAdmin: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliArgs {
  let command: CliArgs["command"] | undefined;
  let repoDir: string | null = null;
  let fromSource = false;
  let releaseVersion: string | undefined;
  let repairAdmin = false;
  let help = false;
  const seen = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--repo-dir" || arg === "--from-source" || arg === "--repair-admin" || arg === "--release") {
      if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
      seen.add(arg);
      if (arg === "--repo-dir") {
        const value = args[++i];
        if (!value?.trim() || value.startsWith("-")) {
          throw new Error("--repo-dir requires a path.");
        }
        repoDir = value;
      } else if (arg === "--release") {
        releaseVersion = validateSetupReleaseVersion(args[++i] ?? "");
      } else if (arg === "--from-source") {
        fromSource = true;
      } else {
        repairAdmin = true;
      }
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg.split("=", 1)[0]}`);
    } else if (arg !== "setup" && arg !== "update") {
      throw new Error("Unknown command. Use setup or update.");
    } else if (command !== undefined) {
      throw new Error("Specify only one command: setup or update.");
    } else {
      command = arg;
    }
  }

  command ??= "setup";
  if (repairAdmin && command !== "update") {
    throw new Error("--repair-admin は update コマンドでのみ使用できます。");
  }
  if (fromSource && command !== "setup") {
    throw new Error("--from-source は setup コマンドでのみ使用できます。");
  }
  if (releaseVersion !== undefined && command !== "setup") {
    throw new Error("--release は setup コマンドでのみ使用できます。");
  }
  if (releaseVersion !== undefined && fromSource) {
    throw new Error("--release と --from-source は併用できません。");
  }
  return { command, repoDir, fromSource, releaseVersion, repairAdmin, help };
}

/** update uses the explicit directory, an existing cwd config, or the install home. */
function getConfigDir(explicitRepoDir: string | null): string {
  if (explicitRepoDir) return explicitRepoDir;
  const cwdConfig = join(process.cwd(), ".line-harness-config.json");
  if (existsSync(cwdConfig)) return process.cwd();
  const home = homedir() || process.env.HOME || process.env.USERPROFILE || tmpdir();
  const dir = join(home, ".line-harness");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  let parsed: CliArgs;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid arguments.");
    console.error(HELP);
    return 1;
  }
  if (parsed.help) {
    console.log(HELP);
    return 0;
  }

  // Validate and handle help before resolving directories or loading anything
  // that can prompt, authenticate, run subprocesses, or contact the network.
  const repoDir = parsed.repoDir === null ? null : resolve(parsed.repoDir);
  if (parsed.command === "update") {
    const { runUpdate } = await import("./commands/update.js");
    await runUpdate(getConfigDir(repoDir), { repairAdmin: parsed.repairAdmin });
  } else {
    const { ensureRepo } = await import("./steps/clone-repo.js");
    const { runSetup } = await import("./commands/setup.js");
    await runSetup(await ensureRepo(repoDir), {
      fromSource: parsed.fromSource,
      ...(parsed.releaseVersion !== undefined ? { releaseVersion: parsed.releaseVersion } : {}),
    });
  }
  return 0;
}
