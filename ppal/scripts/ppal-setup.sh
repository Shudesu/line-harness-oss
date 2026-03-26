#!/usr/bin/env bash
# =============================================================================
# PPAL LINE Harness セットアップスクリプト
# PPALのDiscord運用をLINEに移行するためのワンコマンドセットアップ
#
# 実行前に以下を用意しておいてください:
#   - Cloudflare アカウント & wrangler 認証済み (`npx wrangler login`)
#   - LINE Official Account の Channel Secret / Access Token
#   - LINE Login Channel の Channel ID / Secret (LIFF用)
# =============================================================================
set -euo pipefail

WORKER_DIR="$(cd "$(dirname "$0")/../../apps/worker" && pwd)"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/../../packages/db/migrations" && pwd)"
SCHEMA_FILE="$(cd "$(dirname "$0")/../../packages/db" && pwd)/schema.sql"
DB_NAME="miyabi-line-crm"

echo ""
echo "======================================================"
echo "  PPAL LINE Harness セットアップ"
echo "======================================================"
echo ""

# ── Step 1: D1 データベース作成 ───────────────────────────
echo "[1/6] D1 データベースを作成します..."
DB_OUTPUT=$(npx wrangler d1 create "$DB_NAME" 2>&1 || true)
echo "$DB_OUTPUT"

# database_id を抽出
DB_ID=$(echo "$DB_OUTPUT" | grep -oE 'database_id = "[^"]+"' | sed 's/database_id = "//;s/"//')
if [ -z "$DB_ID" ]; then
  # 既存DBの場合はリストから取得
  DB_ID=$(npx wrangler d1 list --json 2>/dev/null | \
    python3 -c "import sys,json; dbs=json.load(sys.stdin); \
    match=[d['uuid'] for d in dbs if d['name']=='$DB_NAME']; \
    print(match[0] if match else '')" 2>/dev/null || echo "")
fi

if [ -z "$DB_ID" ]; then
  echo "ERROR: database_id が取得できませんでした。手動で wrangler.toml に設定してください。"
else
  echo "database_id: $DB_ID"
  # wrangler.toml に database_id を書き込む
  sed -i.bak "s/database_id  = \"YOUR_D1_DATABASE_ID\"/database_id  = \"$DB_ID\"/" \
    "$WORKER_DIR/wrangler.toml"
  echo "wrangler.toml を更新しました ✓"
fi

# ── Step 2: スキーマ適用 ──────────────────────────────────
echo ""
echo "[2/6] スキーマを適用します..."
npx wrangler d1 execute "$DB_NAME" --remote --file="$SCHEMA_FILE"

# ── Step 3: マイグレーション適用 ─────────────────────────
echo ""
echo "[3/6] マイグレーションを適用します..."
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  applying: $(basename "$f")"
  npx wrangler d1 execute "$DB_NAME" --remote --file="$f" 2>/dev/null || true
done
echo "マイグレーション完了 ✓"

# ── Step 4: Secrets 設定 ─────────────────────────────────
echo ""
echo "[4/6] Secrets を設定します (各値を入力してください)"
echo ""
echo "  > API_KEY: 管理画面アクセス用の秘密キー (任意の文字列)"
npx wrangler secret put API_KEY --name miyabi-line-crm

echo ""
echo "  > LINE_CHANNEL_SECRET: LINE Developers の Messaging API チャネルシークレット"
npx wrangler secret put LINE_CHANNEL_SECRET --name miyabi-line-crm

echo ""
echo "  > LINE_CHANNEL_ACCESS_TOKEN: Messaging API のチャネルアクセストークン"
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN --name miyabi-line-crm

echo ""
echo "  > LINE_LOGIN_CHANNEL_SECRET: LINE Login チャネルシークレット (LIFF用)"
npx wrangler secret put LINE_LOGIN_CHANNEL_SECRET --name miyabi-line-crm

# ── Step 5: デプロイ ──────────────────────────────────────
echo ""
echo "[5/6] Worker をデプロイします..."
cd "$WORKER_DIR"
npx wrangler deploy

WORKER_URL=$(npx wrangler deploy --dry-run 2>&1 | grep "https://" | head -1 | grep -oE 'https://[^ ]+' || echo "")
if [ -n "$WORKER_URL" ]; then
  echo "Worker URL: $WORKER_URL"
fi

# ── Step 6: ヘルスチェック ───────────────────────────────
echo ""
echo "[6/6] ヘルスチェック..."
sleep 3

HEALTH_URL="${WORKER_URL:-https://miyabi-line-crm.YOUR_ACCOUNT.workers.dev}/api/health"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "401" ]; then
  echo "Worker が正常に起動しました ✓ (status: $HTTP_STATUS)"
else
  echo "WARNING: ヘルスチェック失敗 (status: $HTTP_STATUS)"
  echo "  URL: $HEALTH_URL"
fi

echo ""
echo "======================================================"
echo "  セットアップ完了!"
echo "======================================================"
echo ""
echo "次のステップ:"
echo "  1. LINE Developers Console で Webhook URL を設定:"
echo "     ${WORKER_URL:-https://your-worker.workers.dev}/webhook"
echo ""
echo "  2. PPAL タグを移行:"
echo "     cd ppal/scripts && npx tsx migrate-ppal-tags.ts"
echo ""
echo "  3. PPAL シナリオを移行:"
echo "     cd ppal/scripts && npx tsx migrate-ppal-scenarios.ts"
echo ""
echo "  4. Teachable Webhook 自動化を設定:"
echo "     cd ppal/scripts && npx tsx ppal-automation-rules.ts"
echo ""
