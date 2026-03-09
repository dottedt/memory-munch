# memory-munch — Technical Reference

This document covers internals, architecture, and the complete reference for all configuration, CLI, and tool parameters. For installation and everyday use, see [README.md](README.md).

---

## Contents

- [Architecture](#architecture)
- [What gets indexed](#what-gets-indexed)
- [How files are chunked](#how-files-are-chunked)
- [Incremental indexing](#incremental-indexing)
- [Auxiliary tables](#auxiliary-tables)
- [The lookup path system](#the-lookup-path-system)
- [Retrieval pipeline](#retrieval-pipeline)
- [MCP tools — parameters and response envelope](#mcp-tools)
- [OpenClaw plugin](#openclaw-plugin)
- [Full configuration reference](#full-configuration-reference)
- [Full CLI reference](#full-cli-reference)
- [Token savings calculation](#token-savings-calculation)
- [The subprocess bridge](#the-subprocess-bridge)
- [Requirements](#requirements)

---

## Architecture

```
Your Markdown files
  (MEMORY.md, memory/**/*.md, etc.)
          |
          v
    [ Indexer ]
    Parses heading hierarchy, splits into 100-300 token chunks,
    builds lookup paths from file path + headings, stores in SQLite.
          |
          v
    [ SQLite database ]  (.memorymunch/memory.db)
    Tables: memory_chunks, memory_fts (FTS5 virtual),
            memory_terms, memory_facts, memory_lookup_paths,
            memory_index (access tracking)
          |
          v
    [ MCP server ]  (stdio transport, dmemorymunch-mpc)
          |
    5 MCP tools
          |
          v
    OpenClaw
```

The indexer and MCP server are separate processes. The indexer runs once (or continuously in watch mode) to build and maintain the database. The MCP server reads from the already-built database and never writes during retrieval.

---

## What gets indexed

The indexer discovers files matching `include_globs` under each configured `roots` directory. Defaults:

- `MEMORY.md` in each root
- All `*.md` files under `memory/` subdirectories

Files matching `exclude_globs` (secrets, build artifacts, `.git`, etc.) are skipped. Symlinks are not followed by default.

---

## How files are chunked

Each file is parsed into blocks by heading hierarchy. Blocks are grouped into chunks targeting 100–300 tokens. A block larger than 300 tokens becomes its own chunk; smaller blocks are merged with their neighbors within the same heading scope.

Unicode is NFKD-normalized and common typographic symbols (curly quotes, em-dashes, arrows) are replaced with ASCII equivalents before storage.

---

## Incremental indexing

The indexer tracks each file's mtime, size, and SHA-256 hash in a `file_manifest` table. On subsequent runs it re-indexes only files that have changed, making incremental updates fast regardless of corpus size.

---

## Auxiliary tables

After indexing, three auxiliary tables are rebuilt from scratch:

- **`memory_lookup_paths`** — the full path hierarchy with child counts, used by `path_root` and `path_children`.
- **`memory_terms`** — a weighted token-to-path index built from path components, proper names, and content keywords; used as a fallback when FTS finds nothing.
- **`memory_facts`** — structured `(subject, predicate, object)` triples extracted from bullet-list key-value pairs (e.g. `- Email: alice@example.com`); used by the fact-index stage of text search.

---

## The lookup path system

Every chunk is assigned a **lookup path**: a dot-separated slug derived from the file path and the heading chain at the chunk's location.

**Construction rules:**

1. Split the file path into directory components and the filename stem.
2. Append each heading title in the current heading chain.
3. Slugify each part: lowercase, non-alphanumeric characters become underscores, consecutive underscores collapsed.
4. Deduplicate consecutive identical segments.
5. Truncate to 6 levels.

**Examples:**

| File | Headings at chunk | Lookup path |
|---|---|---|
| `MEMORY.md` | `# People > ## Alice Smith` | `memory.people.alice_smith` |
| `memory/projects/acme.md` | `# Auth service` | `memory.projects.acme.auth_service` |
| `memory/2024-01-15.md` | `# Follow-ups` | `memory.2024_01_15.follow_ups` |

Files under `~/`-rooted directories use a prefix derived from the full directory path, so paths from different root directories never collide:

| Root config | File | Lookup path prefix |
|---|---|---|
| `~/notes` | `MEMORY.md` | `home.notes.memory` |
| `~/projects/acme` | `memory/people.md` | `home.projects.acme.memory.people` |

The path hierarchy is navigable without search: list domains with `path_root`, drill down with `path_children`, retrieve by exact path with `path_lookup`. Text search is a fallback, not the primary retrieval method.

---

## Retrieval pipeline

### `memory_munch_path_lookup`

Three stages, tried in order, stopping at the first hit:

1. **Exact match** — chunks whose `lookup_path` equals the requested path exactly.
2. **Prefix match** — chunks whose `lookup_path` starts with `<path>.`, returning the subtree.
3. **Term reverse** — strips non-alphanumeric characters from the path and queries the term index.

Results are scored by an activation function (`recency + log(access_count + 1)`) that promotes chunks accessed frequently or recently.

### `memory_munch_text_search`

Four stages, each adding to a shared result set. Stages short-circuit once enough results are accumulated.

**Stage 1 — Fact index**

When the query contains fact-type vocabulary (phone, email, wifi, company, title, role, follow-up) or proper-name tokens (two or more capitalized words), the `memory_facts` table is queried directly for matching `(predicate, subject)` pairs. Fact hits receive the highest base score (3.0) and appear first in the result set.

Example: `"What is Alice Smith's phone number?"` → predicate=`phone`, subject_tokens=`["alice", "smith"]`.

**Stage 2 — FTS / BM25**

Runs SQLite FTS5 `MATCH` queries against the full chunk corpus, trying up to four query variants:

- `fts_exact`: all terms required (AND)
- `fts_keywords`: significant terms (stopwords and short tokens removed), AND
- `fts_or`: significant terms, OR (broadest)
- `fts_name`: proper-name terms from any multi-word capitalized phrases in the query

BM25 score is normalized to `[0, 2)` via sigmoid. A content-overlap bonus (max 1.25) is added based on what fraction of significant query terms appear in the chunk text. An activation bonus (max 0.5, scaled by `access_count` and recency) rewards chunks that have been retrieved frequently or recently.

**Stage 3 — Term index fallback**

When FTS produces fewer results than needed, the `memory_terms` table is queried for each significant term. Term index entries include path-component tokens, proper-name compacts, and high-frequency content keywords with pre-computed weights. Score: `0.3 + min(0.5, weight × 0.3)` plus the activation bonus.

**Stage 4 — Sibling expansion**

For each of the top-5 scoring hits, chunks sharing the same `parent_path` are fetched and added at `anchor_score × 0.75`. This pulls in the rest of a "card" when only one sub-section matched — for example, a person's contact details alongside their notes because both live under `memory.people.alice_smith`.

After all stages, results are sorted by score, truncated to the configured `limit`, then capped at the `max_tokens` budget. The token cap is applied by walking the sorted list and stopping when adding the next chunk would exceed the budget.

---

## MCP tools

### Response envelope

All tools return a consistent response envelope:

```json
{
  "ok": true,
  "api_version": "v2",
  "data": { ... },
  "error": null,
  "_meta": {
    "timing_ms": 4.2,
    "tokens_saved": 1840,
    "total_tokens_saved": 42300,
    "cost_avoided": { "claude_opus": 0.0092, "gpt5_latest": 0.0032 },
    "raw_tokens_estimate": 2100,
    "response_tokens_estimate": 260
  }
}
```

On error, `ok` is `false`, `data` is `null`, and `error` contains `code` and `message`.

### Tool parameters

| Tool | Required | Optional |
|---|---|---|
| `memory_munch_path_root` | — | — |
| `memory_munch_path_children` | — | `path` (default `""`), `limit` (default 100), `cursor` |
| `memory_munch_path_lookup` | `path` | `max_tokens`, `limit` (default 20) |
| `memory_munch_text_search` | `query` | `path_prefix`, `max_tokens`, `limit` (default 20) |
| `memory_munch_chunk_fetch` | `chunk_id` | — |

### Recommended call order

1. If you can infer a likely path → `memory_munch_path_lookup` directly.
2. If the domain is unknown → `memory_munch_path_root` → `memory_munch_path_children` → `memory_munch_path_lookup`.
3. If path navigation finds nothing → `memory_munch_text_search`.
4. If a snippet is insufficient → `memory_munch_chunk_fetch` on the specific `chunk_id` from a previous result.

Path navigation is faster, cheaper, and deterministic. Prefer it over text search when the structure of your memory files is known.

---

## OpenClaw plugin

`extensions/memory-munch-tools/` is the packaged OpenClaw plugin that wraps the Python backend.

### Model-facing tools

Three tools are always registered and are the primary interface for agents:

| Tool | Behavior |
|---|---|
| `memory_search` | Text search with native fallback. Returns results in OpenClaw's native `memory_search` schema (`results`, `provider`, `model`). Falls back to OpenClaw's native vector search if FTS finds nothing. |
| `memory_get` | Reads a bounded line range from the source file directly (not the chunk index). Accepts `path`, `from`, `lines`. Matches OpenClaw's built-in `memory_get` schema. |
| `memory_lookup` | Path-first retrieval: routes through `path_lookup` when the query looks like a dot-path, otherwise falls back to `text_search`. Registered as optional. |

The `memory_search` tool matches OpenClaw's built-in name, so agents and skills that call `memory_search` are routed through memory-munch without any changes to the agent.

When `exposeRawTools` is `true`, the five low-level `memory_munch_*` tools are also registered (see [MCP tools](#mcp-tools)).

### Plugin config options

These options are set in the OpenClaw plugin config (written by the install script, or set manually via `openclaw config set`):

| Option | Default | Description |
|---|---|---|
| `pythonBin` | repo `.venv/bin/python` or `python3` | Python executable used to run the bridge script |
| `bridgeScript` | `openclaw_memory_munch_bridge.py` | Path to the bridge CLI script |
| `configPath` | `~/.openclaw/workspace/dmemorymunch-mpc.toml` | Path to the dmemorymunch config file |
| `timeoutMs` | `15000` | Bridge subprocess timeout in milliseconds |
| `autoInjectPromptContext` | `false` | Prepend memory snippets before each user message |
| `exposeRawTools` | `false` | Register the low-level `memory_munch_*` tools (for power users and debugging) |
| `autoIndexWatch` | `true` | Run a plugin-managed background watcher to keep the index up to date |
| `autoIndexWatchIntervalSec` | `1.5` | Polling interval for the background watcher (minimum 0.5) |

Environment variable overrides: `MEMORY_MUNCH_PYTHON`, `MEMORY_MUNCH_BRIDGE`, `MEMORY_MUNCH_CONFIG`, `MEMORY_MUNCH_AUTO_INJECT=1`, `MEMORY_MUNCH_EXPOSE_RAW_TOOLS=1`, `MEMORY_MUNCH_AUTO_INDEX_WATCH=0` (set to `0` to disable).

### Auto-inject mode

When `autoInjectPromptContext` is `true`, a `before_prompt_build` hook fires before each real user message. It runs a text search against the prompt, then prepends up to 6 matching snippets (capped at 1,200 tokens) as `[Memory context]` blocks. Heartbeat, memory-flush, and cron triggers are skipped.

### Install script options

```bash
./scripts/install_openclaw_memory_munch_plugin.sh [options]
```

| Option | Default | Description |
|---|---|---|
| `--state-dir <dir>` | `~/.openclaw` | OpenClaw state directory |
| `--workspace <dir>` | `<state-dir>/workspace` | OpenClaw workspace directory |
| `--config <path>` | `<workspace>/dmemorymunch-mpc.toml` | Config file path |
| `--python <path>` | repo `.venv/bin/python` or `python3` | Python executable |
| `--timeout-ms <n>` | `15000` | Bridge subprocess timeout |
| `--allowlist-mode <m>` | `prompt` | `prompt` / `enable` / `skip` |
| `--auto-inject-prompt` | `false` | `true` to enable `before_prompt_build` hook |
| `--expose-raw-tools` | `false` | `true` to register low-level `memory_munch_*` tools |
| `--auto-index-watch` | `true` | `false` to disable the plugin-managed background watcher |
| `--watch-interval-sec` | `1.5` | Watcher polling interval (minimum 0.5) |
| `--backup-root <dir>` | `<state-dir>/backups/memory-munch-tools` | Backup directory for pre-install snapshots |
| `--no-restart` | — | Skip daemon restart after install |

The script copies the plugin to `~/.openclaw/extensions/`, writes config to `openclaw.json`, and sets the memory plugin slot to `memory-munch-tools`. Backups of all modified files are written to the backup directory before any changes.

To undo: `./scripts/undo_openclaw_memory_munch_install.sh`

---

## Full configuration reference

Config file: `~/.openclaw/workspace/dmemorymunch-mpc.toml` (or the path passed via `--config`).

All fields are optional; defaults shown.

```toml
# SQLite database path, relative to this config file or absolute.
db_path = ".memorymunch/memory.db"

# Directories to scan. "~/" prefix is expanded to the user's home directory.
roots = ["~/.openclaw/workspace"]

# Glob patterns for files to include, relative to each root.
include_globs = ["MEMORY.md", "memory/**/*.md"]

# Glob patterns for files to exclude. Checked before include_globs.
exclude_globs = [
  ".git/**", ".pytest_cache/**", "node_modules/**", ".venv/**",
  "dist/**", "build/**", ".secrets/**", "private/**",
  "**/*password*.md", "**/*secret*.md", "**/*token*.md",
]

# Follow symbolic links during file discovery.
follow_symlinks = false

# Hard token cap on every tool response.
max_tokens_per_query = 1200

# Characters to include in FTS snippet fields.
snippet_chars = 200
```

**`db_path`** — The database is resolved relative to the config file's directory. Use an absolute path if you want it to live somewhere else.

**`roots`** — Each root is scanned independently. Paths from different roots never collide because the full directory path is encoded into each lookup path prefix.

**`include_globs`** — Evaluated relative to each root directory. The defaults cover the standard OpenClaw memory layout. Add entries here if your memory files live in other locations within a root.

**`exclude_globs`** — Evaluated before `include_globs`. Files matching any exclude pattern are skipped entirely.

**`max_tokens_per_query`** — Applied as a hard cap after all retrieval stages. Token count is estimated at 4 characters per token.

**`snippet_chars`** — Controls the length of the FTS snippet field returned with each chunk. Does not affect full chunk content retrieved via `chunk_fetch`.

---

## Full CLI reference

Two executables are installed:

- `dmemorymunch-mpc` — MCP stdio server (registered with OpenClaw; not called directly in normal use)
- `dmemorymunch-mpc-admin` — administrative commands

### `dmemorymunch-mpc`

```
dmemorymunch-mpc [--config PATH] [--db PATH]
```

Starts the MCP server on stdio. OpenClaw invokes this automatically; you do not run it directly.

### `dmemorymunch-mpc-admin` commands

All commands accept `--config PATH` and `--db PATH`.

| Command | Description |
|---|---|
| `init-db` | Create the database and apply schema migrations. Safe to re-run. |
| `index --scope changed` | Re-index changed files only (default). |
| `index --scope all` | Force re-index all files. |
| `reindex` | Alias for `index --scope all`. |
| `watch [--interval N]` | Poll for changes and reindex continuously (Ctrl+C to stop). Default interval: 1.5 s. |
| `stats [--namespace-prefix P]` | Print chunk count and largest chunks, optionally scoped to a path prefix. |
| `doctor` | Run `PRAGMA integrity_check` and verify FTS row count matches chunks. |
| `savings` | Print cumulative token savings and estimated cost avoided. |
| `serve` | Run the MCP server (same as `dmemorymunch-mpc`). |

---

## Token savings calculation

Each tool response includes a `_meta` block with:

- `raw_tokens_estimate` — estimated tokens in the source files that contributed chunks to the result
- `response_tokens_estimate` — estimated tokens in the actual response
- `tokens_saved` — the difference (tokens not sent to the model)
- `total_tokens_saved` — cumulative since installation
- `cost_avoided` — estimated dollar savings at current pricing for Claude Opus and GPT-5

Savings are persisted to `~/.memorymunch/_savings.json` and accessible via `dmemorymunch-mpc-admin savings` or the `/savings` plugin command.

The estimate is conservative: it measures retrieval savings only, based on `(raw_file_bytes - response_bytes) / 4`. It does not account for files that would otherwise be loaded wholesale into the context at session start.

---

## The subprocess bridge

Each OpenClaw tool call spawns `openclaw_memory_munch_bridge.py` as a subprocess. The bridge is a thin CLI over the same Python functions used by the MCP server. Each invocation is independent. A configurable timeout (default 15 s) kills the subprocess if it hangs.

The bridge accepts the same operations as the MCP tools: `path_root`, `path_children`, `path_lookup`, `text_search`, `chunk_fetch`, `savings`. It reads from the same SQLite database the indexer writes to.

### Background watcher service

When `autoIndexWatch` is `true` (the default), the plugin registers an OpenClaw service that runs `dmemorymunch-mpc-admin watch` as a managed background process. The service starts with the OpenClaw daemon and stops cleanly on daemon shutdown (SIGTERM, with a 2-second SIGKILL fallback). This is separate from the per-call bridge subprocess — the watcher runs continuously; the bridge is spawned on demand.

Disable the watcher:

```bash
openclaw config set plugins.entries.memory-munch-tools.config.autoIndexWatch false
openclaw daemon restart
```

---

## Requirements

| | |
|---|---|
| Python | 3.11 or newer |
| SQLite | Bundled with Python; no separate install needed |
| Embedding model | Not used |
| External services | None — fully local |
| OpenClaw | Required for plugin installation |
| Disk space | A typical personal memory corpus (a few hundred KB of Markdown) produces a database under 5 MB |
