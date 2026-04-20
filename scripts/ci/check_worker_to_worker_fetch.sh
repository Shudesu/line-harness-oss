#!/usr/bin/env bash
# Detect worker-to-worker fetch via public `*.workers.dev` URLs.
#
# Same-account Worker-to-Worker fetch via the public `*.workers.dev` hostname
# bypasses Cloudflare edge routing and returns HTTP 404 inside the isolate,
# even though the URL responds 200 from an external curl.
#
# Use Service Bindings (`env.<BINDING>.fetch(req)`) instead.
#
# Structural immunity for ED-027 (cloudflare_worker_routing).
# See ADR-057 (CF Workers Service Bindings & Secret Sync Protocol).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Pattern: fetch(...) or new Request(...) or similar, targeting *.workers.dev
# Scan TS / JS / TSX / JSX in apps/ and packages/ (exclude node_modules, dist, .wrangler)
PATTERN='(fetch|new\s+Request)\s*\(\s*["'"'"'`][^"'"'"'`]*\.workers\.dev'

MATCHES=$(
  grep -rEn \
    --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.wrangler \
    --exclude-dir=.next --exclude-dir=.vercel \
    "$PATTERN" \
    apps packages 2>/dev/null || true
)

if [[ -n "$MATCHES" ]]; then
  echo "[check_worker_to_worker_fetch] FAIL — detected *.workers.dev fetch pattern:"
  echo ""
  echo "$MATCHES"
  echo ""
  echo "Same-account Worker-to-Worker fetch via public workers.dev URL returns 404"
  echo "(Cloudflare edge routing bypass). Use Service Bindings instead:"
  echo ""
  echo "  # wrangler.toml"
  echo "  [[env.production.services]]"
  echo "  binding = \"MIZUKAGAMI\""
  echo "  service = \"mizukagami-worker\""
  echo ""
  echo "  # code"
  echo "  await env.MIZUKAGAMI.fetch(req)"
  echo ""
  echo "See ADR-057, ED-027 (cloudflare_worker_routing)."
  exit 1
fi

echo "[check_worker_to_worker_fetch] OK — no *.workers.dev fetch pattern found"
