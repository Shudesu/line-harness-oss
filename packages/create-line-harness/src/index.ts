import { resolve } from "node:path";
import { runSetup } from "./commands/setup.js";
import { runUpdate } from "./commands/update.js";
import { ensureRepo } from "./steps/clone-repo.js";

const args = process.argv.slice(2);

function parseArgs(): { command: string; repoDir: string | null } {
  let command = "setup";
  let repoDir: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repo-dir" && args[i + 1]) {
      repoDir = resolve(args[i + 1]);
      i++;
    } else if (!args[i].startsWith("-")) {
      command = args[i];
    }
  }

  return { command, repoDir };
}

async function main(): Promise<void> {
  const { command, repoDir: explicitRepoDir } = parseArgs();

  // Ensure repo is available (clone if needed)
  const repoDir = await ensureRepo(explicitRepoDir);

  if (command === "setup") {
    await runSetup(repoDir);
  } else if (command === "update") {
    await runUpdate(repoDir);
  } else {
    console.error(`Unknown command: ${command}`);
    console.error("Usage: create-line-harness [setup|update] [--repo-dir <path>]");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
