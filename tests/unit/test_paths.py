from dmemorymunch_mpc.paths import build_lookup_path, normalize_lookup_path, parent_path


def test_build_lookup_path_from_heading_chain():
    p = build_lookup_path("memory/guide.md", ["Agents", "Tools", "Memory"])
    assert p == "agents.tools.memory"
    assert parent_path(p) == "agents.tools"


def test_build_lookup_path_fallback_to_file_stem():
    p = build_lookup_path("memory/Business.md", [])
    assert p == "business"


def test_invalid_path_rejected():
    try:
        normalize_lookup_path("System.Bad Path")
    except ValueError:
        pass
    else:
        assert False
