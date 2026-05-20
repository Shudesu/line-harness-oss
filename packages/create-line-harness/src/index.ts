import { resolve } from "node:path";
import { runSetup } from "./commands/setup.js";
import { runUpdate } from "./commands/update.js";
import { ensureRepo } from "./steps/clone-repo.js";

const args = process.argv.slice(2);
const VERSION = "0.1.19";

function printHelp(): void {
  console.log(`LINE Harness setup CLI

Usage:
  create-line-harness [setup|update] [--repo-dir <path>]
  create-line-harness --help
  create-line-harness --version

Commands:
  setup   Set up LINE Harness locally and on Cloudflare (default)
  update  Update an existing LINE Harness installation

Options:
  --repo-dir <path>  Use an existing repository directory
  -h, --help         Show this help
  -v, --version      Show the package version`);
}

function parseArgs(): { command: string; repoDir: string | null; help: boolean; version: boolean } {
  let command = "setup";
  let repoDir: string | null = null;
  let help = false;
  let version = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-h" || args[i] === "--help") {
      help = true;
    } else if (args[i] === "-v" || args[i] === "--version") {
      version = true;
    } else if (args[i] === "--repo-dir" && args[i + 1]) {
      repoDir = resolve(args[i + 1]);
      i++;
    } else if (!args[i].startsWith("-")) {
      command = args[i];
    }
  }

  return { command, repoDir, help, version };
}

async function main(): Promise<void> {
  const { command, repoDir: explicitRepoDir, help, version } = parseArgs();

  if (help) {
    printHelp();
    return;
  }

  if (version) {
    console.log(VERSION);
    return;
  }

  if (command !== "setup" && command !== "update") {
    console.error(`Unknown command: ${command}`);
    console.error("Run `create-line-harness --help` for usage.");
    process.exit(1);
  }

  // Ensure repo is available (clone if needed)
  const repoDir = await ensureRepo(explicitRepoDir);

  if (command === "setup") {
    await runSetup(repoDir);
  } else {
    await runUpdate(repoDir);
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
