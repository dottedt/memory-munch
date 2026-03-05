from __future__ import annotations

from pathlib import Path
import json
import time

import typer

from .config import load_settings
from .db import Database
from .indexer import run_index
from .server import run_server


app = typer.Typer(add_completion=False, help="dmemorymunch-mpc CLI")


def _open_db(db_path: str) -> Database:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = Database(str(path))
    db.init_schema()
    return db


@app.command("init-db")
def init_db(config: str = typer.Option(None), db: str = typer.Option(None)) -> None:
    settings = load_settings(config)
    db_path = db or settings.db_path
    database = _open_db(db_path)
    database.close()
    typer.echo(f"initialized db at {db_path}")


@app.command("index")
def index_cmd(
    scope: str = typer.Option("changed", help="changed|all"),
    config: str = typer.Option(None),
    db: str = typer.Option(None),
) -> None:
    settings = load_settings(config)
    db_path = db or settings.db_path
    database = _open_db(db_path)
    try:
        result = run_index(database, settings, scope=scope)
        typer.echo(json.dumps(result, indent=2))
    finally:
        database.close()


@app.command("reindex")
def reindex_cmd(
    scope: str = typer.Option("all", help="changed|all"),
    config: str = typer.Option(None),
    db: str = typer.Option(None),
) -> None:
    settings = load_settings(config)
    db_path = db or settings.db_path
    database = _open_db(db_path)
    try:
        result = run_index(database, settings, scope=scope)
        typer.echo(json.dumps(result, indent=2))
    finally:
        database.close()


@app.command("watch")
def watch_cmd(
    interval: float = typer.Option(1.5, help="Polling interval in seconds"),
    config: str = typer.Option(None),
    db: str = typer.Option(None),
) -> None:
    settings = load_settings(config)
    db_path = db or settings.db_path
    database = _open_db(db_path)
    typer.echo("watching markdown memory files; press Ctrl+C to stop")
    try:
        typer.echo(json.dumps(run_index(database, settings, scope="all"), indent=2))
        while True:
            time.sleep(max(0.5, interval))
            result = run_index(database, settings, scope="changed")
            if result["indexed_files"] or result["deleted_chunks"]:
                typer.echo(json.dumps(result, indent=2))
    except KeyboardInterrupt:
        typer.echo("stopped")
    finally:
        database.close()


@app.command("stats")
def stats_cmd(namespace_prefix: str = typer.Option(None), config: str = typer.Option(None), db: str = typer.Option(None)) -> None:
    settings = load_settings(config)
    db_path = db or settings.db_path
    database = _open_db(db_path)
    try:
        result = database.stats(namespace_prefix)
        typer.echo(json.dumps(result, indent=2))
    finally:
        database.close()


@app.command("doctor")
def doctor_cmd(config: str = typer.Option(None), db: str = typer.Option(None)) -> None:
    settings = load_settings(config)
    db_path = db or settings.db_path
    database = _open_db(db_path)
    try:
        result = database.integrity_check()
        typer.echo(json.dumps(result, indent=2))
    finally:
        database.close()


@app.command("serve")
def serve_cmd(config: str = typer.Option(None), db: str = typer.Option(None)) -> None:
    import asyncio

    asyncio.run(run_server(config_path=config, db_path=db))


if __name__ == "__main__":
    app()
