#!/usr/bin/env bash
# Abort deploy if `.wrangler/deploy/config.json` exists with a redirect.
#
# `@cloudflare/vite-plugin` and some build flows write a redirect file at
# `.wrangler/deploy/config.json` pointing at a past `dist/*/wrangler.json`.
# When present, `wrangler deploy` silently ships the stale bundle while
# appearing successful on stdout (`Current Version ID: xxx` still prints).
#
# Structural immunity for ED-028 (wrangler_deploy_redirect_stale).
# See ADR-057.
#
# Usage: run as a `predeploy` hook. Set WRANGLER_DEPLOY_REDIRECT_ALLOW=1 to
# bypass (when the redirect is intentionally required).

set -euo pipefail

# Default mode: check apps/worker/.wrangler/deploy/config.json (most common),
# plus any other workspaces that contain .wrangler/deploy/config.json.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

FOUND=$(find apps packages -type f -path '*/.wrangler/deploy/config.json' 2>/dev/null || true)

if [[ -z "$FOUND" ]]; then
  echo "[check_wrangler_deploy_redirect] OK — no .wrangler/deploy/config.json redirect present"
  exit 0
fi

if [[ "${WRANGLER_DEPLOY_REDIRECT_ALLOW:-0}" == "1" ]]; then
  echo "[check_wrangler_deploy_redirect] WARN — redirect present but WRANGLER_DEPLOY_REDIRECT_ALLOW=1, continuing"
  echo "$FOUND"
  exit 0
fi

echo "[check_wrangler_deploy_redirect] FAIL — .wrangler/deploy/config.json detected:"
echo ""
echo "$FOUND" | while read -r f; do
  echo "  $f"
  echo "    -> $(cat "$f" 2>/dev/null | tr -d '\n' | head -c 200)"
  echo ""
done
echo ""
echo "This redirect causes wrangler deploy to ship the stale dist/*/wrangler.json"
echo "bundle (not your current src/). See ADR-057, ED-028 (wrangler_deploy_redirect_stale)."
echo ""
echo "Fix options:"
echo "  (a) rm .wrangler/deploy/config.json      # preferred: bundle directly from src/"
echo "  (b) rm -rf .wrangler/                    # nuclear: clears all wrangler state"
echo "  (c) WRANGLER_DEPLOY_REDIRECT_ALLOW=1 pnpm deploy   # intentional override"
exit 1
