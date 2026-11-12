-- 2026年度 第3回 実用英語技能検定（英検） 申込導線
-- 対象LINEアカウント: あいことば｜教室とおうちのホームルーム
-- 元資料: Eiken_Notice_2026_3.docx（一次 2027/1/23(土)・申込 12/4(金)締切・引き落とし 12/15(火)）
--
-- 導線:
--   ① 案内のQR → /r/eiken-2026-3 で友だち追加 → タグ「英検2026第3回｜流入」＋ シナリオで級を聞く
--      （すでに友だちの方は「英検申込」と送ると同じ案内が届く）
--   ② 「5級」「4級」「3級」「準2級」「2級」のいずれかを送る
--      → 自動応答（silent）＋ オートメーションで級タグ・プロフィール記録・級別の申込ページを送信
--   ③ 申込ページ（LIFF予約）でプロフィールを入力して申込 → 教室が確認して確定（承認制）
--
-- 再実行可（固定ID・ON CONFLICT）。本番反映前にテスト用の値がないか確認すること。
-- 締切（12/4）で自動的に閉じる機能はないため、12/5 に events.is_published = 0 にする。

-- ───────────────────────── タグ
INSERT INTO tags (id, name, color) VALUES
  ('9fcad10e-5bdf-407a-9b2c-cebc39ffbbd4', '英検2026第3回｜流入', '#2563EB'),
  ('1dfc22ef-500a-40fd-afea-f559c6d003ab', '英検2026第3回｜5級', '#0EA5E9'),
  ('19c8e5f5-70fa-4db7-8543-ee75c468bba7', '英検2026第3回｜4級', '#0EA5E9'),
  ('67ac89e8-148d-4c3f-9470-759c925ee6aa', '英検2026第3回｜3級', '#0EA5E9'),
  ('9b1882b2-3106-4f0b-a4c9-94fb100fc8a7', '英検2026第3回｜準2級', '#0EA5E9'),
  ('ad727121-3722-4b86-a147-6c53f0109e28', '英検2026第3回｜2級', '#0EA5E9')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color;

-- ───────────────────────── 流入シナリオ（流入リンク経由の友だち追加だけで開始）
INSERT INTO scenarios (id, name, description, trigger_type, trigger_tag_id, is_active, delivery_mode, line_account_id)
VALUES (
  '8970e806-27ed-4ab1-938b-cdc797893c92',
  '英検2026第3回｜流入あいさつ',
  '案内のQR（/r/eiken-2026-3）から友だち追加した方へ、日程と級の選び方を送ります。',
  'manual', NULL, 1, 'relative', '0797696f-e377-4132-bb17-77bc1db29b0a'
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name, description = excluded.description, trigger_type = excluded.trigger_type,
  trigger_tag_id = excluded.trigger_tag_id, is_active = excluded.is_active,
  delivery_mode = excluded.delivery_mode, line_account_id = excluded.line_account_id,
  updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours');

INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content)
VALUES (
  'e2b36bb1-6f05-4b98-b084-1fe21cc7d7e3',
  '8970e806-27ed-4ab1-938b-cdc797893c92',
  1, 0, 'text',
  '友だち追加ありがとうございます。
2026年度 第3回 実用英語技能検定（英検®）のお申し込みをご案内します。

【一次試験】2027年1月23日（土）
【二次試験】3月7日（日）
【会場】ECCジュニア・ベストワン北島中央校
【申込締切】12月4日（金）まで（期日厳守）

受験を希望する級を、次のいずれか1つだけそのままお送りください。級ごとの試験時間・検定料と、お申し込みページをご案内します。

5級
4級
3級
準2級
2級

※ごきょうだいで受験される場合は、それぞれの級をお送りください。'
)
ON CONFLICT(id) DO UPDATE SET
  scenario_id = excluded.scenario_id, step_order = excluded.step_order, delay_minutes = excluded.delay_minutes,
  message_type = excluded.message_type, message_content = excluded.message_content;

