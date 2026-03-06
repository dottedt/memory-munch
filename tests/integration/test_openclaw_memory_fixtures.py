from __future__ import annotations

from pathlib import Path
import shutil

from dmemorymunch_mpc.config import Settings
from dmemorymunch_mpc.db import Database
from dmemorymunch_mpc.indexer import run_index
from dmemorymunch_mpc.retrieval import chunk_fetch, path_children, path_lookup, path_root, text_search


FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "openclaw_memory"


def _copy_fixture_workspace(tmp_path: Path) -> None:
    for src in FIXTURE_DIR.rglob("*"):
        rel = src.relative_to(FIXTURE_DIR)
        dest = tmp_path / rel
        if src.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)


def test_openclaw_style_memory_fixture_ingest(tmp_path: Path):
    _copy_fixture_workspace(tmp_path)

    db_path = tmp_path / ".memorymunch" / "memory.db"
    db_path.parent.mkdir()
    settings = Settings(
        db_path=str(db_path),
        roots=["."],
        include_globs=["MEMORY.md", "memory.md", "memory/**/*.md"],
        exclude_globs=[],
    )
    db = Database(str(db_path))
    db.init_schema()

    result = run_index(db, settings, scope="all", cwd=tmp_path)
    assert result["indexed_chunks"] >= 4

    roots = path_root(db)
    # File path prefix makes "memory" the single universal root.
    assert "memory" in roots["items"]

    children = path_children(db, "memory.longtermmemory", limit=50, cursor=None)
    assert any(item["lookup_path"] == "memory.longtermmemory.decisions" for item in children["items"])

    longterm = path_lookup(db, settings, path="memory.longtermmemory", max_tokens=1200, limit=10)
    assert longterm["items"]
    first = longterm["items"][0]
    assert first["path"] == "MEMORY.md"
    # Line 2 contains the first paragraph after heading in fixture.
    assert first["startLine"] == 2
    assert first["endLine"] >= 2
    assert "555-0100" in first["snippet"]

    search = text_search(
        db,
        settings,
        query="router migration VLAN10",
        path_prefix="memory.2026_02_25.dailynetworkops",
        max_tokens=1200,
        limit=10,
    )
    assert search["items"]
    assert search["items"][0]["path"] == "memory/2026-02-25.md"

    cid = search["items"][0]["chunk_id"]
    fetched = chunk_fetch(db, cid)
    assert fetched["item"]
    assert "VLAN10" in fetched["item"]["text"]
    db.close()


def test_symlinked_markdown_is_ignored_by_default(tmp_path: Path):
    _copy_fixture_workspace(tmp_path)
    outside = tmp_path / "outside.md"
    outside.write_text("# OutsideSecret\nThis should not be indexed.\n", encoding="utf-8")

    link_path = tmp_path / "memory" / "linked.md"
    try:
        link_path.symlink_to(outside)
    except OSError:
        # Symlinks may be unavailable in some environments; skip behavior check.
        return

    db_path = tmp_path / ".memorymunch" / "memory.db"
    db_path.parent.mkdir()
    settings = Settings(
        db_path=str(db_path),
        roots=["."],
        include_globs=["MEMORY.md", "memory.md", "memory/**/*.md"],
        exclude_globs=[],
        follow_symlinks=False,
    )
    db = Database(str(db_path))
    db.init_schema()

    run_index(db, settings, scope="all", cwd=tmp_path)
    out = text_search(db, settings, query="OutsideSecret", path_prefix=None, max_tokens=1200, limit=10)
    assert not out["items"]
    db.close()
