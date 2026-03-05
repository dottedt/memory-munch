from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import fnmatch
import hashlib
import re
import unicodedata
from pathlib import Path

from .config import Settings, expand_root
from .db import Database
from .models import ChunkRecord, IndexStats
from .parser import parse_markdown_blocks
from .paths import build_lookup_path, parent_path


@dataclass(slots=True)
class DiscoveredFile:
    abs_path: Path
    rel_path: str


def _matches_any_glob(rel: str, globs: list[str]) -> bool:
    rel_path = Path(rel)
    for g in globs:
        if fnmatch.fnmatch(rel, g) or rel_path.match(g):
            return True
        # Support common expectation that "x/**/*.md" also matches "x/file.md".
        if "/**/" in g:
            compact = g.replace("/**/", "/")
            if fnmatch.fnmatch(rel, compact) or rel_path.match(compact):
                return True
    return False


def _normalize_rel_path(abs_path: Path, cwd: Path, root: str) -> str:
    abs_resolved = abs_path.resolve()
    home = Path.home().resolve()
    if root.startswith("~/") and abs_resolved.is_relative_to(home):
        return f"home/{abs_resolved.relative_to(home).as_posix()}"
    if abs_resolved.is_relative_to(cwd):
        return abs_resolved.relative_to(cwd).as_posix()
    return abs_resolved.as_posix()