-- ───────────────────────── 流入リンク
-- URL: https://ecc-tokushima-harness.kikuchi-mkt.workers.dev/r/eiken-2026-3
-- アカウント標準の友だち追加あいさつは走らせない（案内が二重になるため）。
INSERT INTO entry_routes (id, ref_code, name, tag_id, scenario_id, redirect_url, is_active, pool_id, intro_template_id, run_account_friend_add_scenarios)
SELECT '1e8d7fcc-eeeb-489d-8a76-b83c031de404', 'eiken-2026-3', '英検2026第3回｜申込案内（紙・QR）',
       '9fcad10e-5bdf-407a-9b2c-cebc39ffbbd4', '8970e806-27ed-4ab1-938b-cdc797893c92', NULL, 1,
       pool_id, NULL, 0
FROM entry_routes WHERE ref_code = 'preschool-autumn-2026'
ON CONFLICT(id) DO UPDATE SET
  ref_code = excluded.ref_code, name = excluded.name, tag_id = excluded.tag_id, scenario_id = excluded.scenario_id,
  redirect_url = excluded.redirect_url, is_active = excluded.is_active, pool_id = excluded.pool_id,
  intro_template_id = excluded.intro_template_id,
  run_account_friend_add_scenarios = excluded.run_account_friend_add_scenarios, updated_at = datetime('now');

-- ───────────────────────── 級別の申込ページ（LIFF予約、各級1枠・定員10・承認制）
-- 予約フォーム = プロフィール入力。教室が対策受講生を優先して確定する。
INSERT INTO events (
  id, line_account_id, name, venue_name, description, description_centered,
  max_bookings_per_friend, requires_approval, waitlist_enabled, cancel_deadline_hours_before,
  reminder_day_before_enabled, reminder_hours_before, is_published, sort_order, target_type,
  booking_form_fields, confirmation_message_extra
)
SELECT v.id, '0797696f-e377-4132-bb17-77bc1db29b0a', v.name, 'ECCジュニア・ベストワン北島中央校',
  v.description || '

【会場】ECCジュニア・ベストワン北島中央校
北島町江尻字松ノ本17-2 ライト北島A（TEL：088-679-4646）

【二次試験】3月7日（日）（3級以上で一次試験に合格した方）
【結果発表】一次：2月15日（月）／二次：3月16日（火）

【お申し込み】12月4日（金）まで（期日厳守）
【お支払い】12月15日（火）に、検定料と事務手数料100円を合わせた金額を口座から引き落とします。

※試験時間はあらかじめ指定されています。10〜15分前後して始まる場合があり、詳しい時間はあらためてお知らせします。
※各級の定員は10名程度です。当校で英検対策を受講している生徒を優先し、その後は先着順とします。お申し込み後、教室で確認してから確定のご連絡をします。
※一次試験免除で二次試験のみを受験される方も、検定料は同額です。

【個人情報の取り扱い】
ご入力いただいた情報は、英検の申込手続き・当日の運営・結果のお知らせに利用します。あわせて、当校の英検対策講座や講習などのご案内をお送りすることがあります。',
  0, NULL, 1, 0, NULL, 1, 24, 1, v.sort_order, 'single',
  '[{"id":"student_name","label":"受験者氏名","type":"text","required":true,"placeholder":"例：山田 花子"},{"id":"phone","label":"電話番号","type":"text","required":true,"placeholder":"例：090-1234-5678"},{"id":"school_name","label":"学校名","type":"text","required":true,"placeholder":"例：北島中学校"},{"id":"grade","label":"学年","type":"select","required":true,"options":["小学1年生","小学2年生","小学3年生","小学4年生","小学5年生","小学6年生","中学1年生","中学2年生","中学3年生","高校1年生","高校2年生","高校3年生","その他"]},{"id":"enrolled_class","label":"在籍教室（当グループに在籍している場合）","type":"select","required":true,"options":["在籍していない","ECCベストワン藍住校","ECCベストワン北島中央校","ECCジュニア藍住教室","ECCジュニア北島中央教室","ECCジュニア大学前教室","ECCジュニア板野駅前教室"]},{"id":"note","label":"教室へ伝えておきたいこと","type":"textarea","required":false,"placeholder":"一次試験免除の方など、必要があればご記入ください"}]',
  'お申し込みありがとうございます。教室で内容を確認し、確定のご連絡をします。検定料は12月15日（火）に、事務手数料100円を合わせてお引き落としします。取り消しや変更は、このトークへご連絡ください。'
