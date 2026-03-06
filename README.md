# dmemorymunch-mpc

Local-first deterministic memory gateway for OpenClaw.

Memory-Munch ingests markdown memory files (`MEMORY.md`, `memory.md`, `memory/**/*.md`) into structured SQLite chunks and exposes MCP tools that return small targeted results instead of full documents.

## Install

```bash
pip install -e .
```

## Run MCP server

```bash
dmemorymunch-mpc --config /absolute/path/to/dmemorymunch-mpc.toml
```

## Admin commands

```bash
dmemorymunch-mpc-admin init-db --config dmemorymunch-mpc.toml
dmemorymunch-mpc-admin index --scope all --config dmemorymunch-mpc.toml
dmemorymunch-mpc-admin watch --config dmemorymunch-mpc.toml
dmemorymunch-mpc-admin savings
```

## MCP tools

- `memory_munch_path_root()`
- `memory_munch_path_children(path="", limit=100, cursor=null)`
- `memory_munch_path_lookup(path, max_tokens=1200, limit=20)`
- `memory_munch_text_search(query, path_prefix=null, max_tokens=1200, limit=20)`
- `memory_munch_chunk_fetch(chunk_id)`

## Retrieval strategy

1. `memory_munch_path_root`
2. `memory_munch_path_children`
3. `memory_munch_path_lookup`
4. `memory_munch_text_search`
5. `memory_munch_chunk_fetch`

Always prefer path navigation/lookup before text search.

## Guarantees

- Deterministic path-first retrieval
- Chunk size target 100-300 tokens
- Hard token budget per query (`max_tokens_per_query`, default 1200)
- Snippets are short (default 200 chars)
- Full text only via `memory_munch_chunk_fetch`
- No full-document tool responses

## OpenClaw Plugin Packaging

This repo now includes a packaged OpenClaw extension at:

- `extensions/memory-munch-tools/index.ts`
- `extensions/memory-munch-tools/openclaw.plugin.json`

Install it into a local OpenClaw state directory:

```bash
./scripts/install_openclaw_memory_munch_plugin.sh
```

What this does:

- copies `memory-munch-tools` into `~/.openclaw/extensions/`
- writes plugin config paths (`pythonBin`, `bridgeScript`, `configPath`)
- restarts OpenClaw daemon (unless `--no-restart`)

Note: test memory content (like `mimmic/`) is intentionally not coupled to plugin install.

Verify installation/runtime:

```bash
./scripts/verify_openclaw_memory_munch.sh "Which lead asked for temporary searchable inbox before CRM sync? Give just the name."
```
