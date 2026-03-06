from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import re
import sqlite3
from pathlib import Path

from .models import ChunkRecord, IndexStats


MIGRATIONS_DIR = Path(__file__).parent / "migrations"

TERM_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "how",
    "i",
    "in",
    "is",
    "it",
    "its",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "that",
    "the",
    "their",
    "them",
    "they",
    "this",
    "to",
    "up",
    "us",
    "was",
    "we",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
    "you",
    "your",
}


def _tokenize_terms(text: str) -> list[str]:
    out: list[str] = []
    for t in re.findall(r"[a-z0-9]+", text.lower()):
        if len(t) < 3 or t in TERM_STOPWORDS:
            continue
        out.append(t)
    return out


def _safe_term(raw: str) -> str | None:
    term = re.sub(r"[^a-z0-9]", "", raw.lower())
    return term if len(term) >= 2 else None


def _normalize_predicate(raw: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", raw.strip().lower()).strip("_")


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA synchronous = NORMAL")
        self.conn.execute("PRAGMA busy_timeout = 5000")
        self.conn.execute("PRAGMA temp_store = MEMORY")
        # Keep more of the DB hot in RAM while remaining file-backed/persistent.
        # cache_size is in KiB when negative (here: 128 MiB).
        self.conn.execute("PRAGMA cache_size = -131072")
        # Let SQLite memory-map part of the DB file for faster reads (here: 256 MiB).
        self.conn.execute("PRAGMA mmap_size = 268435456")
        self.conn.execute("PRAGMA journal_size_limit = 67108864")

    def close(self) -> None:
        self.conn.close()

    def init_schema(self) -> None:
        # Bootstrap migration tracker — idempotent, runs once on brand-new DBs.
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS _schema_migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
        """)
        for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
            name = migration.name
            if self.conn.execute("SELECT 1 FROM _schema_migrations WHERE name = ?", (name,)).fetchone():
                continue
            self.conn.executescript(migration.read_text(encoding="utf-8"))
            self.conn.execute(
                "INSERT INTO _schema_migrations(name, applied_at) VALUES (?, ?)",
                (name, utcnow_iso()),
            )
            self.conn.commit()
        self.conn.commit()

    # Manifest
    def upsert_manifest(self, source_file: str, file_hash: str, mtime_ns: int, size_bytes: int) -> None:
        self.conn.execute(
            """
            INSERT INTO file_manifest (file_path, file_hash, mtime_ns, size_bytes, last_indexed_at, root_kind)
            VALUES (?, ?, ?, ?, ?, 'project')
            ON CONFLICT(file_path) DO UPDATE SET
              file_hash=excluded.file_hash,
              mtime_ns=excluded.mtime_ns,
              size_bytes=excluded.size_bytes,
              last_indexed_at=excluded.last_indexed_at,
              root_kind=excluded.root_kind
            """,
            (source_file, file_hash, mtime_ns, size_bytes, utcnow_iso()),
        )
        self.conn.commit()

    def get_manifest(self) -> dict[str, sqlite3.Row]:
        rows = self.conn.execute("SELECT * FROM file_manifest").fetchall()
        return {r["file_path"]: r for r in rows}

    def delete_manifest_not_in(self, scanned_files: set[str]) -> None:
        if not scanned_files:
            self.conn.execute("DELETE FROM file_manifest")
        else:
            placeholders = ",".join("?" for _ in scanned_files)
            self.conn.execute(f"DELETE FROM file_manifest WHERE file_path NOT IN ({placeholders})", tuple(scanned_files))
        self.conn.commit()

    # Chunks
    def replace_chunks_for_file(self, source_file: str, chunks: list[ChunkRecord]) -> tuple[int, int]:
        deleted = self.conn.execute("DELETE FROM memory_chunks WHERE source_file = ?", (source_file,)).rowcount
        if not chunks:
            self.conn.commit()
            return 0, deleted

        now = utcnow_iso()
        self.conn.executemany(
            """
            INSERT INTO memory_chunks (
              lookup_path, parent_path, chunk_order, content, token_count,
              source_file, start_line, end_line, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    c.lookup_path,
                    c.parent_path,
                    c.chunk_order,
                    c.content,
                    c.token_count,
                    c.source_file,
                    c.start_line,
                    c.end_line,
                    now,
                    now,
                )
                for c in chunks
            ],
        )
        self.conn.execute(
            """
            INSERT OR IGNORE INTO memory_index(chunk_id, access_count, last_accessed, confidence)
            SELECT chunk_id, 0, NULL, 0.5 FROM memory_chunks WHERE source_file = ?
            """,
            (source_file,),
        )
        self.conn.commit()
        return len(chunks), deleted

    def delete_chunks_for_missing_files(self, scanned_files: set[str]) -> int:
        if not scanned_files:
            count = self.conn.execute("DELETE FROM memory_chunks").rowcount
        else:
            placeholders = ",".join("?" for _ in scanned_files)
            count = self.conn.execute(
                f"DELETE FROM memory_chunks WHERE source_file NOT IN ({placeholders})",
                tuple(scanned_files),
            ).rowcount
        self.conn.commit()
        return count

    def rebuild_lookup_paths(self) -> None:
        self.conn.execute("DELETE FROM memory_lookup_paths")
        rows = self.conn.execute(
            """
            SELECT lookup_path, parent_path, COUNT(*) AS chunk_count
            FROM memory_chunks
            GROUP BY lookup_path, parent_path
            """
        ).fetchall()
        for r in rows:
            lookup_path = r["lookup_path"]
            depth = lookup_path.count(".") + 1
            self.conn.execute(
                """
                INSERT INTO memory_lookup_paths(lookup_path, parent_path, depth, chunk_count)
                VALUES (?, ?, ?, ?)
                """,
                (lookup_path, r["parent_path"], depth, r["chunk_count"]),
            )

        # Include intermediate parents even if no direct chunks.
        direct_paths = [r["lookup_path"] for r in rows]
        for p in direct_paths:
            parts = p.split(".")
            for i in range(1, len(parts)):
                parent = ".".join(parts[:i])
                pp = ".".join(parts[: i - 1]) if i > 1 else None
                self.conn.execute(
                    """
                    INSERT INTO memory_lookup_paths(lookup_path, parent_path, depth, chunk_count)
                    VALUES (?, ?, ?, 0)
                    ON CONFLICT(lookup_path) DO NOTHING
                    """,
                    (parent, pp, i),
                )

        self.conn.execute(
            """
            UPDATE memory_lookup_paths
            SET child_count = (
              SELECT COUNT(*) FROM memory_lookup_paths c
              WHERE c.parent_path = memory_lookup_paths.lookup_path
            )
            WHERE 1=1
            """
        )
        self.conn.commit()

    def rebuild_terms(self) -> None:
        # Drop indexes before the wipe so SQLite doesn't maintain them per-row during DELETE.
        self.conn.execute("DROP INDEX IF EXISTS idx_memory_terms_term")
        self.conn.execute("DROP INDEX IF EXISTS idx_memory_terms_lookup_path")
        self.conn.execute("DELETE FROM memory_terms")
        # Aggregate all chunk content per path so each path is processed exactly
        # once — eliminates (term, path) duplicates in the batch and the need for
        # ON CONFLICT resolution.
        rows = self.conn.execute(
            "SELECT lookup_path, GROUP_CONCAT(content, ' ') AS content FROM memory_chunks GROUP BY lookup_path"
        ).fetchall()
        batch: list[tuple[str, str, float]] = []
        for r in rows:
            path = r["lookup_path"]
            content = r["content"] or ""
            parts = [p for p in path.split(".") if p]
            weights: dict[str, float] = {}

            def add(term: str | None, weight: float) -> None:
                if not term:
                    return
                weights[term] = weights.get(term, 0.0) + weight

            for idx, term in enumerate(parts):
                add(_safe_term(term), 1.0 + (len(parts) - idx) * 0.2)
                # Add individual words from underscore-separated slug segments so
                # that FTS/term-index queries for "inbox" find "convention_inbox".
                words = [w for w in term.split("_") if len(w) >= 3]
                if len(words) > 1:
                    for word in words:
                        add(word, 0.7 + (len(parts) - idx) * 0.1)

            # Compact path term (e.g. business2).
            compact = "".join(parts)
            add(_safe_term(compact), 0.8)

            # Lightweight lexical index from content, with emphasis on labels and names.
            freq: dict[str, int] = {}
            for t in _tokenize_terms(content):
                freq[t] = freq.get(t, 0) + 1
            for t, c in sorted(freq.items(), key=lambda x: (-x[1], x[0]))[:120]:
                add(t, min(0.65, 0.2 + (c * 0.07)))

            for key in re.findall(r"(?m)^\s*[-*]\s*([^:\n]{2,48})\s*:", content):
                add(_safe_term(key), 1.1)

            for phrase in re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b", content):
                parts2 = [p.lower() for p in re.findall(r"[A-Za-z0-9]+", phrase)]
                if len(parts2) >= 2:
                    add(_safe_term("".join(parts2)), 0.9)
                    for p2 in parts2:
                        add(_safe_term(p2), 0.5)

            for term, weight in sorted(weights.items(), key=lambda x: (-x[1], x[0]))[:140]:
                batch.append((term, path, round(weight, 4)))

        batch.sort()
        self.conn.executemany(
            "INSERT INTO memory_terms(term, lookup_path, weight) VALUES (?, ?, ?)",
            batch,
        )
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_terms_term ON memory_terms(term)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_terms_lookup_path ON memory_terms(lookup_path)")
        self.conn.commit()

    def rebuild_facts(self) -> None:
        self.conn.execute("DELETE FROM memory_facts")
        rows = self.conn.execute(
            """
            SELECT chunk_id, lookup_path, content
            FROM memory_chunks
            ORDER BY chunk_id ASC
            """
        ).fetchall()
        for r in rows:
            chunk_id = int(r["chunk_id"])
            lookup_path = str(r["lookup_path"])
            content = str(r["content"] or "")
            lines = [ln.strip() for ln in content.splitlines() if ln.strip()]
            kv: dict[str, str] = {}
            for ln in lines:
                m = re.match(r"^[-*]\s*([^:\n]{2,48})\s*:\s*(.+)$", ln)
                if not m:
                    continue
                key = _normalize_predicate(m.group(1))
                val = m.group(2).strip()
                if not key or not val:
                    continue
                # Keep the first occurrence for subject inference stability.
                kv.setdefault(key, val)

            subject = kv.get("name") or kv.get("person") or kv.get("contact")
            for key, val in kv.items():
                self.conn.execute(
                    """
                    INSERT INTO memory_facts(chunk_id, lookup_path, subject, predicate, object, weight)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (chunk_id, lookup_path, subject, key, val[:280], 1.0),
                )
        self.conn.commit()

    # Retrieval primitives
    def path_roots(self) -> list[sqlite3.Row]:
        return self.conn.execute(
            """
            SELECT lookup_path, child_count
            FROM memory_lookup_paths
            WHERE parent_path IS NULL
            ORDER BY lookup_path ASC
            """
        ).fetchall()

    def path_children(self, path: str, limit: int, cursor: str | None) -> list[sqlite3.Row]:
        if path:
            if cursor:
                return self.conn.execute(
                    """
                    SELECT lookup_path, child_count
                    FROM memory_lookup_paths
                    WHERE parent_path = ? AND lookup_path > ?
                    ORDER BY lookup_path ASC
                    LIMIT ?
                    """,
                    (path, cursor, limit),
                ).fetchall()
            return self.conn.execute(
                """
                SELECT lookup_path, child_count
                FROM memory_lookup_paths
                WHERE parent_path = ?
                ORDER BY lookup_path ASC
                LIMIT ?
                """,
                (path, limit),
            ).fetchall()

        if cursor:
            return self.conn.execute(
                """
                SELECT lookup_path, child_count
                FROM memory_lookup_paths
                WHERE parent_path IS NULL AND lookup_path > ?
                ORDER BY lookup_path ASC
                LIMIT ?
                """,
                (cursor, limit),
            ).fetchall()
        return self.conn.execute(
            """
            SELECT lookup_path, child_count
            FROM memory_lookup_paths
            WHERE parent_path IS NULL
            ORDER BY lookup_path ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    def chunks_for_path(self, path: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            """
            SELECT c.*, i.access_count, i.last_accessed, i.confidence
            FROM memory_chunks c
            LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
            WHERE c.lookup_path = ?
            ORDER BY c.chunk_order ASC
            """,
            (path,),
        ).fetchall()

    def chunks_for_prefix(self, prefix: str, limit: int) -> list[sqlite3.Row]:
        like = f"{prefix}.%"
        return self.conn.execute(
            """
            SELECT c.*, i.access_count, i.last_accessed, i.confidence
            FROM memory_chunks c
            LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
            WHERE c.lookup_path LIKE ?
            ORDER BY c.lookup_path ASC, c.chunk_order ASC
            LIMIT ?
            """,
            (like, limit),
        ).fetchall()

    def chunks_for_parent(self, parent_path: str, limit: int) -> list[sqlite3.Row]:
        return self.conn.execute(
            """
            SELECT c.*, i.access_count, i.last_accessed, i.confidence
            FROM memory_chunks c
            LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
            WHERE c.parent_path = ?
            ORDER BY c.lookup_path ASC, c.chunk_order ASC
            LIMIT ?
            """,
            (parent_path, limit),
        ).fetchall()

    def chunks_for_term(self, term: str, limit: int) -> list[sqlite3.Row]:
        return self.conn.execute(
            """
            SELECT c.*, i.access_count, i.last_accessed, i.confidence,
                   t.term AS matched_term, t.weight AS term_weight
            FROM memory_terms t
            JOIN memory_chunks c ON c.lookup_path = t.lookup_path
            LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
            WHERE t.term = ?
            ORDER BY t.weight DESC, c.lookup_path ASC, c.chunk_order ASC
            LIMIT ?
            """,
            (term, limit),
        ).fetchall()

    def chunks_for_fact_query(
        self,
        predicates: list[str],
        subject_tokens: list[str],
        limit: int,
    ) -> list[sqlite3.Row]:
        if not predicates and not subject_tokens:
            return []

        where_parts: list[str] = []
        params: list[object] = []
        if predicates:
            where_parts.append("(" + " OR ".join("f.predicate = ?" for _ in predicates) + ")")
            params.extend(predicates)
        if subject_tokens:
            for tok in subject_tokens:
                where_parts.append("(LOWER(COALESCE(f.subject, '')) LIKE ? OR LOWER(f.object) LIKE ?)")
                like = f"%{tok.lower()}%"
                params.extend([like, like])

        where_sql = " AND ".join(where_parts) if where_parts else "1=1"
        params.append(max(1, limit))

        return self.conn.execute(
            f"""
            SELECT c.*, i.access_count, i.last_accessed, i.confidence,
                   f.predicate AS fact_predicate, f.subject AS fact_subject, f.object AS fact_object, f.weight AS fact_weight
            FROM memory_facts f
            JOIN memory_chunks c ON c.chunk_id = f.chunk_id
            LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
            WHERE {where_sql}
            ORDER BY f.weight DESC, c.lookup_path ASC, c.chunk_order ASC
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()

    def search_text(self, query: str, path_prefix: str | None, limit: int) -> list[sqlite3.Row]:
        like_clause = ""
        params: list = [query]
        if path_prefix:
            like_clause = "AND c.lookup_path LIKE ?"
            params.append(f"{path_prefix}%")
        params.append(limit)
        return self.conn.execute(
            f"""
            SELECT c.*, i.access_count, i.last_accessed, i.confidence,
                   bm25(memory_fts) AS rank,
                   snippet(memory_fts, 0, '', '', ' ... ', 36) AS fts_snippet
            FROM memory_fts f
            JOIN memory_chunks c ON c.chunk_id = f.rowid
            LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
            WHERE memory_fts MATCH ?
              {like_clause}
            ORDER BY rank ASC, c.lookup_path ASC, c.chunk_order ASC
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()

    def fetch_chunk(self, chunk_id: int) -> sqlite3.Row | None:
        return self.conn.execute(
            """
            SELECT c.*, i.access_count, i.last_accessed, i.confidence
            FROM memory_chunks c
            LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
            WHERE c.chunk_id = ?
            """,
            (chunk_id,),
        ).fetchone()

    def record_access(self, chunk_ids: list[int]) -> None:
        if not chunk_ids:
            return
        now = utcnow_iso()
        self.conn.executemany(
            """
            UPDATE memory_index
            SET access_count = access_count + 1,
                last_accessed = ?
            WHERE chunk_id = ?
            """,
            [(now, cid) for cid in chunk_ids],
        )
        self.conn.commit()

    def insert_index_run(self, stats: IndexStats) -> None:
        data = asdict(stats)
        self.conn.execute(
            """
            INSERT INTO index_runs (
              started_at, ended_at, scope, files_scanned, files_changed,
              nodes_upserted, nodes_deleted, status, error_summary
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["started_at"].isoformat(),
                data["ended_at"].isoformat(),
                data["scope"],
                data["files_scanned"],
                data["files_changed"],
                data["chunks_upserted"],
                data["chunks_deleted"],
                data["status"],
                data["error_summary"],
            ),
        )
        self.conn.commit()

    def stats(self, namespace_prefix: str | None = None) -> dict:
        if namespace_prefix:
            total = self.conn.execute(
                "SELECT COUNT(*) FROM memory_chunks WHERE lookup_path LIKE ?",
                (f"{namespace_prefix}%",),
            ).fetchone()[0]
        else:
            total = self.conn.execute("SELECT COUNT(*) FROM memory_chunks").fetchone()[0]
        largest = self.conn.execute(
            "SELECT lookup_path, LENGTH(content) AS size FROM memory_chunks ORDER BY size DESC LIMIT 10"
        ).fetchall()
        return {
            "total_chunks": total,
            "largest_chunks": [dict(row) for row in largest],
        }

    def integrity_check(self) -> dict:
        checks = self.conn.execute("PRAGMA integrity_check").fetchall()
        fts_count = self.conn.execute("SELECT COUNT(*) FROM memory_fts").fetchone()[0]
        chunk_count = self.conn.execute("SELECT COUNT(*) FROM memory_chunks").fetchone()[0]
        return {
            "integrity": [row[0] for row in checks],
            "chunks_count": chunk_count,
            "fts_count": fts_count,
            "fts_synced": chunk_count == fts_count,
        }
