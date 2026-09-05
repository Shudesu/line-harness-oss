-- 055: Webinar CTA cards (チャット欄に流れる CTA + インラインフォーム)
--
-- ウェビナーの指定秒数でチャット欄に CTA カードを流し込む。kind='form' は
-- 既存フォーム機能 (forms) をビューア内ボトムシートで開き、離脱なしで回答
-- させる (送信は既存 POST /api/forms/:id/submit — タグ/シナリオ side effects
-- がそのまま発火する)。kind='url' は外部 URL を開く (従来 CTA 相当)。
-- 052-054 は OSS PR (#236/#223/#229) に割当済みのため 055 (line-harness-oss-pr-day)。

CREATE TABLE IF NOT EXISTS webinar_ctas (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  at_seconds INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('form', 'url')),
  title TEXT NOT NULL,
  body TEXT,
  button_label TEXT NOT NULL,
  auto_open INTEGER NOT NULL DEFAULT 0,
  form_id TEXT REFERENCES forms(id),
  url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webinar_ctas_webinar
  ON webinar_ctas (webinar_id, at_seconds);
