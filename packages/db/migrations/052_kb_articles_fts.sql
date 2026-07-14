-- RAG 用ナレッジ記事 + FTS5（日本語は bigram フォールバック併用）
CREATE TABLE IF NOT EXISTS kb_articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  line_account_id TEXT,
  tags TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS kb_articles_fts USING fts5(
  title,
  content,
  content='kb_articles',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS kb_articles_ai AFTER INSERT ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS kb_articles_ad AFTER DELETE ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS kb_articles_au AFTER UPDATE ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
  INSERT INTO kb_articles_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;
