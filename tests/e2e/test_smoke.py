from pathlib import Path

from dmemorymunch_mpc.cli import app
from typer.testing import CliRunner


def test_cli_init_index_stats(tmp_path: Path):
    runner = CliRunner()
    cfg = tmp_path / "dmemorymunch-mpc.toml"
    (tmp_path / "memory").mkdir()
    (tmp_path / "memory" / "x.md").write_text("# Agents\nbody\n", encoding="utf-8")
    cfg.write_text(
        "\n".join(
            [
                f'db_path = "{(tmp_path / ".memorymunch" / "memory.db").as_posix()}"',
                'roots = ["."]',
                'include_globs = ["memory/**/*.md"]',
                'exclude_globs = []',
            ]
        ),
        encoding="utf-8",
    )

    with runner.isolated_filesystem(temp_dir=str(tmp_path)):
        r1 = runner.invoke(app, ["init-db", "--config", "dmemorymunch-mpc.toml"])
        assert r1.exit_code == 0
        r2 = runner.invoke(app, ["index", "--scope", "all", "--config", "dmemorymunch-mpc.toml"])
        assert r2.exit_code == 0
        r3 = runner.invoke(app, ["stats", "--config", "dmemorymunch-mpc.toml"])
        assert r3.exit_code == 0
