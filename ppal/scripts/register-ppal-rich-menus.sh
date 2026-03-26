#!/usr/bin/env bash
# PPAL リッチメニュー登録スクリプト
set -euo pipefail

API_KEY="${LINE_CRM_API_KEY:?LINE_CRM_API_KEY environment variable is required}"
WORKER_URL="${WORKER_URL:-https://miyabi-line-crm.supernovasyun.workers.dev}"
IMAGE_DIR="${PPAL_IMAGE_DIR:-$HOME/dev/products/PPAL/L-Step-Setup/assets/generated-images/richmenu}"

TEACHABLE_COURSE="https://shuhayas-s-school.teachable.com/courses/enrolled/2925864"
DISCORD_INVITE="https://discord.gg/ppal-lab"
LIFF_URL="https://liff.line.me/2008491323-apEVKQYv"
PPAL_LP="https://shuhayas-s-school.teachable.com/p/ppal-lab"
SEMINAR_URL="https://hayashi.link/5days"
LAB_ABOUT_URL="https://hayashi.link/about-lab"
TESTIMONIALS_URL="https://hayashi.link/testimonials"
PROFILE_URL="https://hayashi.link/profile"
FREE_CONTENT_URL="https://hayashi.link/free-content"
WEEKLY_MCP_URL="https://note.com/hayashi_ppal"
SKILL_MD_URL="https://github.com/ppal-lab/skill-library"

GUEST_ID=""
STAGE0_ID=""
STAGE2_ID=""

echo "======================================================"
echo "  PPAL リッチメニュー登録"
echo "======================================================"

