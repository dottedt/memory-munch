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
    p = Path(file_path)
    # File path components (all dirs + stem) form the uniqueness prefix.
    file_parts = [slugify(part) for part in p.with_suffix("").parts]
    file_parts = [s for s in file_parts if s]

    heading_parts = [slugify(h) for h in heading_chain if h.strip()]

    # Merge, collapsing consecutive identical segments (e.g. when H1 title
    # slugifies to the same string as the file stem).
    raw = file_parts + heading_parts
    parts: list[str] = []
    for seg in raw:
        if seg and (not parts or parts[-1] != seg):
            parts.append(seg)

    if not parts:
        parts = [slugify(p.stem) or "untitled"]

    return normalize_lookup_path(".".join(parts[:6]))


def parent_path(path: str) -> str | None:
    return path.rsplit(".", 1)[0] if "." in path else None
