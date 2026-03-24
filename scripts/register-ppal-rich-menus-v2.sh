#!/bin/bash
# =============================================================================
# PPAL リッチメニュー完全セットアップ v2
# RICHMENU_IMPLEMENTATION.yaml 準拠
# 計測・タグ付与・自動切替を全てAPIで設定
# =============================================================================

set -e

BASE_URL="${WORKER_URL:-https://miyabi-line-crm.supernovasyun.workers.dev}"
API_KEY="${LINE_CRM_API_KEY:-miyabi-ppal-5e5be18c9f2d90aba4a5203b184171da}"
IMAGE_DIR="$(cd "$(dirname "$0")/../" && pwd)/../products/PPAL/L-Step-Setup/assets/generated-images/richmenu"

AUTH_HEADER="x-api-key: ${API_KEY}"

echo "=== PPAL リッチメニュー v2 セットアップ ==="
echo "Worker: ${BASE_URL}"
echo "Images: ${IMAGE_DIR}"
echo ""

# =============================================================================
# ヘルパー関数
# =============================================================================
api_post() {
  local path="$1"
  local body="$2"
  curl -s -X POST "${BASE_URL}${path}" \
    -H "Content-Type: application/json" \
    -H "${AUTH_HEADER}" \
    -d "${body}"
}

api_delete() {
  local path="$1"
  curl -s -X DELETE "${BASE_URL}${path}" \
    -H "${AUTH_HEADER}"
}

api_get() {
  local path="$1"
  curl -s -X GET "${BASE_URL}${path}" \
    -H "${AUTH_HEADER}"
}

upload_image() {
  local menu_id="$1"
  local image_path="$2"
  echo "  画像アップロード: $(basename ${image_path})"
  curl -s -X POST "${BASE_URL}/api/rich-menus/${menu_id}/image" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: image/jpeg" \
    --data-binary "@${image_path}" | jq -r '.status // "ok"'
}

# =============================================================================
# Step 1: 既存の PPAL リッチメニューを削除
# =============================================================================
echo "--- Step 1: 既存 PPAL メニュー削除 ---"

EXISTING=$(api_get "/api/rich-menus" | jq -r '.[] | select(.name | startswith("PPAL_")) | .id' 2>/dev/null || echo "")
if [ -n "$EXISTING" ]; then
  for menu_id in $EXISTING; do
    echo "  削除: ${menu_id}"
    api_delete "/api/rich-menus/${menu_id}" | jq -r '.status // "deleted"'
  done
else
  echo "  削除対象なし"
fi
echo ""

# =============================================================================
# Step 2: タグ作成（存在しない場合のみ）
# =============================================================================
echo "--- Step 2: タグ作成 ---"

create_tag_if_not_exists() {
  local name="$1"
  local color="$2"
  # 既存チェック
  EXISTING_TAG=$(api_get "/api/tags" | jq -r --arg n "$name" '.[] | select(.name == $n) | .id' 2>/dev/null || echo "")
  if [ -n "$EXISTING_TAG" ]; then
    echo "  既存タグ: ${name} (${EXISTING_TAG})"
    echo "$EXISTING_TAG"
  else
    RESULT=$(api_post "/api/tags" "{\"name\":\"${name}\",\"color\":\"${color}\"}")
    TAG_ID=$(echo "$RESULT" | jq -r '.id')
    echo "  作成: ${name} (${TAG_ID})"
    echo "$TAG_ID"
  fi
}

TAG_ONBOARDING_STARTED=$(create_tag_if_not_exists "Onboarding:Started" "#10B981")
TAG_STEP0_CLICKED=$(create_tag_if_not_exists "Onboarding:Step0_Clicked" "#3B82F6")
TAG_WEEK1_COMPLETE=$(create_tag_if_not_exists "lesson_week1_complete" "#8B5CF6")

echo ""
echo "  TAG_ONBOARDING_STARTED: ${TAG_ONBOARDING_STARTED}"
echo "  TAG_STEP0_CLICKED:      ${TAG_STEP0_CLICKED}"
echo "  TAG_WEEK1_COMPLETE:     ${TAG_WEEK1_COMPLETE}"
echo ""

# =============================================================================
# Step 3: Guest メニュー作成（2x3、デフォルト）
# =============================================================================
echo "--- Step 3: Guest メニュー作成 ---"

