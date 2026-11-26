-- 067_mileage_keyword_auto_reply.sql
-- A single global auto-reply applies to every active LINE account. The Worker
-- replaces {{liff_id}} with the LIFF ID of the account that received the text.

INSERT INTO auto_replies
  (id, keyword, match_type, response_type, response_content,
   template_id, line_account_id, is_active, created_at)
SELECT
  'builtin-mileage-wallet-keyword',
  'マイル',
  'exact',
  'flex',
  '{"type":"bubble","size":"kilo","body":{"type":"box","layout":"vertical","paddingAll":"20px","contents":[{"type":"text","text":"あなたのHarnessマイル","weight":"bold","size":"lg","color":"#1e293b"},{"type":"text","text":"現在のマイル、獲得履歴、登録済みアカウント、次にマイルを獲得できる行動を確認できます。","wrap":true,"size":"sm","color":"#64748b","margin":"md"}]},"footer":{"type":"box","layout":"vertical","paddingAll":"16px","contents":[{"type":"button","style":"primary","color":"#06C755","height":"sm","action":{"type":"uri","label":"マイルを確認する","uri":"https://liff.line.me/{{liff_id}}/?page=affiliate&liffId={{liff_id}}"}}]}}',
  NULL,
  NULL,
  1,
  '2026-08-11T00:00:00.000+09:00'
WHERE NOT EXISTS (
  SELECT 1 FROM auto_replies WHERE id = 'builtin-mileage-wallet-keyword'
);
