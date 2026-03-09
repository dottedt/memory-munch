"""MCP server for dmemorymunch-mpc."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from mcp.server import Server
from mcp.types import TextContent, Tool

from .config import load_settings
from .db import Database
from .tools import (
    doctor_tool,
    memory_munch_chunk_fetch_tool,
    memory_munch_path_children_tool,
    memory_munch_path_lookup_tool,
    memory_munch_path_root_tool,
    memory_munch_text_search_tool,
)


server = Server("dmemorymunch-mpc")
_SETTINGS = None
_DB = None


def _init_context(config_path: str | None = None, db_path: str | None = None) -> tuple:
    global _SETTINGS, _DB
    if _SETTINGS is None:
        _SETTINGS = load_settings(config_path)
    if db_path:
        _SETTINGS = _SETTINGS.model_copy(update={"db_path": db_path})
    if _DB is None:
        path = Path(_SETTINGS.db_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        _DB = Database(str(path))
        _DB.init_schema()
    return _SETTINGS, _DB


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="memory_munch_path_root",
            description="List top-level memory domains. Use first to orient in hierarchy.",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="memory_munch_path_children",
            description="Explore child paths under a parent lookup path before searching.",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "default": ""},
                    "limit": {"type": "integer", "default": 100},
                    "cursor": {"type": "string"},
                },
            },
        ),
        Tool(
            name="memory_munch_path_lookup",
            description="Deterministic path lookup. Use when you know or can infer a path like agents.tools.memory.",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "max_tokens": {"type": "integer", "default": 1200},
                    "limit": {"type": "integer", "default": 20},
                },
                "required": ["path"],
            },
        ),
        Tool(
            name="memory_munch_text_search",
            description="Fallback keyword search over memory chunks when path navigation is insufficient.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "path_prefix": {"type": "string"},
                    "max_tokens": {"type": "integer", "default": 1200},
                    "limit": {"type": "integer", "default": 20},
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="memory_munch_chunk_fetch",
            description="Fetch one full chunk by chunk_id after lookup/search shortlisted it.",
            inputSchema={
                "type": "object",
                "properties": {"chunk_id": {"type": "integer"}},
                "required": ["chunk_id"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    settings, db = _init_context()
    args = arguments or {}
    try:
        if name == "memory_munch_path_root":
            result = memory_munch_path_root_tool(db)
        elif name == "memory_munch_path_children":
            result = memory_munch_path_children_tool(
                db,
                path=args.get("path", ""),
                limit=args.get("limit", 100),
                cursor=args.get("cursor"),
            )
        elif name == "memory_munch_path_lookup":
            result = memory_munch_path_lookup_tool(
                db,
                settings,
                path=args["path"],
                max_tokens=args.get("max_tokens", 1200),
                limit=args.get("limit", 20),
            )
        elif name == "memory_munch_text_search":
            result = memory_munch_text_search_tool(
                db,
                settings,
                query=args["query"],
                path_prefix=args.get("path_prefix"),
                max_tokens=args.get("max_tokens", 1200),
                limit=args.get("limit", 20),
            )
        elif name == "memory_munch_chunk_fetch":
            result = memory_munch_chunk_fetch_tool(db, chunk_id=args["chunk_id"])
        elif name == "doctor":
            result = doctor_tool(db)
        else:
            result = {"ok": False, "error": {"code": "UNKNOWN_TOOL", "message": f"Unknown tool: {name}"}, "data": None}

        return [TextContent(type="text", text=json.dumps(result, indent=2))]
    except Exception as exc:
        result = {"ok": False, "error": {"code": "SERVER_ERROR", "message": str(exc)}, "data": None}
        return [TextContent(type="text", text=json.dumps(result, indent=2))]


async def run_server(config_path: str | None = None, db_path: str | None = None) -> None:
    _init_context(config_path=config_path, db_path=db_path)
    from mcp.server.stdio import stdio_server

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="dmemorymunch-mpc",
        description="Run the dmemorymunch-mpc MCP stdio server.",
    )
    parser.add_argument("--config", default=None, help="Path to dmemorymunch-mpc.toml")
    parser.add_argument("--db", default=None, help="Override db path")
    args = parser.parse_args(argv)
    asyncio.run(run_server(config_path=args.config, db_path=args.db))


if __name__ == "__main__":
    main()
