from pathlib import Path

from dmemorymunch_mpc.config import Settings
from dmemorymunch_mpc.db import Database
from dmemorymunch_mpc.indexer import run_index
from dmemorymunch_mpc.retrieval import chunk_fetch, path_children, path_lookup, path_root, text_search


def test_index_and_retrieval_flow(tmp_path: Path):
    (tmp_path / "memory").mkdir()
    md = tmp_path / "memory" / "guide.md"
    md.write_text("# Agents\n## Tools\n### Memory\nPhone number is 555-0100\n", encoding="utf-8")

    db_path = tmp_path / ".memorymunch" / "memory.db"
    db_path.parent.mkdir()

    settings = Settings(
        db_path=str(db_path),
        roots=["."],
        include_globs=["MEMORY.md", "memory/**/*.md"],
        exclude_globs=[],
    )
    db = Database(str(db_path))
    db.init_schema()

    result = run_index(db, settings, scope="all", cwd=tmp_path)
    assert result["indexed_chunks"] >= 1

    roots = path_root(db)
    assert "memory" in roots["items"]

    children = path_children(db, "memory.guide.agents.tools", limit=10, cursor=None)
    assert any(item["lookup_path"] == "memory.guide.agents.tools.memory" for item in children["items"])

    out = path_lookup(db, settings, path="memory.guide.agents.tools.memory", max_tokens=1200, limit=10)
    assert out["items"]
    cid = out["items"][0]["chunk_id"]

    search = text_search(db, settings, query="phone number", path_prefix="memory.guide.agents", max_tokens=1200, limit=10)
    assert search["items"]

    fetched = chunk_fetch(db, cid)
    assert fetched["item"]
    assert "555-0100" in fetched["item"]["text"]
    db.close()


def test_text_search_handles_question_terms_spanning_sibling_chunks(tmp_path: Path):
    (tmp_path / "memory" / "inbox").mkdir(parents=True)
    md = tmp_path / "memory" / "inbox" / "cards.md"
    md.write_text(
        "\n".join(
            [
                "# Convention Inbox",
                "## Card 005",
                "### Person",
                "- Name: Sophie Tran",
                "- Title: Team Lead",
                "- Company: Cedar Lane Residential",
                "- Email: sophie.tran@cedarlane.test",
                "- Phone: (972) 555-0152",
                "### Handwritten Notes",
                "- Biggest issue: forgetting context between first meeting and second call.",
                "- Wants summaries by person + company + next action.",
                "- Asked for exact-source citations in assistant responses.",
                "- Follow-up preference: Thursday after 2 PM CT.",
            ]
        ),
        encoding="utf-8",
    )

    db_path = tmp_path / ".memorymunch" / "memory.db"
    db_path.parent.mkdir()
    settings = Settings(
        db_path=str(db_path),
        roots=["."],
        include_globs=["MEMORY.md", "memory/**/*.md"],
        exclude_globs=[],
        snippet_chars=360,
    )
    db = Database(str(db_path))
    db.init_schema()
    run_index(db, settings, scope="all", cwd=tmp_path)

    out = text_search(
        db,
        settings,
        query="What follow-up time preference did Sophie Tran give?",
        path_prefix=None,
        max_tokens=1200,
        limit=8,
    )

    assert out["items"]
    assert any(
        ("Follow-up preference" in i["snippet"]) or i["lookup_path"].endswith(".handwritten_notes")
        for i in out["items"]
    )
    db.close()


def test_text_search_uses_global_term_index_for_compact_name_query(tmp_path: Path):
    (tmp_path / "memory" / "inbox").mkdir(parents=True)
    md = tmp_path / "memory" / "inbox" / "cards.md"
    md.write_text(
        "\n".join(
            [
                "# Convention Inbox",
                "## Card 005",
                "### Person",
                "- Name: Sophie Tran",
                "- Phone: (972) 555-0152",
                "### Handwritten Notes",
                "- Follow-up preference: Thursday after 2 PM CT.",
            ]
        ),
        encoding="utf-8",
    )

    db_path = tmp_path / ".memorymunch" / "memory.db"
    db_path.parent.mkdir()
    settings = Settings(
        db_path=str(db_path),
        roots=["."],
        include_globs=["MEMORY.md", "memory/**/*.md"],
        exclude_globs=[],
    )
    db = Database(str(db_path))
    db.init_schema()
    run_index(db, settings, scope="all", cwd=tmp_path)

    out = text_search(
        db,
        settings,
        query="sophietran followup window",
        path_prefix=None,
        max_tokens=1200,
        limit=8,
    )

    assert out["items"]
    assert any(i["lookup_path"].endswith(".person") for i in out["items"])
    assert any(step["stage"] == "term_index" for step in out["retrieval_trace"])
    db.close()


def test_text_search_uses_fact_index_for_person_attribute_questions(tmp_path: Path):
    (tmp_path / "memory" / "inbox").mkdir(parents=True)
    md = tmp_path / "memory" / "inbox" / "cards.md"
    md.write_text(
        "\n".join(
            [
                "# Convention Inbox",
                "## Card 004",
                "### Person",
                "- Name: Adam Rodriguez",
                "- Phone: (210) 555-0147",
                "- Email: adam.rodriguez@harborkey.test",
                "### Handwritten Notes",
                "- Requested follow-up next week.",
            ]
        ),
        encoding="utf-8",
    )

    db_path = tmp_path / ".memorymunch" / "memory.db"
    db_path.parent.mkdir()
    settings = Settings(
        db_path=str(db_path),
        roots=["."],
        include_globs=["MEMORY.md", "memory/**/*.md"],
        exclude_globs=[],
        snippet_chars=360,
    )
    db = Database(str(db_path))
    db.init_schema()
    run_index(db, settings, scope="all", cwd=tmp_path)

    out = text_search(
        db,
        settings,
        query="What is Adam Rodriguez's phone number?",
        path_prefix=None,
        max_tokens=1200,
        limit=8,
    )

    assert out["items"]
    assert any("555-0147" in i["snippet"] for i in out["items"])
    assert any(step["stage"] == "fact_index" for step in out["retrieval_trace"])
    db.close()
