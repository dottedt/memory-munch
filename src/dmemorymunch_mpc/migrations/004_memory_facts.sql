CREATE TABLE IF NOT EXISTS memory_facts (
  fact_id INTEGER PRIMARY KEY,
  chunk_id INTEGER NOT NULL,
  lookup_path TEXT NOT NULL,
  subject TEXT,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  FOREIGN KEY(chunk_id) REFERENCES memory_chunks(chunk_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_facts_chunk ON memory_facts(chunk_id);
CREATE INDEX IF NOT EXISTS idx_memory_facts_lookup_path ON memory_facts(lookup_path);
CREATE INDEX IF NOT EXISTS idx_memory_facts_predicate ON memory_facts(predicate);
CREATE INDEX IF NOT EXISTS idx_memory_facts_subject ON memory_facts(subject);
