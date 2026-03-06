#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dmemorymunch_mpc.config import load_settings
from dmemorymunch_mpc.db import Database
from dmemorymunch_mpc.tools import (
    memory_munch_chunk_fetch_tool,
    memory_munch_path_children_tool,
    memory_munch_path_lookup_tool,
    memory_munch_path_root_tool,
    memory_munch_text_search_tool,
)


def _print_json(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def _cfg_path(raw: str | None) -> str:
    if raw and raw.strip():
        return raw.strip()
    return str(Path.home() / ".openclaw" / "workspace" / "dmemorymunch-mpc.toml")


def _resolve_db_path(config_path: str, db_path: str) -> str:
    p = Path(db_path)
    if p.is_absolute():
        return str(p)
    return str((Path(config_path).resolve().parent / p).resolve())


def main() -> int:
    parser = argparse.ArgumentParser(description="Memory-Munch bridge for OpenClaw plugin tools")
    parser.add_argument("--config", dest="config_path", default=None)
    sub = parser.add_subparsers(dest="op", required=True)

    sub.add_parser("path_root")

    p_children = sub.add_parser("path_children")
    p_children.add_argument("--path", default="")
    p_children.add_argument("--limit", type=int, default=100)
    p_children.add_argument("--cursor", default=None)

    p_lookup = sub.add_parser("path_lookup")
    p_lookup.add_argument("--path", required=True)
    p_lookup.add_argument("--max_tokens", type=int, default=None)
    p_lookup.add_argument("--limit", type=int, default=20)

    p_search = sub.add_parser("text_search")
    p_search.add_argument("--query", required=True)
    p_search.add_argument("--path_prefix", default=None)
    p_search.add_argument("--max_tokens", type=int, default=None)
    p_search.add_argument("--limit", type=int, default=20)

    p_fetch = sub.add_parser("chunk_fetch")
    p_fetch.add_argument("--chunk_id", type=int, required=True)

    args = parser.parse_args()
    config_path = _cfg_path(args.config_path)
    settings = load_settings(config_path)
    db = Database(_resolve_db_path(config_path, settings.db_path))
    db.init_schema()
    try:
        if args.op == "path_root":
            _print_json(memory_munch_path_root_tool(db))
            return 0
        if args.op == "path_children":
            _print_json(
                memory_munch_path_children_tool(
                    db,
                    path=args.path or "",
                    limit=max(1, min(int(args.limit), 500)),
                    cursor=args.cursor or None,
                )
            )
            return 0
        if args.op == "path_lookup":
            _print_json(
                memory_munch_path_lookup_tool(
                    db,
                    settings,
                    path=args.path,
                    max_tokens=args.max_tokens,
                    limit=max(1, min(int(args.limit), 200)),
                )
            )
            return 0
        if args.op == "text_search":
            _print_json(
                memory_munch_text_search_tool(
                    db,
                    settings,
                    query=args.query,
                    path_prefix=args.path_prefix or None,
                    max_tokens=args.max_tokens,
                    limit=max(1, min(int(args.limit), 200)),
                )
            )
            return 0
        if args.op == "chunk_fetch":
            _print_json(memory_munch_chunk_fetch_tool(db, chunk_id=int(args.chunk_id)))
            return 0

        print(json.dumps({"ok": False, "error": {"code": "UNKNOWN_OP", "message": args.op}}))
        return 2
    finally:
        db.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": {"code": "BRIDGE_ERROR", "message": str(exc)}}))
        raise SystemExit(1)