FROM (
  SELECT 'eiken-2026-r3-5kyu' AS id, '英検2026第3回｜5級 申込' AS name, 1 AS sort_order,
         '2026年度 第3回 英検 5級のお申し込みページです。

【一次試験】2027年1月23日（土）11:20〜12:10（50分）
【検定料】2,400円（税込）' AS description
  UNION ALL SELECT 'eiken-2026-r3-4kyu', '英検2026第3回｜4級 申込', 2,
         '2026年度 第3回 英検 4級のお申し込みページです。

【一次試験】2027年1月23日（土）13:00〜14:10（70分）
【検定料】2,800円（税込）'
  UNION ALL SELECT 'eiken-2026-r3-3kyu', '英検2026第3回｜3級 申込', 3,
         '2026年度 第3回 英検 3級のお申し込みページです。

【一次試験】2027年1月23日（土）14:40〜16:10（90分）
【検定料】4,900円（税込）
※3級以上は、顔写真付きの身分証明書（原本）が必要です。'
  UNION ALL SELECT 'eiken-2026-r3-p2kyu', '英検2026第3回｜準2級 申込', 4,
         '2026年度 第3回 英検 準2級のお申し込みページです。

【一次試験】2027年1月23日（土）17:00〜18:45（105分）
【検定料】6,000円（税込）
※3級以上は、顔写真付きの身分証明書（原本）が必要です。'
  UNION ALL SELECT 'eiken-2026-r3-2kyu', '英検2026第3回｜2級 申込', 5,
         '2026年度 第3回 英検 2級のお申し込みページです。

【一次試験】2027年1月23日（土）19:15〜21:05（110分）
【検定料】6,800円（税込）
※3級以上は、顔写真付きの身分証明書（原本）が必要です。'
) AS v
WHERE true
ON CONFLICT(id) DO UPDATE SET
  line_account_id = excluded.line_account_id, name = excluded.name, venue_name = excluded.venue_name,
  description = excluded.description, description_centered = excluded.description_centered,
  max_bookings_per_friend = excluded.max_bookings_per_friend, requires_approval = excluded.requires_approval,
  waitlist_enabled = excluded.waitlist_enabled, cancel_deadline_hours_before = excluded.cancel_deadline_hours_before,
  reminder_day_before_enabled = excluded.reminder_day_before_enabled, reminder_hours_before = excluded.reminder_hours_before,
  is_published = excluded.is_published, sort_order = excluded.sort_order, target_type = excluded.target_type,
  booking_form_fields = excluded.booking_form_fields, confirmation_message_extra = excluded.confirmation_message_extra,
  deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours');

-- 試験時間（JST → UTC で保存）
INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity, is_active, sort_order) VALUES
  ('eiken-2026-r3-5kyu-0123',  'eiken-2026-r3-5kyu',  '2027-01-23T02:20:00.000Z', '2027-01-23T03:10:00.000Z', 10, 1, 1),
  ('eiken-2026-r3-4kyu-0123',  'eiken-2026-r3-4kyu',  '2027-01-23T04:00:00.000Z', '2027-01-23T05:10:00.000Z', 10, 1, 1),
  ('eiken-2026-r3-3kyu-0123',  'eiken-2026-r3-3kyu',  '2027-01-23T05:40:00.000Z', '2027-01-23T07:10:00.000Z', 10, 1, 1),
  ('eiken-2026-r3-p2kyu-0123', 'eiken-2026-r3-p2kyu', '2027-01-23T08:00:00.000Z', '2027-01-23T09:45:00.000Z', 10, 1, 1),
  ('eiken-2026-r3-2kyu-0123',  'eiken-2026-r3-2kyu',  '2027-01-23T10:15:00.000Z', '2027-01-23T12:05:00.000Z', 10, 1, 1)
ON CONFLICT(id) DO UPDATE SET
  event_id = excluded.event_id, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
  capacity = excluded.capacity, is_active = excluded.is_active, sort_order = excluded.sort_order,
  deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours');

