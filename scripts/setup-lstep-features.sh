#!/bin/bash
# L-step移行: ステップ配信 + テンプレメッセージの初期セットアップ
# テスト環境用
API_URL="https://line-crm-worker.spothoiku-test.workers.dev"
API_KEY="spothoiku-test-2026"

echo "=== 1. ステップ配信シナリオ登録（友だち追加後3通フォロー） ==="

# シナリオ作成
SCENARIO_ID=$(curl -s -X POST "$API_URL/api/scenarios" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "アンケート未回答ユーザーへのステップ配信",
    "triggerType": "friend_add",
    "isActive": true
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

echo "Scenario ID: $SCENARIO_ID"

# ステップ1: 即座（delay=0） — 友だち追加直後
curl -s -X POST "$API_URL/api/scenarios/$SCENARIO_ID/steps" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "stepOrder": 1,
    "delayMinutes": 0,
    "messageType": "text",
    "messageContent": "{{name}}さん、ご登録ありがとうございます！\n\nスポットほいくは、保育士さんが好きな日時に保育園で働けるスポットワークサービスです。\n\nまずは下のメニューから「お仕事を探す」をタップして、お近くの求人をチェックしてみてください。"
  }' | python3 -c "import sys,json; print('Step 1:', json.load(sys.stdin).get('data',{}).get('id','error'))"

# ステップ2: 3日後 07:00
curl -s -X POST "$API_URL/api/scenarios/$SCENARIO_ID/steps" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "stepOrder": 2,
    "delayMinutes": 4320,
    "messageType": "text",
    "messageContent": "{{name}}さん、おはようございます。スポットほいくです。\n\nご登録いただきありがとうございます。もうお仕事はチェックされましたか？\n\n新しい求人が続々と追加されています。気になる園があればお気軽にご応募ください。\n\n▼お仕事を探す\n下のメニューからどうぞ！"
  }' | python3 -c "import sys,json; print('Step 2:', json.load(sys.stdin).get('data',{}).get('id','error'))"

# ステップ3: 5日後 07:00
curl -s -X POST "$API_URL/api/scenarios/$SCENARIO_ID/steps" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "stepOrder": 3,
    "delayMinutes": 7200,
    "messageType": "text",
    "messageContent": "{{name}}さん、おはようございます。スポットほいくです。\n\nお仕事情報は定期的にお届けしています。\n\n「この園気になるかも！」と思ったら、まずは1日だけのお試し勤務からでもOKです。\n\nご不明点があれば、このLINEからお気軽にメッセージください。"
  }' | python3 -c "import sys,json; print('Step 3:', json.load(sys.stdin).get('data',{}).get('id','error'))"

echo ""
echo "=== 2. テンプレメッセージ登録（園別定型文6種） ==="

# 持ち物案内
curl -s -X POST "$API_URL/api/templates" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "園内アナウンス通知（持ち物）",
    "category": "園通知",
    "messageType": "text",
    "messageContent": "【お持ち物】\n上記は目安です。当園で2回目以降の勤務では不要です。\n・筆記具\n・動きやすい服装\n・上履き\n・エプロン\n\n※持ち物はメッセージに記載されます。ご不明な点があればメッセージでお知らせください。"
  }' | python3 -c "import sys,json; print('Template 1:', json.load(sys.stdin).get('data',{}).get('id','error'))"

# 日時確認メッセージ
curl -s -X POST "$API_URL/api/templates" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "確認メッセージ（日時確認）",
    "category": "園通知",
    "messageType": "text",
    "messageContent": "{{name}}さん、当日の勤務日時を改めてご確認ください。\n\nご都合が悪くなった場合は、お早めにこちらのLINEからご連絡をお願いいたします。"
  }' | python3 -c "import sys,json; print('Template 2:', json.load(sys.stdin).get('data',{}).get('id','error'))"

# 確定決定通知
curl -s -X POST "$API_URL/api/templates" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "確定決定通知",
    "category": "園通知",
    "messageType": "text",
    "messageContent": "{{name}}さん、ご応募ありがとうございます！\n\n勤務が確定いたしました。当日はよろしくお願いいたします。\n\n前日にリマインドをお送りしますので、お待ちください。"
  }' | python3 -c "import sys,json; print('Template 3:', json.load(sys.stdin).get('data',{}).get('id','error'))"

# 勤務レビュー依頼
curl -s -X POST "$API_URL/api/templates" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "勤務レビュー記入依頼",
    "category": "アフター",
    "messageType": "text",
    "messageContent": "{{name}}さん、お疲れさまでした！\n\n今回の勤務はいかがでしたか？\n\n今後の改善のため、簡単なレビューにご協力いただけると嬉しいです。\n\n※2-3分で完了します"
  }' | python3 -c "import sys,json; print('Template 4:', json.load(sys.stdin).get('data',{}).get('id','error'))"

# 差し戻し通知
curl -s -X POST "$API_URL/api/templates" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "差し戻し通知",
    "category": "園通知",
    "messageType": "text",
    "messageContent": "{{name}}さん、ご応募いただきありがとうございます。\n\n大変申し訳ございませんが、今回の求人については定員に達したため、ご希望に添えない結果となりました。\n\nまた別の日程やお仕事でお会いできることを楽しみにしております。\n引き続き、スポットほいくをよろしくお願いいたします。"
  }' | python3 -c "import sys,json; print('Template 5:', json.load(sys.stdin).get('data',{}).get('id','error'))"

# 応募発生通知（管理者向け）
curl -s -X POST "$API_URL/api/templates" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "応募発生メッセージ（管理者通知）",
    "category": "管理",
    "messageType": "text",
    "messageContent": "【応募発生】\n{{name}}さんから応募がありました。\n\n管理画面の「承認」タブから確認・承認をお願いします。"
  }' | python3 -c "import sys,json; print('Template 6:', json.load(sys.stdin).get('data',{}).get('id','error'))"

echo ""
echo "=== セットアップ完了 ==="
echo "ステップ配信: 友だち追加後 → 即時/3日後/5日後 の3通"
echo "テンプレート: 園通知4種 + アフター1種 + 管理1種 = 6種"
