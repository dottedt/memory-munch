from __future__ import annotations

import json
from pathlib import Path
import time

from .config import Settings
from .db import Database
from .retrieval import chunk_fetch, path_children, path_lookup, path_root, text_search
from .token_tracker import bytes_to_tokens, cost_avoided, estimate_savings, record_savings


API_VERSION = "v2"


def _resolve_file_path(file_path: str) -> Path:
    if file_path.startswith("home/"):
        return (Path.home() / file_path[len("home/") :]).resolve()
    return (Path.cwd() / file_path).resolve()


def _file_size(file_path: str) -> int:
    p = _resolve_file_path(file_path)
    try:
        return p.stat().st_size if p and p.exists() else 0
    except Exception:
        return 0


def _collect_file_paths(value, out: set[str]) -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            if k in {"file_path", "source_file", "path"} and isinstance(v, str):
                out.add(v)
            else:
                _collect_file_paths(v, out)
    elif isinstance(value, list):
        for item in value:
            _collect_file_paths(item, out)


def _response_bytes(data: dict) -> int:
    return len(json.dumps(data, ensure_ascii=False).encode("utf-8"))


def _meta_for(data: dict, started: float) -> dict:
    file_paths: set[str] = set()
    _collect_file_paths(data, file_paths)
    raw_bytes = sum(_file_size(fp) for fp in file_paths)
    response_bytes = _response_bytes(data)
    tokens_saved = estimate_savings(raw_bytes, response_bytes)
    total_saved = record_savings(tokens_saved)
    meta = {
        "timing_ms": round((time.perf_counter() - started) * 1000, 2),
        "raw_bytes_estimate": raw_bytes,
        "response_bytes": response_bytes,
        "raw_tokens_estimate": bytes_to_tokens(raw_bytes),
        "response_tokens_estimate": bytes_to_tokens(response_bytes),
        "tokens_saved": tokens_saved,
        "total_tokens_saved": total_saved,
    }
    meta.update(cost_avoided(tokens_saved, total_saved))
    return meta


def ok(data: dict, started: float | None = None) -> dict:
    payload = {"ok": True, "api_version": API_VERSION, "data": data, "error": None}
    if started is not None:
        payload["_meta"] = _meta_for(data, started)
    return payload


def err(code: str, message: str, details: dict | None = None, started: float | None = None) -> dict:
    payload = {
        "ok": False,
        "api_version": API_VERSION,
        "data": None,
        "error": {"code": code, "message": message, "details": details or {}},
    }
    if started is not None:
        payload["_meta"] = {"timing_ms": round((time.perf_counter() - started) * 1000, 2)}
    return payload


def memory_munch_path_root_tool(db: Database) -> dict:
    started = time.perf_counter()
    try:
        return ok(path_root(db), started=started)
    except Exception as e:
        return err("DB_ERROR", "Failed to list path roots", {"reason": str(e)}, started=started)


def memory_munch_path_children_tool(db: Database, path: str = "", limit: int = 100, cursor: str | None = None) -> dict:
    started = time.perf_counter()
    try:
        return ok(path_children(db, path, limit, cursor), started=started)
    except Exception as e:
        return err("DB_ERROR", "Failed to list path children", {"reason": str(e)}, started=started)


def memory_munch_path_lookup_tool(
    db: Database,
    settings: Settings,
    path: str,
    max_tokens: int | None = None,
    limit: int = 20,
) -> dict:
    started = time.perf_counter()
    try:
        return ok(
            path_lookup(db, settings, path, max_tokens or settings.max_tokens_per_query, limit),
            started=started,
        )
    except Exception as e:
        return err("DB_ERROR", "Failed path lookup", {"reason": str(e)}, started=started)


def memory_munch_text_search_tool(
    db: Database,
    settings: Settings,
    query: str,
    path_prefix: str | None = None,
    max_tokens: int | None = None,
    limit: int = 20,
) -> dict:
    started = time.perf_counter()
    if not query.strip():
        return err("INVALID_QUERY", "query must not be empty", started=started)
    try:
        return ok(
            text_search(db, settings, query, path_prefix, max_tokens or settings.max_tokens_per_query, limit),
            started=started,
        )
    except Exception as e:
        return err("DB_ERROR", "Failed text search", {"reason": str(e)}, started=started)


def memory_munch_chunk_fetch_tool(db: Database, chunk_id: int) -> dict:
    started = time.perf_counter()
    try:
        return ok(chunk_fetch(db, chunk_id), started=started)
    except Exception as e:
        return err("DB_ERROR", "Failed chunk fetch", {"reason": str(e)}, started=started)


def doctor_tool(db: Database) -> dict:
    started = time.perf_counter()
    try:
        return ok(db.integrity_check(), started=started)
    except Exception as e:
        return err("DB_ERROR", "Doctor failed", {"reason": str(e)}, started=started)
