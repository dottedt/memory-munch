from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import math
import re

from .config import Settings
from .db import Database
from .models import RetrievalTraceStep


def _activation(row) -> float:
    access_count = row["access_count"] if row["access_count"] is not None else 0
    confidence = row["confidence"] if row["confidence"] is not None else 0.5
    last = row["last_accessed"]
    recency = 0.0
    if last:
        try:
            ts = datetime.fromisoformat(last)
            days = max(0.0, (datetime.now(timezone.utc) - ts).total_seconds() / 86400.0)
            recency = 1.0 / (days + 1.0)
        except Exception:
            recency = 0.0
    return recency + math.log1p(max(0, access_count)) + float(confidence)


def _row_to_hit(row, score: float, snippet_chars: int) -> dict:
    text = row["content"] or ""
    snippet = text[:snippet_chars]
    return {
        "path": row["source_file"],
        "startLine": row["start_line"],
        "endLine": row["end_line"],
        "snippet": snippet,
        "score": round(score, 4),
        "chunk_id": row["chunk_id"],
        "lookup_path": row["lookup_path"],
        "token_count": row["token_count"],
        "chunk_order": row["chunk_order"],
    }


def _apply_token_budget(hits: list[dict], max_tokens: int) -> list[dict]:
    out: list[dict] = []
    used = 0
    for h in hits:
        t = h["token_count"]
        if used + t > max_tokens:
            break
        out.append(h)
        used += t
    return out


def path_root(db: Database) -> dict:
    rows = db.path_roots()
    roots = [r["lookup_path"] for r in rows]
    return {"items": roots}


def path_children(db: Database, path: str, limit: int, cursor: str | None) -> dict:
    rows = db.path_children(path, max(1, min(limit, 500)), cursor)
    items = [{"lookup_path": r["lookup_path"], "child_count": r["child_count"]} for r in rows]
    next_cursor = rows[-1]["lookup_path"] if rows else None
    return {"items": items, "next_cursor": next_cursor}


def path_lookup(db: Database, settings: Settings, path: str, max_tokens: int, limit: int) -> dict:
    trace: list[RetrievalTraceStep] = [RetrievalTraceStep(stage="exact_path", detail=path)]
    rows = db.chunks_for_path(path)

    if not rows:
        trace.append(RetrievalTraceStep(stage="prefix_path", detail=path))
        rows = db.chunks_for_prefix(path, max(50, limit * 5))

    if not rows:
        term = re.sub(r"[^a-z0-9]", "", path.lower())
        if term:
            trace.append(RetrievalTraceStep(stage="term_reverse", detail=term))
            rows = db.chunks_for_term(term, max(20, limit * 3))

    hits = [_row_to_hit(r, _activation(r), settings.snippet_chars) for r in rows]
    hits.sort(key=lambda h: (-h["score"], h["lookup_path"], h["chunk_order"]))
    hits = _apply_token_budget(hits[: max(1, min(limit, 200))], max_tokens)
    db.record_access([h["chunk_id"] for h in hits])
    return {"items": hits, "retrieval_trace": [asdict(t) for t in trace]}


def text_search(
    db: Database,
    settings: Settings,
    query: str,
    path_prefix: str | None,
    max_tokens: int,
    limit: int,
) -> dict:
    trace: list[RetrievalTraceStep] = [RetrievalTraceStep(stage="fts", detail=f"query={query}")]
    terms = re.findall(r"[a-zA-Z0-9_]+", query.lower())
    safe_query = " ".join(f'"{t}"' for t in terms) if terms else '""'

    rows = db.search_text(safe_query, path_prefix, max(1, min(limit * 5, 300)))
    hits = []
    for r in rows:
        keyword = 1.0 / (1.0 + max(0.0, float(r["rank"])))
        score = keyword + _activation(r)
        hits.append(_row_to_hit(r, score, settings.snippet_chars))

    hits.sort(key=lambda h: (-h["score"], h["lookup_path"], h["chunk_order"]))
    hits = _apply_token_budget(hits[: max(1, min(limit, 200))], max_tokens)
    db.record_access([h["chunk_id"] for h in hits])
    return {"items": hits, "retrieval_trace": [asdict(t) for t in trace]}


def chunk_fetch(db: Database, chunk_id: int) -> dict:
    row = db.fetch_chunk(chunk_id)
    if not row:
        return {"item": None}
    db.record_access([chunk_id])
    return {
        "item": {
            "path": row["source_file"],
            "from": row["start_line"],
            "lines": row["end_line"] - row["start_line"] + 1,
            "text": row["content"],
            "chunk_id": row["chunk_id"],
            "lookup_path": row["lookup_path"],
            "token_count": row["token_count"],
            "chunk_order": row["chunk_order"],
        }
    }