-- ───────────────────────── 合言葉 → オートメーション（タグ・プロフィール記録・案内送信）
INSERT INTO automations (id, name, description, event_type, conditions, actions, is_active, priority, line_account_id) VALUES
  ('546d6fdf-fd89-4d14-8c7c-88a376dae27d', '英検2026第3回｜「英検申込」→案内',
   'すでに友だちの方が「英検申込」と送ったとき、流入タグを付けて日程と級の選び方を送ります。',
   'message_received', '{"keyword_exact":"英検申込"}',
   '[{"type":"add_tag","params":{"tagId":"9fcad10e-5bdf-407a-9b2c-cebc39ffbbd4"}},{"type":"send_message","params":{"messageType":"text","content":"2026年度 第3回 実用英語技能検定（英検®）のご案内です。\n\n【一次試験】2027年1月23日（土）\n【二次試験】3月7日（日）\n【会場】ECCジュニア・ベストワン北島中央校\n【申込締切】12月4日（金）まで（期日厳守）\n\n受験を希望する級を、次のいずれか1つだけそのままお送りください。級ごとの試験時間・検定料と、お申し込みページをご案内します。\n\n5級\n4級\n3級\n準2級\n2級\n\n※ごきょうだいで受験される場合は、それぞれの級をお送りください。"}}]',
   1, 100, '0797696f-e377-4132-bb17-77bc1db29b0a'),
  ('96542795-8434-49f0-b676-323d68b762ad', '英検2026第3回｜5級回答→申込案内',
   '5級と回答した方に、級タグとプロフィールを記録し、5級の申込ページを送ります。',
   'message_received', '{"keyword_exact":"5級"}',
   '[{"type":"add_tag","params":{"tagId":"9fcad10e-5bdf-407a-9b2c-cebc39ffbbd4"}},{"type":"add_tag","params":{"tagId":"1dfc22ef-500a-40fd-afea-f559c6d003ab"}},{"type":"set_metadata","params":{"data":"{\"eiken_2026_3_grade\":\"5級\"}"}},{"type":"send_message","params":{"messageType":"text","content":"5級ですね。ありがとうございます。\n\n【一次試験】2027年1月23日（土）11:20〜12:10（50分）\n【検定料】2,400円（税込）＋事務手数料100円\n【会場】ECCジュニア・ベストワン北島中央校\n\n次のページで、受験者のプロフィールを入力してお申し込みください（12月4日（金）まで）。\n\n▼5級 お申し込み\nhttps://liff.line.me/2010714049-6L0KFjN7/?page=event&id=eiken-2026-r3-5kyu\n\n各級の定員は10名程度です。教室で確認してから確定のご連絡をします。"}}]',
   1, 100, '0797696f-e377-4132-bb17-77bc1db29b0a'),
  ('eb1bb6dc-b128-4aec-a593-d2bc1cc05984', '英検2026第3回｜4級回答→申込案内',
   '4級と回答した方に、級タグとプロフィールを記録し、4級の申込ページを送ります。',
   'message_received', '{"keyword_exact":"4級"}',
   '[{"type":"add_tag","params":{"tagId":"9fcad10e-5bdf-407a-9b2c-cebc39ffbbd4"}},{"type":"add_tag","params":{"tagId":"19c8e5f5-70fa-4db7-8543-ee75c468bba7"}},{"type":"set_metadata","params":{"data":"{\"eiken_2026_3_grade\":\"4級\"}"}},{"type":"send_message","params":{"messageType":"text","content":"4級ですね。ありがとうございます。\n\n【一次試験】2027年1月23日（土）13:00〜14:10（70分）\n【検定料】2,800円（税込）＋事務手数料100円\n【会場】ECCジュニア・ベストワン北島中央校\n\n次のページで、受験者のプロフィールを入力してお申し込みください（12月4日（金）まで）。\n\n▼4級 お申し込み\nhttps://liff.line.me/2010714049-6L0KFjN7/?page=event&id=eiken-2026-r3-4kyu\n\n各級の定員は10名程度です。教室で確認してから確定のご連絡をします。"}}]',
   1, 100, '0797696f-e377-4132-bb17-77bc1db29b0a'),
  ('c6ee79eb-6d89-456e-a189-ff05c9c9aeca', '英検2026第3回｜3級回答→申込案内',
   '3級と回答した方に、級タグとプロフィールを記録し、3級の申込ページを送ります。',
   'message_received', '{"keyword_exact":"3級"}',
   '[{"type":"add_tag","params":{"tagId":"9fcad10e-5bdf-407a-9b2c-cebc39ffbbd4"}},{"type":"add_tag","params":{"tagId":"67ac89e8-148d-4c3f-9470-759c925ee6aa"}},{"type":"set_metadata","params":{"data":"{\"eiken_2026_3_grade\":\"3級\"}"}},{"type":"send_message","params":{"messageType":"text","content":"3級ですね。ありがとうございます。\n\n【一次試験】2027年1月23日（土）14:40〜16:10（90分）\n【二次試験】3月7日（日）\n【検定料】4,900円（税込）＋事務手数料100円\n【会場】ECCジュニア・ベストワン北島中央校\n※3級以上は、顔写真付きの身分証明書（原本）が必要です。\n\n次のページで、受験者のプロフィールを入力してお申し込みください（12月4日（金）まで）。\n\n▼3級 お申し込み\nhttps://liff.line.me/2010714049-6L0KFjN7/?page=event&id=eiken-2026-r3-3kyu\n\n各級の定員は10名程度です。教室で確認してから確定のご連絡をします。"}}]',
   1, 100, '0797696f-e377-4132-bb17-77bc1db29b0a'),
  ('fc15ceff-1511-4d5e-88a3-b324ddf80d40', '英検2026第3回｜準2級回答→申込案内',
   '準2級と回答した方に、級タグとプロフィールを記録し、準2級の申込ページを送ります。',
   'message_received', '{"keyword_exact":"準2級"}',
   '[{"type":"add_tag","params":{"tagId":"9fcad10e-5bdf-407a-9b2c-cebc39ffbbd4"}},{"type":"add_tag","params":{"tagId":"9b1882b2-3106-4f0b-a4c9-94fb100fc8a7"}},{"type":"set_metadata","params":{"data":"{\"eiken_2026_3_grade\":\"準2級\"}"}},{"type":"send_message","params":{"messageType":"text","content":"準2級ですね。ありがとうございます。\n\n【一次試験】2027年1月23日（土）17:00〜18:45（105分）\n【二次試験】3月7日（日）\n【検定料】6,000円（税込）＋事務手数料100円\n【会場】ECCジュニア・ベストワン北島中央校\n※3級以上は、顔写真付きの身分証明書（原本）が必要です。\n\n次のページで、受験者のプロフィールを入力してお申し込みください（12月4日（金）まで）。\n\n▼準2級 お申し込み\nhttps://liff.line.me/2010714049-6L0KFjN7/?page=event&id=eiken-2026-r3-p2kyu\n\n各級の定員は10名程度です。教室で確認してから確定のご連絡をします。"}}]',
   1, 100, '0797696f-e377-4132-bb17-77bc1db29b0a'),
  ('7af9a1c6-eb2f-490f-91d1-6b39dcf3b71d', '英検2026第3回｜2級回答→申込案内',
   '2級と回答した方に、級タグとプロフィールを記録し、2級の申込ページを送ります。',
   'message_received', '{"keyword_exact":"2級"}',
   '[{"type":"add_tag","params":{"tagId":"9fcad10e-5bdf-407a-9b2c-cebc39ffbbd4"}},{"type":"add_tag","params":{"tagId":"ad727121-3722-4b86-a147-6c53f0109e28"}},{"type":"set_metadata","params":{"data":"{\"eiken_2026_3_grade\":\"2級\"}"}},{"type":"send_message","params":{"messageType":"text","content":"2級ですね。ありがとうございます。\n\n【一次試験】2027年1月23日（土）19:15〜21:05（110分）\n【二次試験】3月7日（日）\n【検定料】6,800円（税込）＋事務手数料100円\n【会場】ECCジュニア・ベストワン北島中央校\n※3級以上は、顔写真付きの身分証明書（原本）が必要です。\n\n次のページで、受験者のプロフィールを入力してお申し込みください（12月4日（金）まで）。\n\n▼2級 お申し込み\nhttps://liff.line.me/2010714049-6L0KFjN7/?page=event&id=eiken-2026-r3-2kyu\n\n各級の定員は10名程度です。教室で確認してから確定のご連絡をします。"}}]',
   1, 100, '0797696f-e377-4132-bb17-77bc1db29b0a')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name, description = excluded.description, event_type = excluded.event_type,
  conditions = excluded.conditions, actions = excluded.actions, is_active = excluded.is_active,
  priority = excluded.priority, line_account_id = excluded.line_account_id,
  updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours');

