-- 046_ai_reply_mode.sql
-- friends に AI自動応答のモード列を追加。auto_replies にマッチせずLLM応答を
-- 使う際、人間オペレーターが引き継いだ会話でAIが割り込まないようにするフラグ。
-- 'bot'（既定）= AI応答対象。'human'= オペレーター対応中、AI応答を停止。

ALTER TABLE friends ADD COLUMN ai_reply_mode TEXT NOT NULL DEFAULT 'bot';
