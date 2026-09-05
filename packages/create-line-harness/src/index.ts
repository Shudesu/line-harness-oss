import { resolve, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { runSetup } from "./commands/setup.js";
import { runUpdate } from "./commands/update.js";
import { ensureRepo } from "./steps/clone-repo.js";

const args = process.argv.slice(2);

function parseArgs(): {
  command: string;
  repoDir: string | null;
  fromSource: boolean;
  repairAdmin: boolean;
} {
  let command = "setup";
  let repoDir: string | null = null;
  let fromSource = false;
  let repairAdmin = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repo-dir" && args[i + 1]) {
      repoDir = resolve(args[i + 1]);
      i++;
    } else if (args[i] === "--from-source") {
      // Dev escape hatch: build + deploy from the cloned source instead of
      // the official release bundle. The install reports 0.0.0-dev and is
      // excluded from automatic updates.
      fromSource = true;
    } else if (args[i] === "--repair-admin") {
      // Recovery path for a partial update where D1 + Worker succeeded but
      // the Admin Pages upload failed. This deliberately does not force a
      // full update or replay migrations.
      repairAdmin = true;
    } else if (!args[i].startsWith("-")) {
      command = args[i];
    }
  }

  return { command, repoDir, fromSource, repairAdmin };
}

/**
 * Resolve the directory we'll read `.line-harness-config.json` from when
 * running `update`. Unlike setup, the update command never touches the
 * cloned repo — it talks directly to the Cloudflare REST API. We just need
 * a stable path that matches where setup wrote the config.
 *
 * Precedence:
 *   1. --repo-dir flag (allows operators to point at a custom checkout)
 *   2. cwd, if it already contains a config file
 *   3. ~/.line-harness (the canonical install location)
 *
 * The directory is created if it doesn't exist so that the prompt-fallback
 * branch in update.ts can write the merged config back without surprises.
 */
function getConfigDir(explicitRepoDir: string | null): string {
  if (explicitRepoDir) return explicitRepoDir;
  const cwdConfig = join(process.cwd(), ".line-harness-config.json");
  if (existsSync(cwdConfig)) return process.cwd();
  const home = homedir() || process.env.HOME || process.env.USERPROFILE || tmpdir();
  const dir = join(home, ".line-harness");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function main(): Promise<void> {
  const {
    command,
    repoDir: explicitRepoDir,
    fromSource,
    repairAdmin,
  } = parseArgs();

  if (repairAdmin && command !== "update") {
    console.error("--repair-admin は update コマンドでのみ使用できます。");
    console.error(
      "Usage: create-line-harness update --repair-admin [--repo-dir <path>]",
    );
    process.exit(1);
  }

  let repoDir: string;
  if (command === "update") {
    // update reads .line-harness-config.json + calls CF REST API directly;
    // it never needs the cloned repo. Skipping ensureRepo avoids an unwanted
    // git clone/pull when operators just want to bump versions.
    repoDir = getConfigDir(explicitRepoDir);
  } else {
    // Ensure repo is available (clone if needed)
    repoDir = await ensureRepo(explicitRepoDir);
  }

  if (command === "setup") {
    await runSetup(repoDir, { fromSource });
  } else if (command === "update") {
    await runUpdate(repoDir, { repairAdmin });
  } else {
    console.error(`Unknown command: ${command}`);
    console.error(
      "Usage: create-line-harness [setup|update] [--repo-dir <path>] [--from-source] [--repair-admin]",
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
