from dmemorymunch_mpc.paths import build_lookup_path, normalize_lookup_path, parent_path


def test_build_lookup_path_from_heading_chain():
    # File path components prefix the heading chain for global uniqueness.
    p = build_lookup_path("memory/guide.md", ["Agents", "Tools", "Memory"])
    assert p == "memory.guide.agents.tools.memory"
    assert parent_path(p) == "memory.guide.agents.tools"


def test_build_lookup_path_fallback_to_file_stem():
    # No headings: path is all file path components.
    p = build_lookup_path("memory/Business.md", [])
    assert p == "memory.business"


def test_build_lookup_path_deduplicates_consecutive_segments():
    # H1 slug matches file stem — no redundant repeat.
    p = build_lookup_path("memory/people-index.md", ["People Index", "Work"])
    assert p == "memory.people_index.work"


def test_build_lookup_path_includes_directory_structure():
    # Directory hierarchy is preserved in the path prefix.
    p = build_lookup_path("memory/slack/design-research-threads.md", ["Slack Export", "Threads"])
    assert p == "memory.slack.design_research_threads.slack_export.threads"


def test_invalid_path_rejected():
    try:
        normalize_lookup_path("System.Bad Path")
    except ValueError:
        pass
    else:
        assert False
