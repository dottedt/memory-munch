-- Drop unused v1 schema (memory_nodes, reference_edges, memory_nodes_fts + triggers).
-- The v2 schema (memory_chunks, memory_lookup_paths, memory_terms, memory_fts, memory_facts)
-- replaced all of these in 002_memory_munch_v2.sql.

DROP TRIGGER IF EXISTS memory_nodes_ai;
DROP TRIGGER IF EXISTS memory_nodes_ad;
DROP TRIGGER IF EXISTS memory_nodes_au;
DROP TABLE IF EXISTS memory_nodes_fts;
DROP TABLE IF EXISTS reference_edges;
DROP TABLE IF EXISTS memory_nodes;