-- ───────────────────────── 自動応答
-- 合言葉は silent（返信はオートメーション側）。チャットを未対応にしない。
-- そのほか、よくある質問を合言葉で返す。
INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, template_id, line_account_id, is_active) VALUES
  ('b02e9a04-2433-4107-9e48-e28a6ce9c900', '英検申込', 'exact', 'silent', '', NULL, '0797696f-e377-4132-bb17-77bc1db29b0a', 1),
  ('2416f4e3-0f4e-401a-a0e9-f9c060ac648e', '5級', 'exact', 'silent', '', NULL, '0797696f-e377-4132-bb17-77bc1db29b0a', 1),
  ('0342aa50-fe7d-46f6-baaa-6bbd65ab0012', '4級', 'exact', 'silent', '', NULL, '0797696f-e377-4132-bb17-77bc1db29b0a', 1),
  ('56b96824-b0f0-48e2-91b5-ed858d4627d9', '3級', 'exact', 'silent', '', NULL, '0797696f-e377-4132-bb17-77bc1db29b0a', 1),
  ('5aae4be1-4ce6-48f0-88d9-31aa9c6e3efd', '準2級', 'exact', 'silent', '', NULL, '0797696f-e377-4132-bb17-77bc1db29b0a', 1),
  ('dd22ba96-7b55-4e6f-8eb4-34d8598d179c', '2級', 'exact', 'silent', '', NULL, '0797696f-e377-4132-bb17-77bc1db29b0a', 1),
  ('5e5915e9-a622-4d94-aff4-51c4ad5c88ab', '英検日程', 'exact', 'text', '2026年度 第3回 英検の日程です。

【一次試験】2027年1月23日（土）
5級　11:20〜12:10
4級　13:00〜14:10
3級　14:40〜16:10
準2級　17:00〜18:45
2級　19:15〜21:05
※10〜15分前後して始まる場合があります。詳しい時間はあらためてお知らせします。

【二次試験】3月7日（日）
【結果発表】一次：2月15日（月）／二次：3月16日（火）
【会場】ECCジュニア・ベストワン北島中央校
【申込締切】12月4日（金）

お申し込みは、受験する級（例：3級）をこのトークへお送りください。', NULL, '0797696f-e377-4132-bb17-77bc1db29b0a', 1),
  ('5e92b82e-af95-4105-b225-013452f24d35', '英検料金', 'exact', 'text', '2026年度 第3回 英検の検定料（税込）です。

2級　6,800円
準2級　6,000円
3級　4,900円
4級　2,800円
5級　2,400円

12月15日（火）に、検定料と事務手数料100円を合わせた金額を口座から引き落とします。
一次試験免除で二次試験のみを受験される方も、検定料は同額です。', NULL, '0797696f-e377-4132-bb17-77bc1db29b0a', 1),
  ('91d80313-35e2-497e-ad65-d8277c88e0b5', '英検申込確認', 'exact', 'text', 'お申し込み内容はこちらから確認できます。

▼申込履歴
https://liff.line.me/2010714049-6L0KFjN7/?page=event-me

「承認待ち」は教室で確認中です。確定したらこのトークでお知らせします。取り消しや変更は、このトークへご連絡ください。', NULL, '0797696f-e377-4132-bb17-77bc1db29b0a', 1)
ON CONFLICT(id) DO UPDATE SET
  keyword = excluded.keyword, match_type = excluded.match_type, response_type = excluded.response_type,
  response_content = excluded.response_content, template_id = excluded.template_id,
  line_account_id = excluded.line_account_id, is_active = excluded.is_active;
