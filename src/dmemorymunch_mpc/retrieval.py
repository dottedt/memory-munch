from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import math
import re
from typing import Iterable

from .config import Settings
from .db import Database
from .models import RetrievalTraceStep

STOPWORDS = {
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
    "did",
    "does",
    "do",
    "give",
    "given",
    "asked",
}

FACT_PREDICATE_SYNONYMS: dict[str, tuple[str, ...]] = {
    "phone": ("phone", "telephone", "mobile", "cell", "number"),
    "email": ("email", "e-mail", "mail"),
    "ssid": ("ssid", "wifi", "wi-fi", "wireless"),
    "follow_up_preference": ("follow-up", "followup", "follow", "preference", "availability"),
    "company": ("company", "organization", "org"),
    "title": ("title", "role", "position"),
}


def _significant_terms(query: str) -> list[str]:
    terms = re.findall(r"[a-zA-Z0-9_]+", query.lower())
    out: list[str] = []
    seen = set()
    for t in terms:
        if len(t) < 3 or t in STOPWORDS:
            continue
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


def _extract_subject_tokens(query: str) -> list[str]:
    out: list[str] = []
    seen = set()
    for phrase in re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b", query):
        for t in re.findall(r"[A-Za-z0-9]+", phrase.lower()):
            if len(t) < 2 or t in seen:
                continue
            seen.add(t)
            out.append(t)
    return out[:4]


def _infer_fact_predicates(query: str) -> list[str]:
    q = query.lower()
    out: list[str] = []
    for pred, words in FACT_PREDICATE_SYNONYMS.items():
        if any(w in q for w in words):
            out.append(pred)
    return out


def _overlap_score(text: str, terms: list[str]) -> float:
    if not text or not terms:
        return 0.0
    low = text.lower()
    matched = 0
    for t in terms:
        if t and t in low:
            matched += 1
    return matched / max(1, len(terms))


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


def _escape_fts_term(term: str) -> str:
    return term.replace('"', '""')


def _fts_and_query(terms: Iterable[str]) -> str:
    ts = [t for t in terms if t]
    if not ts:
        return '""'
    return " ".join(f'"{_escape_fts_term(t)}"' for t in ts)


def _fts_or_query(terms: Iterable[str]) -> str:
    ts = [t for t in terms if t]
    if not ts:
        return '""'
    return " OR ".join(f'"{_escape_fts_term(t)}"' for t in ts)


def _query_variants(query: str) -> list[tuple[str, str, float]]:
    all_terms = re.findall(r"[a-zA-Z0-9_]+", query.lower())
    sig_terms = _significant_terms(query)
    variants: list[tuple[str, str, float]] = []
    seen = set()

    def add(label: str, q: str, bonus: float) -> None:
        key = (label, q)
        if key in seen:
            return
        seen.add(key)
        variants.append((label, q, bonus))

    add("fts_exact", _fts_and_query(all_terms), 0.35)
    if sig_terms and sig_terms != all_terms:
        add("fts_keywords", _fts_and_query(sig_terms[:8]), 0.2)
    if len(sig_terms) > 1:
        add("fts_or", _fts_or_query(sig_terms[:8]), 0.1)

    # Proper-name fallback helps when question terms span sibling chunks.
    name_phrases = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b", query)
    for phrase in name_phrases[:2]:
        name_terms = re.findall(r"[a-zA-Z0-9_]+", phrase.lower())
        if name_terms:
            add("fts_name", _fts_and_query(name_terms), 0.25)

    return variants


