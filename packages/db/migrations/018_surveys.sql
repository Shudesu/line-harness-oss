-- Survey management
CREATE TABLE IF NOT EXISTS surveys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  questions_json TEXT NOT NULL DEFAULT '[]', -- JSON array of SurveyQuestion
  is_active INTEGER NOT NULL DEFAULT 1,
  line_account_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL,
  friend_id TEXT,
  answers_json TEXT NOT NULL DEFAULT '[]', -- JSON array matching questions order
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
