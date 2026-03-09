"""Persistent token savings tracker for dmemorymunch-mpc."""

from __future__ import annotations

import json
import os
from pathlib import Path

_SAVINGS_FILE = "_savings.json"
_BYTES_PER_TOKEN = 4

PRICING = {
    "claude_opus": 5.00 / 1_000_000,
    "gpt5_latest": 1.75 / 1_000_000,
}


def _savings_path(base_path: str | None = None) -> Path:
    if base_path:
        root = Path(base_path)
    elif os.environ.get("DMEMORYMUNCH_SAVINGS_PATH"):
        root = Path(os.environ["DMEMORYMUNCH_SAVINGS_PATH"])
    else:
        root = Path.home() / ".memorymunch"
    try:
        root.mkdir(parents=True, exist_ok=True)
    except Exception:
        root = Path.cwd() / ".memorymunch"
        try:
            root.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
    return root / _SAVINGS_FILE


def record_savings(tokens_saved: int, base_path: str | None = None) -> int:
    try:
        path = _savings_path(base_path)
    except Exception:
        return 0
    try:
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception:
        data = {}

    delta = max(0, int(tokens_saved))
    total = int(data.get("total_tokens_saved", 0)) + delta
    data["total_tokens_saved"] = total

    try:
        path.write_text(json.dumps(data), encoding="utf-8")
    except Exception:
        pass

    return total


def get_total_saved(base_path: str | None = None) -> int:
    try:
        path = _savings_path(base_path)
    except Exception:
        return 0
    try:
        return int(json.loads(path.read_text(encoding="utf-8")).get("total_tokens_saved", 0))
    except Exception:
        return 0


def estimate_savings(raw_bytes: int, response_bytes: int) -> int:
    return max(0, (int(raw_bytes) - int(response_bytes)) // _BYTES_PER_TOKEN)


def bytes_to_tokens(value: int) -> int:
    return max(0, (int(value) + (_BYTES_PER_TOKEN - 1)) // _BYTES_PER_TOKEN)


def cost_avoided(tokens_saved: int, total_tokens_saved: int) -> dict:
    return {
        "cost_avoided": {k: round(tokens_saved * v, 4) for k, v in PRICING.items()},
        "total_cost_avoided": {k: round(total_tokens_saved * v, 4) for k, v in PRICING.items()},
    }
