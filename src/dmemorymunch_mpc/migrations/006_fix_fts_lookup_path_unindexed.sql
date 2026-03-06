-- Migration 006: Make lookup_path UNINDEXED in memory_fts.
--
-- Bug: previously lookup_path was a full FTS5-indexed column. SQLite FTS5
-- tokenizes it (e.g. "convention_inbox.card_001.handwritten_notes" →
-- "convention", "inbox", "card", "001", "handwritten", "notes"), so queries
-- containing common path segment words like "person", "notes", "card", "inbox"
-- spuriously match chunks via lookup_path rather than content.
--
-- Fix: mark lookup_path UNINDEXED. FTS no longer builds a token index for it;
-- it is stored only for reference. MATCH queries search content only.
--
-- This migration is run at most once thanks to the _schema_migrations tracker
-- in init_schema(), so the FTS rebuild is a one-time cost.

DROP TRIGGER IF EXISTS memory_chunks_ai;
DROP TRIGGER IF EXISTS memory_chunks_ad;
DROP TRIGGER IF EXISTS memory_chunks_au;

DROP TABLE IF EXISTS memory_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,
  lookup_path UNINDEXED,
  content='memory_chunks',
  content_rowid='chunk_id'
);

-- Populate FTS index from existing chunks.
INSERT INTO memory_fts(memory_fts) VALUES ('rebuild');

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