def discover_files(settings: Settings, cwd: Path) -> list[DiscoveredFile]:
    files: list[DiscoveredFile] = []
    seen: set[str] = set()
    for root in settings.roots:
        root_abs = expand_root(root, cwd)
        if not root_abs.exists():
            continue

        # OpenClaw-compatible defaults: root MEMORY.md / memory.md + memory/**/*.md.
        defaults: list[Path] = [root_abs / "MEMORY.md", root_abs / "memory.md"]
        memory_dir = root_abs / "memory"
        if memory_dir.exists() and memory_dir.is_dir():
            defaults.extend(memory_dir.rglob("*.md"))

        for path in defaults:
            if not path.exists() or not path.is_file():
                continue
            if path.is_symlink() and not settings.follow_symlinks:
                continue
            rel = _normalize_rel_path(path, cwd, root)
            if settings.include_globs and not _matches_any_glob(rel, settings.include_globs):
                continue
            if _matches_any_glob(rel, settings.exclude_globs):
                continue
            key = str(path.resolve())
            if key in seen:
                continue
            seen.add(key)
            files.append(DiscoveredFile(abs_path=path, rel_path=rel))

        # Optional extra globs outside defaults (for custom configs).
        for path in root_abs.rglob("*.md"):
            if not path.is_file():
                continue
            if path.is_symlink() and not settings.follow_symlinks:
                continue
            rel = _normalize_rel_path(path, cwd, root)
            if settings.include_globs and not _matches_any_glob(rel, settings.include_globs):
                continue
            if _matches_any_glob(rel, settings.exclude_globs):
                continue
            key = str(path.resolve())
            if key in seen:
                continue
            seen.add(key)
            files.append(DiscoveredFile(abs_path=path, rel_path=rel))
    files.sort(key=lambda f: f.rel_path)
    return files


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def estimate_tokens(text: str) -> int:
    return max(1, (len(text) + 3) // 4)


_UNICODE_REPLACEMENTS = {
    "→": "->",
    "←": "<-",
    "—": "-",
    "–": "-",
    "“": '"',
    "”": '"',
    "’": "'",
    "…": "...",
}


def sqlite_safe_text(text: str) -> str:
    for src, dst in _UNICODE_REPLACEMENTS.items():
        text = text.replace(src, dst)
    text = unicodedata.normalize("NFKD", text)
    return text.encode("ascii", "ignore").decode("ascii")


def _chunk_blocks(
    source_file: str,
    blocks,
    target_min_tokens: int = 100,
    target_max_tokens: int = 300,
) -> list[ChunkRecord]:
    out: list[ChunkRecord] = []
    order_by_path: dict[str, int] = {}

    pending_texts: list[str] = []
    pending_start: int | None = None
    pending_end: int | None = None
    pending_tokens = 0
    pending_lookup: str | None = None

    def flush_pending() -> None:
        nonlocal pending_texts, pending_start, pending_end, pending_tokens, pending_lookup
        if not pending_texts or pending_lookup is None or pending_start is None or pending_end is None:
            pending_texts = []
            pending_start = None
            pending_end = None
            pending_tokens = 0
            pending_lookup = None
            return
        content = "\n\n".join(pending_texts).strip()
        order = order_by_path.get(pending_lookup, 0)
        out.append(
            ChunkRecord(
                lookup_path=pending_lookup,
                parent_path=parent_path(pending_lookup),
                chunk_order=order,
                content=content,
                token_count=estimate_tokens(content),
                source_file=source_file,
                start_line=pending_start,
                end_line=pending_end,
            )
        )
        order_by_path[pending_lookup] = order + 1
        pending_texts = []
        pending_start = None
        pending_end = None
        pending_tokens = 0
        pending_lookup = None

    max_chars = max(64, target_max_tokens * 4)

    def segment_block_text(raw_text: str, start_line: int, end_line: int) -> list[tuple[str, int, int]]:
        # OpenClaw-compatible safety: split pathological long lines to keep chunk size bounded.
        lines = raw_text.split("\n")
        line_count = len(lines)
        if line_count == 0:
            return []
        if line_count == 1 and len(lines[0]) <= max_chars:
            return [(raw_text, start_line, end_line)]

        segments: list[tuple[str, int, int]] = []
        cur_lines: list[str] = []
        cur_chars = 0
        seg_start_line: int | None = None
        seg_end_line: int | None = None

        def flush() -> None:
            nonlocal cur_lines, cur_chars, seg_start_line, seg_end_line
            if not cur_lines or seg_start_line is None or seg_end_line is None:
                cur_lines = []
                cur_chars = 0
                seg_start_line = None
                seg_end_line = None
                return
            text = "\n".join(cur_lines).strip()
            if text:
                segments.append((text, seg_start_line, seg_end_line))
            cur_lines = []
            cur_chars = 0
            seg_start_line = None
            seg_end_line = None

        for idx, raw_line in enumerate(lines):
            line_no = start_line + idx
            pieces = [raw_line[j : j + max_chars] for j in range(0, max(1, len(raw_line)), max_chars)] or [""]
            for piece in pieces:
                piece_size = len(piece) + 1
                if cur_lines and cur_chars + piece_size > max_chars:
                    flush()
                if seg_start_line is None:
                    seg_start_line = line_no
                seg_end_line = line_no
                cur_lines.append(piece)
                cur_chars += piece_size
        flush()
        return segments

    for b in blocks:
        lookup = build_lookup_path(source_file, b.heading_chain)
        block_text = sqlite_safe_text(b.text).strip()
        if not block_text:
            continue
        block_segments = segment_block_text(block_text, b.start_line, b.end_line)
        if not block_segments:
            continue

        for seg_text, seg_start, seg_end in block_segments:
            block_tokens = estimate_tokens(seg_text)

            # Keep structure intact at block/segment boundaries.
            if pending_lookup is None:
                pending_lookup = lookup
                pending_start = seg_start

            if pending_lookup != lookup:
                flush_pending()
                pending_lookup = lookup
                pending_start = seg_start

            if block_tokens >= target_max_tokens:
                flush_pending()
                order = order_by_path.get(lookup, 0)
                out.append(
                    ChunkRecord(
                        lookup_path=lookup,
                        parent_path=parent_path(lookup),
                        chunk_order=order,
                        content=seg_text,
                        token_count=block_tokens,
                        source_file=source_file,
                        start_line=seg_start,
                        end_line=seg_end,
                    )
                )
                order_by_path[lookup] = order + 1
                continue

            if pending_tokens >= target_min_tokens and pending_tokens + block_tokens > target_max_tokens:
                flush_pending()
                pending_lookup = lookup
                pending_start = seg_start

            pending_texts.append(seg_text)
            pending_tokens += block_tokens
            pending_end = seg_end

    flush_pending()
    return out


def _safe_term(raw: str) -> str | None:
    term = re.sub(r"[^a-z0-9]", "", raw.lower())
    return term if len(term) >= 2 else None


def run_index(db: Database, settings: Settings, scope: str = "changed", cwd: Path | None = None) -> dict:
    cwd = cwd or Path.cwd()
    started = datetime.now(timezone.utc)
    scanned = discover_files(settings, cwd)
    scanned_set = {f.rel_path for f in scanned}

    manifest = db.get_manifest()
    changed_files: list[DiscoveredFile] = []

    for f in scanned:
        stat = f.abs_path.stat()
        h = file_hash(f.abs_path)
        previous = manifest.get(f.rel_path)
        is_changed = (
            scope == "all"
            or previous is None
            or previous["file_hash"] != h
            or previous["mtime_ns"] != stat.st_mtime_ns
            or previous["size_bytes"] != stat.st_size
        )
        if is_changed:
            changed_files.append(f)
        db.upsert_manifest(f.rel_path, h, stat.st_mtime_ns, stat.st_size)

    chunks_upserted = 0
    chunks_deleted = 0

    for discovered in changed_files:
        text = discovered.abs_path.read_text(encoding="utf-8")
        _frontmatter, blocks = parse_markdown_blocks(text)
        chunks = _chunk_blocks(discovered.rel_path, blocks)
        upserted, deleted_for_file = db.replace_chunks_for_file(discovered.rel_path, chunks)
        chunks_upserted += upserted
        chunks_deleted += deleted_for_file

    chunks_deleted += db.delete_chunks_for_missing_files(scanned_set)
    db.delete_manifest_not_in(scanned_set)
    db.rebuild_lookup_paths()
    db.rebuild_terms()

    ended = datetime.now(timezone.utc)
    stats = IndexStats(
        started_at=started,
        ended_at=ended,
        scope=scope,
        files_scanned=len(scanned),
        files_changed=len(changed_files),
        chunks_upserted=chunks_upserted,
        chunks_deleted=chunks_deleted,
        status="ok",
    )
    db.insert_index_run(stats)
    return {
        "indexed_files": len(changed_files),
        "scanned_files": len(scanned),
        "indexed_chunks": chunks_upserted,
        "deleted_chunks": chunks_deleted,
        "duration_ms": int((ended - started).total_seconds() * 1000),
        "scope": scope,
    }