upload_image() {
  local rich_menu_id="$1"
  local image_path="$2"
  echo "  画像アップロード: $(basename "$image_path")..."
  local result
  result=$(curl -s -X POST "$WORKER_URL/api/rich-menus/$rich_menu_id/image" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: image/jpeg" \
    --data-binary "@$image_path")
  echo "  結果: $result"
}

# ── 1. Guest Menu（デフォルト・未会員向け 2500x1686 2x3）──
echo ""
echo "[1/3] Guest Menu (2500x1686, 2列x3行)..."

GUEST_DEF="{
  \"size\": { \"width\": 2500, \"height\": 1686 },
  \"selected\": true,
  \"name\": \"PPAL_Guest\",
  \"chatBarText\": \"メニュー\",
  \"areas\": [
    { \"bounds\": { \"x\": 0,    \"y\": 0,    \"width\": 1250, \"height\": 562 }, \"action\": { \"type\": \"uri\", \"label\": \"5Daysセミナー\", \"uri\": \"$SEMINAR_URL\" } },
    { \"bounds\": { \"x\": 1250, \"y\": 0,    \"width\": 1250, \"height\": 562 }, \"action\": { \"type\": \"uri\", \"label\": \"ラボとは\",    \"uri\": \"$LAB_ABOUT_URL\" } },
    { \"bounds\": { \"x\": 0,    \"y\": 562,  \"width\": 1250, \"height\": 562 }, \"action\": { \"type\": \"uri\", \"label\": \"メンバーの声\", \"uri\": \"$TESTIMONIALS_URL\" } },
    { \"bounds\": { \"x\": 1250, \"y\": 562,  \"width\": 1250, \"height\": 562 }, \"action\": { \"type\": \"uri\", \"label\": \"ハヤシとは\",  \"uri\": \"$PROFILE_URL\" } },
    { \"bounds\": { \"x\": 0,    \"y\": 1124, \"width\": 1250, \"height\": 562 }, \"action\": { \"type\": \"uri\", \"label\": \"無料コンテンツ\", \"uri\": \"$FREE_CONTENT_URL\" } },
    { \"bounds\": { \"x\": 1250, \"y\": 1124, \"width\": 1250, \"height\": 562 }, \"action\": { \"type\": \"uri\", \"label\": \"ラボに参加\", \"uri\": \"$PPAL_LP\" } }
  ]
}"

GUEST_RESULT=$(curl -s -X POST "$WORKER_URL/api/rich-menus" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$GUEST_DEF")
echo "  作成結果: $GUEST_RESULT"

GUEST_ID=$(echo "$GUEST_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('richMenuId',''))" 2>/dev/null || echo "")

if [ -n "$GUEST_ID" ]; then
  upload_image "$GUEST_ID" "$IMAGE_DIR/richmenu_guest.jpg"
  DEFAULT_RESULT=$(curl -s -X POST "$WORKER_URL/api/rich-menus/$GUEST_ID/default" \
    -H "Authorization: Bearer $API_KEY")
  echo "  デフォルト設定: $DEFAULT_RESULT"
  echo "  ✅ Guest Menu完了 ID=$GUEST_ID"
else
  echo "  ❌ Guest Menu作成失敗"
fi

# ── 2. Stage0 Menu（購入直後コンパクト 2500x843 1ボタン）──
echo ""
echo "[2/3] Stage0 Menu (2500x843, コンパクト1ボタン)..."

STAGE0_DEF="{
  \"size\": { \"width\": 2500, \"height\": 843 },
  \"selected\": false,
  \"name\": \"PPAL_Stage0\",
  \"chatBarText\": \"講座へ\",
  \"areas\": [
    { \"bounds\": { \"x\": 0, \"y\": 0, \"width\": 2500, \"height\": 843 }, \"action\": { \"type\": \"uri\", \"label\": \"講座にアクセス\", \"uri\": \"$TEACHABLE_COURSE\" } }
  ]
}"

STAGE0_RESULT=$(curl -s -X POST "$WORKER_URL/api/rich-menus" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$STAGE0_DEF")
echo "  作成結果: $STAGE0_RESULT"

STAGE0_ID=$(echo "$STAGE0_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('richMenuId',''))" 2>/dev/null || echo "")

if [ -n "$STAGE0_ID" ]; then
  upload_image "$STAGE0_ID" "$IMAGE_DIR/richmenu_stage0.jpg"
  echo "  ✅ Stage0 Menu完了 ID=$STAGE0_ID"
else
  echo "  ❌ Stage0 Menu作成失敗"
fi

# ── 3. Stage2 Menu（会員フル 2500x1686 3x2）──
echo ""
echo "[3/3] Stage2 Member Menu (2500x1686, 3列x2行)..."

STAGE2_DEF="{
  \"size\": { \"width\": 2500, \"height\": 1686 },
  \"selected\": false,
  \"name\": \"PPAL_Stage2\",
  \"chatBarText\": \"メニュー\",
  \"areas\": [
    { \"bounds\": { \"x\": 0,    \"y\": 0,   \"width\": 833, \"height\": 843 }, \"action\": { \"type\": \"uri\",     \"label\": \"講座にアクセス\", \"uri\": \"$TEACHABLE_COURSE\" } },
    { \"bounds\": { \"x\": 833,  \"y\": 0,   \"width\": 833, \"height\": 843 }, \"action\": { \"type\": \"uri\",     \"label\": \"Discord参加\",  \"uri\": \"$DISCORD_INVITE\" } },
    { \"bounds\": { \"x\": 1666, \"y\": 0,   \"width\": 834, \"height\": 843 }, \"action\": { \"type\": \"message\", \"label\": \"質問する\",      \"text\": \"質問があります\" } },
    { \"bounds\": { \"x\": 0,    \"y\": 843, \"width\": 833, \"height\": 843 }, \"action\": { \"type\": \"uri\",     \"label\": \"週刊MCP\",       \"uri\": \"$WEEKLY_MCP_URL\" } },
    { \"bounds\": { \"x\": 833,  \"y\": 843, \"width\": 833, \"height\": 843 }, \"action\": { \"type\": \"uri\",     \"label\": \"SKILL.md\",      \"uri\": \"$SKILL_MD_URL\" } },
    { \"bounds\": { \"x\": 1666, \"y\": 843, \"width\": 834, \"height\": 843 }, \"action\": { \"type\": \"uri\",     \"label\": \"プロフィール\",  \"uri\": \"$LIFF_URL\" } }
  ]
}"

STAGE2_RESULT=$(curl -s -X POST "$WORKER_URL/api/rich-menus" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$STAGE2_DEF")
echo "  作成結果: $STAGE2_RESULT"

STAGE2_ID=$(echo "$STAGE2_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('richMenuId',''))" 2>/dev/null || echo "")

if [ -n "$STAGE2_ID" ]; then
  upload_image "$STAGE2_ID" "$IMAGE_DIR/richmenu_stage2.jpg"
  echo "  ✅ Stage2 Menu完了 ID=$STAGE2_ID"
else
  echo "  ❌ Stage2 Menu作成失敗"
fi

# ── 登録確認 ──
echo ""
echo "======================================================"
echo "  登録済みリッチメニュー一覧"
echo "======================================================"
curl -s "$WORKER_URL/api/rich-menus" \
  -H "Authorization: Bearer $API_KEY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('data', []):
    tag = ' ★DEFAULT' if m['selected'] else ''
    print(f\"  [{m['name']}] {m['richMenuId']} {m['size']['width']}x{m['size']['height']}{tag}\")
"
echo ""
echo "  PPAL_Guest  ID: $GUEST_ID"
echo "  PPAL_Stage0 ID: $STAGE0_ID"
echo "  PPAL_Stage2 ID: $STAGE2_ID"
echo "======================================================"
