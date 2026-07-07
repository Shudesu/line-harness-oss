#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/run-create-line-harness-sandbox.sh [options] [-- command...]

Options:
  --name NAME              Sandbox name (default: default)
  --root PATH              Sandbox root directory
  --reset                  Delete the sandbox root before starting
  --reuse-wrangler-auth    Copy the current user's wrangler auth into the sandbox
  -h, --help               Show this help

Examples:
  scripts/run-create-line-harness-sandbox.sh --name repro-20260521 -- npx create-line-harness
  scripts/run-create-line-harness-sandbox.sh --name repro-20260521 --reuse-wrangler-auth

What this isolates:
  - ~/.line-harness clone + setup state
  - wrangler config/cache under HOME / XDG
  - npm/pnpm/corepack cache + user config
  - working directory for the npx command

What this does NOT isolate:
  - Cloudflare resources you create with the sandbox login/token
  - LINE Developers resources you point the setup at
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

copy_dir_if_present() {
  local src="$1"
  local dest="$2"

  if [[ ! -e "$src" ]]; then
    return 0
  fi

  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  cp -R "$src" "$dest"
}

REAL_HOME="${HOME:-}"
if [[ -z "$REAL_HOME" ]]; then
  REAL_HOME="$(cd ~ && pwd)"
fi

SANDBOX_NAME="default"
SANDBOX_ROOT=""
RESET_SANDBOX=0
REUSE_WRANGLER_AUTH=0
COMMAND=()

while (($# > 0)); do
  case "$1" in
    --name)
      shift
      (($# > 0)) || die "--name requires a value"
      SANDBOX_NAME="$1"
      ;;
    --root)
      shift
      (($# > 0)) || die "--root requires a value"
      SANDBOX_ROOT="$1"
      ;;
    --reset)
      RESET_SANDBOX=1
      ;;
    --reuse-wrangler-auth)
      REUSE_WRANGLER_AUTH=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      COMMAND=("$@")
      break
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
  shift
done

SAFE_NAME="$(printf '%s' "$SANDBOX_NAME" | tr -cs 'A-Za-z0-9._-' '-')"
if [[ -z "$SAFE_NAME" ]]; then
  SAFE_NAME="default"
fi

if [[ -z "$SANDBOX_ROOT" ]]; then
  SANDBOX_ROOT="/private/tmp/line-harness-sandboxes/$SAFE_NAME"
fi

SANDBOX_ROOT="${SANDBOX_ROOT%/}"
SANDBOX_HOME="$SANDBOX_ROOT/home"
SANDBOX_WORK="$SANDBOX_ROOT/work"
SANDBOX_XDG_CONFIG="$SANDBOX_ROOT/xdg/config"
SANDBOX_XDG_CACHE="$SANDBOX_ROOT/xdg/cache"
SANDBOX_XDG_DATA="$SANDBOX_ROOT/xdg/data"
SANDBOX_NPM_CACHE="$SANDBOX_ROOT/npm-cache"
SANDBOX_PNPM_HOME="$SANDBOX_ROOT/pnpm-home"
SANDBOX_COREPACK_HOME="$SANDBOX_ROOT/corepack"
SANDBOX_USER_NPMRC="$SANDBOX_HOME/.npmrc"

if (( RESET_SANDBOX )); then
  rm -rf "$SANDBOX_ROOT"
fi

mkdir -p \
  "$SANDBOX_HOME" \
  "$SANDBOX_WORK" \
  "$SANDBOX_XDG_CONFIG" \
  "$SANDBOX_XDG_CACHE" \
  "$SANDBOX_XDG_DATA" \
  "$SANDBOX_NPM_CACHE" \
  "$SANDBOX_PNPM_HOME" \
  "$SANDBOX_COREPACK_HOME"

if [[ ! -f "$SANDBOX_USER_NPMRC" ]]; then
  printf 'registry=https://registry.npmjs.org/\n' >"$SANDBOX_USER_NPMRC"
fi

if (( REUSE_WRANGLER_AUTH )); then
  copy_dir_if_present "$REAL_HOME/.wrangler" "$SANDBOX_HOME/.wrangler"
  copy_dir_if_present "$REAL_HOME/.config/.wrangler" "$SANDBOX_XDG_CONFIG/.wrangler"
fi

if ((${#COMMAND[@]} > 0)) && [[ "${COMMAND[0]}" == "--" ]]; then
  COMMAND=("${COMMAND[@]:1}")
fi

export HOME="$SANDBOX_HOME"
export XDG_CONFIG_HOME="$SANDBOX_XDG_CONFIG"
export XDG_CACHE_HOME="$SANDBOX_XDG_CACHE"
export XDG_DATA_HOME="$SANDBOX_XDG_DATA"
export NPM_CONFIG_USERCONFIG="$SANDBOX_USER_NPMRC"
export NPM_CONFIG_CACHE="$SANDBOX_NPM_CACHE"
export PNPM_HOME="$SANDBOX_PNPM_HOME"
export COREPACK_HOME="$SANDBOX_COREPACK_HOME"
export WRANGLER_HOME="$SANDBOX_HOME/.wrangler"
export LINE_HARNESS_SANDBOX_ROOT="$SANDBOX_ROOT"
export LINE_HARNESS_REAL_HOME="$REAL_HOME"
export PATH="$PNPM_HOME:$PATH"

cd "$SANDBOX_WORK"

echo "LINE Harness sandbox is ready."
echo "  sandbox root: $SANDBOX_ROOT"
echo "  sandbox home: $SANDBOX_HOME"
echo "  working dir : $SANDBOX_WORK"
echo
echo "Safety reminders:"
echo "  - Local ~/.line-harness and wrangler state are isolated from your real HOME."
echo "  - Cloudflare / LINE resources are NOT isolated unless you use a separate account"
echo "    or a unique project name and test channel."
echo

if ((${#COMMAND[@]} == 0)); then
  echo "Starting an interactive shell inside the sandbox."
  exec "${SHELL:-/bin/zsh}" -i
fi

exec "${COMMAND[@]}"