def _row_to_hit(row, score: float, snippet_chars: int) -> dict:
    text = row["content"] or ""
    snippet = ""
    if hasattr(row, "keys") and "fts_snippet" in row.keys():
        raw = row["fts_snippet"]
        if isinstance(raw, str):
            snippet = raw.strip()
    if not snippet:
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
    trace: list[RetrievalTraceStep] = []
    variants = _query_variants(query)
    hits_by_id: dict[int, dict] = {}
    order_by_id: dict[int, int] = {}
    next_order = 0
    max_rows = max(1, min(limit * 6, 400))
    overlap_terms = _significant_terms(query)[:12]

    fact_predicates = _infer_fact_predicates(query)
    subject_tokens = _extract_subject_tokens(query)
    if fact_predicates or subject_tokens:
        fact_rows = db.chunks_for_fact_query(fact_predicates, subject_tokens, max(12, limit * 3))
        trace.append(
            RetrievalTraceStep(
                stage="fact_index",
                detail=f"predicates={fact_predicates}; subject_tokens={subject_tokens}; hits={len(fact_rows)}",
            )
        )
        for r in fact_rows:
            boost = min(1.0, float(r["fact_weight"]) * 0.3) if r["fact_weight"] is not None else 0.0
            score = _activation(r) + 0.35 + boost
            hit = _row_to_hit(r, score, settings.snippet_chars)
            cid = hit["chunk_id"]
            prev = hits_by_id.get(cid)
            if prev is None or hit["score"] > prev["score"]:
                hits_by_id[cid] = hit
            if cid not in order_by_id:
                order_by_id[cid] = next_order
                next_order += 1

    for label, fts_query, bonus in variants:
        rows = db.search_text(fts_query, path_prefix, max_rows)
        trace.append(RetrievalTraceStep(stage=label, detail=f"query={fts_query}; hits={len(rows)}"))
        for r in rows:
            bm25 = max(0.0, -float(r["rank"]))  # BM25 is negative; flip so larger = better
            keyword = bm25 / (1.0 + bm25)
            overlap = _overlap_score(str(r["content"] or ""), overlap_terms)
            score = (2.0 * keyword) + (1.25 * overlap) + (0.35 * _activation(r)) + bonus
            hit = _row_to_hit(r, score, settings.snippet_chars)
            cid = hit["chunk_id"]
            prev = hits_by_id.get(cid)
            if prev is None or hit["score"] > prev["score"]:
                hits_by_id[cid] = hit
            if cid not in order_by_id:
                order_by_id[cid] = next_order
                next_order += 1

        # Early stop once we have enough primary hits.
        if len(hits_by_id) >= max(8, limit * 2):
            break

    hits = list(hits_by_id.values())

    # Fallback on explicit term index when FTS is sparse.
    sig_terms = _significant_terms(query)[:6]
    if len(hits_by_id) < max(2, limit // 2) and sig_terms:
        added = 0
        for term in sig_terms:
            rows = db.chunks_for_term(term, max(8, limit * 2))
            trace.append(RetrievalTraceStep(stage="term_index", detail=f"term={term}; hits={len(rows)}"))
            for r in rows:
                boost = min(1.0, float(r["term_weight"]) * 0.2) if r["term_weight"] is not None else 0.0
                overlap = _overlap_score(str(r["content"] or ""), overlap_terms)
                score = (1.1 * overlap) + (0.3 * _activation(r)) + 0.15 + boost
                hit = _row_to_hit(r, score, settings.snippet_chars)
                cid = hit["chunk_id"]
                prev = hits_by_id.get(cid)
                if prev is None or hit["score"] > prev["score"]:
                    if prev is None:
                        added += 1
                    hits_by_id[cid] = hit
                if cid not in order_by_id:
                    order_by_id[cid] = next_order
                    next_order += 1
        if added:
            trace.append(RetrievalTraceStep(stage="term_index_expand", detail=f"added={added}"))
        hits = list(hits_by_id.values())

    # Expand sibling chunks under same parent_path to support split semantic facts
    # (e.g., person identity in one chunk and follow-up notes in another).
    if hits:
        parent_info: list[tuple[str, float]] = []
        seen_parents: set[str] = set()
        for h in sorted(hits, key=lambda x: -x["score"])[:5]:
            lp = h.get("lookup_path") or ""
            parent = ".".join(str(lp).split(".")[:-1]) if lp else ""
            if parent and parent not in seen_parents:
                seen_parents.add(parent)
                parent_info.append((parent, h["score"]))
        expanded = 0
        for parent, anchor_score in parent_info:
            for row in db.chunks_for_parent(parent, 8):
                # Sibling chunks inherit a score competitive with their anchor so
                # they survive the limit/budget cut alongside the primary hit.
                score = max(_activation(row) + 0.05, anchor_score * 0.75)
                hit = _row_to_hit(row, score, settings.snippet_chars)
                cid = hit["chunk_id"]
                if cid in hits_by_id:
                    continue
                hits_by_id[cid] = hit
                if cid not in order_by_id:
                    order_by_id[cid] = next_order
                    next_order += 1
                expanded += 1
        if expanded:
            trace.append(RetrievalTraceStep(stage="parent_expand", detail=f"added={expanded}"))
        hits = list(hits_by_id.values())

    # Sort by score so the most relevant items survive the limit/budget cut
    # regardless of discovery order (parent_expand items are added last but
    # can have competitive scores). TypeScript reranks for final display.
    hits.sort(key=lambda h: -h["score"])
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
