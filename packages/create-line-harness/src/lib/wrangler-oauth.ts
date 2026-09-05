import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Locate and read wrangler's own OAuth access token so setup can call the
 * Cloudflare REST API directly (e.g. the workers.dev subdomain endpoints,
 * which have no wrangler subcommand) with the same identity the user already
 * authorized via `wrangler login`.
 *
 * The path resolution mirrors wrangler's `getGlobalConfigPath()`
 * (cloudflare/workers-sdk, packages/workers-utils/src/global-wrangler-config-path.ts):
 *   1. A pre-existing legacy `~/.wrangler` directory wins.
 *   2. Otherwise the XDG-compliant config dir:
 *        - macOS:   $XDG_CONFIG_HOME || ~/Library/Preferences
 *        - Windows: $XDG_CONFIG_HOME || %APPDATA%/xdg.config
 *        - other:   $XDG_CONFIG_HOME || ~/.config
 *      each suffixed with `/.wrangler`.
 * Credentials live at `<dir>/config/default.toml`.
 */

export interface WranglerOAuthEnv {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  home?: string;
  /** Injectable for tests. Defaults to fs.statSync-based directory check. */
  isDirectory?: (path: string) => boolean;
}

function defaultIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Resolve wrangler's global config directory (the one holding `config/default.toml`). */
export function getWranglerConfigDir(opts: WranglerOAuthEnv = {}): string {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const isDirectory = opts.isDirectory ?? defaultIsDirectory;

  const legacyDir = join(home, ".wrangler");
  if (isDirectory(legacyDir)) {
    return legacyDir;
  }

  let xdgConfigBase: string;
  if (env.XDG_CONFIG_HOME) {
    xdgConfigBase = env.XDG_CONFIG_HOME;
  } else if (platform === "darwin") {
    xdgConfigBase = join(home, "Library", "Preferences");
  } else if (platform === "win32") {
    xdgConfigBase = join(env.APPDATA ?? join(home, "AppData", "Roaming"), "xdg.config");
  } else {
    xdgConfigBase = join(home, ".config");
  }
  return join(xdgConfigBase, ".wrangler");
}

/**
 * Extract `oauth_token` / `expiration_time` from wrangler's credentials TOML
 * without a TOML parser — wrangler writes flat `key = "value"` lines, which
 * is all we need to match.
 */
export function parseWranglerAuthToml(content: string): {
  oauthToken: string | null;
  expirationTime: string | null;
} {
  const tokenMatch = content.match(/^\s*oauth_token\s*=\s*"([^"]+)"/m);
  const expirationMatch = content.match(/^\s*expiration_time\s*=\s*"([^"]+)"/m);
  return {
    oauthToken: tokenMatch?.[1] ?? null,
    expirationTime: expirationMatch?.[1] ?? null,
  };
}

/**
 * Read the current wrangler OAuth access token.
 *
 * Returns null when the credentials file is absent/unreadable, has no
 * `oauth_token`, or the token is already expired (wrangler refreshes it on
 * its own CLI runs — we can't, so an expired token is unusable). Callers
 * treat null as "cannot pre-check via the API" and fall back to the plain
 * deploy path.
 */
export function readWranglerOAuthToken(
  opts: WranglerOAuthEnv & { now?: () => number } = {},
): string | null {
  const tomlPath = join(getWranglerConfigDir(opts), "config", "default.toml");

  let content: string;
  try {
    content = readFileSync(tomlPath, "utf-8");
  } catch {
    return null;
  }

  const { oauthToken, expirationTime } = parseWranglerAuthToml(content);
  if (!oauthToken) return null;

  if (expirationTime) {
    const expiresAt = Date.parse(expirationTime);
    const now = (opts.now ?? Date.now)();
    if (!Number.isNaN(expiresAt) && expiresAt <= now) {
      return null;
    }
  }

  return oauthToken;
}
