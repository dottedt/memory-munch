from pathlib import Path

from dmemorymunch_mpc.config import Settings
from dmemorymunch_mpc.db import Database
from dmemorymunch_mpc.indexer import run_index
from dmemorymunch_mpc.retrieval import chunk_fetch, path_children, path_lookup, path_root, text_search


def test_index_and_retrieval_flow(tmp_path: Path):
    (tmp_path / "memory").mkdir()
    md = tmp_path / "memory" / "guide.md"
    md.write_text("# Agents\n## Tools\n### Memory\nPhone number is 555-0100\n", encoding="utf-8")
    (tmp_path / "memory.md").write_text("# Root alt\nFallback root memory file\n", encoding="utf-8")

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
    assert result["indexed_chunks"] >= 1

    roots = path_root(db)
    assert "agents" in roots["items"]

    children = path_children(db, "agents.tools", limit=10, cursor=None)
    assert any(item["lookup_path"] == "agents.tools.memory" for item in children["items"])

    out = path_lookup(db, settings, path="agents.tools.memory", max_tokens=1200, limit=10)
    assert out["items"]
    cid = out["items"][0]["chunk_id"]

    search = text_search(db, settings, query="phone number", path_prefix="agents", max_tokens=1200, limit=10)
    assert search["items"]

    fetched = chunk_fetch(db, cid)
    assert fetched["item"]
    assert "555-0100" in fetched["item"]["text"]
    alt_lookup = path_lookup(db, settings, path="rootalt", max_tokens=1200, limit=10)
    assert alt_lookup["items"]
    assert alt_lookup["items"][0]["path"] == "memory.md"
    db.close()
