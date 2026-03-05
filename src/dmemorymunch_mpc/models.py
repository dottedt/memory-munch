from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(slots=True)
class ChunkRecord:
    lookup_path: str
    parent_path: str | None
    chunk_order: int
    content: str
    token_count: int
    source_file: str
    start_line: int
    end_line: int


@dataclass(slots=True)
class RetrievalTraceStep:
    stage: str
    detail: str


@dataclass(slots=True)
class IndexStats:
    started_at: datetime
    ended_at: datetime
    scope: str
    files_scanned: int
    files_changed: int
    chunks_upserted: int
    chunks_deleted: int
    status: str
    error_summary: str | None = None
