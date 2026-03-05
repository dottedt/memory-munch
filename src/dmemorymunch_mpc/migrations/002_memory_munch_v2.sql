PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS memory_chunks (
  chunk_id INTEGER PRIMARY KEY,
  lookup_path TEXT NOT NULL,
  parent_path TEXT,
  chunk_order INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  source_file TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_lookup_path ON memory_chunks(lookup_path);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_parent_path ON memory_chunks(parent_path);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_lookup_order ON memory_chunks(lookup_path, chunk_order);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_source_file ON memory_chunks(source_file);

CREATE TABLE IF NOT EXISTS memory_lookup_paths (
  lookup_path TEXT PRIMARY KEY,
  parent_path TEXT,
  depth INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  child_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lookup_paths_parent ON memory_lookup_paths(parent_path);
CREATE INDEX IF NOT EXISTS idx_lookup_paths_depth ON memory_lookup_paths(depth);

CREATE TABLE IF NOT EXISTS memory_terms (
  term TEXT NOT NULL,
  lookup_path TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY(term, lookup_path)
);

CREATE INDEX IF NOT EXISTS idx_memory_terms_lookup_path ON memory_terms(lookup_path);

CREATE TABLE IF NOT EXISTS memory_index (
  chunk_id INTEGER PRIMARY KEY,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  FOREIGN KEY(chunk_id) REFERENCES memory_chunks(chunk_id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,
  lookup_path,
  content='memory_chunks',
  content_rowid='chunk_id'
);

CREATE TRIGGER IF NOT EXISTS memory_chunks_ai AFTER INSERT ON memory_chunks BEGIN
  INSERT INTO memory_fts(rowid, content, lookup_path)
  VALUES (new.chunk_id, new.content, new.lookup_path);
END;

CREATE TRIGGER IF NOT EXISTS memory_chunks_ad AFTER DELETE ON memory_chunks BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content, lookup_path)
  VALUES ('delete', old.chunk_id, old.content, old.lookup_path);
END;

CREATE TRIGGER IF NOT EXISTS memory_chunks_au AFTER UPDATE ON memory_chunks BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content, lookup_path)
  VALUES ('delete', old.chunk_id, old.content, old.lookup_path);
  INSERT INTO memory_fts(rowid, content, lookup_path)
  VALUES (new.chunk_id, new.content, new.lookup_path);
END;
