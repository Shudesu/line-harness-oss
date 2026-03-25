#!/bin/bash
# Sync private repo to OSS repo
# Usage: bash scripts/sync-oss.sh

OSS_DIR="/tmp/line-harness-public"
PRIVATE_DIR="/Users/axpr/claudecode/tools/line-harness"

echo "=== Syncing to OSS ==="

# Rsync with exclusions
rsync -av \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env.production' \
  --exclude='.env.local' \
  --exclude='.env' \
  --exclude='.claude' \
  --exclude='apps/web/out' \
  --exclude='apps/liff/dist' \
  --exclude='docs/superpowers' \
  --exclude='README.md' \
  --exclude='.github/workflows' \
  --exclude='CHANGELOG.md' \
  --exclude='COMPETITOR_FEATURES.md' \
  --exclude='PROGRESS.md' \
  --exclude='SPEC.md' \
  --exclude='.env.example' \
  --exclude='tsconfig.base.json' \
  "$PRIVATE_DIR/" "$OSS_DIR/"

# Clean secrets
cd "$OSS_DIR"
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.md" -o -name "*.toml" -o -name "*.sql" -o -name "*.sh" -o -name "*.json" \) \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  -exec sed -i '' \
    -e 's|YOUR_D1_DATABASE_ID|YOUR_D1_DATABASE_ID|g' \
    -e 's|YOUR_D1_DATABASE_ID"]*"|YOUR_D1_DATABASE_ID"|g' \
    {} +

# Verify no secrets
LEAKS=$(grep -rl "YOUR_D1_DATABASE_ID" . 2>/dev/null | grep -v node_modules | grep -v ".git/")
if [ -n "$LEAKS" ]; then
  echo "WARNING: secrets found in:"
  echo "$LEAKS"
  exit 1
fi

echo "=== Clean. Ready to commit ==="
git add -A
git status --short
