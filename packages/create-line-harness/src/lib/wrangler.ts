import { execa, type Options as ExecaOptions } from "execa";

export class WranglerError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "WranglerError";
  }

  /**
   * Map common wrangler / Cloudflare errors to actionable hints.
   * Returns null when nothing matches so the caller can fall back to the raw stderr.
   */
  getHelp(): string | null {
    const text = `${this.message}\n${this.stderr}`.toLowerCase();
    const hints: string[] = [];

    if (text.includes("code: 10034") || text.includes("code:10034")) {
      hints.push(
        "Cloudflare アカウントのメール認証が完了していません。Cloudflare ダッシュボードに届く確認メールを開いて認証してください。",
      );
    }
    if (
      text.includes("authentication error") ||
      text.includes("code: 10000") ||
      text.includes("code:10000")
    ) {
      hints.push(
        "認証 / アカウント不一致の可能性: 別の CF アカウントでログイン中、または対象アカウントで D1/Workers がまだ有効化されていません。`npx wrangler whoami` で確認してください。",
      );
    }
    if (text.includes("not authenticated") || text.includes("you are not authenticated")) {
      hints.push("OAuth トークンが切れています。`npx wrangler logout && npx wrangler login` で再ログインしてください。");
    }
    if (text.includes("non-interactive") || text.includes("cloudflare_api_token")) {
      hints.push(
        "wrangler が CI モード判定に陥っています（TTY 不在）。create-line-harness 側のバグの可能性が高いので、Issue で報告してください。",
      );
    }
    if (text.includes("d1_create_too_many_databases") || text.includes("too many databases")) {
      hints.push("D1 の無料枠を使い切っています。古い D1 を削除するか有料プランへ。");
    }

    return hints.length > 0 ? hints.join("\n") : null;
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

export interface WranglerOptions {
  input?: string;
  cwd?: string;
  /**
   * When true, inherit *all* stdio (stdin/stdout/stderr) from the parent so
   * wrangler's `isInteractive()` check passes. Wrangler requires BOTH stdin
   * and stdout to be a TTY before it will refresh OAuth tokens or prompt the
   * user — half-piping stdout silently demotes it to non-interactive mode and
   * we hit the bogus `CLOUDFLARE_API_TOKEN required` error.
   *
   * Trade-off: we cannot capture the command's output in this mode. Callers
   * either must not need it, or must derive the result from a follow-up
   * `wrangler ... list` call.
   *
   * Caller MUST stop any active clack spinner before invoking — wrangler will
   * write progress to the inherited stderr and otherwise scramble the spinner.
   * Cannot be combined with `input`.
   */
  tty?: boolean;
}

export async function wrangler(
  args: string[],
  options?: WranglerOptions,
): Promise<string> {
  const env: Record<string, string> = { ...process.env, FORCE_COLOR: "0" } as Record<string, string>;
  if (_accountId) {
    env.CLOUDFLARE_ACCOUNT_ID = _accountId;
  }

  if (options?.tty) {
    if (options.input !== undefined) {
      throw new Error("wrangler({ tty: true }) does not support `input`.");
    }
    try {
      await execa("npx", ["wrangler", ...args], {
        cwd: options.cwd,
        env,
        stdio: "inherit",
      });
      return "";
    } catch (error: any) {
      // stderr was inherited so it isn't on the error object — surface what we can.
      const message = error?.shortMessage || error?.message || "unknown error";
      throw new WranglerError(`wrangler ${args[0]} failed: ${message}`, "");
    }
  }

  try {
    const result = await execa("npx", ["wrangler", ...args], {
      cwd: options?.cwd,
      input: options?.input,
      env,
    });
    return typeof result.stdout === "string" ? result.stdout : "";
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

export interface CloudflareAccount {
  name: string;
  id: string;
}

/**
 * Parse all Cloudflare accounts available to the currently authenticated user.
 * Returns an empty array if none could be parsed (e.g. wrangler not authenticated).
 */
export async function getAccountIds(): Promise<CloudflareAccount[]> {
  let output: string;
  try {
    output = await wrangler(["whoami"]);
  } catch {
    return [];
  }
  const matches = [...output.matchAll(/│\s+(.+?)\s+│\s+([a-f0-9]{32})\s+│/g)];
  return matches.map((m) => ({ name: m[1].trim(), id: m[2] }));
}
