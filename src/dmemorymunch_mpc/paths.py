from __future__ import annotations

import re
from pathlib import Path


VALID_PATH_RE = re.compile(r"^[a-z0-9._-]+$")


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "_", value).strip("_")
    return value or "untitled"


def normalize_lookup_path(value: str) -> str:
    p = value.strip().lower()
    p = re.sub(r"\.+", ".", p).strip(".")
    if not p:
        raise ValueError("lookup path cannot be empty")
    if not VALID_PATH_RE.match(p):
        raise ValueError(f"Invalid lookup path: {value}")
    return p


def build_lookup_path(file_path: str, heading_chain: list[str]) -> str:
    parts = [slugify(h) for h in heading_chain if h.strip()]
    if not parts:
        parts = [slugify(Path(file_path).stem)]
    return normalize_lookup_path(".".join(parts[:6]))


def parent_path(path: str) -> str | None:
    return path.rsplit(".", 1)[0] if "." in path else None
