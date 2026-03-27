-- スポットほいく向けFAQ自動応答ルール
-- 未解決の問い合わせのみオペレーター（Shota）にエスカレーション

-- 給与・振込に関する質問
INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, created_at)
VALUES (
  'faq-salary-01',
  '給料',
  'contains',
  'text',
  '💰 報酬のお支払いについて\n\n勤務完了後、翌月末にお振込みいたします。\n振込先はマイページからご確認・変更いただけます。\n\nその他ご不明点がございましたら、お気軽にメッセージをお送りください。担当者が確認次第ご返信いたします。',
  1,
  datetime('now')
);

INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, created_at)
VALUES (
  'faq-salary-02',
  '給与',
  'contains',
  'text',
  '💰 報酬のお支払いについて\n\n勤務完了後、翌月末にお振込みいたします。\n振込先はマイページからご確認・変更いただけます。\n\nその他ご不明点がございましたら、お気軽にメッセージをお送りください。担当者が確認次第ご返信いたします。',
  1,
  datetime('now')
);

INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, created_at)
VALUES (
  'faq-salary-03',
  '振込',
  'contains',
  'text',
  '💰 報酬のお支払いについて\n\n勤務完了後、翌月末にお振込みいたします。\n振込先はマイページからご確認・変更いただけます。\n\nその他ご不明点がございましたら、お気軽にメッセージをお送りください。担当者が確認次第ご返信いたします。',
  1,
  datetime('now')
);

-- キャンセルに関する質問
INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, created_at)
VALUES (
  'faq-cancel-01',
  'キャンセル',
  'contains',
  'text',
  '📋 キャンセルについて\n\nキャンセルはマイページの「予定のお仕事」から手続きできます。\n\n⚠️ 前日・当日のキャンセルは園にご迷惑がかかるため、やむを得ない場合を除きお控えください。キャンセル回数が多い場合、今後の応募に影響する場合がございます。\n\nどうしても出勤が難しい場合は、お早めにこちらにメッセージをお送りください。',
  1,
  datetime('now')
);

-- 持ち物・服装に関する質問
INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, created_at)
VALUES (
  'faq-items-01',
  '持ち物',
  'contains',
  'text',
  '🎒 基本の持ち物\n\n・筆記具\n・動きやすい服装\n・上履き（室内履き）\n・エプロン\n・水筒\n\n※園によって異なる場合があります。承認メッセージに記載がある場合はそちらをご確認ください。\n※2回目以降の勤務では不要なものもあります。',
  1,
  datetime('now')
);

INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, created_at)
VALUES (
  'faq-items-02',
  '服装',
  'contains',
  'text',
  '👕 服装について\n\n動きやすい服装でお越しください。ジーンズ・スニーカーOKです。\n\n避けていただきたい服装：\n・フード付きの服（子どもに引っ張られる危険）\n・アクセサリー類\n・ネイル・つけ爪\n・派手な柄・色\n\n詳しくは園ごとの案内をご確認ください。',
  1,
  datetime('now')
);

-- 遅刻・体調不良に関する質問
INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, created_at)
VALUES (
  'faq-late-01',
  '遅刻',
  'contains',
  'text',
  '⏰ 遅刻・遅れる場合\n\n遅刻の可能性がある場合は、できるだけ早く以下にご連絡ください：\n\n1. まずこのLINEにメッセージを送ってください\n2. 担当者から園に連絡いたします\n\n交通機関の遅延など、やむを得ない遅刻については遅延証明書をお持ちください。',
  1,
  datetime('now')
);

INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, created_at)
VALUES (
  'faq-late-02',
  '遅れ',
  'contains',
  'text',
  '⏰ 遅刻・遅れる場合\n\n遅刻の可能性がある場合は、できるだけ早く以下にご連絡ください：\n\n1. まずこのLINEにメッセージを送ってください\n2. 担当者から園に連絡いたします\n\n交通機関の遅延など、やむを得ない遅刻については遅延証明書をお持ちください。',
  1,
  datetime('now')
);

INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, created_at)
VALUES (
  'faq-sick-01',
  '体調',
  'contains',
  'text',
  '🏥 体調不良の場合\n\n体調がすぐれない場合は、無理をせず早めにご連絡ください。\n\nこのLINEにメッセージを送っていただければ、担当者が園への連絡を行います。\n\n※当日の体調不良による欠勤は、信用スコアへの影響はありません。',
  1,
  datetime('now')
);

-- 資格に関する質問
INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, created_at)
VALUES (
  'faq-qual-01',
  '資格',
  'contains',
  'text',
  '📝 資格について\n\n以下の資格をお持ちの方がご応募いただけます：\n・保育士\n・看護師\n・子育て支援員\n\n資格証のアップロードはマイページの「プロフィール」から行えます。\n\n無資格の方でも応募可能な求人もございますので、お仕事一覧をご確認ください。',
  1,
  datetime('now')
);

-- 交通費に関する質問
INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, created_at)
VALUES (
  'faq-transport-01',
  '交通費',
  'contains',
  'text',
  '🚃 交通費について\n\n交通費は園ごとに異なります。求人詳細に記載がありますのでご確認ください。\n\n一般的には実費支給（上限あり）の園が多いです。\n詳細は各求人の情報をご確認いただくか、こちらにお問い合わせください。',
  1,
  datetime('now')
);

-- 使い方・操作に関する質問
INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, created_at)
VALUES (
  'faq-howto-01',
  '使い方',
  'contains',
  'text',
  '📱 スポットほいくの使い方\n\n1️⃣ リッチメニューの「お仕事を探す」をタップ\n2️⃣ 気になる求人を選んで応募\n3️⃣ 承認されたらLINEに通知が届きます\n4️⃣ 当日はQRコードで出退勤\n5️⃣ 勤務後にレビューを送信\n\nマイページから応募履歴や報酬の確認ができます。',
  1,
  datetime('now')
);
