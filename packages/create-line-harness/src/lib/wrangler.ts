import { execa } from "execa";

export class WranglerError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "WranglerError";
  }
}

let _accountId: string | undefined;

/**
 * Set the Cloudflare account ID to use for all wrangler commands.
 * This is injected as CLOUDFLARE_ACCOUNT_ID env var.
 */
export function setAccountId(accountId: string): void {
  _accountId = accountId;
}

export async function wrangler(
  args: string[],
  options?: { input?: string; cwd?: string },
): Promise<string> {
  try {
    const env: Record<string, string> = { ...process.env, FORCE_COLOR: "0" } as Record<string, string>;
    if (_accountId) {
      env.CLOUDFLARE_ACCOUNT_ID = _accountId;
    }
    const result = await execa("npx", ["wrangler", ...args], {
      cwd: options?.cwd,
      input: options?.input,
      env,
    });
    return result.stdout;
  } catch (error: any) {
    throw new WranglerError(
      `wrangler ${args[0]} failed: ${error.stderr || error.message}`,
      error.stderr || "",
    );
  }
}

/**
 * Run wrangler with full stdio inheritance (for interactive commands like login).
 * Cannot capture output — use only when user interaction is needed.
 */
export async function wranglerInteractive(args: string[]): Promise<void> {
  await execa("npx", ["wrangler", ...args], {
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
}

export async function isWranglerAuthenticated(): Promise<boolean> {
  try {
    const output = await wrangler(["whoami"]);
    return !output.toLowerCase().includes("not authenticated");
  } catch {
    return false;
  }
}
