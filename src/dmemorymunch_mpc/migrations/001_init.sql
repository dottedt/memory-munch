PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS memory_nodes (
  id INTEGER PRIMARY KEY,
  knowledge_path TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  section_title TEXT NOT NULL,
  heading_level INTEGER NOT NULL,
  parent_path TEXT,
  anchor_slug TEXT,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_file_path ON memory_nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_parent_path ON memory_nodes(parent_path);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_updated_at ON memory_nodes(updated_at DESC);

CREATE TABLE IF NOT EXISTS file_manifest (
  file_path TEXT PRIMARY KEY,
  file_hash TEXT NOT NULL,
  mtime_ns INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  last_indexed_at TEXT NOT NULL,
  root_kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reference_edges (
  id INTEGER PRIMARY KEY,
  source_knowledge_path TEXT NOT NULL,
  target_file_path TEXT,
  target_anchor TEXT,
  target_knowledge_path TEXT,
  link_text TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source_knowledge_path, target_file_path, target_anchor, link_text)
);

CREATE TABLE IF NOT EXISTS index_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  scope TEXT NOT NULL,
  files_scanned INTEGER NOT NULL,
  files_changed INTEGER NOT NULL,
  nodes_upserted INTEGER NOT NULL,
  nodes_deleted INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_summary TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_nodes_fts USING fts5(
  content,
  knowledge_path,
  file_path,
  section_title,
  content='memory_nodes',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS memory_nodes_ai AFTER INSERT ON memory_nodes BEGIN
  INSERT INTO memory_nodes_fts(rowid, content, knowledge_path, file_path, section_title)
  VALUES (new.id, new.content, new.knowledge_path, new.file_path, new.section_title);
END;

CREATE TRIGGER IF NOT EXISTS memory_nodes_ad AFTER DELETE ON memory_nodes BEGIN
  INSERT INTO memory_nodes_fts(memory_nodes_fts, rowid, content, knowledge_path, file_path, section_title)
  VALUES ('delete', old.id, old.content, old.knowledge_path, old.file_path, old.section_title);
END;

CREATE TRIGGER IF NOT EXISTS memory_nodes_au AFTER UPDATE ON memory_nodes BEGIN
  INSERT INTO memory_nodes_fts(memory_nodes_fts, rowid, content, knowledge_path, file_path, section_title)
  VALUES ('delete', old.id, old.content, old.knowledge_path, old.file_path, old.section_title);
  INSERT INTO memory_nodes_fts(rowid, content, knowledge_path, file_path, section_title)
  VALUES (new.id, new.content, new.knowledge_path, new.file_path, new.section_title);
END;