GUEST_BODY=$(cat <<EOF
{
  "size": {"width": 2500, "height": 1686},
  "selected": true,
  "name": "PPAL_RichMenu_Guest",
  "chatBarText": "メニューを開く",
  "areas": [
    {
      "bounds": {"x": 0, "y": 0, "width": 1250, "height": 562},
      "action": {"type": "uri", "uri": "https://hayashi.link/5days", "label": "5Daysセミナー"}
    },
    {
      "bounds": {"x": 1250, "y": 0, "width": 1250, "height": 562},
      "action": {"type": "uri", "uri": "https://hayashi.link/about-lab", "label": "ラボとは？"}
    },
    {
      "bounds": {"x": 0, "y": 562, "width": 1250, "height": 562},
      "action": {"type": "uri", "uri": "https://hayashi.link/testimonials", "label": "メンバーの声"}
    },
    {
      "bounds": {"x": 1250, "y": 562, "width": 1250, "height": 562},
      "action": {"type": "uri", "uri": "https://hayashi.link/profile", "label": "ハヤシとは"}
    },
    {
      "bounds": {"x": 0, "y": 1124, "width": 1250, "height": 562},
      "action": {"type": "uri", "uri": "https://hayashi.link/free-content", "label": "無料コンテンツ"}
    },
    {
      "bounds": {"x": 1250, "y": 1124, "width": 1250, "height": 562},
      "action": {"type": "uri", "uri": "https://shuhayas-s-school.teachable.com/p/ppal-lab", "label": "ラボに参加"}
    }
  ]
}
EOF
)

GUEST_RESULT=$(api_post "/api/rich-menus" "$GUEST_BODY")
GUEST_ID=$(echo "$GUEST_RESULT" | jq -r '.richMenuId // .id')
echo "  Guest Menu ID: ${GUEST_ID}"
upload_image "$GUEST_ID" "${IMAGE_DIR}/richmenu_guest.jpg"
echo ""

# =============================================================================
# Step 4: Stage0 メニュー作成（1x1、postback でタグ計測）
# =============================================================================
echo "--- Step 4: Stage0 メニュー作成 ---"

STAGE0_BODY=$(cat <<EOF
{
  "size": {"width": 2500, "height": 843},
  "selected": true,
  "name": "PPAL_RichMenu_Stage0",
  "chatBarText": "講座にアクセス",
  "areas": [
    {
      "bounds": {"x": 0, "y": 0, "width": 2500, "height": 843},
      "action": {
        "type": "postback",
        "label": "講座にアクセス",
        "data": "action=rm_stage0_course",
        "displayText": "講座にアクセスする"
      }
    }
  ]
}
EOF
)

STAGE0_RESULT=$(api_post "/api/rich-menus" "$STAGE0_BODY")
STAGE0_ID=$(echo "$STAGE0_RESULT" | jq -r '.richMenuId // .id')
echo "  Stage0 Menu ID: ${STAGE0_ID}"
upload_image "$STAGE0_ID" "${IMAGE_DIR}/richmenu_stage0.jpg"
echo ""

# =============================================================================
# Step 5: Stage1 メニュー作成（2x1）
# =============================================================================
echo "--- Step 5: Stage1 メニュー作成 ---"

STAGE1_BODY=$(cat <<EOF
{
  "size": {"width": 2500, "height": 843},
  "selected": true,
  "name": "PPAL_RichMenu_Stage1",
  "chatBarText": "講座を続ける",
  "areas": [
    {
      "bounds": {"x": 0, "y": 0, "width": 1250, "height": 843},
      "action": {"type": "uri", "uri": "https://shuhayas-s-school.teachable.com/courses/enrolled/2925864", "label": "講座を続ける"}
    },
    {
      "bounds": {"x": 1250, "y": 0, "width": 1250, "height": 843},
      "action": {"type": "message", "label": "質問する", "text": "質問があります"}
    }
  ]
}
EOF
)

STAGE1_RESULT=$(api_post "/api/rich-menus" "$STAGE1_BODY")
STAGE1_ID=$(echo "$STAGE1_RESULT" | jq -r '.richMenuId // .id')
echo "  Stage1 Menu ID: ${STAGE1_ID}"
upload_image "$STAGE1_ID" "${IMAGE_DIR}/richmenu_stage1.jpg"
echo ""

# =============================================================================
# Step 6: Stage2 メニュー作成（3x2）
# =============================================================================
echo "--- Step 6: Stage2 メニュー作成 ---"

STAGE2_BODY=$(cat <<EOF
{
  "size": {"width": 2500, "height": 1686},
  "selected": true,
  "name": "PPAL_RichMenu_Stage2",
  "chatBarText": "メニューを開く",
  "areas": [
    {
      "bounds": {"x": 0, "y": 0, "width": 833, "height": 843},
      "action": {"type": "uri", "uri": "https://shuhayas-s-school.teachable.com/courses/enrolled/2925864", "label": "講座を見る"}
    },
    {
      "bounds": {"x": 833, "y": 0, "width": 834, "height": 843},
      "action": {"type": "uri", "uri": "https://discord.gg/ppal-lab", "label": "LIVE LAB"}
    },
    {
      "bounds": {"x": 1667, "y": 0, "width": 833, "height": 843},
      "action": {"type": "message", "label": "質問する", "text": "質問があります"}
    },
    {
      "bounds": {"x": 0, "y": 843, "width": 833, "height": 843},
      "action": {"type": "uri", "uri": "https://note.com/hayashi_ppal/n/weekly-mcp", "label": "週刊MCP"}
    },
    {
      "bounds": {"x": 833, "y": 843, "width": 834, "height": 843},
      "action": {"type": "uri", "uri": "https://github.com/ppal-lab/skill-library", "label": "SKILL.md"}
    },
    {
      "bounds": {"x": 1667, "y": 843, "width": 833, "height": 843},
      "action": {"type": "uri", "uri": "https://shuhayas-s-school.teachable.com/profile", "label": "プロフィール"}
    }
  ]
}
EOF
)

