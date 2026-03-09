from __future__ import annotations

from pathlib import Path
import tomllib

from pydantic import BaseModel, Field


DEFAULT_EXCLUDES = [
    ".git/**",
    ".pytest_cache/**",
    "node_modules/**",
    ".venv/**",
    "dist/**",
    "build/**",
    ".secrets/**",
    "private/**",
    "**/*password*.md",
    "**/*secret*.md",
    "**/*token*.md",
]

_OPENCLAW_WORKSPACE = Path.home() / ".openclaw" / "workspace"


class Settings(BaseModel):
    db_path: str = ".memorymunch/memory.db"
    roots: list[str] = Field(default_factory=lambda: [str(_OPENCLAW_WORKSPACE)])
    include_globs: list[str] = Field(default_factory=lambda: ["MEMORY.md", "memory/**/*.md"])
    exclude_globs: list[str] = Field(default_factory=lambda: list(DEFAULT_EXCLUDES))
    follow_symlinks: bool = False
    max_tokens_per_query: int = 2400
    snippet_chars: int = 400


DEFAULT_CONFIG_FILE = str(_OPENCLAW_WORKSPACE / "dmemorymunch-mpc.toml")


def load_settings(config_path: str | None = None) -> Settings:
    path = Path(config_path or DEFAULT_CONFIG_FILE).expanduser()
    if not path.exists():
        return Settings()
    with path.open("rb") as f:
        raw = tomllib.load(f)
    return Settings(**raw)


def expand_root(root: str, cwd: Path) -> Path:
    return Path(root).expanduser() if root.startswith("~") else (cwd / root).resolve()
