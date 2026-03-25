#!/bin/bash
# upstream 動向チェックスクリプト
# 毎日1回以上実行すること（週1は遅すぎる）

set -e

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
UPSTREAM_REPO="Shudesu/line-harness-oss"
LOG_FILE="$REPO_ROOT/project_memory/UPSTREAM_SYNC_LOG.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M')

echo "=== upstream 動向チェック ==="
echo "実行時刻: $TIMESTAMP"
echo ""

# upstream fetch
echo "[1/4] upstream fetch..."
git -C "$REPO_ROOT" fetch upstream 2>/dev/null && echo "OK" || echo "WARN: fetch failed"

# 直近10コミット
echo ""
echo "[2/4] upstream 直近10コミット:"
git -C "$REPO_ROOT" log upstream/main --oneline -10

# フォークとの差分量
echo ""
echo "[3/4] 自分のフォーク(main) vs upstream/main 差分:"
git -C "$REPO_ROOT" diff main upstream/main --stat 2>/dev/null | tail -3 || echo "(差分なし)"

# upstream オープンPR
echo ""
echo "[4/4] upstream オープンPR:"
gh pr list --repo "$UPSTREAM_REPO" --state open --limit 5 2>/dev/null || echo "(取得失敗 — gh auth 確認)"

# ログに記録
cat >> "$LOG_FILE" <<ENTRY

## $TIMESTAMP

\`\`\`
$(git -C "$REPO_ROOT" log upstream/main --oneline -5)
\`\`\`
ENTRY

echo ""
echo "=== チェック完了 ==="
echo "ログ: $LOG_FILE"