STAGE2_RESULT=$(api_post "/api/rich-menus" "$STAGE2_BODY")
STAGE2_ID=$(echo "$STAGE2_RESULT" | jq -r '.richMenuId // .id')
echo "  Stage2 Menu ID: ${STAGE2_ID}"
upload_image "$STAGE2_ID" "${IMAGE_DIR}/richmenu_stage2.jpg"
echo ""

# =============================================================================
# Step 7: Guest メニューをデフォルト設定
# =============================================================================
echo "--- Step 7: Guest メニューをデフォルト設定 ---"
api_post "/api/rich-menus/${GUEST_ID}/default" "{}" | jq -r '.status // "ok"'
echo ""

# =============================================================================
# Step 8: オートメーション作成（タグ → メニュー切替）
# =============================================================================
echo "--- Step 8: オートメーション作成 ---"

# 既存 PPAL オートメーション削除
echo "  既存 PPAL オートメーション削除..."
EXISTING_AUTOS=$(api_get "/api/automations" | jq -r '.[] | select(.name | startswith("PPAL_")) | .id' 2>/dev/null || echo "")
for auto_id in $EXISTING_AUTOS; do
  echo "  削除: ${auto_id}"
  api_delete "/api/automations/${auto_id}" | jq -r '.status // "deleted"'
done

# Automation 1: Onboarding:Started → Stage0 メニューに切替
echo "  作成: Onboarding:Started → Stage0"
AUTO1=$(api_post "/api/automations" "{
  \"name\": \"PPAL_GuestToStage0\",
  \"eventType\": \"tag_change\",
  \"conditions\": {\"tag_id\": \"${TAG_ONBOARDING_STARTED}\", \"tag_action\": \"add\"},
  \"actions\": [{\"type\": \"switch_rich_menu\", \"params\": {\"richMenuId\": \"${STAGE0_ID}\"}}],
  \"priority\": 10,
  \"is_active\": true
}")
echo "  ID: $(echo $AUTO1 | jq -r '.id')"

# Automation 2: Onboarding:Step0_Clicked → Stage1 メニューに切替
echo "  作成: Onboarding:Step0_Clicked → Stage1"
AUTO2=$(api_post "/api/automations" "{
  \"name\": \"PPAL_Stage0ToStage1\",
  \"eventType\": \"tag_change\",
  \"conditions\": {\"tag_id\": \"${TAG_STEP0_CLICKED}\", \"tag_action\": \"add\"},
  \"actions\": [{\"type\": \"switch_rich_menu\", \"params\": {\"richMenuId\": \"${STAGE1_ID}\"}}],
  \"priority\": 10,
  \"is_active\": true
}")
echo "  ID: $(echo $AUTO2 | jq -r '.id')"

# Automation 3: lesson_week1_complete → Stage2 メニューに切替
echo "  作成: lesson_week1_complete → Stage2"
AUTO3=$(api_post "/api/automations" "{
  \"name\": \"PPAL_Stage1ToStage2\",
  \"eventType\": \"tag_change\",
  \"conditions\": {\"tag_id\": \"${TAG_WEEK1_COMPLETE}\", \"tag_action\": \"add\"},
  \"actions\": [{\"type\": \"switch_rich_menu\", \"params\": {\"richMenuId\": \"${STAGE2_ID}\"}}],
  \"priority\": 10,
  \"is_active\": true
}")
echo "  ID: $(echo $AUTO3 | jq -r '.id')"
echo ""

# =============================================================================
# 完了サマリー
# =============================================================================
echo "============================================"
echo "✅ PPAL リッチメニュー v2 セットアップ完了"
echo "============================================"
echo ""
echo "メニュー ID:"
echo "  Guest  (DEFAULT): ${GUEST_ID}"
echo "  Stage0:           ${STAGE0_ID}"
echo "  Stage1:           ${STAGE1_ID}"
echo "  Stage2:           ${STAGE2_ID}"
echo ""
echo "タグ ID:"
echo "  Onboarding:Started:       ${TAG_ONBOARDING_STARTED}"
echo "  Onboarding:Step0_Clicked: ${TAG_STEP0_CLICKED}"
echo "  lesson_week1_complete:    ${TAG_WEEK1_COMPLETE}"
echo ""
echo "切替フロー:"
echo "  Guest → [Onboarding:Started タグ追加] → Stage0"
echo "  Stage0 → [講座ボタンタップ postback] → Onboarding:Step0_Clicked → Stage1"
echo "  Stage1 → [lesson_week1_complete タグ追加] → Stage2"
echo ""
echo "次の手動作業:"
echo "  T10: LINE Developers Console で Webhook URL を設定"
echo "       URL: ${BASE_URL}/webhook"
echo "  T13: アイン(テストユーザー)に Guest メニューが表示されることを確認"
echo "  T21: βユーザーに LINE 案内を送信"
